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
	"errors"
	"fmt"
	"github.com/heroiclabs/nakama-common/runtime"
	"slices"
	"strconv"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrPurchasesListInvalidCursor = errors.New("purchases list cursor invalid")

func handleValidatedPurchases(ctx context.Context, db *sql.DB, storagePurchases []*runtime.StoragePurchase, persist bool) (*api.ValidatePurchaseProviderResponse, error) {

	if !persist {
		//Skip storing the receipts
		validatedPurchases := make([]*api.PurchaseProviderValidatedPurchase, 0, len(storagePurchases))
		for _, p := range storagePurchases {
			validatedPurchases = append(validatedPurchases, &api.PurchaseProviderValidatedPurchase{
				UserId:           p.UserID.String(),
				ProductId:        p.ProductId,
				TransactionId:    p.TransactionId,
				Store:            p.Store,
				PurchaseTime:     timestamppb.New(p.PurchaseTime),
				ProviderResponse: p.RawResponse,
				Environment:      p.Environment,
			})
		}

		return &api.ValidatePurchaseProviderResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := iap.UpsertPurchases(ctx, db, storagePurchases)
	if err != nil {
		return nil, err
	}

	validatedPurchases := make([]*api.PurchaseProviderValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.UserID.String()
		if p.UserID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.PurchaseProviderValidatedPurchase{
			UserId:           suid,
			ProductId:        p.ProductId,
			TransactionId:    p.TransactionId,
			Store:            p.Store,
			PurchaseTime:     timestamppb.New(p.PurchaseTime),
			CreateTime:       timestamppb.New(p.CreateTime),
			UpdateTime:       timestamppb.New(p.UpdateTime),
			ProviderResponse: p.RawResponse,
			Environment:      p.Environment,
		})
	}

	return &api.ValidatePurchaseProviderResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchase(ctx context.Context, logger *zap.Logger, db *sql.DB, purchaseProvider runtime.PurchaseProvider, in *api.ValidatePurchaseRequest, userID uuid.UUID, persist bool, overrides ...runtime.PurchaseProviderOverrides) (*api.ValidatePurchaseProviderResponse, error) {
	var oRides struct {
		Password    string
		ClientEmail string
		PrivateKey  string
	}

	if len(overrides) > 0 {
		oRides = overrides[0]
	}

	validationPurchases, err := purchaseProvider.PurchaseValidate(ctx, in, userID.String(), oRides)
	if err != nil {
		return nil, err
	}

	validatedPurchasesResponse, err := handleValidatedPurchases(ctx, db, validationPurchases, persist)
	if err != nil {
		return nil, err
	}

	return validatedPurchasesResponse, nil
}

func ValidatePurchasesApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string, persist bool) (*api.ValidatePurchaseResponse, error) {
	validation, raw, err := iap.ValidateReceiptApple(ctx, iap.Httpc, receipt, password)
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				logger.Debug("Error validating Apple receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
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

	seenTransactionIDs := make(map[string]struct{}, len(validation.Receipt.InApp)+len(validation.LatestReceiptInfo))
	storagePurchases := make([]*runtime.StoragePurchase, 0, len(validation.Receipt.InApp)+len(validation.LatestReceiptInfo))
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
		storagePurchases = append(storagePurchases, &runtime.StoragePurchase{
			UserID:        userID,
			Store:         api.StoreProvider_APPLE_APP_STORE,
			ProductId:     purchase.ProductID,
			TransactionId: purchase.TransactionId,
			RawResponse:   string(raw),
			PurchaseTime:  iap.ParseMillisecondUnixTimestamp(purchaseTime),
			Environment:   env,
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
		storagePurchases = append(storagePurchases, &runtime.StoragePurchase{
			UserID:        userID,
			Store:         api.StoreProvider_APPLE_APP_STORE,
			ProductId:     purchase.ProductId,
			TransactionId: purchase.TransactionId,
			RawResponse:   string(raw),
			PurchaseTime:  iap.ParseMillisecondUnixTimestamp(purchaseTime),
			Environment:   env,
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
				UserId:           p.UserID.String(),
				ProductId:        p.ProductId,
				TransactionId:    p.TransactionId,
				Store:            p.Store,
				PurchaseTime:     timestamppb.New(p.PurchaseTime),
				ProviderResponse: string(raw),
				Environment:      p.Environment,
			})
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := iap.UpsertPurchases(ctx, db, storagePurchases)
	if err != nil {
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.UserID.String()
		if p.UserID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.ProductId,
			TransactionId:    p.TransactionId,
			Store:            p.Store,
			PurchaseTime:     timestamppb.New(p.PurchaseTime),
			CreateTime:       timestamppb.New(p.CreateTime),
			UpdateTime:       timestamppb.New(p.UpdateTime),
			ProviderResponse: string(raw),
			SeenBefore:       p.SeenBefore,
			Environment:      p.Environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPGoogleConfig, receipt string, persist bool) (*api.ValidatePurchaseResponse, error) {
	gResponse, gReceipt, raw, err := iap.ValidateReceiptGoogle(ctx, iap.Httpc, config.ClientEmail, config.PrivateKey, receipt)
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

	sPurchase := &runtime.StoragePurchase{
		UserID:        userID,
		Store:         api.StoreProvider_GOOGLE_PLAY_STORE,
		ProductId:     gReceipt.ProductID,
		TransactionId: gReceipt.PurchaseToken,
		RawResponse:   string(raw),
		PurchaseTime:  iap.ParseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		Environment:   purchaseEnv,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID.String(),
				ProductId:        sPurchase.ProductId,
				TransactionId:    sPurchase.TransactionId,
				Store:            sPurchase.Store,
				PurchaseTime:     timestamppb.New(sPurchase.PurchaseTime),
				ProviderResponse: string(raw),
				Environment:      sPurchase.Environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := iap.UpsertPurchases(ctx, db, []*runtime.StoragePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Google receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.UserID.String()
		if p.UserID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.ProductId,
			TransactionId:    p.TransactionId,
			Store:            p.Store,
			PurchaseTime:     timestamppb.New(p.PurchaseTime),
			CreateTime:       timestamppb.New(p.CreateTime),
			UpdateTime:       timestamppb.New(p.UpdateTime),
			ProviderResponse: string(raw),
			SeenBefore:       p.SeenBefore,
			Environment:      p.Environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseHuawei(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPHuaweiConfig, inAppPurchaseData, signature string, persist bool) (*api.ValidatePurchaseResponse, error) {
	validation, data, raw, err := iap.ValidateReceiptHuawei(ctx, iap.Httpc, config.PublicKey, config.ClientID, config.ClientSecret, inAppPurchaseData, signature)
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

	sPurchase := &runtime.StoragePurchase{
		UserID:        userID,
		Store:         api.StoreProvider_HUAWEI_APP_GALLERY,
		ProductId:     validation.PurchaseTokenData.ProductId,
		TransactionId: validation.PurchaseTokenData.PurchaseToken,
		RawResponse:   string(raw),
		PurchaseTime:  iap.ParseMillisecondUnixTimestamp(data.PurchaseTime),
		Environment:   env,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				ProductId:        sPurchase.ProductId,
				TransactionId:    sPurchase.TransactionId,
				Store:            sPurchase.Store,
				PurchaseTime:     timestamppb.New(sPurchase.PurchaseTime),
				ProviderResponse: string(raw),
				Environment:      sPurchase.Environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := iap.UpsertPurchases(ctx, db, []*runtime.StoragePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Huawei receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.UserID.String()
		if p.UserID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.ProductId,
			TransactionId:    p.TransactionId,
			Store:            p.Store,
			PurchaseTime:     timestamppb.New(p.PurchaseTime),
			CreateTime:       timestamppb.New(p.CreateTime),
			UpdateTime:       timestamppb.New(p.UpdateTime),
			ProviderResponse: string(raw),
			SeenBefore:       p.SeenBefore,
			Environment:      p.Environment,
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

	sPurchase := &runtime.StoragePurchase{
		UserID:        userID,
		Store:         api.StoreProvider_FACEBOOK_INSTANT_STORE,
		ProductId:     payment.ProductId,
		TransactionId: payment.PurchaseToken,
		RawResponse:   rawResponse,
		PurchaseTime:  time.Unix(int64(payment.PurchaseTime), 0),
		Environment:   api.StoreEnvironment_PRODUCTION,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID.String(),
				ProductId:        sPurchase.ProductId,
				TransactionId:    sPurchase.TransactionId,
				Store:            sPurchase.Store,
				PurchaseTime:     timestamppb.New(sPurchase.PurchaseTime),
				ProviderResponse: rawResponse,
				Environment:      sPurchase.Environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := iap.UpsertPurchases(ctx, db, []*runtime.StoragePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Facebook Instant receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		suid := p.UserID.String()
		if p.UserID.IsNil() {
			suid = ""
		}
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			UserId:           suid,
			ProductId:        p.ProductId,
			TransactionId:    p.TransactionId,
			Store:            p.Store,
			PurchaseTime:     timestamppb.New(p.PurchaseTime),
			CreateTime:       timestamppb.New(p.CreateTime),
			UpdateTime:       timestamppb.New(p.UpdateTime),
			ProviderResponse: rawResponse,
			SeenBefore:       p.SeenBefore,
			Environment:      p.Environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

type purchasesListCursor struct {
	TransactionId string
	PurchaseTime  *timestamppb.Timestamp
	UserId        string
	IsNext        bool
}

func ListPurchases(ctx context.Context, logger *zap.Logger, db *sql.DB, userID string, limit int, cursor string) (*api.PurchaseList, error) {
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
	purchase
`

	params := make([]interface{}, 0)

	if incomingCursor != nil {
		if incomingCursor.IsNext {
			if userID == "" {
				query += `
WHERE (purchase_time, user_id, transaction_id) < ($1, $2, $3)
ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC
LIMIT $4`
			} else {
				query += `
WHERE user_id = $2
	AND (purchase_time, user_id, transaction_id) < ($1, $2, $3)
ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC
LIMIT $4`
			}
		} else {
			if userID == "" {
				query += `
WHERE (purchase_time, user_id, transaction_id) > ($1, $2, $3)
ORDER BY purchase_time, user_id, transaction_id
LIMIT $4`
			} else {
				query += `
WHERE user_id = $2
	AND (purchase_time, user_id, transaction_id) > ($1, $2, $3)
ORDER BY purchase_time, user_id, transaction_id
LIMIT $4`
			}
		}
		params = append(params, incomingCursor.PurchaseTime.AsTime(), incomingCursor.UserId, incomingCursor.TransactionId)
	} else {
		if userID == "" {
			query += " ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC LIMIT $1"
		} else {
			query += " WHERE user_id = $1 ORDER BY purchase_time DESC, user_id DESC, transaction_id DESC LIMIT $2"
			params = append(params, userID)
		}
	}

	if limit > 0 {
		params = append(params, limit+1)
	} else {
		params = append(params, 101) // Default limit to 100 purchases if not set
	}

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
