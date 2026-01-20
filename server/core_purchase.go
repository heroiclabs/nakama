// Copyright 2018 The Nakama Authors
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
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrPurchasesListInvalidCursor = errors.New("purchases list cursor invalid")

var httpc = &http.Client{Timeout: 20 * time.Second}

func ValidatePurchasesApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string, persist bool) (*api.ValidatePurchaseResponse, error) {
	tokens := strings.Split(receipt, ".")
	if len(tokens) != 3 {
		// Receipt is not a JWS, fallback to using deprecated verifyReceipt API.
		return validateLegacyPurchaseReceiptApple(ctx, logger, db, httpc, userID, receipt, password, persist)
	}
	// Receipt is a JWS.
	if err := iap.ValidateAppleJwsSignature(receipt); err != nil {
		return nil, err
	}
	seg := tokens[1]
	jsonPayload, err := base64.RawStdEncoding.DecodeString(seg)
	if err != nil {
		return nil, err
	}

	var transactionInfo *runtime.AppleNotificationTransactionInfo
	if err = json.Unmarshal(jsonPayload, &transactionInfo); err != nil {
		return nil, err
	}

	if transactionInfo.ExpiresDate != 0 {
		// This is a subscription transaction.
		return nil, status.Error(codes.FailedPrecondition, "Subscription Receipt. Use the appropriate function instead.")
	}

	env := api.StoreEnvironment_PRODUCTION
	if transactionInfo.Environment == iap.AppleSandboxEnvironment {
		env = api.StoreEnvironment_SANDBOX
	}

	purchase := &storagePurchase{
		userID:        userID,
		store:         api.StoreProvider_APPLE_APP_STORE,
		productId:     transactionInfo.ProductId,
		transactionId: transactionInfo.TransactionId,
		purchaseTime:  parseMillisecondUnixTimestamp(transactionInfo.PurchaseDate),
		refundTime:    parseMillisecondUnixTimestamp(transactionInfo.RevocationDate),
		environment:   env,
	}

	dbPurchases, err := upsertPurchases(ctx, db, []*storagePurchase{purchase})
	if err != nil {
		logger.Error("Failed to store App Store notification purchase data", zap.Error(err))
		return nil, status.Error(codes.Internal, "Failed to store app store purchase data")
	}

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
		ProviderResponse: receipt,
		Environment:      env,
		SeenBefore:       dbPurchase.seenBefore,
	}

	return &api.ValidatePurchaseResponse{ValidatedPurchases: []*api.ValidatedPurchase{validatedPurchase}}, nil
}

func validateLegacyPurchaseReceiptApple(ctx context.Context, logger *zap.Logger, db *sql.DB, httpc *http.Client, userID uuid.UUID, receipt, password string, persist bool) (*api.ValidatePurchaseResponse, error) {
	if password == "" {
		return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	}

	validation, raw, err := iap.ValidateLegacyReceiptApple(ctx, httpc, receipt, password)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Debug("Error validating Apple receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr
			}
			logger.Error("Error validating Apple receipt", zap.Error(err))
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

	seenTransactionIDs := make(map[string]struct{}, len(validation.Receipt.InApp)+len(validation.LatestReceiptInfo))
	storagePurchases := make([]*storagePurchase, 0, len(validation.Receipt.InApp)+len(validation.LatestReceiptInfo))
	for _, purchase := range validation.Receipt.InApp {
		if purchase.ExpiresDateMs != "" {
			continue
		}
		if _, seen := seenTransactionIDs[purchase.TransactionId]; seen {
			continue
		}

		purchaseTime, err := strconv.ParseInt(purchase.PurchaseDateMs, 10, 64)
		if err != nil {
			return nil, err
		}

		seenTransactionIDs[purchase.TransactionId] = struct{}{}
		storagePurchases = append(storagePurchases, &storagePurchase{
			userID:        userID,
			store:         api.StoreProvider_APPLE_APP_STORE,
			productId:     purchase.ProductID,
			transactionId: purchase.TransactionId,
			rawResponse:   string(raw),
			purchaseTime:  parseMillisecondUnixTimestamp(purchaseTime),
			environment:   env,
		})
	}
	// latest_receipt_info can also contaion purchases.
	// https://developer.apple.com/forums/thread/63092
	for _, purchase := range validation.LatestReceiptInfo {
		if purchase.ExpiresDateMs != "" {
			continue
		}
		if _, seen := seenTransactionIDs[purchase.TransactionId]; seen {
			continue
		}

		purchaseTime, err := strconv.ParseInt(purchase.PurchaseDateMs, 10, 64)
		if err != nil {
			return nil, err
		}

		seenTransactionIDs[purchase.TransactionId] = struct{}{}
		storagePurchases = append(storagePurchases, &storagePurchase{
			userID:        userID,
			store:         api.StoreProvider_APPLE_APP_STORE,
			productId:     purchase.ProductId,
			transactionId: purchase.TransactionId,
			rawResponse:   string(raw),
			purchaseTime:  parseMillisecondUnixTimestamp(purchaseTime),
			environment:   env,
		})
	}

	if len(storagePurchases) == 0 && len(validation.Receipt.InApp)+len(validation.LatestReceiptInfo) > 0 {
		// All purchases in this receipt are subscriptions.
		return nil, status.Error(codes.FailedPrecondition, "Subscription Receipt. Use the appropriate function instead.")
	}

	if !persist {
		// Skip storing the receipts
		validatedPurchases := make([]*api.ValidatedPurchase, 0, len(storagePurchases))
		for _, p := range storagePurchases {
			validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
				UserId:           p.userID.String(),
				ProductId:        p.productId,
				TransactionId:    p.transactionId,
				Store:            p.store,
				PurchaseTime:     timestamppb.New(p.purchaseTime),
				ProviderResponse: string(raw),
				Environment:      p.environment,
			})
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := upsertPurchases(ctx, db, storagePurchases)
	if err != nil {
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.userID.String()
		if p.userID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     timestamppb.New(p.purchaseTime),
			CreateTime:       timestamppb.New(p.createTime),
			UpdateTime:       timestamppb.New(p.updateTime),
			ProviderResponse: string(raw),
			SeenBefore:       p.seenBefore,
			Environment:      p.environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPGoogleConfig, receipt string, persist bool) (*api.ValidatePurchaseResponse, error) {
	gResponse, gReceipt, raw, err := iap.ValidateReceiptGoogle(ctx, httpc, config.ClientEmail, config.PrivateKey, receipt)
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Debug("Error validating Google receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
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

	if gReceipt.PurchaseState != 0 {
		// Do not accept cancelled or pending receipts.
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. State: %d", gReceipt.PurchaseState))
	}

	sPurchase := &storagePurchase{
		userID:        userID,
		store:         api.StoreProvider_GOOGLE_PLAY_STORE,
		productId:     gReceipt.ProductID,
		transactionId: gReceipt.PurchaseToken,
		rawResponse:   string(raw),
		purchaseTime:  parseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		environment:   purchaseEnv,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID.String(),
				ProductId:        sPurchase.productId,
				TransactionId:    sPurchase.transactionId,
				Store:            sPurchase.store,
				PurchaseTime:     timestamppb.New(sPurchase.purchaseTime),
				ProviderResponse: string(raw),
				Environment:      sPurchase.environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := upsertPurchases(ctx, db, []*storagePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Google receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.userID.String()
		if p.userID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     timestamppb.New(p.purchaseTime),
			CreateTime:       timestamppb.New(p.createTime),
			UpdateTime:       timestamppb.New(p.updateTime),
			ProviderResponse: string(raw),
			SeenBefore:       p.seenBefore,
			Environment:      p.environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseHuawei(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPHuaweiConfig, inAppPurchaseData, signature string, persist bool) (*api.ValidatePurchaseResponse, error) {
	validation, data, raw, err := iap.ValidateReceiptHuawei(ctx, httpc, config.PublicKey, config.ClientID, config.ClientSecret, inAppPurchaseData, signature)
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Debug("Error validating Huawei receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr
			} else {
				logger.Error("Error validating Huawei receipt", zap.Error(err))
			}
		}
		return nil, err
	}

	if validation.ResponseCode != strconv.Itoa(iap.HuaweiReceiptIsValid) {
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. Code: %s", validation.ResponseCode))
	}

	env := api.StoreEnvironment_PRODUCTION
	if data.PurchaseType == iap.HuaweiSandboxPurchaseType {
		env = api.StoreEnvironment_SANDBOX
	}

	sPurchase := &storagePurchase{
		userID:        userID,
		store:         api.StoreProvider_HUAWEI_APP_GALLERY,
		productId:     validation.PurchaseTokenData.ProductId,
		transactionId: validation.PurchaseTokenData.PurchaseToken,
		rawResponse:   string(raw),
		purchaseTime:  parseMillisecondUnixTimestamp(data.PurchaseTime),
		environment:   env,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				ProductId:        sPurchase.productId,
				TransactionId:    sPurchase.transactionId,
				Store:            sPurchase.store,
				PurchaseTime:     timestamppb.New(sPurchase.purchaseTime),
				ProviderResponse: string(raw),
				Environment:      sPurchase.environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := upsertPurchases(ctx, db, []*storagePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Huawei receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.userID.String()
		if p.userID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     timestamppb.New(p.purchaseTime),
			CreateTime:       timestamppb.New(p.createTime),
			UpdateTime:       timestamppb.New(p.updateTime),
			ProviderResponse: string(raw),
			SeenBefore:       p.seenBefore,
			Environment:      p.environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseFacebookInstant(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPFacebookInstantConfig, signedRequest string, persist bool) (*api.ValidatePurchaseResponse, error) {
	payment, rawResponse, err := iap.ValidateReceiptFacebookInstant(config.AppSecret, signedRequest)
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error validating Facebook Instant receipt", zap.Error(err))
		}
		return nil, err
	}

	sPurchase := &storagePurchase{
		userID:        userID,
		store:         api.StoreProvider_FACEBOOK_INSTANT_STORE,
		productId:     payment.ProductId,
		transactionId: payment.PurchaseToken,
		rawResponse:   rawResponse,
		purchaseTime:  time.Unix(int64(payment.PurchaseTime), 0),
		environment:   api.StoreEnvironment_PRODUCTION,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID.String(),
				ProductId:        sPurchase.productId,
				TransactionId:    sPurchase.transactionId,
				Store:            sPurchase.store,
				PurchaseTime:     timestamppb.New(sPurchase.purchaseTime),
				ProviderResponse: rawResponse,
				Environment:      sPurchase.environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := upsertPurchases(ctx, db, []*storagePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Facebook Instant receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.userID.String()
		if p.userID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     timestamppb.New(p.purchaseTime),
			CreateTime:       timestamppb.New(p.createTime),
			UpdateTime:       timestamppb.New(p.updateTime),
			ProviderResponse: rawResponse,
			SeenBefore:       p.seenBefore,
			Environment:      p.environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func GetPurchaseByTransactionId(ctx context.Context, logger *zap.Logger, db *sql.DB, transactionID string) (*api.ValidatedPurchase, error) {
	var (
		dbTransactionId string
		dbUserId        uuid.UUID
		dbStore         api.StoreProvider
		dbCreateTime    pgtype.Timestamptz
		dbUpdateTime    pgtype.Timestamptz
		dbPurchaseTime  pgtype.Timestamptz
		dbRefundTime    pgtype.Timestamptz
		dbProductId     string
		dbEnvironment   api.StoreEnvironment
		dbRawResponse   string
	)

	err := db.QueryRowContext(ctx, `
		SELECT
			user_id,
			store,
			transaction_id,
			create_time,
			update_time,
			purchase_time,
			refund_time,
			product_id,
			environment,
			raw_response
		FROM purchase
		WHERE transaction_id = $1
`, transactionID).Scan(&dbUserId, &dbStore, &dbTransactionId, &dbCreateTime, &dbUpdateTime, &dbPurchaseTime, &dbRefundTime, &dbProductId, &dbEnvironment, &dbRawResponse)
	if err != nil {
		if err == sql.ErrNoRows {
			// Not found
			return nil, nil
		}
		logger.Error("Error getting purchase", zap.Error(err))
		return nil, err
	}

	suid := dbUserId.String()
	if dbUserId.IsNil() {
		suid = ""
	}

	return &api.ValidatedPurchase{
		UserId:           suid,
		ProductId:        dbProductId,
		TransactionId:    dbTransactionId,
		Store:            dbStore,
		PurchaseTime:     timestamppb.New(dbPurchaseTime.Time),
		CreateTime:       timestamppb.New(dbCreateTime.Time),
		UpdateTime:       timestamppb.New(dbUpdateTime.Time),
		Environment:      dbEnvironment,
		RefundTime:       timestamppb.New(dbRefundTime.Time),
		ProviderResponse: dbRawResponse,
	}, nil
}

type purchasesListCursor struct {
	TransactionId string
	PurchaseTime  *timestamppb.Timestamp
	UserId        string
	IsNext        bool
	After         time.Time
	Before        time.Time
}

func ListPurchases(ctx context.Context, logger *zap.Logger, db *sql.DB, userID string, limit int, cursor string, after, before time.Time) (*api.PurchaseList, error) {
	var incomingCursor *purchasesListCursor
	if cursor != "" {
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, ErrPurchasesListInvalidCursor
		}
		incomingCursor = &purchasesListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrPurchasesListInvalidCursor
		}
		if userID != "" && userID != incomingCursor.UserId {
			// userID filter was set and has changed, cursor is now invalid
			return nil, ErrPurchasesListInvalidCursor
		}
		if !after.Equal(incomingCursor.After) {
			return nil, ErrPurchasesListInvalidCursor
		}
		if !before.Equal(incomingCursor.Before) {
			return nil, ErrPurchasesListInvalidCursor
		}
	}

	query := `
SELECT
	user_id,
	transaction_id,
	product_id,
	store,
	raw_response,
	purchase_time,
	create_time,
	update_time,
	refund_time,
	environment
FROM
	purchase`

	var order string
	params := make([]interface{}, 0, 7)

	if incomingCursor != nil {
		if incomingCursor.IsNext {
			if userID == "" {
				query += " WHERE (purchase_time, user_id, transaction_id) < ($1, $2, $3)"
				order = " ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC"
			} else {
				query += " WHERE user_id = $2 AND (purchase_time, user_id, transaction_id) < ($1, $2, $3)"
				order = " ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC"
			}
		} else {
			if userID == "" {
				query += " WHERE (purchase_time, user_id, transaction_id) > ($1, $2, $3)"
				order = " ORDER BY purchase_time, user_id, transaction_id"
			} else {
				query += " WHERE user_id = $2 AND (purchase_time, user_id, transaction_id) > ($1, $2, $3)"
				order = " ORDER BY purchase_time, user_id, transaction_id"
			}
		}
		params = append(params, incomingCursor.PurchaseTime.AsTime(), incomingCursor.UserId, incomingCursor.TransactionId)
	} else {
		if userID == "" {
			//query += " "
			order = " ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC"
		} else {
			query += " WHERE user_id = $1"
			order = " ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC"
			params = append(params, userID)
		}
	}

	if !after.IsZero() {
		if len(params) == 0 {
			params = append(params, after)
			query += fmt.Sprintf(" WHERE purchase_time >= $%v", len(params))
		} else {
			params = append(params, after)
			query += fmt.Sprintf(" AND purchase_time >= $%v", len(params))
		}
	}
	if !before.IsZero() {
		if len(params) == 0 {
			params = append(params, before)
			query += fmt.Sprintf(" WHERE purchase_time <= $%v", len(params))
		} else {
			params = append(params, before)
			query += fmt.Sprintf(" AND purchase_time <= $%v", len(params))
		}
	}

	// Add order to query.
	query += order

	// Add limit to query.
	if limit > 0 {
		params = append(params, limit+1)
	} else {
		params = append(params, 101) // Default limit to 100 purchases if not set
	}
	query += fmt.Sprintf(" LIMIT $%d", len(params))

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving purchases.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	var nextCursor *purchasesListCursor
	var prevCursor *purchasesListCursor
	purchases := make([]*api.ValidatedPurchase, 0, limit)

	var dbUserID uuid.UUID
	var transactionId string
	var productId string
	var store api.StoreProvider
	var rawResponse string
	var purchaseTime pgtype.Timestamptz
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	var refundTime pgtype.Timestamptz
	var environment api.StoreEnvironment

	for rows.Next() {
		if len(purchases) >= limit {
			nextCursor = &purchasesListCursor{
				TransactionId: transactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        dbUserID.String(),
				IsNext:        true,
				After:         after,
				Before:        before,
			}
			break
		}

		if err = rows.Scan(&dbUserID, &transactionId, &productId, &store, &rawResponse, &purchaseTime, &createTime, &updateTime, &refundTime, &environment); err != nil {
			logger.Error("Error retrieving purchases.", zap.Error(err))
			return nil, err
		}

		suid := dbUserID.String()
		if dbUserID.IsNil() {
			suid = ""
		}

		purchase := &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        productId,
			TransactionId:    transactionId,
			Store:            store,
			PurchaseTime:     timestamppb.New(purchaseTime.Time),
			CreateTime:       timestamppb.New(createTime.Time),
			UpdateTime:       timestamppb.New(updateTime.Time),
			ProviderResponse: rawResponse,
			Environment:      environment,
			RefundTime:       timestamppb.New(refundTime.Time),
		}

		purchases = append(purchases, purchase)

		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &purchasesListCursor{
				TransactionId: transactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        dbUserID.String(),
				IsNext:        false,
				After:         after,
				Before:        before,
			}
		}
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving purchases", zap.Error(err))
		return nil, err
	}
	_ = rows.Close()

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

		slices.Reverse(purchases)
	}

	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating purchases list cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating purchases list cursor", zap.Error(err))
			return nil, err
		}
		prevCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return &api.PurchaseList{ValidatedPurchases: purchases, Cursor: nextCursorStr, PrevCursor: prevCursorStr}, nil
}

type storagePurchase struct {
	userID        uuid.UUID
	store         api.StoreProvider
	productId     string
	transactionId string
	rawResponse   string
	purchaseTime  time.Time
	createTime    time.Time // Set by upsertPurchases
	updateTime    time.Time // Set by upsertPurchases
	refundTime    time.Time
	environment   api.StoreEnvironment
	seenBefore    bool // Set by upsertPurchases
}

func upsertPurchases(ctx context.Context, db *sql.DB, purchases []*storagePurchase) ([]*storagePurchase, error) {
	if len(purchases) < 1 {
		return nil, errors.New("expects at least one receipt")
	}

	transactionIDsToPurchase := make(map[string]*storagePurchase)

	userIdParams := make([]uuid.UUID, 0, len(purchases))
	storeParams := make([]api.StoreProvider, 0, len(purchases))
	transactionIdParams := make([]string, 0, len(purchases))
	productIdParams := make([]string, 0, len(purchases))
	purchaseTimeParams := make([]time.Time, 0, len(purchases))
	rawResponseParams := make([]string, 0, len(purchases))
	environmentParams := make([]api.StoreEnvironment, 0, len(purchases))
	refundTimeParams := make([]time.Time, 0, len(purchases))

	for _, purchase := range purchases {
		if purchase.refundTime.IsZero() {
			purchase.refundTime = time.Unix(0, 0)
		}
		if purchase.rawResponse == "" {
			purchase.rawResponse = "{}"
		}
		transactionIDsToPurchase[purchase.transactionId] = purchase

		userIdParams = append(userIdParams, purchase.userID)
		storeParams = append(storeParams, purchase.store)
		transactionIdParams = append(transactionIdParams, purchase.transactionId)
		productIdParams = append(productIdParams, purchase.productId)
		purchaseTimeParams = append(purchaseTimeParams, purchase.purchaseTime)
		rawResponseParams = append(rawResponseParams, purchase.rawResponse)
		environmentParams = append(environmentParams, purchase.environment)
		refundTimeParams = append(refundTimeParams, purchase.refundTime)
	}

	query := `
INSERT INTO purchase
	(
		user_id,
		store,
		transaction_id,
		product_id,
		purchase_time,
		raw_response,
		environment,
		refund_time
	)
SELECT unnest($1::uuid[]), unnest($2::smallint[]), unnest($3::text[]), unnest($4::text[]), unnest($5::timestamptz[]), unnest($6::jsonb[]), unnest($7::smallint[]), unnest($8::timestamptz[])
ON CONFLICT
	(transaction_id)
DO UPDATE SET
	refund_time = EXCLUDED.refund_time,
	update_time = now()
RETURNING
	user_id,
	transaction_id,
	create_time,
	update_time,
	refund_time
`

	rows, err := db.QueryContext(ctx, query, userIdParams, storeParams, transactionIdParams, productIdParams, purchaseTimeParams, rawResponseParams, environmentParams, refundTimeParams)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		// Newly inserted purchases
		var dbUserID uuid.UUID
		var transactionId string
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var refundTime pgtype.Timestamptz
		if err = rows.Scan(&dbUserID, &transactionId, &createTime, &updateTime, &refundTime); err != nil {
			_ = rows.Close()
			return nil, err
		}
		storedPurchase := transactionIDsToPurchase[transactionId]
		storedPurchase.createTime = createTime.Time
		storedPurchase.updateTime = updateTime.Time
		storedPurchase.seenBefore = updateTime.Time.After(createTime.Time)
		if refundTime.Time.Unix() != 0 {
			storedPurchase.refundTime = refundTime.Time
		}
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	storedPurchases := make([]*storagePurchase, 0, len(transactionIDsToPurchase))
	for _, purchase := range transactionIDsToPurchase {
		storedPurchases = append(storedPurchases, purchase)
	}

	return storedPurchases, nil
}

func parseMillisecondUnixTimestamp(t int64) time.Time {
	return time.Unix(0, 0).Add(time.Duration(t) * time.Millisecond)
}
