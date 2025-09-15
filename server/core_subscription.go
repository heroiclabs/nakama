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
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/iap"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func ValidateSubscriptionApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	validation, rawResponse, err := iap.ValidateReceiptApple(ctx, httpc, receipt, password)
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

		expireTime := parseMillisecondUnixTimestamp(expireTimeIntUnix)
		purchaseTime := parseMillisecondUnixTimestamp(purchaseTimeUnix)

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
			storageSub := &storageSubscription{
				userID:                userID,
				store:                 api.StoreProvider_APPLE_APP_STORE,
				productId:             sub.ProductId,
				originalTransactionId: sub.OriginalTransactionId,
				purchaseTime:          sub.PurchaseTime.AsTime(),
				environment:           env,
				expireTime:            sub.ExpiryTime.AsTime(),
				rawResponse:           string(rawResponse),
			}

			if err = upsertSubscription(ctx, tx, storageSub); err != nil {
				return err
			}

			suid := storageSub.userID.String()
			if storageSub.userID.IsNil() {
				suid = ""
			}

			sub.UserId = suid
			sub.CreateTime = timestamppb.New(storageSub.createTime)
			sub.UpdateTime = timestamppb.New(storageSub.updateTime)
			sub.ProviderResponse = storageSub.rawResponse
			sub.ProviderNotification = storageSub.rawNotification
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
	gResponse, gReceipt, rawResponse, err := iap.ValidateSubscriptionReceiptGoogle(ctx, httpc, config.ClientEmail, config.PrivateKey, receipt)
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
	if gResponse.TestPurchase != nil {
		purchaseEnv = api.StoreEnvironment_SANDBOX
	}

	storageSub := &storageSubscription{
		originalTransactionId: gReceipt.PurchaseToken,
		userID:                userID,
		store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
		productId:             gReceipt.ProductID,
		purchaseTime:          parseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		environment:           purchaseEnv,
		expireTime:            gResponse.LineItems[0].ExpiryTime,
		rawResponse:           string(rawResponse),
	}

	if gResponse.LinkedPurchaseToken != "" {
		// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
		storageSub.originalTransactionId = gResponse.LinkedPurchaseToken
	}

	validatedSub := &api.ValidatedSubscription{
		UserId:                userID.String(),
		ProductId:             storageSub.productId,
		OriginalTransactionId: storageSub.originalTransactionId,
		Store:                 storageSub.store,
		PurchaseTime:          timestamppb.New(storageSub.purchaseTime),
		Environment:           storageSub.environment,
		ExpiryTime:            timestamppb.New(storageSub.expireTime),
		ProviderResponse:      storageSub.rawResponse,
		ProviderNotification:  storageSub.rawNotification,
	}

	if !persist {
		return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
	}

	if err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		return upsertSubscription(ctx, tx, storageSub)
	}); err != nil {
		logger.Error("Failed to upsert Google subscription receipt", zap.Error(err))
		return nil, err
	}

	suid := storageSub.userID.String()
	if storageSub.userID.IsNil() {
		suid = ""
	}

	validatedSub.UserId = suid
	validatedSub.CreateTime = timestamppb.New(storageSub.createTime)
	validatedSub.UpdateTime = timestamppb.New(storageSub.updateTime)
	validatedSub.ProviderResponse = storageSub.rawResponse
	validatedSub.ProviderNotification = storageSub.rawNotification
	validatedSub.Active = gResponse.LineItems[0].ExpiryTime.After(time.Now()) && validatedSub.RefundTime.AsTime().IsZero()

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

func getSubscriptionByOriginalTransactionId(ctx context.Context, logger *zap.Logger, db *sql.DB, originalTransactionId string) (*api.ValidatedSubscription, error) {
	var (
		dbUserId                uuid.UUID
		dbStore                 api.StoreProvider
		dbOriginalTransactionId string
		dbCreateTime            pgtype.Timestamptz
		dbUpdateTime            pgtype.Timestamptz
		dbExpireTime            pgtype.Timestamptz
		dbPurchaseTime          pgtype.Timestamptz
		dbRefundTime            pgtype.Timestamptz
		dbProductId             string
		dbEnvironment           api.StoreEnvironment
		dbRawResponse           string
		dbRawNotification       string
	)

	err := db.QueryRowContext(ctx, `
		SELECT
		    user_id,
				store,
				original_transaction_id,
				create_time,
				update_time,
				expire_time,
				purchase_time,
				refund_time,
				product_id,
				environment,
				raw_response,
				raw_notification
		FROM subscription
		WHERE original_transaction_id = $1
`, originalTransactionId).Scan(&dbUserId, &dbStore, &dbOriginalTransactionId, &dbCreateTime, &dbUpdateTime, &dbExpireTime, &dbPurchaseTime, &dbRefundTime, &dbProductId, &dbEnvironment, &dbRawResponse, &dbRawNotification)
	if err != nil {
		if err == sql.ErrNoRows {
			// Not found
			return nil, nil
		}
		logger.Error("Failed to get subscription", zap.Error(err))
		return nil, err
	}

	active := false
	if dbExpireTime.Time.After(time.Now()) && dbRefundTime.Time.Unix() == 0 {
		active = true
	}

	suid := dbUserId.String()
	if dbUserId.IsNil() {
		suid = ""
	}

	return &api.ValidatedSubscription{
		UserId:                suid,
		ProductId:             dbProductId,
		OriginalTransactionId: dbOriginalTransactionId,
		Store:                 dbStore,
		PurchaseTime:          timestamppb.New(dbPurchaseTime.Time),
		CreateTime:            timestamppb.New(dbCreateTime.Time),
		UpdateTime:            timestamppb.New(dbUpdateTime.Time),
		Environment:           dbEnvironment,
		ExpiryTime:            timestamppb.New(dbExpireTime.Time),
		RefundTime:            timestamppb.New(dbRefundTime.Time),
		ProviderResponse:      dbRawResponse,
		ProviderNotification:  dbRawNotification,
		Active:                active,
	}, nil
}

type storageSubscription struct {
	originalTransactionId string
	userID                uuid.UUID
	store                 api.StoreProvider
	productId             string
	purchaseTime          time.Time
	createTime            time.Time // Set by upsertSubscription
	updateTime            time.Time // Set by upsertSubscription
	refundTime            time.Time
	environment           api.StoreEnvironment
	expireTime            time.Time
	rawResponse           string
	rawNotification       string
}

func upsertSubscription(ctx context.Context, db *sql.Tx, sub *storageSubscription) error {
	if sub.refundTime.IsZero() {
		// Refund time not set, init as default value.
		sub.refundTime = time.Unix(0, 0)
	}

	query := `
INSERT
INTO
    subscription
        (
						user_id,
						store,
						original_transaction_id,
						product_id,
						purchase_time,
						environment,
						expire_time,
						raw_response,
						raw_notification,
						refund_time
        )
VALUES
    ($1, $2, $3, $4, $5, $6, $7, to_jsonb(coalesce(nullif($8, ''), '{}')), to_jsonb(coalesce(nullif($9, ''), '{}')), $10)
ON CONFLICT
    (original_transaction_id)
DO
	UPDATE SET
		expire_time = $7,
		update_time = now(),
		raw_response = coalesce(to_jsonb(nullif($8, '')), subscription.raw_response::jsonb),
		raw_notification = coalesce(to_jsonb(nullif($9, '')), subscription.raw_notification::jsonb),
		refund_time = coalesce(nullif($10, '1970-01-01 00:00:00+00'), subscription.refund_time)
RETURNING
    user_id, create_time, update_time, expire_time, refund_time, raw_response, raw_notification
`
	var (
		userID          uuid.UUID
		createTime      pgtype.Timestamptz
		updateTime      pgtype.Timestamptz
		expireTime      pgtype.Timestamptz
		refundTime      pgtype.Timestamptz
		rawResponse     string
		rawNotification string
	)
	if err := db.QueryRowContext(
		ctx,
		query,
		sub.userID,
		sub.store,
		sub.originalTransactionId,
		sub.productId,
		sub.purchaseTime,
		sub.environment,
		sub.expireTime,
		sub.rawResponse,
		sub.rawNotification,
		sub.refundTime,
	).Scan(&userID, &createTime, &updateTime, &expireTime, &refundTime, &rawResponse, &rawNotification); err != nil {
		return err
	}

	sub.userID = userID
	sub.createTime = createTime.Time
	sub.updateTime = updateTime.Time
	sub.expireTime = expireTime.Time
	sub.refundTime = refundTime.Time
	sub.rawResponse = rawResponse
	sub.rawNotification = rawNotification

	return nil
}

const AppleRootPEM = `
-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`

type appleNotificationSigned struct {
	SignedPayload string `json:"signedPayload"`
}

// Reference: https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2decodedpayload
// The data, summary, and externalPurchaseToken fields are mutually exclusive. The payload contains only one of these fields.
type appleNotificationPayload struct {
	NotificationType      string                         `json:"notificationType"`      // The in-app purchase event for which the App Store sends this version 2 notification.
	Subtype               string                         `json:"subtype"`               // Additional information that identifies the notification event. The subtype field is present only for specific version 2 notifications.
	Data                  *runtime.AppleNotificationData `json:"data"`                  // The object that contains the app metadata and signed renewal and transaction information.
	Summary               *appleNotificationSummary      `json:"summary"`               // The summary data that appears when the App Store server completes your request to extend a subscription renewal date for eligible subscribers. For more information, see Extend Subscription Renewal Dates for All Active Subscribers.
	ExternalPurchaseToken *appleExternalPurchaseToken    `json:"externalPurchaseToken"` // This field appears when the notificationType is EXTERNAL_PURCHASE_TOKEN.
	Version               string                         `json:"version"`               // The App Store Server Notification version number, "2.0".
	SignedDate            int64                          `json:"signedDate"`            // The UNIX time, in milliseconds, that the App Store signed the JSON Web Signature data.
	NotificationUUID      string                         `json:"notificationUUID"`      // A unique identifier for the notification. Use this value to identify a duplicate notification.
}

type appleNotificationSummary struct {
	RequestIdentifier      string   `json:"requestIdentifier"`      // The UUID that represents a specific request to extend a subscription renewal date. This value matches the value you initially specify in the requestIdentifier when you call Extend Subscription Renewal Dates for All Active Subscribers in the App Store Server API.
	Environment            string   `json:"environment"`            // The server environment that the notification applies to, either sandbox or production.
	AppAppleId             string   `json:"appAppleId"`             // The unique identifier of the app that the notification applies to. This property is available for apps that users download from the App Store. It isn’t present in the sandbox environment.
	BundleId               string   `json:"bundleId"`               // The bundle identifier of the app.
	ProductId              string   `json:"productId"`              // The product identifier of the auto-renewable subscription that the subscription-renewal-date extension applies to.
	StorefrontCountryCodes []string `json:"storefrontCountryCodes"` // A list of country codes that limits the App Store’s attempt to apply the subscription-renewal-date extension. If this list isn’t present, the subscription-renewal-date extension applies to all storefronts.
	FailedCount            int64    `json:"failedCount"`            // The final count of subscriptions that fail to receive a subscription-renewal-date extension.
	SucceededCount         int64    `json:"succeededCount"`         // The final count of subscriptions that successfully receive a subscription-renewal-date extension.
}

type appleExternalPurchaseToken struct {
	ExternalPurchaseId  string `json:"externalPurchaseId"`  // The unique identifier of the token. Use this value to report tokens and their associated transactions in the Send External Purchase Report endpoint.
	TokenCreationDate   int64  `json:"tokenCreationDate"`   // The UNIX time, in milliseconds, when the system created the token.
	AppAppleId          string `json:"appAppleId"`          // The app Apple ID for which the system generated the token.
	BundleId            string `json:"bundleId"`            // The bundle ID of the app for which the system generated the token.
	TokenExpirationDate int64  `json:"tokenExpirationDate"` // The UNIX time, in milliseconds, when a token expires. This field is present only for custom link tokens.
	TokenType           string `json:"tokenType"`           // The custom link token type, either SERVICES or ACQUISITION. This field is present only for custom link tokens.
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

		var signedNotificationPayload *appleNotificationSigned
		if err := json.Unmarshal(body, &signedNotificationPayload); err != nil {
			logger.Error("Failed to unmarshal App Store notification", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		notificationPayload, notificationData, err := decodeAppleNotificationSignedPayload(signedNotificationPayload)
		if err != nil {
			logger.Error("Failed to decode App Store notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
		}

		logger.Debug("Apple IAP notification received", zap.Any("notification_payload", notificationData))

		switch notificationType := strings.ToUpper(notificationPayload.NotificationType); notificationType {
		case "DID_RENEW", "SUBSCRIBED":
			// These notification types only relate to subscriptions.
			// These should always contain transactionInfo as they imply something was billed.
			transactionInfo := notificationData.TransactionInfo
			if transactionInfo == nil {
				logger.Warn("No transaction info for this Apple IAP notification type", zap.String("notification_type", notificationType))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			uid := uuid.Nil
			if transactionInfo.AppAccountToken != "" {
				tokenUID, err := uuid.FromString(transactionInfo.AppAccountToken)
				if err != nil {
					logger.Warn("App Store subscription notification AppAccountToken is an invalid uuid", zap.String("app_account_token", transactionInfo.AppAccountToken), zap.Error(err), zap.String("payload", string(body)))
				} else {
					uid = tokenUID
				}
			}

			env := api.StoreEnvironment_PRODUCTION
			if transactionInfo.Environment == iap.AppleSandboxEnvironment {
				env = api.StoreEnvironment_SANDBOX
			}

			if uid.IsNil() {
				// No user ID was found in receipt, lookup a validated subscription.
				s, err := getSubscriptionByOriginalTransactionId(r.Context(), logger, db, transactionInfo.OriginalTransactionId)
				if err != nil || s == nil {
					w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
					return
				}
				if s.UserId != "" {
					uid = uuid.Must(uuid.FromString(s.UserId))
				}
			}

			sub := &storageSubscription{
				userID:                uid,
				originalTransactionId: transactionInfo.OriginalTransactionId,
				store:                 api.StoreProvider_APPLE_APP_STORE,
				productId:             transactionInfo.ProductId,
				purchaseTime:          parseMillisecondUnixTimestamp(transactionInfo.OriginalPurchaseDate),
				environment:           env,
				expireTime:            parseMillisecondUnixTimestamp(transactionInfo.ExpiresDate),
				rawNotification:       string(body),
				refundTime:            parseMillisecondUnixTimestamp(transactionInfo.RevocationDate),
			}

			if err = ExecuteInTx(r.Context(), db, func(tx *sql.Tx) error {
				if err = upsertSubscription(r.Context(), tx, sub); err != nil {
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
			if sub.expireTime.After(time.Now()) && sub.refundTime.Unix() == 0 {
				active = true
			}

			var suid string
			if !sub.userID.IsNil() {
				suid = sub.userID.String()
			}

			if subscriptionNotificationCallback != nil {
				validatedSub := &api.ValidatedSubscription{
					UserId:                suid,
					ProductId:             sub.productId,
					OriginalTransactionId: sub.originalTransactionId,
					Store:                 api.StoreProvider_APPLE_APP_STORE,
					PurchaseTime:          timestamppb.New(sub.purchaseTime),
					CreateTime:            timestamppb.New(sub.createTime),
					UpdateTime:            timestamppb.New(sub.updateTime),
					Environment:           env,
					ExpiryTime:            timestamppb.New(sub.expireTime),
					RefundTime:            timestamppb.New(sub.refundTime),
					ProviderResponse:      sub.rawResponse,
					ProviderNotification:  sub.rawNotification,
					Active:                active,
				}

				notification := runtime.IAPNotificationSubscribed
				if notificationType == "DID_RENEW" {
					notification = runtime.IAPNotificationRenewed
				}

				if err = subscriptionNotificationCallback(r.Context(), notification, validatedSub, notificationData); err != nil {
					logger.Error("Error invoking Apple IAP subscription notification function", zap.Error(err), zap.String("notification_type", notification.String()), zap.String("notification_payload", string(body)))
					w.WriteHeader(http.StatusOK)
					return
				}
			}

		case "EXPIRED", "DID_CHANGE_RENEWAL_STATUS", "GRACE_PERIOD_EXPIRED", "REVOKED":
			// These only apply to subscriptions that have expired or have been revoked (family sharing).
			// These should all contain RenewalInfo but may not contain TransactionInfo.
			// DID_CHANGE_RENEWAL_STATUS contains a substatus for auto-renewal cancellation.
			renewalInfo := notificationData.RenewalInfo
			if renewalInfo == nil {
				logger.Warn("No renewal info for this Apple IAP notification type", zap.String("notification_type", notificationType))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			uid := uuid.Nil
			if renewalInfo.AppAccountToken != "" {
				tokenUID, err := uuid.FromString(renewalInfo.AppAccountToken)
				if err != nil {
					logger.Warn("App Store subscription notification AppAccountToken is an invalid uuid", zap.String("app_account_token", renewalInfo.AppAccountToken), zap.Error(err), zap.String("payload", string(body)))
				} else {
					uid = tokenUID
				}
			} else {
				s, err := getSubscriptionByOriginalTransactionId(r.Context(), logger, db, renewalInfo.OriginalTransactionId)
				if err != nil {
					logger.Error("Failed to get subscription by original transaction id", zap.Error(err))
					w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
					return
				} else if s == nil || s.UserId == "" {
					// No subscription found, we don't have a valid userID. We do not want to upsert or run the hook.
					logger.Warn("No userId found for this Apple IAP notification", zap.String("notification_type", notificationType), zap.Any("payload", notificationData))
					w.WriteHeader(http.StatusOK)
					return
				}
				uid = uuid.Must(uuid.FromString(s.UserId))
			}

			env := api.StoreEnvironment_PRODUCTION
			if renewalInfo.Environment == iap.AppleSandboxEnvironment {
				env = api.StoreEnvironment_SANDBOX
			}

			expiryTime := parseMillisecondUnixTimestamp(renewalInfo.RenewalDate)
			graceExpiryTime := parseMillisecondUnixTimestamp(renewalInfo.GracePeriodExpiresDate)
			if !graceExpiryTime.IsZero() && graceExpiryTime.After(expiryTime) {
				expiryTime = graceExpiryTime
			}

			sub := &storageSubscription{
				userID:                uid,
				originalTransactionId: renewalInfo.OriginalTransactionId,
				store:                 api.StoreProvider_APPLE_APP_STORE,
				productId:             renewalInfo.ProductId,
				environment:           env,
				expireTime:            expiryTime,
				rawNotification:       string(body),
			}

			if err = ExecuteInTx(r.Context(), db, func(tx *sql.Tx) error {
				if err = upsertSubscription(r.Context(), tx, sub); err != nil {
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
			if sub.expireTime.After(time.Now()) && sub.refundTime.Unix() == 0 {
				active = true
			}

			var suid string
			if !sub.userID.IsNil() {
				suid = sub.userID.String()
			}

			nType := runtime.IAPNotificationExpired
			if notificationType == "DID_CHANGE_RENEWAL_STATUS" {
				if notificationPayload.Subtype == "AUTO_RENEW_DISABLED" {
					nType = runtime.IAPNotificationCancelled
				} else {
					// AUTO_RENEW_ENABLED: The user enabled the auto-renewal, but there's nothing to upsert or hook to fire, so do nothing.
					w.WriteHeader(http.StatusOK)
					return
				}
			}

			if subscriptionNotificationCallback != nil {
				validatedSub := &api.ValidatedSubscription{
					UserId:                suid,
					ProductId:             sub.productId,
					OriginalTransactionId: sub.originalTransactionId,
					Store:                 api.StoreProvider_APPLE_APP_STORE,
					PurchaseTime:          timestamppb.New(sub.purchaseTime),
					CreateTime:            timestamppb.New(sub.createTime),
					UpdateTime:            timestamppb.New(sub.updateTime),
					Environment:           env,
					ExpiryTime:            timestamppb.New(sub.expireTime),
					RefundTime:            timestamppb.New(sub.refundTime),
					ProviderResponse:      sub.rawResponse,
					ProviderNotification:  sub.rawNotification,
					Active:                active,
				}

				if err = subscriptionNotificationCallback(r.Context(), nType, validatedSub, notificationData); err != nil {
					logger.Error("Error invoking Apple IAP subscription notification function", zap.Error(err), zap.String("notification_type", nType.String()), zap.String("notification_payload", string(body)))
					w.WriteHeader(http.StatusOK)
					return
				}
			}

		case "REFUND":
			transactionInfo := notificationData.TransactionInfo

			uid := uuid.Nil
			if transactionInfo.AppAccountToken != "" {
				tokenUID, err := uuid.FromString(transactionInfo.AppAccountToken)
				if err != nil {
					logger.Warn("App Store subscription notification AppAccountToken is an invalid uuid", zap.String("app_account_token", transactionInfo.AppAccountToken), zap.Error(err), zap.String("payload", string(body)))
				} else {
					uid = tokenUID
				}
			}

			env := api.StoreEnvironment_PRODUCTION
			if transactionInfo.Environment == iap.AppleSandboxEnvironment {
				env = api.StoreEnvironment_SANDBOX
			}

			if transactionInfo.ExpiresDate != 0 {
				// This is a subscription related refund.
				if uid.IsNil() {
					s, err := getSubscriptionByOriginalTransactionId(r.Context(), logger, db, transactionInfo.OriginalTransactionId)
					if err != nil {
						logger.Error("Failed to get subscription by original transaction id", zap.Error(err))
						w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
						return
					}
					if s == nil || s.UserId == "" {
						// No subscription found, we do not want to upsert or run the hook.
						logger.Warn("No userId found for this Apple IAP refund notification", zap.String("notification_type", notificationType), zap.Any("payload", notificationData))
						w.WriteHeader(http.StatusOK)
						return
					}
					uid = uuid.Must(uuid.FromString(s.UserId))
				}

				sub := &storageSubscription{
					userID:                uid,
					originalTransactionId: transactionInfo.OriginalTransactionId,
					store:                 api.StoreProvider_APPLE_APP_STORE,
					productId:             transactionInfo.ProductId,
					purchaseTime:          parseMillisecondUnixTimestamp(transactionInfo.OriginalPurchaseDate),
					environment:           env,
					expireTime:            parseMillisecondUnixTimestamp(transactionInfo.ExpiresDate),
					rawNotification:       string(body),
					refundTime:            parseMillisecondUnixTimestamp(transactionInfo.RevocationDate),
				}

				active := false
				if sub.expireTime.After(time.Now()) && sub.refundTime.Unix() == 0 {
					active = true
				}

				validatedSub := &api.ValidatedSubscription{
					UserId:                uid.String(),
					ProductId:             sub.productId,
					OriginalTransactionId: sub.originalTransactionId,
					Store:                 api.StoreProvider_APPLE_APP_STORE,
					PurchaseTime:          timestamppb.New(sub.purchaseTime),
					CreateTime:            timestamppb.New(sub.createTime),
					UpdateTime:            timestamppb.New(sub.updateTime),
					Environment:           env,
					ExpiryTime:            timestamppb.New(sub.expireTime),
					RefundTime:            timestamppb.New(sub.refundTime),
					ProviderResponse:      sub.rawResponse,
					ProviderNotification:  sub.rawNotification,
					Active:                active,
				}

				if err = subscriptionNotificationCallback(r.Context(), runtime.IAPNotificationRefunded, validatedSub, notificationData); err != nil {
					logger.Error("Error invoking Apple purchase refund runtime function", zap.Error(err))
					w.WriteHeader(http.StatusOK)
					return
				}
			} else {
				// This is a purchase related refund.
				if uid.IsNil() {
					p, err := GetPurchaseByTransactionId(r.Context(), logger, db, transactionInfo.TransactionId)
					if err != nil {
						logger.Error("Failed to get subscription by original transaction id", zap.Error(err))
						w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
						return
					}
					if p == nil || p.UserId == "" {
						// No subscription found, we do not want to upsert or run the hook.
						logger.Warn("No userId found for this Apple IAP refund notification", zap.String("notification_type", notificationType), zap.Any("payload", notificationData))
						w.WriteHeader(http.StatusOK)
						return
					}
					uid = uuid.Must(uuid.FromString(p.UserId))
				}

				purchase := &storagePurchase{
					userID:        uid,
					store:         api.StoreProvider_APPLE_APP_STORE,
					productId:     transactionInfo.ProductId,
					transactionId: transactionInfo.TransactionId,
					purchaseTime:  parseMillisecondUnixTimestamp(transactionInfo.PurchaseDate),
					refundTime:    parseMillisecondUnixTimestamp(transactionInfo.RevocationDate),
					environment:   env,
				}

				dbPurchases, err := upsertPurchases(r.Context(), db, []*storagePurchase{purchase})
				if err != nil {
					logger.Error("Failed to store App Store notification purchase data")
					w.WriteHeader(http.StatusInternalServerError)
					return
				}

				if purchaseNotificationCallback != nil {
					dbPurchase := dbPurchases[0]
					suid := dbPurchase.userID.String()
					if dbPurchase.userID.IsNil() {
						suid = ""
					}
					validatedPurchase := &api.ValidatedPurchase{
						UserId:           suid,
						ProductId:        transactionInfo.ProductId,
						TransactionId:    transactionInfo.TransactionId,
						Store:            api.StoreProvider_APPLE_APP_STORE,
						CreateTime:       timestamppb.New(dbPurchase.createTime),
						UpdateTime:       timestamppb.New(dbPurchase.updateTime),
						PurchaseTime:     timestamppb.New(dbPurchase.purchaseTime),
						RefundTime:       timestamppb.New(dbPurchase.refundTime),
						ProviderResponse: string(body),
						Environment:      env,
						SeenBefore:       dbPurchase.seenBefore,
					}

					if err = purchaseNotificationCallback(r.Context(), runtime.IAPNotificationRefunded, validatedPurchase, notificationData); err != nil {
						logger.Error("Error invoking Apple IAP purchase notification function", zap.Error(err), zap.String("notification_type", runtime.IAPNotificationRefunded.String()), zap.String("notification_payload", string(body)))
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			}
		default:
			// Unhandled notification type.
		}
		w.WriteHeader(http.StatusOK)
	}
}

func decodeAppleNotificationSignedPayload(appleNotificationSigned *appleNotificationSigned) (*appleNotificationPayload, *runtime.AppleNotificationData, error) {
	tokens := strings.Split(appleNotificationSigned.SignedPayload, ".")

	if len(tokens) < 3 {
		return nil, nil, fmt.Errorf("unexpected apple jws length: %d", len(tokens))
	}

	seg := tokens[0]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	headerByte, err := base64.StdEncoding.DecodeString(seg)
	if err != nil {
		return nil, nil, err
	}

	type Header struct {
		Alg string   `json:"alg"`
		X5c []string `json:"x5c"`
	}
	var header Header

	if err = json.Unmarshal(headerByte, &header); err != nil {
		return nil, nil, err
	}

	certs := make([][]byte, 0)
	for _, encodedCert := range header.X5c {
		cert, err := base64.StdEncoding.DecodeString(encodedCert)
		if err != nil {
			return nil, nil, err
		}
		certs = append(certs, cert)
	}

	rootCert := x509.NewCertPool()
	ok := rootCert.AppendCertsFromPEM([]byte(AppleRootPEM))
	if !ok {
		return nil, nil, err
	}

	interCert, err := x509.ParseCertificate(certs[1])
	if err != nil {
		return nil, nil, err
	}
	intermediates := x509.NewCertPool()
	intermediates.AddCert(interCert)

	cert, err := x509.ParseCertificate(certs[2])
	if err != nil {
		return nil, nil, err
	}

	opts := x509.VerifyOptions{
		Roots:         rootCert,
		Intermediates: intermediates,
	}

	_, err = cert.Verify(opts)
	if err != nil {
		return nil, nil, err
	}

	seg = tokens[1]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	jsonPayload, err := base64.StdEncoding.DecodeString(seg)
	if err != nil {
		return nil, nil, err
	}

	var notificationPayload *appleNotificationPayload
	if err = json.Unmarshal(jsonPayload, &notificationPayload); err != nil {
		return nil, nil, err
	}

	tokens = strings.Split(notificationPayload.Data.SignedTransactionInfo, ".")
	if len(tokens) < 3 {
		return nil, nil, fmt.Errorf("unexpected apple signedTransactionInfo jws length: %d", len(tokens))
	}

	seg = tokens[1]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	jsonPayload, err = base64.StdEncoding.DecodeString(seg)
	if err != nil {
		return nil, nil, err
	}

	var signedTransactionInfo *runtime.AppleNotificationTransactionInfo
	if err = json.Unmarshal(jsonPayload, &signedTransactionInfo); err != nil {
		return nil, nil, err
	}

	tokens = strings.Split(notificationPayload.Data.SignedRenewalInfo, ".")
	if len(tokens) < 3 {
		return nil, nil, fmt.Errorf("unexpected apple signedRenewalInfo jws length: %d", len(tokens))
	}

	seg = tokens[1]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	renewalJsonPayload, err := base64.StdEncoding.DecodeString(seg)
	if err != nil {
		return nil, nil, err
	}
	var signedRenewalInfo *runtime.AppleNotificationRenewalInfo
	if err = json.Unmarshal(renewalJsonPayload, &signedRenewalInfo); err != nil {
		return nil, nil, err
	}

	data := notificationPayload.Data
	data.TransactionInfo = signedTransactionInfo
	data.RenewalInfo = signedRenewalInfo

	return notificationPayload, data, nil
}

type googleStoreNotification struct {
	Message      googleStoreNotificationMessage `json:"message"`
	Subscription string                         `json:"subscription"`
}

type googleStoreNotificationMessage struct {
	Attributes map[string]string `json:"attributes"`
	Data       string            `json:"data"`
	MessageId  string            `json:"messageId"`
}

func googleNotificationHandler(logger *zap.Logger, db *sql.DB, config *IAPGoogleConfig, purchaseNotificationCallback RuntimePurchaseNotificationGoogleFunction, subscriptionNotificationCallback RuntimeSubscriptionNotificationGoogleFunction) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.Error("Failed to decode App Store notification body", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer r.Body.Close()

		logger = logger.With(zap.String("notification_body", string(body)))

		var notification *googleStoreNotification
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

		var googleNotification *runtime.GoogleDeveloperNotificationData
		if err = json.Unmarshal(jsonData, &googleNotification); err != nil {
			logger.Error("Failed to json unmarshal Google Play Billing notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		switch {
		case googleNotification.SubscriptionNotification != nil:
			gSubscription, _, err := iap.GetSubscriptionV2Google(r.Context(), httpc, config.ClientEmail, config.PrivateKey, googleNotification.PackageName, googleNotification.SubscriptionNotification.PurchaseToken)
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

			logger.Debug("Google IAP subscription notification received", zap.String("notification_payload", string(jsonData)), zap.Any("api_response", gSubscription))

			uid, err := extractAccountIdentifier(gSubscription)
			if err != nil {
				logger.Error("failed to extract account id", zap.Error(err))
				w.WriteHeader(http.StatusOK)
				return
			}

			transactionId := googleNotification.SubscriptionNotification.PurchaseToken
			if gSubscription.LinkedPurchaseToken != "" {
				transactionId = gSubscription.LinkedPurchaseToken
			}

			if uid == nil {
				s, err := getSubscriptionByOriginalTransactionId(r.Context(), logger, db, transactionId)
				if err != nil {
					logger.Error("Failed to get subscription by original transaction id", zap.Error(err))
					w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
					return
				}
				if s == nil || s.UserId == "" {
					// No subscription or user found, we do not want to upsert.
					logger.Warn("No userId found for this Google IAP notification", zap.Any("notification_payload", googleNotification), zap.Any("provider_payload", gSubscription))
					w.WriteHeader(http.StatusOK)
					return
				} else {
					u := uuid.Must(uuid.FromString(s.UserId))
					uid = &u
				}
			}

			env := api.StoreEnvironment_PRODUCTION
			if gSubscription.TestPurchase != nil {
				env = api.StoreEnvironment_SANDBOX
			}

			storageSub := &storageSubscription{
				originalTransactionId: transactionId,
				userID:                *uid,
				store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
				productId:             gSubscription.LineItems[0].ProductId, // This item can have multiple entries if the subscription was upgraded/downgraded. Skip handling this for now.
				environment:           env,
				expireTime:            gSubscription.LineItems[0].ExpiryTime,
				rawNotification:       string(body),
			}

			var notificationType runtime.NotificationType
			switch googleNotification.SubscriptionNotification.NotificationType {
			case runtime.GoogleSubscriptionPurchased:
				notificationType = runtime.IAPNotificationSubscribed
			case runtime.GoogleSubscriptionRenewed:
				notificationType = runtime.IAPNotificationRenewed
			case runtime.GoogleSubscriptionExpired:
				notificationType = runtime.IAPNotificationExpired
			case runtime.GoogleSubscriptionCanceled:
				notificationType = runtime.IAPNotificationCancelled
			default:
				w.WriteHeader(http.StatusOK)
				return
			}

			if err = ExecuteInTx(r.Context(), db, func(tx *sql.Tx) error {
				if err = upsertSubscription(r.Context(), tx, storageSub); err != nil {
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

			if subscriptionNotificationCallback != nil {
				active := false
				if storageSub.expireTime.After(time.Now()) && storageSub.refundTime.Unix() == 0 {
					active = true
				}

				validatedSub := &api.ValidatedSubscription{
					UserId:                uid.String(),
					ProductId:             storageSub.productId,
					OriginalTransactionId: storageSub.originalTransactionId,
					Store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
					PurchaseTime:          timestamppb.New(storageSub.purchaseTime),
					CreateTime:            timestamppb.New(storageSub.createTime),
					UpdateTime:            timestamppb.New(storageSub.updateTime),
					Environment:           env,
					ExpiryTime:            timestamppb.New(storageSub.expireTime),
					RefundTime:            timestamppb.New(storageSub.refundTime),
					ProviderNotification:  storageSub.rawNotification,
					Active:                active,
				}

				if err := subscriptionNotificationCallback(r.Context(), notificationType, validatedSub, gSubscription); err != nil {
					logger.Error("Error invoking Google IAP subscription notification function", zap.Error(err), zap.String("notification_type", notificationType.String()), zap.Any("google_subscription", gSubscription))
					w.WriteHeader(http.StatusOK)
					return
				}
			}

		case googleNotification.OneTimeProductNotification != nil:
			// We do not handle one time product notifications for now.
		case googleNotification.VoidedPurchaseNotification != nil:
			if googleNotification.VoidedPurchaseNotification.ProductType == runtime.GoogleProductTypeSubscription {
				// This is a subscription related refund/voided notification.
				gSubscription, _, err := iap.GetSubscriptionV2Google(r.Context(), httpc, config.ClientEmail, config.PrivateKey, googleNotification.PackageName, googleNotification.SubscriptionNotification.PurchaseToken)
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

				logger.Debug("Google IAP subscription notification received", zap.String("notification_payload", string(jsonData)), zap.Any("api_response", gSubscription))

				uid, err := extractAccountIdentifier(gSubscription)
				if err != nil {
					logger.Error("failed to extract account id", zap.Error(err))
					w.WriteHeader(http.StatusOK)
					return
				}

				transactionId := googleNotification.SubscriptionNotification.PurchaseToken
				if gSubscription.LinkedPurchaseToken != "" {
					transactionId = gSubscription.LinkedPurchaseToken
				}

				if uid == nil {
					s, err := getSubscriptionByOriginalTransactionId(r.Context(), logger, db, transactionId)
					if err != nil {
						logger.Error("Failed to get subscription by original transaction id", zap.Error(err))
						w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
						return
					}
					if s == nil || s.UserId == "" {
						// No subscription found, we do not want to upsert.
						logger.Warn("No userId found for this Google IAP refund notification", zap.Any("notification_payload", googleNotification), zap.Any("google_subscription", gSubscription))
						w.WriteHeader(http.StatusOK)
						return
					} else {
						u := uuid.Must(uuid.FromString(s.UserId))
						uid = &u
					}
				}

				env := api.StoreEnvironment_PRODUCTION
				if gSubscription.TestPurchase != nil {
					env = api.StoreEnvironment_SANDBOX
				}

				storageSub := &storageSubscription{
					originalTransactionId: transactionId,
					userID:                *uid,
					store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
					productId:             gSubscription.LineItems[0].ProductId, // This item can have multiple entries if the subscription was upgraded/downgraded. Skip handling this for now.
					refundTime:            time.Now(),
					environment:           env,
					expireTime:            gSubscription.LineItems[0].ExpiryTime,
					rawResponse:           "",
					rawNotification:       string(body),
				}

				if err = ExecuteInTx(r.Context(), db, func(tx *sql.Tx) error {
					if err = upsertSubscription(r.Context(), tx, storageSub); err != nil {
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

				if subscriptionNotificationCallback != nil {
					active := false
					if storageSub.expireTime.After(time.Now()) && storageSub.refundTime.Unix() == 0 {
						active = true
					}

					validatedSub := &api.ValidatedSubscription{
						UserId:                uid.String(),
						ProductId:             storageSub.productId,
						OriginalTransactionId: storageSub.originalTransactionId,
						Store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
						PurchaseTime:          timestamppb.New(storageSub.purchaseTime),
						CreateTime:            timestamppb.New(storageSub.createTime),
						UpdateTime:            timestamppb.New(storageSub.updateTime),
						Environment:           env,
						ExpiryTime:            timestamppb.New(storageSub.expireTime),
						RefundTime:            timestamppb.New(storageSub.refundTime),
						ProviderNotification:  storageSub.rawNotification,
						Active:                active,
					}

					if err := subscriptionNotificationCallback(r.Context(), runtime.IAPNotificationRefunded, validatedSub, gSubscription); err != nil {
						logger.Error("Error invoking Google IAP subscription notification function", zap.Error(err), zap.String("notification_type", runtime.IAPNotificationRefunded.String()), zap.Any("google_subscription", gSubscription))
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			} else {
				// This is a purchase related refund/voided notification.
				gPurchase, err := iap.GetPurchaseV2Google(r.Context(), httpc, config.ClientEmail, config.PrivateKey, googleNotification.PackageName, googleNotification.OneTimeProductNotification.PurchaseToken)
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

				logger.Debug("Google IAP purchase notification received", zap.String("notification_payload", string(jsonData)), zap.Any("api_response", gPurchase))

				uid, err := extractAccountIdentifier(gPurchase)
				if err != nil {
					logger.Error("failed to extract account id", zap.Error(err))
					w.WriteHeader(http.StatusOK)
					return
				}

				transactionId := googleNotification.OneTimeProductNotification.PurchaseToken

				if uid == nil {
					s, err := GetPurchaseByTransactionId(r.Context(), logger, db, transactionId)
					if err != nil {
						logger.Error("Failed to get purchase by transaction id", zap.Error(err))
						w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
						return
					}
					if s == nil || s.UserId == "" {
						// No purchase found, we do not want to upsert.
						logger.Warn("No userId found for this Google IAP refund notification", zap.Any("notification_payload", googleNotification), zap.Any("purchase", gPurchase))
						w.WriteHeader(http.StatusOK)
						return
					} else {
						u := uuid.Must(uuid.FromString(s.UserId))
						uid = &u
					}
				}

				env := api.StoreEnvironment_PRODUCTION
				if gPurchase.TestPurchaseContext != nil {
					env = api.StoreEnvironment_SANDBOX
				}

				sPurchase := &storagePurchase{
					userID:        *uid,
					store:         api.StoreProvider_GOOGLE_PLAY_STORE,
					productId:     gPurchase.ProductLineItem[0].ProductId, // This item can have multiple entries if the subscription was upgraded/downgraded. Skip handling this for now.
					purchaseTime:  gPurchase.PurchaseCompletionTime,
					transactionId: transactionId,
					refundTime:    time.Now(),
					environment:   env,
				}

				if _, err = upsertPurchases(r.Context(), db, []*storagePurchase{sPurchase}); err != nil {
					var pgErr *pgconn.PgError
					if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
						// User id was not found, ignore this notification
						w.WriteHeader(http.StatusOK)
						return
					}
					logger.Error("Failed to store Google Play Billing notification subscription data", zap.Error(err))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}

				if purchaseNotificationCallback != nil {
					suid := sPurchase.userID.String()
					if sPurchase.userID.IsNil() {
						suid = ""
					}
					validatedPurchase := &api.ValidatedPurchase{
						UserId:        suid,
						ProductId:     sPurchase.productId,
						TransactionId: sPurchase.transactionId,
						Store:         sPurchase.store,
						PurchaseTime:  timestamppb.New(sPurchase.purchaseTime),
						CreateTime:    timestamppb.New(sPurchase.createTime),
						UpdateTime:    timestamppb.New(sPurchase.updateTime),
						RefundTime:    timestamppb.New(sPurchase.refundTime),
						Environment:   env,
						SeenBefore:    sPurchase.seenBefore,
					}

					if err := purchaseNotificationCallback(r.Context(), runtime.IAPNotificationRefunded, validatedPurchase, gPurchase); err != nil {
						logger.Error("Error invoking Google IAP purchase notification function", zap.Error(err), zap.String("notification_type", runtime.IAPNotificationRefunded.String()), zap.Any("google_purchase", gPurchase))
						w.WriteHeader(http.StatusInternalServerError)
						return
					}
				}
			}
		}

		w.WriteHeader(http.StatusOK)
	}
}

type ExternalAccountIdentifiersGetter interface {
	GetObfuscatedExternalAccountId() string
	GetObfuscatedExternalProfileId() string
}

func extractAccountIdentifier(data ExternalAccountIdentifiersGetter) (*uuid.UUID, error) {
	var uid *uuid.UUID
	switch {
	case data.GetObfuscatedExternalAccountId() != "":
		extUID, err := uuid.FromString(data.GetObfuscatedExternalAccountId())
		if err != nil {
			return &uuid.UUID{}, err
		}
		uid = &extUID
	case data.GetObfuscatedExternalProfileId() != "":
		extUID, err := uuid.FromString(data.GetObfuscatedExternalProfileId())
		if err != nil {
			return &uuid.UUID{}, err
		}
		uid = &extUID
	default:
		// Not found
		return nil, nil
	}
	return uid, nil
}
