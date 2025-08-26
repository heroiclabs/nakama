// Copyright 2022 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"bytes"
	"context"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrSubscriptionsListInvalidCursor = errors.New("subscriptions list cursor invalid")
var ErrSubscriptionNotFound = errors.New("subscription not found")
var ErrSkipNotification = errors.New("skip notification")

type subscriptionsListCursor struct {
	OriginalTransactionId string
	PurchaseTime          *timestamppb.Timestamp
	UserId                string
	IsNext                bool
}

func ListSubscriptions(ctx context.Context, logger *zap.Logger, db *sql.DB, userID string, limit int, cursor string) (*api.SubscriptionList, error) {
	var incomingCursor *subscriptionsListCursor
	if cursor != "" {
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, ErrSubscriptionsListInvalidCursor
		}
		incomingCursor = &subscriptionsListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrSubscriptionsListInvalidCursor
		}
		if userID != "" && userID != incomingCursor.UserId {
			// userID filter was set and has changed, cursor is now invalid
			return nil, ErrSubscriptionsListInvalidCursor
		}
	}

	comparisonOp := "<="
	sortConf := "DESC"
	if incomingCursor != nil && !incomingCursor.IsNext {
		comparisonOp = ">"
		sortConf = "ASC"
	}

	params := make([]interface{}, 0, 4)
	predicateConf := ""
	if incomingCursor != nil {
		if userID == "" {
			predicateConf = fmt.Sprintf(" WHERE (user_id, purchase_time, original_transaction_id) %s ($1, $2, $3)", comparisonOp)
		} else {
			predicateConf = fmt.Sprintf(" WHERE user_id = $1 AND (purchase_time, original_transaction_id) %s ($2, $3)", comparisonOp)
		}
		params = append(params, incomingCursor.UserId, incomingCursor.PurchaseTime.AsTime(), incomingCursor.OriginalTransactionId)
	} else {
		if userID != "" {
			predicateConf = " WHERE user_id = $1"
			params = append(params, userID)
		}
	}

	if limit > 0 {
		params = append(params, limit+1)
	} else {
		params = append(params, 101) // Default limit to 100 subscriptions if not set
	}

	query := fmt.Sprintf(`
	SELECT
			original_transaction_id,
			user_id,
			product_id,
			store,
			purchase_time,
			create_time,
			update_time,
			expire_time,
			refund_time,
			environment,
			raw_response,
			raw_notification
	FROM
			subscription
	%s
	ORDER BY purchase_time %s LIMIT $%v`, predicateConf, sortConf, len(params))

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving subscriptions.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	var nextCursor *purchasesListCursor
	var prevCursor *purchasesListCursor
	subscriptions := make([]*api.ValidatedSubscription, 0, limit)

	for rows.Next() {
		var originalTransactionId string
		var dbUserID uuid.UUID
		var productId string
		var store api.StoreProvider
		var purchaseTime pgtype.Timestamptz
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var expireTime pgtype.Timestamptz
		var refundTime pgtype.Timestamptz
		var environment api.StoreEnvironment
		var rawResponse string
		var rawNotification string

		if err = rows.Scan(&originalTransactionId, &dbUserID, &productId, &store, &purchaseTime, &createTime, &updateTime, &expireTime, &refundTime, &environment, &rawResponse, &rawNotification); err != nil {
			logger.Error("Error retrieving subscriptions.", zap.Error(err))
			return nil, err
		}

		if len(subscriptions) >= limit {
			nextCursor = &purchasesListCursor{
				TransactionId: originalTransactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        dbUserID.String(),
				IsNext:        true,
			}
			break
		}

		active := false
		if expireTime.Time.After(time.Now()) {
			active = true
		}
		if refundTime.Time.Unix() > 0 {
			active = false
		}

		suid := dbUserID.String()
		if dbUserID.IsNil() {
			suid = ""
		}

		subscription := &api.ValidatedSubscription{
			UserId:                suid,
			ProductId:             productId,
			OriginalTransactionId: originalTransactionId,
			Store:                 store,
			PurchaseTime:          timestamppb.New(purchaseTime.Time),
			CreateTime:            timestamppb.New(createTime.Time),
			UpdateTime:            timestamppb.New(updateTime.Time),
			ExpiryTime:            timestamppb.New(expireTime.Time),
			RefundTime:            timestamppb.New(refundTime.Time),
			Active:                active,
			Environment:           environment,
			ProviderResponse:      rawResponse,
			ProviderNotification:  rawNotification,
		}

		subscriptions = append(subscriptions, subscription)

		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &purchasesListCursor{
				TransactionId: originalTransactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        dbUserID.String(),
				IsNext:        false,
			}
		}
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving subscriptions.", zap.Error(err))
		return nil, err
	}

	if incomingCursor != nil && !incomingCursor.IsNext {
		if nextCursor != nil && prevCursor != nil {
			nextCursor, nextCursor.IsNext, prevCursor, prevCursor.IsNext = prevCursor, prevCursor.IsNext, nextCursor, nextCursor.IsNext
		} else if nextCursor != nil {
			nextCursor, prevCursor = nil, nextCursor
			prevCursor.IsNext = !prevCursor.IsNext
		} else if prevCursor != nil {
			nextCursor, prevCursor = prevCursor, nil
			nextCursor.IsNext = !nextCursor.IsNext
		}

		for i, j := 0, len(subscriptions)-1; i < j; i, j = i+1, j-1 {
			subscriptions[i], subscriptions[j] = subscriptions[j], subscriptions[i]
		}
	}

	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating subscriptions list cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating subscriptions list cursor", zap.Error(err))
			return nil, err
		}
		prevCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return &api.SubscriptionList{ValidatedSubscriptions: subscriptions, Cursor: nextCursorStr, PrevCursor: prevCursorStr}, nil
}

func handleValidatedSubscriptions(ctx context.Context, db *sql.DB, storageSubscriptions []*runtime.StorageSubscription, persist bool, logger *zap.Logger) (*api.ValidatePurchaseProviderSubscriptionResponse, error) {
	if !persist {
		validatedSubs := make([]*api.ValidatedSubscription, 0, len(storageSubscriptions))
		for _, s := range storageSubscriptions {
			validatedSubs = append(validatedSubs, &api.ValidatedSubscription{
				UserId:                s.UserID.String(),
				ProductId:             s.ProductId,
				OriginalTransactionId: s.OriginalTransactionId,
				Store:                 api.StoreProvider_APPLE_APP_STORE,
				PurchaseTime:          timestamppb.New(s.PurchaseTime),
				Environment:           s.Environment,
				Active:                s.Active,
				ExpiryTime:            timestamppb.New(s.ExpireTime),
				ProviderResponse:      s.RawResponse,
				ProviderNotification:  s.RawNotification,
			})
		}

		return &api.ValidatePurchaseProviderSubscriptionResponse{ValidatedSubscription: validatedSubs}, nil
	}

	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		if err := iap.UpsertSubscriptions(ctx, tx, storageSubscriptions); err != nil {
			return err
		}
		return nil
	}); err != nil {
		if errors.Is(err, ErrSkipNotification) {
			logger.Error("Failed to store provider subscription data", zap.Error(err))
			return nil, err
		}
	}

	validatedSubs := make([]*api.ValidatedSubscription, 0, len(storageSubscriptions))

	for _, sub := range storageSubscriptions {
		var validatedSub api.ValidatedSubscription
		suid := sub.UserID.String()
		if sub.UserID.IsNil() {
			suid = ""
		}

		validatedSub.UserId = suid
		validatedSub.CreateTime = timestamppb.New(sub.CreateTime)
		validatedSub.UpdateTime = timestamppb.New(sub.UpdateTime)
		validatedSub.ProviderResponse = sub.RawResponse
		validatedSub.ProviderNotification = sub.RawNotification

		validatedSubs = append(validatedSubs, &validatedSub)
	}

	return &api.ValidatePurchaseProviderSubscriptionResponse{ValidatedSubscription: validatedSubs}, nil
}

func ValidateSubscription(ctx context.Context, logger *zap.Logger, db *sql.DB, purchaseProvider runtime.PurchaseProvider, in *api.ValidateSubscriptionRequest, userID uuid.UUID, persist bool) (*api.ValidatePurchaseProviderSubscriptionResponse, error) {
	storageSubs, err := purchaseProvider.SubscriptionValidate(ctx, in, userID.String())
	if err != nil {
		return nil, err
	}

	// handle upsert and persist here
	response, err := handleValidatedSubscriptions(ctx, db, storageSubs, persist, logger)
	if err != nil {
		return nil, err
	}

	return response, nil
}

func ValidateSubscriptionApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	validation, rawResponse, err := iap.ValidateReceiptApple(ctx, iap.Httpc, receipt, password)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Error("Error validating Apple receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr
			} else {
				logger.Error("Error validating Apple receipt", zap.Error(err))
			}
		}
		return nil, err
	}

	if validation.Status != iap.AppleReceiptIsValid {
		if validation.IsRetryable {
			return nil, status.Error(codes.Unavailable, "Apple IAP verification is currently unavailable. Try again later.")
		}
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. Status: %d", validation.Status))
	}

	env := api.StoreEnvironment_PRODUCTION
	if validation.Environment == iap.AppleSandboxEnvironment {
		env = api.StoreEnvironment_SANDBOX
	}

	validatedSubs := make([]*api.ValidatedSubscription, 0)
	for _, latestReceiptInfo := range validation.LatestReceiptInfo {
		if latestReceiptInfo.ExpiresDateMs == "" {
			// Not a subscription, skip.
			continue
		}

		purchaseTimeUnix, err := strconv.ParseInt(latestReceiptInfo.OriginalPurchaseDateMs, 10, 64)
		if err != nil {
			return nil, err
		}

		expireTimeIntUnix, err := strconv.ParseInt(latestReceiptInfo.ExpiresDateMs, 10, 64)
		if err != nil {
			return nil, err
		}

		expireTime := iap.ParseMillisecondUnixTimestamp(expireTimeIntUnix)
		purchaseTime := iap.ParseMillisecondUnixTimestamp(purchaseTimeUnix)

		active := false
		if expireTime.After(time.Now()) {
			active = true
		}

		validatedSub := &api.ValidatedSubscription{
			UserId:                userID.String(),
			ProductId:             latestReceiptInfo.ProductId,
			OriginalTransactionId: latestReceiptInfo.OriginalTransactionId,
			Store:                 api.StoreProvider_APPLE_APP_STORE,
			PurchaseTime:          timestamppb.New(purchaseTime),
			Environment:           env,
			Active:                active,
			ExpiryTime:            timestamppb.New(expireTime),
			ProviderResponse:      string(rawResponse),
		}

		validatedSubs = append(validatedSubs, validatedSub)
	}
	if len(validatedSubs) == 0 {
		// Receipt is for a purchase (or otherwise has no subscriptions for any reason) so ValidatePurchaseApple should be used instead.
		return nil, status.Error(codes.FailedPrecondition, "Purchase Receipt. Use the appropriate function instead.")
	}

	if !persist {
		// First validated sub is the one with the highest expiry time.
		return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSubs[0]}, nil
	}

	err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		for _, sub := range validatedSubs {
			storageSub := &runtime.StorageSubscription{
				UserID:                userID,
				Store:                 api.StoreProvider_APPLE_APP_STORE,
				ProductId:             sub.ProductId,
				OriginalTransactionId: sub.OriginalTransactionId,
				PurchaseTime:          sub.PurchaseTime.AsTime(),
				Environment:           env,
				ExpireTime:            sub.ExpiryTime.AsTime(),
				RawResponse:           string(rawResponse),
			}

			if err = iap.UpsertSubscription(ctx, tx, storageSub); err != nil {
				return err
			}

			suid := storageSub.UserID.String()
			if storageSub.UserID.IsNil() {
				suid = ""
			}

			sub.UserId = suid
			sub.CreateTime = timestamppb.New(storageSub.CreateTime)
			sub.UpdateTime = timestamppb.New(storageSub.UpdateTime)
			sub.ProviderResponse = storageSub.RawResponse
			sub.ProviderNotification = storageSub.RawNotification
		}

		return nil
	})
	if err != nil {
		logger.Error("Failed to upsert Apple subscription receipt", zap.Error(err))
		return nil, err
	}

	// First validated sub is the one with the highest expiry time.
	return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSubs[0]}, nil
}

func ValidateSubscriptionGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPGoogleConfig, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	gResponse, gReceipt, rawResponse, err := iap.ValidateSubscriptionReceiptGoogle(ctx, iap.Httpc, config.ClientEmail, config.PrivateKey, receipt)
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Error("Error validating Google receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr
			} else {
				logger.Error("Error validating Google receipt", zap.Error(err))
			}
		}
		return nil, err
	}

	purchaseEnv := api.StoreEnvironment_PRODUCTION
	if gResponse.PurchaseType == 0 {
		purchaseEnv = api.StoreEnvironment_SANDBOX
	}

	expireTimeInt, err := strconv.ParseInt(gResponse.ExpiryTimeMillis, 10, 64)
	if err != nil {
		return nil, err
	}

	expireTime := iap.ParseMillisecondUnixTimestamp(expireTimeInt)

	active := false
	if expireTime.After(time.Now()) {
		active = true
	}

	storageSub := &runtime.StorageSubscription{
		OriginalTransactionId: gReceipt.PurchaseToken,
		UserID:                userID,
		Store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
		ProductId:             gReceipt.ProductID,
		PurchaseTime:          iap.ParseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		Environment:           purchaseEnv,
		ExpireTime:            expireTime,
		RawResponse:           string(rawResponse),
	}

	if gResponse.LinkedPurchaseToken != "" {
		// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
		storageSub.OriginalTransactionId = gResponse.LinkedPurchaseToken
	}

	validatedSub := &api.ValidatedSubscription{
		UserId:                userID.String(),
		ProductId:             storageSub.ProductId,
		OriginalTransactionId: storageSub.OriginalTransactionId,
		Store:                 storageSub.Store,
		PurchaseTime:          timestamppb.New(storageSub.PurchaseTime),
		Environment:           storageSub.Environment,
		Active:                active,
		ExpiryTime:            timestamppb.New(storageSub.ExpireTime),
		ProviderResponse:      storageSub.RawResponse,
		ProviderNotification:  storageSub.RawNotification,
	}

	if !persist {
		return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
	}

	if err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		return iap.UpsertSubscription(ctx, tx, storageSub)
	}); err != nil {
		logger.Error("Failed to upsert Google subscription receipt", zap.Error(err))
		return nil, err
	}

	suid := storageSub.UserID.String()
	if storageSub.UserID.IsNil() {
		suid = ""
	}

	validatedSub.UserId = suid
	validatedSub.CreateTime = timestamppb.New(storageSub.CreateTime)
	validatedSub.UpdateTime = timestamppb.New(storageSub.UpdateTime)
	validatedSub.ProviderResponse = storageSub.RawResponse
	validatedSub.ProviderNotification = storageSub.RawNotification

	return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
}

func GetSubscriptionByProductId(ctx context.Context, logger *zap.Logger, db *sql.DB, userID, productID string) (*api.ValidatedSubscription, error) {
	var originalTransactionId string
	var dbUserID uuid.UUID
	var dbProductID string
	var store api.StoreProvider
	var purchaseTime pgtype.Timestamptz
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	var expireTime pgtype.Timestamptz
	var environment api.StoreEnvironment
	var rawResponse string
	var rawNotification string

	if err := db.QueryRowContext(ctx, `
SELECT
    original_transaction_id,
    user_id,
    product_id,
    store,
    purchase_time,
    create_time,
    update_time,
    expire_time,
    environment,
    raw_response,
    raw_notification
FROM
    subscription
WHERE
    user_id = $1 AND
    product_id = $2
`, userID, productID).Scan(&originalTransactionId, &dbUserID, &dbProductID, &store, &purchaseTime, &createTime, &updateTime, &expireTime, &environment, &rawResponse, &rawNotification); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrSubscriptionNotFound
		}
		logger.Error("Failed to get subscription", zap.Error(err))
		return nil, err
	}

	active := false
	if expireTime.Time.After(time.Now()) {
		active = true
	}

	suid := dbUserID.String()
	if dbUserID.IsNil() {
		suid = ""
	}

	return &api.ValidatedSubscription{
		UserId:                suid,
		ProductId:             productID,
		OriginalTransactionId: originalTransactionId,
		Store:                 store,
		PurchaseTime:          timestamppb.New(purchaseTime.Time),
		CreateTime:            timestamppb.New(createTime.Time),
		UpdateTime:            timestamppb.New(updateTime.Time),
		Environment:           environment,
		ExpiryTime:            timestamppb.New(expireTime.Time),
		Active:                active,
		ProviderResponse:      rawResponse,
		ProviderNotification:  rawNotification,
	}, nil
}

// Store providers notification callback handler functions
func appleNotificationHandler(logger *zap.Logger, db *sql.DB, purchaseNotificationCallback RuntimePurchaseNotificationAppleFunction, subscriptionNotificationCallback RuntimeSubscriptionNotificationAppleFunction) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.Error("Failed to decode App Store notification body", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer r.Body.Close()

		var applePayload *iap.AppleNotificationSignedPayload
		if err := json.Unmarshal(body, &applePayload); err != nil {
			logger.Error("Failed to unmarshal App Store notification", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		tokens := strings.Split(applePayload.SignedPayload, ".")
		if len(tokens) < 3 {
			logger.Error("Unexpected App Store notification JWS token length")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		seg := tokens[0]
		if l := len(seg) % 4; l > 0 {
			seg += strings.Repeat("=", 4-l)
		}

		headerByte, err := base64.StdEncoding.DecodeString(seg)
		if err != nil {
			logger.Error("Failed to decode Apple notification JWS header", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		type Header struct {
			Alg string   `json:"alg"`
			X5c []string `json:"x5c"`
		}
		var header Header

		if err = json.Unmarshal(headerByte, &header); err != nil {
			logger.Error("Failed to unmarshal Apple notification JWS header", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		certs := make([][]byte, 0)
		for _, encodedCert := range header.X5c {
			cert, err := base64.StdEncoding.DecodeString(encodedCert)
			if err != nil {
				logger.Error("Failed to decode Apple notification JWS header certificate", zap.Error(err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			certs = append(certs, cert)
		}

		rootCert := x509.NewCertPool()
		ok := rootCert.AppendCertsFromPEM([]byte(iap.AppleRootPEM))
		if !ok {
			logger.Error("Failed to parse Apple root certificate", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		interCert, err := x509.ParseCertificate(certs[1])
		if err != nil {
			logger.Error("Failed to parse Apple notification intermediate certificate", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		intermedia := x509.NewCertPool()
		intermedia.AddCert(interCert)

		cert, err := x509.ParseCertificate(certs[2])
		if err != nil {
			logger.Error("Failed to parse Apple notification certificate", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		opts := x509.VerifyOptions{
			Roots:         rootCert,
			Intermediates: intermedia,
		}

		_, err = cert.Verify(opts)
		if err != nil {
			logger.Error("Failed to validate Apple notification signature", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		seg = tokens[1]
		if l := len(seg) % 4; l > 0 {
			seg += strings.Repeat("=", 4-l)
		}

		jsonPayload, err := base64.StdEncoding.DecodeString(seg)
		if err != nil {
			logger.Error("Failed to base64 decode App Store notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var notificationPayload *iap.AppleNotificationPayload
		if err = json.Unmarshal(jsonPayload, &notificationPayload); err != nil {
			logger.Error("Failed to json unmarshal App Store notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		tokens = strings.Split(notificationPayload.Data.SignedTransactionInfo, ".")
		if len(tokens) < 3 {
			logger.Error("Unexpected App Store notification SignedTransactionInfo JWS token length")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		seg = tokens[1]
		if l := len(seg) % 4; l > 0 {
			seg += strings.Repeat("=", 4-l)
		}

		jsonPayload, err = base64.StdEncoding.DecodeString(seg)
		if err != nil {
			logger.Error("Failed to base64 decode App Store notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var signedTransactionInfo *iap.AppleNotificationTransactionInfo
		if err = json.Unmarshal(jsonPayload, &signedTransactionInfo); err != nil {
			logger.Error("Failed to json unmarshal App Store notification SignedTransactionInfo JWS token", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		logger.Debug("Apple IAP notification received", zap.Any("notification_payload", signedTransactionInfo))

		uid := uuid.Nil
		if signedTransactionInfo.AppAccountToken != "" {
			tokenUID, err := uuid.FromString(signedTransactionInfo.AppAccountToken)
			if err != nil {
				logger.Warn("App Store subscription notification AppAccountToken is an invalid uuid", zap.String("app_account_token", signedTransactionInfo.AppAccountToken), zap.Error(err), zap.String("payload", string(body)))
			} else {
				uid = tokenUID
			}
		}

		env := api.StoreEnvironment_PRODUCTION
		if notificationPayload.Data.Environment == iap.AppleSandboxEnvironment {
			env = api.StoreEnvironment_SANDBOX
		}

		if signedTransactionInfo.ExpiresDateMs != 0 {
			// Notification regarding a subscription.
			if uid.IsNil() {
				// No user ID was found in receipt, lookup a validated subscription.
				s, err := iap.GetSubscriptionByOriginalTransactionId(r.Context(), logger, db, signedTransactionInfo.OriginalTransactionId)
				if err != nil || s == nil {
					w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
					return
				}
				if s.UserId != "" {
					uid = uuid.Must(uuid.FromString(s.UserId))
				}
			}

			sub := &runtime.StorageSubscription{
				UserID:                uid,
				OriginalTransactionId: signedTransactionInfo.OriginalTransactionId,
				Store:                 api.StoreProvider_APPLE_APP_STORE,
				ProductId:             signedTransactionInfo.ProductId,
				PurchaseTime:          iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.OriginalPurchaseDateMs),
				Environment:           env,
				ExpireTime:            iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.ExpiresDateMs),
				RawNotification:       string(body),
				RefundTime:            iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.RevocationDateMs),
			}

			if err = ExecuteInTx(r.Context(), db, func(tx *sql.Tx) error {
				if err = iap.UpsertSubscription(r.Context(), tx, sub); err != nil {
					var pgErr *pgconn.PgError
					if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
						// User id was not found, ignore this notification
						return ErrSkipNotification
					}
					return err
				}
				return nil
			}); err != nil {
				if errors.Is(err, ErrSkipNotification) {
					w.WriteHeader(http.StatusOK)
					return
				}
				logger.Error("Failed to store App Store notification subscription data", zap.Error(err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			active := false
			if sub.ExpireTime.After(time.Now()) && sub.RefundTime.Unix() == 0 {
				active = true
			}

			var suid string
			if !sub.UserID.IsNil() {
				suid = sub.UserID.String()
			}

			if strings.ToUpper(notificationPayload.NotificationType) == iap.AppleNotificationTypeRefund {
				validatedSub := &api.ValidatedSubscription{
					UserId:                suid,
					ProductId:             sub.ProductId,
					OriginalTransactionId: sub.OriginalTransactionId,
					Store:                 api.StoreProvider_APPLE_APP_STORE,
					PurchaseTime:          timestamppb.New(sub.PurchaseTime),
					CreateTime:            timestamppb.New(sub.CreateTime),
					UpdateTime:            timestamppb.New(sub.UpdateTime),
					Environment:           env,
					ExpiryTime:            timestamppb.New(sub.ExpireTime),
					RefundTime:            timestamppb.New(sub.RefundTime),
					ProviderResponse:      sub.RawResponse,
					ProviderNotification:  sub.RawNotification,
					Active:                active,
				}

				if subscriptionNotificationCallback != nil {
					if err = subscriptionNotificationCallback(r.Context(), validatedSub, string(body)); err != nil {
						logger.Error("Error invoking Apple subscription refund runtime function", zap.Error(err))
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			}

		} else {
			// Notification regarding a purchase.
			if uid.IsNil() {
				// No user ID was found in receipt, lookup a validated subscription.
				p, err := iap.GetPurchaseByTransactionId(r.Context(), logger, db, signedTransactionInfo.TransactionId)
				if err != nil || p == nil {
					// User validated purchase not found.
					w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
					return
				}
				uid = uuid.Must(uuid.FromString(p.UserId))
			}

			if strings.ToUpper(notificationPayload.NotificationType) == iap.AppleNotificationTypeRefund {
				purchase := &runtime.StoragePurchase{
					UserID:        uid,
					Store:         api.StoreProvider_APPLE_APP_STORE,
					ProductId:     signedTransactionInfo.ProductId,
					TransactionId: signedTransactionInfo.TransactionId,
					PurchaseTime:  iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.PurchaseDateMs),
					RefundTime:    iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.RevocationDateMs),
					Environment:   env,
				}

				dbPurchases, err := iap.UpsertPurchases(r.Context(), db, []*runtime.StoragePurchase{purchase})
				if err != nil {
					logger.Error("Failed to store App Store notification purchase data")
					w.WriteHeader(http.StatusInternalServerError)
					return
				}

				if purchaseNotificationCallback != nil {
					dbPurchase := dbPurchases[0]
					suid := dbPurchase.UserID.String()
					if dbPurchase.UserID.IsNil() {
						suid = ""
					}
					validatedPurchase := &api.ValidatedPurchase{
						UserId:           suid,
						ProductId:        signedTransactionInfo.ProductId,
						TransactionId:    signedTransactionInfo.TransactionId,
						Store:            api.StoreProvider_APPLE_APP_STORE,
						CreateTime:       timestamppb.New(dbPurchase.CreateTime),
						UpdateTime:       timestamppb.New(dbPurchase.UpdateTime),
						PurchaseTime:     timestamppb.New(dbPurchase.PurchaseTime),
						RefundTime:       timestamppb.New(dbPurchase.RefundTime),
						ProviderResponse: string(body),
						Environment:      env,
						SeenBefore:       dbPurchase.SeenBefore,
					}

					if err = purchaseNotificationCallback(r.Context(), validatedPurchase, string(body)); err != nil {
						logger.Error("Error invoking Apple purchase refund runtime function", zap.Error(err))
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			}
		}

		w.WriteHeader(http.StatusOK)
	}
}

func googleNotificationHandler(logger *zap.Logger, db *sql.DB, config *IAPGoogleConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.Error("Failed to decode App Store notification body", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer r.Body.Close()

		logger = logger.With(zap.String("notification_body", string(body)))

		var notification *iap.GoogleStoreNotification
		if err := json.Unmarshal(body, &notification); err != nil {
			logger.Error("Failed to unmarshal Google Play Billing notification", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		jsonData, err := base64.URLEncoding.DecodeString(notification.Message.Data)
		if err != nil {
			logger.Error("Failed to base64 decode Google Play Billing notification data")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var googleNotification *iap.GoogleDeveloperNotification
		if err = json.Unmarshal(jsonData, &googleNotification); err != nil {
			logger.Error("Failed to json unmarshal Google Play Billing notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if googleNotification.SubscriptionNotification == nil {
			// Notification is not for subscription, ack and return. https://developer.android.com/google/play/billing/rtdn-reference#one-time
			w.WriteHeader(http.StatusOK)
			return
		}

		receipt := &iap.ReceiptGoogle{
			PurchaseToken: googleNotification.SubscriptionNotification.PurchaseToken,
			ProductID:     googleNotification.SubscriptionNotification.SubscriptionId,
			PackageName:   googleNotification.PackageName,
		}

		encodedReceipt, err := json.Marshal(receipt)
		if err != nil {
			logger.Error("Failed to marshal Google receipt.", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		gResponse, _, _, err := iap.ValidateSubscriptionReceiptGoogle(r.Context(), iap.Httpc, config.ClientEmail, config.PrivateKey, string(encodedReceipt))
		if err != nil {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Error("Error validating Google receipt in notification callback", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
			} else {
				logger.Error("Error validating Google receipt in notification callback", zap.Error(err))
			}
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		logger.Debug("Google IAP subscription notification received", zap.String("notification_payload", string(jsonData)), zap.Any("api_response", gResponse))

		var uid uuid.UUID
		if gResponse.ObfuscatedExternalAccountId != "" {
			extUID, err := uuid.FromString(gResponse.ObfuscatedExternalAccountId)
			if err != nil {
				w.WriteHeader(http.StatusOK)
				return
			}
			uid = extUID
		} else if gResponse.ObfuscatedExternalProfileId != "" {
			extUID, err := uuid.FromString(gResponse.ObfuscatedExternalProfileId)
			if err != nil {
				w.WriteHeader(http.StatusOK)
				return
			}
			uid = extUID
		} else if gResponse.ProfileId != "" {
			var dbUID uuid.UUID
			if err = db.QueryRowContext(r.Context(), "SELECT id FROM users WHERE google_id = $1", gResponse.ProfileId).Scan(&dbUID); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					logger.Warn("Google Play Billing subscription notification user not found", zap.String("profile_id", gResponse.ProfileId), zap.String("payload", string(body)))
					w.WriteHeader(http.StatusOK) // Subscription could not be assigned to a user ID, ack and ignore it.
					return
				}
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			uid = dbUID
		} else {
			// Get user id by existing validated subscription.
			purchaseToken := googleNotification.SubscriptionNotification.PurchaseToken
			if gResponse.LinkedPurchaseToken != "" {
				// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
				purchaseToken = gResponse.LinkedPurchaseToken
			}
			sub, err := iap.GetSubscriptionByOriginalTransactionId(r.Context(), logger, db, purchaseToken)
			if err != nil || sub == nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			if sub.UserId != "" {
				uid = uuid.Must(uuid.FromString(sub.UserId))
			}
		}

		env := api.StoreEnvironment_PRODUCTION
		if gResponse.PurchaseType == 0 {
			env = api.StoreEnvironment_SANDBOX
		}

		expireTimeInt, err := strconv.ParseInt(gResponse.ExpiryTimeMillis, 10, 64)
		if err != nil {
			logger.Error("Failed to convert Google Play Billing notification 'ExpiryTimeMillis' string to int", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		purchaseTime, err := strconv.ParseInt(gResponse.StartTimeMillis, 10, 64)
		if err != nil {
			logger.Error("Failed to convert Google Play Billing notification 'StartTimeMillis' string to int", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		storageSub := &runtime.StorageSubscription{
			OriginalTransactionId: googleNotification.SubscriptionNotification.PurchaseToken,
			UserID:                uid,
			Store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
			ProductId:             googleNotification.SubscriptionNotification.SubscriptionId,
			PurchaseTime:          iap.ParseMillisecondUnixTimestamp(purchaseTime),
			Environment:           env,
			ExpireTime:            iap.ParseMillisecondUnixTimestamp(expireTimeInt),
			RawNotification:       string(body),
		}

		if gResponse.LinkedPurchaseToken != "" {
			// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
			storageSub.OriginalTransactionId = gResponse.LinkedPurchaseToken
		}

		if err = ExecuteInTx(context.Background(), db, func(tx *sql.Tx) error {
			if err = iap.UpsertSubscription(r.Context(), tx, storageSub); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
					// User id was not found, ignore this notification
					return ErrSkipNotification
				}
				return err
			}
			return nil
		}); err != nil {
			if errors.Is(err, ErrSkipNotification) {
				w.WriteHeader(http.StatusOK)
				return
			}
			logger.Error("Failed to store Google Play Billing notification subscription data", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}
}
