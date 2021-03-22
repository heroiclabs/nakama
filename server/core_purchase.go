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
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	AppleAppStore    = 0
	GooglePlayStore  = 1
	HuaweiAppGallery = 2
)

var ErrReceiptAlreadyExists = errors.New("The receipt is already present in the database")

func ValidatePurchasesApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string) (*api.ValidatePurchaseResponse, error) {
	httpc := &http.Client{Timeout: 5 * time.Second}

	validation, raw, err := iap.ValidateReceiptApple(ctx, httpc, receipt, password)
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error validating Apple receipt", zap.Error(err))
		}
		return nil, err
	}

	if validation.Status != iap.AppleReceiptIsValid {
		if validation.IsRetryable == true {
			return nil, status.Error(codes.Unavailable, "Apple IAP verification is currently unavailable. Try again later.")
		}
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. Status: %d", validation.Status))
	}

	storagePurchases := make([]*storagePurchase, 0, len(validation.Receipt.InApp))
	for _, purchase := range validation.Receipt.InApp {
		pt, err := strconv.Atoi(purchase.PurchaseDateMs)
		if err != nil {
			return nil, err
		}

		purchaseTime, err := parseMillisecondUnixTimestamp(pt)
		if err != nil {
			return nil, err
		}

		storagePurchases = append(storagePurchases, &storagePurchase{
			userID:        userID,
			store:         AppleAppStore,
			productId:     purchase.ProductID,
			transactionId: purchase.TransactionId,
			rawResponse:   string(raw),
			purchaseTime:  purchaseTime,
		})
	}

	storedPurchases, err := storePurchases(ctx, db, storagePurchases)
	if err != nil {
		return nil, err
	}

	if len(storedPurchases) < 1 {
		return nil, status.Error(codes.AlreadyExists, "Purchases in this receipt have already been seen")
	}

	validatedPurchases := make([]*api.ValidatePurchaseResponse_ValidatedPurchase, 0, len(storedPurchases))
	for _, p := range storedPurchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatePurchaseResponse_ValidatedPurchase{
			ProductId:     p.productId,
			TransactionId: p.transactionId,
			Store:         "AppleAppStore",
			PurchaseTime:  &timestamp.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:    &timestamp.Timestamp{Seconds: p.purchaseTime.Unix()},
			UpdateTime:    nil,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
		ProviderPayload:    string(raw),
	}, nil
}

func ValidatePurchaseGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPGoogleConfig, receipt string) (*api.ValidatePurchaseResponse, error) {
	httpc := &http.Client{Timeout: 5 * time.Second}

	_, gReceipt, raw, err := iap.ValidateReceiptGoogle(ctx, httpc, config.ClientEmail, config.PrivateKey, receipt)
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error validating Google receipt", zap.Error(err))
		}
		return nil, err
	}

	purchaseTime, err := parseMillisecondUnixTimestamp(int(gReceipt.PurchaseTime))
	if err != nil {
		return nil, err
	}
	storedPurchases, err := storePurchases(ctx, db, []*storagePurchase{
		{
			userID:        userID,
			store:         GooglePlayStore,
			productId:     gReceipt.ProductID,
			transactionId: gReceipt.PurchaseToken,
			rawResponse:   string(raw),
			purchaseTime:  purchaseTime,
		},
	})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Google receipt", zap.Error(err))
		}
		return nil, err
	}

	if len(storedPurchases) < 1 {
		return nil, status.Error(codes.AlreadyExists, "receipt has already been seen")
	}

	validatedPurchases := make([]*api.ValidatePurchaseResponse_ValidatedPurchase, 0, len(storedPurchases))
	for _, p := range storedPurchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatePurchaseResponse_ValidatedPurchase{
			ProductId:     p.productId,
			TransactionId: p.transactionId,
			Store:         "GooglePlayStore",
			PurchaseTime:  &timestamp.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:    &timestamp.Timestamp{Seconds: p.purchaseTime.Unix()},
			UpdateTime:    nil,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
		ProviderPayload:    string(raw),
	}, nil
}

func ValidatePurchaseHuawei(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPHuaweiConfig, inAppPurchaseData, signature string) (*api.ValidatePurchaseResponse, error) {
	httpc := &http.Client{Timeout: 5 * time.Second}

	validation, data, raw, err := iap.ValidateReceiptHuawei(ctx, httpc, config.PublicKey, config.ClientID, config.ClientSecret, inAppPurchaseData, signature)
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error validating Huawei receipt", zap.Error(err))
		}
		return nil, err
	}

	if validation.ResponseCode != strconv.Itoa(iap.HuaweiReceiptIsValid) {
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. Code: %s", validation.ResponseCode))
	}

	purchaseTime, err := parseMillisecondUnixTimestamp(int(data.PurchaseTime))
	if err != nil {
		return nil, err
	}
	storedPurchases, err := storePurchases(ctx, db, []*storagePurchase{
		{
			userID:        userID,
			store:         HuaweiAppGallery,
			productId:     validation.PurchaseTokenData.ProductId,
			transactionId: validation.PurchaseTokenData.PurchaseToken,
			rawResponse:   string(raw),
			purchaseTime:  purchaseTime,
		},
	})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Huawei receipt", zap.Error(err))
		}
		return nil, err
	}

	if len(storedPurchases) < 1 {
		return nil, status.Error(codes.AlreadyExists, "receipt has already been seen")
	}

	validatedPurchases := make([]*api.ValidatePurchaseResponse_ValidatedPurchase, 0, len(storedPurchases))
	for _, p := range storedPurchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatePurchaseResponse_ValidatedPurchase{
			ProductId:     p.productId,
			TransactionId: p.transactionId,
			Store:         "GooglePlayStore",
			PurchaseTime:  &timestamp.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:    &timestamp.Timestamp{Seconds: p.purchaseTime.Unix()},
			UpdateTime:    nil,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
		ProviderPayload:    string(raw),
	}, nil
}

type storagePurchase struct {
	userID        uuid.UUID
	store         int
	productId     string
	transactionId string
	rawResponse   string
	purchaseTime  time.Time
	createTime    time.Time // Set by storePurchases
	updateTime    time.Time // Set by storePurchases
}

func storePurchases(ctx context.Context, db *sql.DB, purchases []*storagePurchase) ([]*storagePurchase, error) {
	if len(purchases) < 1 {
		return nil, errors.New("expects at least one receipt")
	}

	statements := make([]string, 0, len(purchases))
	params := make([]interface{}, 0, len(purchases)*7)
	offset := 0
	for _, purchase := range purchases {
		statement := fmt.Sprintf("($%d $%d $%d $%d $%d $%d)", offset+1, offset+2, offset+3, offset+4, offset+5, offset+6)
		offset += 6
		statements = append(statements, statement)
		params = append(params, []interface{}{purchase.userID, purchase.store, purchase.transactionId, purchase.productId, purchase.purchaseTime, purchase.rawResponse})
	}

	query := "INSERT INTO purchase_receipt (user_id, store, receipt, transaction_id, product_id, purchase_time, raw_response) VALUES " + strings.Join(statements, ", ") + `
ON CONFLICT (transaction_id) DO NOTHING
returning transaction_id, create_time, update_time"
`
	storedTransactionIDs := make(map[string]*storagePurchase)
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var transactionId string
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		rows.Scan(&transactionId, &createTime, &updateTime)
		storedTransactionIDs[transactionId] = &storagePurchase{
			createTime: createTime.Time,
			updateTime: updateTime.Time,
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	storedPurchases := make([]*storagePurchase, 0, len(storedTransactionIDs))
	for _, purchase := range purchases {
		if ts, ok := storedTransactionIDs[purchase.transactionId]; ok {
			purchase.createTime = ts.createTime
			purchase.updateTime = ts.updateTime
			storedPurchases = append(storedPurchases, purchase)
		}
	}

	return storedPurchases, nil
}

func parseMillisecondUnixTimestamp(t int) (time.Time, error) {
	return time.Unix(0, 0).Add(time.Duration(t) * time.Millisecond), nil
}
