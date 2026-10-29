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
	"io"
	"net/http"
	"slices"
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

	dbPurchase := &storagePurchase{
		userID:        userID,
		store:         int(api.StoreProvider_APPLE_APP_STORE),
		productId:     transactionInfo.ProductId,
		transactionId: transactionInfo.TransactionId,
		purchaseTime:  parseMillisecondUnixTimestamp(transactionInfo.PurchaseDate),
		refundTime:    parseMillisecondUnixTimestamp(transactionInfo.RevocationDate),
		environment:   env,
	}

	validatedPurchase := &api.ValidatedPurchase{
		UserId:        dbPurchase.userID.String(),
		ProductId:     transactionInfo.ProductId,
		TransactionId: transactionInfo.TransactionId,
		Store:         api.StoreProvider_APPLE_APP_STORE,
		PurchaseTime:  timestamppb.New(dbPurchase.purchaseTime),
		RefundTime:    timestamppb.New(dbPurchase.refundTime),
		Environment:   env,
	}

	if !persist {
		return &api.ValidatePurchaseResponse{ValidatedPurchases: []*api.ValidatedPurchase{validatedPurchase}}, nil
	}

	receiptJson, err := json.Marshal(map[string]string{"jws": receipt})
	if err != nil {
		logger.Error("Failed to marshal Apple receipt JSON", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error validating Apple JWS receipt")
	}
	dbPurchase.rawResponse = string(receiptJson)

	dbPurchases, err := upsertPurchases(ctx, db, []*storagePurchase{dbPurchase})
	if err != nil || len(dbPurchases) == 0 {
		logger.Error("Failed to store App Store notification purchase data", zap.Error(err))
		return nil, status.Error(codes.Internal, "Failed to store app store purchase data")
	}

	dbPurchase = dbPurchases[0]
	suid := dbPurchase.userID.String()
	if dbPurchase.userID.IsNil() {
		suid = ""
	}

	validatedPurchase.UserId = suid
	validatedPurchase.SeenBefore = dbPurchase.seenBefore
	validatedPurchase.CreateTime = timestamppb.New(dbPurchase.createTime)
	validatedPurchase.UpdateTime = timestamppb.New(dbPurchase.updateTime)
	validatedPurchase.RefundTime = timestamppb.New(dbPurchase.refundTime)
	validatedPurchase.ProviderResponse = "" // Do not set for jws validation; no point in returning the incoming receipt.

	return &api.ValidatePurchaseResponse{ValidatedPurchases: []*api.ValidatedPurchase{validatedPurchase}}, nil
}

func validateLegacyPurchaseReceiptApple(ctx context.Context, logger *zap.Logger, db *sql.DB, httpc *http.Client, userID uuid.UUID, receipt, password string, persist bool) (*api.ValidatePurchaseResponse, error) {
	if password == "" {
		return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	}

	validation, raw, err := iap.ValidateLegacyReceiptApple(ctx, httpc, password, receipt)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			if vErr, ok := errors.AsType[*iap.ValidationError](err); ok {
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
			store:         int(api.StoreProvider_APPLE_APP_STORE),
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
			store:         int(api.StoreProvider_APPLE_APP_STORE),
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
				Store:            api.StoreProvider(p.store),
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
			Store:            api.StoreProvider(p.store),
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
		if !errors.Is(err, context.Canceled) {
			if vErr, ok := errors.AsType[*iap.ValidationError](err); ok {
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
		store:         int(api.StoreProvider_GOOGLE_PLAY_STORE),
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
				Store:            api.StoreProvider(sPurchase.store),
				PurchaseTime:     timestamppb.New(sPurchase.purchaseTime),
				ProviderResponse: string(raw),
				Environment:      sPurchase.environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := upsertPurchases(ctx, db, []*storagePurchase{sPurchase})
	if err != nil {
		if !errors.Is(err, context.Canceled) {
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
			Store:            api.StoreProvider(p.store),
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
		if !errors.Is(err, context.Canceled) {
			if vErr, ok := errors.AsType[*iap.ValidationError](err); ok {
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
		store:         int(api.StoreProvider_HUAWEI_APP_GALLERY),
		productId:     validation.PurchaseTokenData.ProductId,
		transactionId: validation.PurchaseTokenData.PurchaseToken,
		rawResponse:   string(raw),
		purchaseTime:  parseMillisecondUnixTimestamp(data.PurchaseTime),
		environment:   env,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID.String(),
				ProductId:        sPurchase.productId,
				TransactionId:    sPurchase.transactionId,
				Store:            api.StoreProvider(sPurchase.store),
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
			Store:            api.StoreProvider(p.store),
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

func GetPurchaseByTransactionId(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, transactionID string) (*api.ValidatedPurchase, error) {
	var (
		dbTransactionId string
		dbUserId        uuid.UUID
		dbStore         int
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
		if errors.Is(err, sql.ErrNoRows) {
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

	purchase := &api.ValidatedPurchase{
		UserId:           suid,
		ProductId:        dbProductId,
		TransactionId:    dbTransactionId,
		Store:            api.StoreProvider(dbStore),
		PurchaseTime:     timestamppb.New(dbPurchaseTime.Time),
		CreateTime:       timestamppb.New(dbCreateTime.Time),
		UpdateTime:       timestamppb.New(dbUpdateTime.Time),
		Environment:      dbEnvironment,
		RefundTime:       timestamppb.New(dbRefundTime.Time),
		ProviderResponse: dbRawResponse,
	}
	if name := registry.GetName(dbStore); name != "" {
		purchase.Provider = name
	}

	return purchase, nil
}

func ValidatePurchase(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, userID uuid.UUID, traceID, providerName string, payload, overrides map[string]any, persist bool) (*api.ValidateIAPPurchaseResponse, error) {
	provider := registry.Get(providerName)
	if provider == nil {
		return nil, status.Error(codes.InvalidArgument, "IAP provider not found: "+providerName)
	}

	purchases, err, code := provider.validate(ctx, traceID, payload, overrides)
	if err != nil {
		if _, ok := status.FromError(err); ok {
			return nil, err
		}
		return nil, status.Error(code, err.Error())
	}

	if len(purchases) == 0 {
		logger.Warn("IAP provider returned no purchases.", zap.String("provider", provider.name))
		return nil, status.Error(codes.FailedPrecondition, "Invalid Receipt. No purchases found.")
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	storagePurchases := make([]*storagePurchase, 0, len(purchases))
	seenTransactionIDs := make(map[string]struct{}, len(purchases))
	for _, purchase := range purchases {
		if purchase == nil || purchase.TransactionId == "" {
			logger.Error("IAP provider returned a purchase without a transaction ID.", zap.String("provider", provider.name))
			return nil, status.Error(codes.FailedPrecondition, "Invalid Receipt. Transaction ID is required.")
		}

		if _, seen := seenTransactionIDs[purchase.TransactionId]; seen {
			continue
		}
		seenTransactionIDs[purchase.TransactionId] = struct{}{}

		validatedPurchase := &api.ValidatedPurchase{
			UserId:           userID.String(),
			ProductId:        purchase.ProductId,
			TransactionId:    purchase.TransactionId,
			Store:            api.StoreProvider(provider.storeCode),
			Provider:         provider.name,
			PurchaseTime:     timestamppb.New(purchase.PurchaseTime),
			ProviderResponse: purchase.RawResponse,
			Environment:      purchase.Environment,
		}
		if !purchase.RefundTime.IsZero() {
			validatedPurchase.RefundTime = timestamppb.New(purchase.RefundTime)
		}
		validatedPurchases = append(validatedPurchases, validatedPurchase)

		storagePurchases = append(storagePurchases, &storagePurchase{
			userID:        userID,
			store:         provider.storeCode,
			productId:     purchase.ProductId,
			transactionId: purchase.TransactionId,
			rawResponse:   purchase.RawResponse,
			purchaseTime:  purchase.PurchaseTime,
			refundTime:    purchase.RefundTime,
			environment:   purchase.Environment,
		})
	}

	if !persist {
		return &api.ValidateIAPPurchaseResponse{Purchase: validatedPurchases}, nil
	}

	ownStorePurchases := make([]*storagePurchase, 0, len(storagePurchases))
	for _, purchaseToStore := range storagePurchases {
		existing, err := GetPurchaseByTransactionId(ctx, logger, db, registry, purchaseToStore.transactionId)
		if err != nil {
			logger.Error("Error looking up purchase from provider", zap.String("provider", provider.name), zap.Error(err))
			return nil, err
		}
		if existing == nil || existing.Provider == provider.name {
			ownStorePurchases = append(ownStorePurchases, purchaseToStore)
			continue
		}
		logger.Warn("IAP provider transaction ID belongs to another store, not storing.", zap.String("provider", provider.name), zap.String("transaction_id", purchaseToStore.transactionId))
		for _, validatedPurchase := range validatedPurchases {
			if validatedPurchase.TransactionId == purchaseToStore.transactionId {
				validatedPurchase.SeenBefore = true
			}
		}
	}
	if len(ownStorePurchases) == 0 {
		return &api.ValidateIAPPurchaseResponse{Purchase: validatedPurchases}, nil
	}

	stored, err := upsertPurchases(ctx, db, ownStorePurchases)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			logger.Error("Error storing purchase from provider", zap.String("provider", provider.name), zap.Error(err))
		}
		return nil, err
	}

	for _, validatedPurchase := range validatedPurchases {
		for _, storedPurchase := range stored {
			if storedPurchase.transactionId != validatedPurchase.TransactionId {
				continue
			}
			validatedPurchase.CreateTime = timestamppb.New(storedPurchase.createTime)
			validatedPurchase.UpdateTime = timestamppb.New(storedPurchase.updateTime)
			validatedPurchase.SeenBefore = storedPurchase.seenBefore
			if storedPurchase.refundTime.Unix() != 0 {
				validatedPurchase.RefundTime = timestamppb.New(storedPurchase.refundTime)
			}
			break
		}
	}

	return &api.ValidateIAPPurchaseResponse{Purchase: validatedPurchases}, nil
}

type purchasesListCursor struct {
	TransactionId string
	PurchaseTime  *timestamppb.Timestamp
	UserId        string
	IsNext        bool
	After         time.Time
	Before        time.Time
	Store         *int
}

func ListPurchases(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, userID string, limit int, cursor string, after, before time.Time, storeFilter *int) (*api.PurchaseList, error) {
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
		if (storeFilter == nil) != (incomingCursor.Store == nil) || (storeFilter != nil && *storeFilter != *incomingCursor.Store) {
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
	params := make([]any, 0, 7)

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
	if storeFilter != nil {
		if len(params) == 0 {
			params = append(params, *storeFilter)
			query += fmt.Sprintf(" WHERE store = $%v", len(params))
		} else {
			params = append(params, *storeFilter)
			query += fmt.Sprintf(" AND store = $%v", len(params))
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
	var store int
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
				Store:         storeFilter,
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
			Store:            api.StoreProvider(store),
			PurchaseTime:     timestamppb.New(purchaseTime.Time),
			CreateTime:       timestamppb.New(createTime.Time),
			UpdateTime:       timestamppb.New(updateTime.Time),
			ProviderResponse: rawResponse,
			Environment:      environment,
			RefundTime:       timestamppb.New(refundTime.Time),
		}

		if name := registry.GetName(store); name != "" {
			purchase.Provider = name
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
				Store:         storeFilter,
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
	store         int
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
	storeParams := make([]int, 0, len(purchases))
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

func iapProviderNotificationHandler(logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, provider *RuntimeIAPProviderFunctions, purchaseHook RuntimeIAPPurchaseNotificationFunction, subscriptionHook RuntimeIAPSubscriptionNotificationFunction) http.HandlerFunc {
	logger = logger.With(zap.String("provider", provider.name))
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			logger.Error("Failed to read IAP provider notification body", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		notifications, err := provider.notificationHandler(r.Context(), body, r.Header, r.URL.Query())
		if err != nil {
			logger.Error("Failed to handle IAP provider notification", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		for _, notification := range notifications {
			if notification == nil {
				continue
			}

			if subscription := notification.Subscription; subscription != nil {
				if subscription.OriginalTransactionId == "" {
					logger.Error("IAP provider subscription notification has no original transaction ID")
					continue
				}

				existing, err := getSubscriptionByOriginalTransactionId(r.Context(), logger, db, registry, subscription.OriginalTransactionId)
				if err != nil {
					logger.Error("Failed to get subscription by original transaction id", zap.Error(err))
					w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
					return
				}
				if existing != nil && existing.Store != api.StoreProvider(provider.storeCode) {
					logger.Warn("IAP provider subscription notification original transaction ID belongs to another store", zap.String("original_transaction_id", subscription.OriginalTransactionId))
					continue
				}

				uid := uuid.FromStringOrNil(notification.UserId)
				if uid.IsNil() {
					if existing == nil || existing.UserId == "" {
						logger.Warn("No userId found for this IAP provider subscription notification", zap.String("original_transaction_id", subscription.OriginalTransactionId))
						if notification.RequireUser {
							w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
							return
						}
						continue
					}
					uid = uuid.Must(uuid.FromString(existing.UserId))
				}

				refundTime := subscription.RefundTime
				if refundTime.IsZero() && notification.Type == runtime.IAPNotificationRefunded {
					refundTime = time.Now()
				}
				sub := &storageSubscription{
					userID:                uid,
					originalTransactionId: subscription.OriginalTransactionId,
					store:                 api.StoreProvider(provider.storeCode),
					productId:             subscription.ProductId,
					purchaseTime:          subscription.PurchaseTime,
					environment:           subscription.Environment,
					expireTime:            subscription.ExpiryTime,
					refundTime:            refundTime,
					rawResponse:           subscription.RawResponse,
					rawNotification:       string(body),
				}

				if err = ExecuteInTx(r.Context(), db, func(tx *sql.Tx) error {
					return upsertSubscription(r.Context(), tx, sub)
				}); err != nil {
					var pgErr *pgconn.PgError
					if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
						logger.Warn("User not found for this IAP provider subscription notification", zap.String("original_transaction_id", subscription.OriginalTransactionId))
						continue
					}
					logger.Error("Failed to store IAP provider notification subscription data", zap.Error(err))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}

				if subscriptionHook != nil && notification.Type != 0 {
					suid := sub.userID.String()
					if sub.userID.IsNil() {
						suid = ""
					}
					validatedSub := &api.ValidatedSubscription{
						UserId:                suid,
						ProductId:             sub.productId,
						OriginalTransactionId: sub.originalTransactionId,
						Store:                 sub.store,
						Provider:              provider.name,
						PurchaseTime:          timestamppb.New(sub.purchaseTime),
						CreateTime:            timestamppb.New(sub.createTime),
						UpdateTime:            timestamppb.New(sub.updateTime),
						Environment:           sub.environment,
						ExpiryTime:            timestamppb.New(sub.expireTime),
						RefundTime:            timestamppb.New(sub.refundTime),
						ProviderResponse:      sub.rawResponse,
						ProviderNotification:  sub.rawNotification,
						Active:                sub.Active(),
					}

					if err = subscriptionHook(r.Context(), provider.name, notification.Type, validatedSub, string(body)); err != nil {
						logger.Error("Error invoking IAP provider subscription notification function", zap.Error(err), zap.String("original_transaction_id", sub.originalTransactionId))
					}
				}

				continue
			}

			if notification.Purchase == nil {
				continue
			}
			if notification.Type != runtime.IAPNotificationRefunded {
				logger.Warn("IAP provider purchase notification is not a refund, ignoring", zap.String("notification_type", notification.Type.String()))
				continue
			}
			purchase := notification.Purchase

			existing, err := GetPurchaseByTransactionId(r.Context(), logger, db, registry, purchase.TransactionId)
			if err != nil {
				logger.Error("Failed to get purchase by transaction id", zap.Error(err))
				w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
				return
			}
			if existing != nil && existing.Provider != provider.name {
				logger.Warn("IAP provider refund notification transaction ID belongs to another store", zap.String("transaction_id", purchase.TransactionId))
				continue
			}

			uid := uuid.FromStringOrNil(notification.UserId)
			if uid.IsNil() {
				if existing == nil || existing.UserId == "" {
					logger.Warn("No userId found for this IAP provider refund notification", zap.String("transaction_id", purchase.TransactionId))
					if notification.RequireUser {
						w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
						return
					}
					continue
				}
				uid = uuid.Must(uuid.FromString(existing.UserId))
			}

			refundTime := purchase.RefundTime
			if refundTime.IsZero() {
				refundTime = time.Now()
			}
			purchaseToStore := &storagePurchase{
				userID:        uid,
				store:         provider.storeCode,
				productId:     purchase.ProductId,
				transactionId: purchase.TransactionId,
				rawResponse:   purchase.RawResponse,
				purchaseTime:  purchase.PurchaseTime,
				refundTime:    refundTime,
				environment:   purchase.Environment,
			}

			dbPurchases, err := upsertPurchases(r.Context(), db, []*storagePurchase{purchaseToStore})
			if err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.ForeignKeyViolation && strings.Contains(pgErr.Message, "user_id") {
					logger.Warn("User not found for this IAP provider refund notification", zap.String("transaction_id", purchase.TransactionId))
					continue
				}
				logger.Error("Failed to store IAP provider notification purchase data", zap.Error(err))
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			if purchaseHook != nil {
				dbPurchase := dbPurchases[0]
				validatedPurchase := &api.ValidatedPurchase{
					UserId:           dbPurchase.userID.String(),
					ProductId:        purchase.ProductId,
					TransactionId:    purchase.TransactionId,
					Store:            api.StoreProvider(provider.storeCode),
					Provider:         provider.name,
					CreateTime:       timestamppb.New(dbPurchase.createTime),
					UpdateTime:       timestamppb.New(dbPurchase.updateTime),
					PurchaseTime:     timestamppb.New(dbPurchase.purchaseTime),
					RefundTime:       timestamppb.New(dbPurchase.refundTime),
					ProviderResponse: purchase.RawResponse,
					Environment:      purchase.Environment,
					SeenBefore:       dbPurchase.seenBefore,
				}

				if err = purchaseHook(r.Context(), provider.name, runtime.IAPNotificationRefunded, validatedPurchase, string(body)); err != nil {
					logger.Error("Error invoking IAP provider notification function", zap.Error(err), zap.String("transaction_id", purchase.TransactionId))
				}
			}

		}

		w.WriteHeader(http.StatusOK)
	}
}
