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
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgconn"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgtype"
	"go.uber.org/zap"
	"golang.org/x/oauth2/jws"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrSubscriptionsListInvalidCursor = errors.New("subscriptions list cursor invalid")
var ErrSubscriptionNotFound = errors.New("subscription not found")

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

		subscription := &api.ValidatedSubscription{
			UserId:                dbUserID.String(),
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
		var vErr *iap.ValidationError
		if err != context.Canceled {
			if errors.As(err, &vErr) {
				logger.Error("Error validating Apple receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr.Err
			} else {
				logger.Error("Error validating Apple receipt", zap.Error(err))
			}
		}
		return nil, err
	}

	if validation.Status != iap.AppleReceiptIsValid {
		if validation.IsRetryable == true {
			return nil, status.Error(codes.Unavailable, "Apple IAP verification is currently unavailable. Try again later.")
		}
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. Status: %d", validation.Status))
	}

	env := api.StoreEnvironment_PRODUCTION
	if validation.Environment == iap.AppleSandboxEnvironment {
		env = api.StoreEnvironment_SANDBOX
	}

	var found bool
	var receiptInfo iap.ValidateReceiptAppleResponseLatestReceiptInfo
	for _, latestReceiptInfo := range validation.LatestReceiptInfo {
		if latestReceiptInfo.ExpiresDateMs == "" {
			// Not a subscription, skip.
			continue
		}
		receiptInfo = latestReceiptInfo
		found = true
	}
	if !found {
		// Receipt is for a purchase (or otherwise has no subscriptions for any reason) so ValidatePurchaseApple should be used instead.
		return nil, status.Error(codes.FailedPrecondition, "Purchase Receipt. Use the appropriate function instead.")
	}

	purchaseTime, err := strconv.ParseInt(receiptInfo.OriginalPurchaseDateMs, 10, 64)
	if err != nil {
		return nil, err
	}

	expireTimeInt, err := strconv.ParseInt(receiptInfo.ExpiresDateMs, 10, 64)
	if err != nil {
		return nil, err
	}

	expireTime := parseMillisecondUnixTimestamp(expireTimeInt)

	active := false
	if expireTime.After(time.Now()) {
		active = true
	}

	storageSub := &storageSubscription{
		userID:                userID,
		store:                 api.StoreProvider_APPLE_APP_STORE,
		productId:             receiptInfo.ProductId,
		originalTransactionId: receiptInfo.OriginalTransactionId,
		purchaseTime:          parseMillisecondUnixTimestamp(purchaseTime),
		environment:           env,
		expireTime:            expireTime,
		rawResponse:           string(rawResponse),
	}

	validatedSub := &api.ValidatedSubscription{
		UserId:                storageSub.userID.String(),
		ProductId:             storageSub.productId,
		OriginalTransactionId: storageSub.originalTransactionId,
		Store:                 api.StoreProvider_APPLE_APP_STORE,
		PurchaseTime:          timestamppb.New(storageSub.purchaseTime),
		Environment:           env,
		Active:                active,
		ExpiryTime:            timestamppb.New(storageSub.expireTime),
		ProviderResponse:      storageSub.rawResponse,
		ProviderNotification:  storageSub.rawNotification,
	}

	if !persist {
		return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
	}

	if err = upsertSubscription(ctx, db, storageSub); err != nil {
		return nil, err
	}

	validatedSub.CreateTime = timestamppb.New(storageSub.createTime)
	validatedSub.UpdateTime = timestamppb.New(storageSub.updateTime)
	validatedSub.ProviderResponse = storageSub.rawResponse
	validatedSub.ProviderNotification = storageSub.rawNotification

	return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
}

func ValidateSubscriptionGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPGoogleConfig, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	gResponse, gReceipt, rawResponse, err := iap.ValidateSubscriptionReceiptGoogle(ctx, httpc, config.ClientEmail, config.PrivateKey, receipt)
	if err != nil {
		var vErr *iap.ValidationError
		if err != context.Canceled {
			if errors.As(err, &vErr) {
				logger.Error("Error validating Google receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr.Err
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

	expireTime := parseMillisecondUnixTimestamp(expireTimeInt)

	active := false
	if expireTime.After(time.Now()) {
		active = true
	}

	storageSub := &storageSubscription{
		originalTransactionId: gReceipt.PurchaseToken,
		userID:                userID,
		store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
		productId:             gReceipt.ProductID,
		purchaseTime:          parseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		environment:           purchaseEnv,
		expireTime:            expireTime,
		rawResponse:           string(rawResponse),
	}

	if gResponse.LinkedPurchaseToken != "" {
		// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
		storageSub.originalTransactionId = gResponse.LinkedPurchaseToken
	}

	validatedSub := &api.ValidatedSubscription{
		UserId:                storageSub.userID.String(),
		ProductId:             storageSub.productId,
		OriginalTransactionId: storageSub.originalTransactionId,
		Store:                 storageSub.store,
		PurchaseTime:          timestamppb.New(storageSub.purchaseTime),
		Environment:           storageSub.environment,
		Active:                active,
		ExpiryTime:            timestamppb.New(storageSub.expireTime),
		ProviderResponse:      storageSub.rawResponse,
		ProviderNotification:  storageSub.rawNotification,
	}

	if !persist {
		return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
	}

	if err = upsertSubscription(ctx, db, storageSub); err != nil {
		return nil, err
	}

	validatedSub.CreateTime = timestamppb.New(storageSub.createTime)
	validatedSub.UpdateTime = timestamppb.New(storageSub.updateTime)
	validatedSub.ProviderResponse = storageSub.rawResponse
	validatedSub.ProviderNotification = storageSub.rawNotification

	return &api.ValidateSubscriptionResponse{ValidatedSubscription: validatedSub}, nil
}

func GetSubscriptionByProductId(ctx context.Context, logger *zap.Logger, db *sql.DB, userID, productID string) (string, *api.ValidatedSubscription, error) {
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
			return "", nil, ErrSubscriptionNotFound
		}
		logger.Error("Failed to get subscription", zap.Error(err))
		return "", nil, err
	}

	active := false
	if expireTime.Time.After(time.Now()) {
		active = true
	}

	return userID, &api.ValidatedSubscription{
		UserId:                dbUserID.String(),
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

func getSubscriptionByOriginalTransactionId(ctx context.Context, db *sql.DB, originalTransactionId string) (*api.ValidatedSubscription, error) {
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
		return nil, err
	}

	active := false
	if dbExpireTime.Time.After(time.Now()) && dbRefundTime.Time.Unix() == 0 {
		active = true
	}

	return &api.ValidatedSubscription{
		UserId:                dbUserId.String(),
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

func upsertSubscription(ctx context.Context, db *sql.DB, sub *storageSubscription) error {
	emptyTime := time.Time{}
	if sub.refundTime == emptyTime {
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
    ($1, $2, $3, $4, $5, $6, $7, to_jsonb(coalesce(nullif($8, ''), '{}')), to_jsonb(coalesce(nullif($9, ''), '{}')))
ON CONFLICT
    (original_transaction_id)
DO
	UPDATE SET
		expire_time = $7,
		update_time = now(),
		raw_response = coalesce(to_jsonb(nullif($8, '')), subscription.raw_response::jsonb),
		raw_notification = coalesce(to_jsonb(nullif($9, '')), subscription.raw_notification::jsonb)
		refund_time = coalesce($10, subscription.refund_time)
RETURNING
    create_time, update_time, expire_time, refund_time, raw_response, raw_notification
`
	var (
		createTime      pgtype.Timestamptz
		updateTime      pgtype.Timestamptz
		expireTime      pgtype.Timestamptz
		refundTime      pgtype.Timestamptz
		rawResponse     string
		rawNotification string
	)
	if err := db.QueryRowContext(ctx, query, sub.userID, sub.store, sub.originalTransactionId, sub.productId, sub.purchaseTime, sub.environment, sub.expireTime, sub.rawResponse, sub.rawNotification, sub.refundTime).Scan(&createTime, &updateTime, &expireTime, &refundTime, &rawResponse, &rawNotification); err != nil {
		return err
	}

	sub.createTime = createTime.Time
	sub.updateTime = updateTime.Time
	sub.expireTime = expireTime.Time
	sub.refundTime = refundTime.Time
	sub.rawResponse = rawResponse
	sub.rawNotification = rawNotification

	return nil
}

var ApplePubKey = func() *rsa.PublicKey {
	appleCert := `-----BEGIN CERTIFICATE-----
MIIEuzCCA6OgAwIBAgIBAjANBgkqhkiG9w0BAQUFADBiMQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwHhcNMDYwNDI1MjE0
MDM2WhcNMzUwMjA5MjE0MDM2WjBiMQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBw
bGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkx
FjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDkkakJH5HbHkdQ6wXtXnmELes2oldMVeyLGYne+Uts9QerIjAC6Bg+
+FAJ039BqJj50cpmnCRrEdCju+QbKsMflZ56DKRHi1vUFjczy8QPTc4UadHJGXL1
XQ7Vf1+b8iUDulWPTV0N8WQ1IxVLFVkds5T39pyez1C6wVhQZ48ItCD3y6wsIG9w
tj8BMIy3Q88PnT3zK0koGsj+zrW5DtleHNbLPbU6rfQPDgCSC7EhFi501TwN22IW
q6NxkkdTVcGvL0Gz+PvjcM3mo0xFfh9Ma1CWQYnEdGILEINBhzOKgbEwWOxaBDKM
aLOPHd5lc/9nXmW8Sdh2nzMUZaF3lMktAgMBAAGjggF6MIIBdjAOBgNVHQ8BAf8E
BAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUK9BpR5R2Cf70a40uQKb3
R01/CF4wHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wggERBgNVHSAE
ggEIMIIBBDCCAQAGCSqGSIb3Y2QFATCB8jAqBggrBgEFBQcCARYeaHR0cHM6Ly93
d3cuYXBwbGUuY29tL2FwcGxlY2EvMIHDBggrBgEFBQcCAjCBthqBs1JlbGlhbmNl
IG9uIHRoaXMgY2VydGlmaWNhdGUgYnkgYW55IHBhcnR5IGFzc3VtZXMgYWNjZXB0
YW5jZSBvZiB0aGUgdGhlbiBhcHBsaWNhYmxlIHN0YW5kYXJkIHRlcm1zIGFuZCBj
b25kaXRpb25zIG9mIHVzZSwgY2VydGlmaWNhdGUgcG9saWN5IGFuZCBjZXJ0aWZp
Y2F0aW9uIHByYWN0aWNlIHN0YXRlbWVudHMuMA0GCSqGSIb3DQEBBQUAA4IBAQBc
NplMLXi37Yyb3PN3m/J20ncwT8EfhYOFG5k9RzfyqZtAjizUsZAS2L70c5vu0mQP
y3lPNNiiPvl4/2vIB+x9OYOLUyDTOMSxv5pPCmv/K/xZpwUJfBdAVhEedNO3iyM7
R6PVbyTi69G3cN8PReEnyvFteO3ntRcXqNx+IjXKJdXZD9Zr1KIkIxH3oayPc4Fg
xhtbCS+SsvhESPBgOJ4V9T0mZyCKM2r3DYLP3uujL/lTaltkwGMzd/c6ByxW69oP
IQ7aunMZT7XZNn/Bh1XZp5m5MkL72NVxnn6hUrcbvZNCJBIqxw8dtk2cXmPIS4AX
UKqK1drk/NAJBzewdXUh
-----END CERTIFICATE-----`

	block, _ := pem.Decode([]byte(appleCert))
	var cert *x509.Certificate
	cert, _ = x509.ParseCertificate(block.Bytes)
	rsaPublicKey := cert.PublicKey.(*rsa.PublicKey)
	return rsaPublicKey
}()

type appleNotification struct {
	NotificationType string                `json:"notificationType"`
	Subtype          string                `json:"subtype"`
	Version          int                   `json:"version"`
	Data             appleNotificationData `json:"data"`
}

type appleNotificationData struct {
	Environment           string `json:"string"`
	BundleId              string `json:"bundleId"`
	AppAppleId            int64  `json:"appAppleId"`
	BundleVersion         int    `json:"bundleVersion"`
	SignedTransactionInfo string `json:"signedTransactionInfo"`
	SignedRenewalInfo     string `json:"signedRenewalInfo"`
}

type appleNotificationTransactionInfo struct {
	AppAccountToken        string `json:"appAccountToken"`
	BundleId               string `json:"bundleId"`
	Environment            string `json:"environment"`
	TransactionId          string `json:"transactionId"`
	OriginalTransactionId  string `json:"originalTransactionId"`
	ProductId              string `json:"productId"`
	ExpiresDateMs          int64  `json:"expiresDate"`
	RevocationDateMs       int64  `json:"revocationDate"`
	OriginalPurchaseDateMs int64  `json:"originalPurchaseDate"`
	PurchaseDateMs         int64  `json:"purchaseDate"`
}

// Store providers notification callback handler functions
func appleNotificationHandler(logger *zap.Logger, db *sql.DB, purchaseNotificationCallback *RuntimePurchaseNotificationAppleFunction, subscriptionNotificationCallback *RuntimeSubscriptionNotificationAppleFunction) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.Error("Failed to decode App Store notification body", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer r.Body.Close()

		logger = logger.With(zap.String("notification_body", string(body)))

		var notification *appleNotification
		if err := json.Unmarshal(body, &notification); err != nil {
			logger.Error("Failed to unmarshal App Store notification", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		if err = jws.Verify(notification.Data.SignedTransactionInfo, ApplePubKey); err != nil {
			logger.Error("Failed to validate App Store notification transaction info signature", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		tokens := strings.Split(string(body), ".")
		if len(tokens) < 3 {
			logger.Error("Unexpected App Store notification JWS token length")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		payload := tokens[1]
		jsonPayload, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			logger.Error("Failed to base64 decode App Store notification payload")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var nPayload *appleNotificationTransactionInfo
		if err = json.Unmarshal(jsonPayload, &nPayload); err != nil {
			logger.Error("Failed to json unmarshal App Store notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		logger.Debug("Apple IAP notification received", zap.String("notification_payload", string(jsonPayload)))

		uid, err := uuid.FromString(nPayload.AppAccountToken)
		if err != nil {
			logger.Warn("App Store subscription notification AppAccountToken is unset or an invalid uuid", zap.String("app_account_token", nPayload.AppAccountToken), zap.Error(err), zap.String("payload", string(body)))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		env := api.StoreEnvironment_PRODUCTION
		if notification.Data.Environment == iap.AppleSandboxEnvironment {
			env = api.StoreEnvironment_SANDBOX
		}

		ctx := context.Background()
		if nPayload.ExpiresDateMs != 0 {
			// Notification regarding a subscription.
			sub := &storageSubscription{
				userID:                uid,
				originalTransactionId: nPayload.OriginalTransactionId,
				store:                 api.StoreProvider_APPLE_APP_STORE,
				productId:             nPayload.ProductId,
				purchaseTime:          parseMillisecondUnixTimestamp(nPayload.OriginalPurchaseDateMs),
				environment:           env,
				expireTime:            parseMillisecondUnixTimestamp(nPayload.ExpiresDateMs),
				rawNotification:       string(body),
				refundTime:            parseMillisecondUnixTimestamp(nPayload.RevocationDateMs),
			}

			if err = upsertSubscription(ctx, db, sub); err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
					// User id was not found, ignore this notification
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

			if strings.ToUpper(notification.NotificationType) == "REFUND" {
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

				if subscriptionNotificationCallback != nil {
					if err = (*subscriptionNotificationCallback)(ctx, validatedSub, string(body)); err != nil {
						logger.Error("Error invoking Apple subscription refund runtime function", zap.Error(err))
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			}

		} else {
			// Notification regarding a purchase.
			if strings.ToUpper(notification.NotificationType) == "REFUND" {
				purchase := &storagePurchase{
					userID:        uid,
					store:         api.StoreProvider_APPLE_APP_STORE,
					productId:     nPayload.ProductId,
					transactionId: nPayload.TransactionId,
					purchaseTime:  parseMillisecondUnixTimestamp(nPayload.PurchaseDateMs),
					refundTime:    parseMillisecondUnixTimestamp(nPayload.RevocationDateMs),
					environment:   env,
				}

				dbPurchases, err := upsertPurchases(ctx, db, []*storagePurchase{purchase})
				if err != nil {
					logger.Error("Failed to store App Store notification purchase data")
					w.WriteHeader(http.StatusInternalServerError)
					return
				}

				if purchaseNotificationCallback != nil {
					dbPurchase := dbPurchases[0]
					validatedPurchase := &api.ValidatedPurchase{
						UserId:           uid.String(),
						ProductId:        nPayload.ProductId,
						TransactionId:    nPayload.TransactionId,
						Store:            api.StoreProvider_APPLE_APP_STORE,
						CreateTime:       timestamppb.New(dbPurchase.createTime),
						UpdateTime:       timestamppb.New(dbPurchase.updateTime),
						PurchaseTime:     timestamppb.New(dbPurchase.purchaseTime),
						RefundTime:       timestamppb.New(dbPurchase.refundTime),
						ProviderResponse: string(body), // TODO: Should we pass the notification or the db response payload here?
						Environment:      env,
						SeenBefore:       dbPurchase.seenBefore,
					}

					if err = (*purchaseNotificationCallback)(ctx, validatedPurchase, string(body)); err != nil {
						logger.Error("Error invoking Apple purchase refund runtime function", zap.Error(err))
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			}
		}

		w.WriteHeader(http.StatusOK)
		return
	}
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

type googleDeveloperNotification struct {
	Version                  string                         `json:"version"`
	PackageName              string                         `json:"packageName"`
	EventTimeMillis          int64                          `json:"eventTimeMillis"`
	SubscriptionNotification googleSubscriptionNotification `json:"subscriptionNotification"`
	TestNotification         map[string]string              `json:"testNotification"`
}

type googleSubscriptionNotification struct {
	Version          string `json:"version"`
	NotificationType int    `json:"notificationType"`
	PurchaseToken    string `json:"purchaseToken"`
	SubscriptionId   string `json:"subscriptionId"`
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

		var notification *googleStoreNotification
		if err := json.Unmarshal(body, &notification); err != nil {
			logger.Error("Failed to unmarshal Google Play Billing notification", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		jsonData, err := base64.StdEncoding.DecodeString(notification.Message.Data)
		if err != nil {
			logger.Error("Failed to base64 decode Google Play Billing notification data")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		var data *googleDeveloperNotification
		if err = json.Unmarshal(jsonData, &data); err != nil {
			logger.Error("Failed to json unmarshal Google Play Billing notification payload", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		gResponse, gReceipt, _, err := iap.ValidateSubscriptionReceiptGoogle(context.Background(), httpc, config.ClientEmail, config.PrivateKey, data.SubscriptionNotification.PurchaseToken)
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

		var userID uuid.UUID
		if gResponse.ObfuscatedExternalAccountId != "" {
			uid, err := uuid.FromString(gResponse.ObfuscatedExternalAccountId)
			if err != nil {
				w.WriteHeader(http.StatusOK)
				return
			}
			userID = uid
		} else if gResponse.ObfuscatedExternalProfileId != "" {
			uid, err := uuid.FromString(gResponse.ObfuscatedExternalProfileId)
			if err != nil {
				w.WriteHeader(http.StatusOK)
				return
			}
			userID = uid
		} else if gResponse.ProfileId != "" {
			var uid string
			if err = db.QueryRowContext(context.Background(), "SELECT id FROM users WHERE google_id = $1", gResponse.ProfileId).Scan(&uid); err != nil {
				if err == sql.ErrNoRows {
					logger.Warn("Google Play Billing subscription notification user not found", zap.String("profile_id", gResponse.ProfileId), zap.String("payload", string(body)))
					w.WriteHeader(http.StatusOK) // Subscription could not be assigned to a user ID, ack and ignore it.
					return
				}
				w.WriteHeader(http.StatusInternalServerError)
				return
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

		storageSub := &storageSubscription{
			originalTransactionId: data.SubscriptionNotification.PurchaseToken,
			userID:                userID,
			store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
			productId:             gReceipt.ProductID,
			purchaseTime:          parseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
			environment:           env,
			expireTime:            parseMillisecondUnixTimestamp(expireTimeInt),
			rawNotification:       string(body),
		}

		if gResponse.LinkedPurchaseToken != "" {
			// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
			storageSub.originalTransactionId = gResponse.LinkedPurchaseToken
		}

		if err = upsertSubscription(context.Background(), db, storageSub); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
				// Record was inserted and the user id was not found, ignore this notification
				w.WriteHeader(http.StatusOK)
				return
			}

			logger.Error("Failed to store Google Play Billing notification subscription data", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		return
	}
}
