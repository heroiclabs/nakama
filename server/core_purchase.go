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
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrPurchasesListInvalidCursor = errors.New("purchases list cursor invalid")

var httpc = &http.Client{Timeout: 5 * time.Second}

func ValidatePurchasesApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string) (*api.ValidatePurchaseResponse, error) {
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

	env := api.ValidatedPurchase_PRODUCTION
	if validation.Environment == iap.AppleSandboxEnvironment {
		env = api.ValidatedPurchase_SANDBOX
	}

	storagePurchases := make([]*storagePurchase, 0, len(validation.Receipt.InApp))
	for _, purchase := range validation.Receipt.InApp {
		pt, err := strconv.Atoi(purchase.PurchaseDateMs)
		if err != nil {
			return nil, err
		}

		storagePurchases = append(storagePurchases, &storagePurchase{
			userID:        userID,
			store:         api.ValidatedPurchase_APPLE_APP_STORE,
			productId:     purchase.ProductID,
			transactionId: purchase.TransactionId,
			rawResponse:   string(raw),
			purchaseTime:  parseMillisecondUnixTimestamp(pt),
			environment:   env,
		})
	}

	storedPurchases, err := storePurchases(ctx, db, storagePurchases)
	if err != nil {
		return nil, err
	}

	if len(storedPurchases) < 1 {
		return nil, runtime.ErrPurchaseReceiptAlreadySeen
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(storedPurchases))
	for _, p := range storedPurchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: p.createTime.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: p.updateTime.Unix()},
			ProviderResponse: string(raw),
			Environment:      p.environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPGoogleConfig, receipt string) (*api.ValidatePurchaseResponse, error) {
	_, gReceipt, raw, err := iap.ValidateReceiptGoogle(ctx, httpc, config.ClientEmail, config.PrivateKey, receipt)
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error validating Google receipt", zap.Error(err))
		}
		return nil, err
	}

	storedPurchases, err := storePurchases(ctx, db, []*storagePurchase{
		{
			userID:        userID,
			store:         api.ValidatedPurchase_GOOGLE_PLAY_STORE,
			productId:     gReceipt.ProductID,
			transactionId: gReceipt.PurchaseToken,
			rawResponse:   string(raw),
			purchaseTime:  parseMillisecondUnixTimestamp(int(gReceipt.PurchaseTime)),
			environment:   api.ValidatedPurchase_UNKNOWN,
		},
	})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Google receipt", zap.Error(err))
		}
		return nil, err
	}

	if len(storedPurchases) < 1 {
		return nil, runtime.ErrPurchaseReceiptAlreadySeen
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(storedPurchases))
	for _, p := range storedPurchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: p.createTime.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: p.updateTime.Unix()},
			ProviderResponse: string(raw),
			Environment:      p.environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func ValidatePurchaseHuawei(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, config *IAPHuaweiConfig, inAppPurchaseData, signature string) (*api.ValidatePurchaseResponse, error) {
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

	env := api.ValidatedPurchase_PRODUCTION
	if data.PurchaseType == iap.HuaweiSandboxPurchaseType {
		env = api.ValidatedPurchase_SANDBOX
	}

	storedPurchases, err := storePurchases(ctx, db, []*storagePurchase{
		{
			userID:        userID,
			store:         api.ValidatedPurchase_HUAWEI_APP_GALLERY,
			productId:     validation.PurchaseTokenData.ProductId,
			transactionId: validation.PurchaseTokenData.PurchaseToken,
			rawResponse:   string(raw),
			purchaseTime:  parseMillisecondUnixTimestamp(int(data.PurchaseTime)),
			environment:   env,
		},
	})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Huawei receipt", zap.Error(err))
		}
		return nil, err
	}

	if len(storedPurchases) < 1 {
		return nil, runtime.ErrPurchaseReceiptAlreadySeen
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(storedPurchases))
	for _, p := range storedPurchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: p.createTime.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: p.updateTime.Unix()},
			ProviderResponse: string(raw),
			Environment:      p.environment,
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
}

func GetPurchaseByTransactionID(ctx context.Context, logger *zap.Logger, db *sql.DB, transactionID string) (string, *api.ValidatedPurchase, error) {
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
    environment
FROM
    purchase
WHERE
    transaction_id = $1
`
	var userID uuid.UUID
	var transactionId string
	var productId string
	var store api.ValidatedPurchase_Store
	var rawResponse string
	var purchaseTime pgtype.Timestamptz
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	var environment api.ValidatedPurchase_Environment

	if err := db.QueryRowContext(ctx, query, transactionID).Scan(&userID, &transactionId, &productId, &store, &rawResponse, &purchaseTime, &createTime, &updateTime, &environment); err != nil {
		logger.Error("Error retrieving purchase.", zap.Error(err))
		return "", nil, err
	}

	return userID.String(), &api.ValidatedPurchase{
		ProductId:        productId,
		TransactionId:    transactionID,
		Store:            store,
		ProviderResponse: rawResponse,
		PurchaseTime:     &timestamppb.Timestamp{Seconds: purchaseTime.Time.Unix()},
		CreateTime:       &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
		UpdateTime:       &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
		Environment:      environment,
	}, nil
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

	params := make([]interface{}, 0, 4)
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
    environment
FROM
    purchase
`
	if incomingCursor != nil {
		if userID == "" {
			query += " WHERE (user_id, purchase_time, transaction_id) <= ($1, $2, $3)"
		} else {
			query += " WHERE user_id = $1 AND (purchase_time, transaction_id) <= ($2, $3)"
		}
		params = append(params, incomingCursor.UserId)
		params = append(params, incomingCursor.PurchaseTime.AsTime())
		params = append(params, incomingCursor.TransactionId)
	} else {
		if userID != "" {
			query += " WHERE user_id = $1"
			params = append(params, userID)
		}
	}
	query += " ORDER BY purchase_time DESC"
	if limit > 0 {
		params = append(params, limit+1)
	} else {
		params = append(params, 101) // Default limit to 100 purchases if not set
	}
	query += " LIMIT $" + strconv.Itoa(len(params))

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving purchases.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	purchases := make([]*api.ValidatedPurchase, 0, limit)
	var outgoingCursor string

	for rows.Next() {
		var userID uuid.UUID
		var transactionId string
		var productId string
		var store api.ValidatedPurchase_Store
		var rawResponse string
		var purchaseTime pgtype.Timestamptz
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var environment api.ValidatedPurchase_Environment

		if err = rows.Scan(&userID, &transactionId, &productId, &store, &rawResponse, &purchaseTime, &createTime, &updateTime, &environment); err != nil {
			logger.Error("Error retrieving purchases.", zap.Error(err))
			return nil, err
		}

		if len(purchases) >= limit {
			cursorBuf := new(bytes.Buffer)
			if err := gob.NewEncoder(cursorBuf).Encode(&purchasesListCursor{
				TransactionId: transactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        userID.String(),
			}); err != nil {
				logger.Error("Error creating purchases list cursor", zap.Error(err))
				return nil, err
			}
			outgoingCursor = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		purchase := &api.ValidatedPurchase{
			ProductId:        productId,
			TransactionId:    transactionId,
			Store:            store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: purchaseTime.Time.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
			ProviderResponse: rawResponse,
			Environment:      environment,
		}

		purchases = append(purchases, purchase)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving purchases.", zap.Error(err))
		return nil, err
	}

	return &api.PurchaseList{ValidatedPurchases: purchases, Cursor: outgoingCursor}, nil
}

type storagePurchase struct {
	userID        uuid.UUID
	store         api.ValidatedPurchase_Store
	productId     string
	transactionId string
	rawResponse   string
	purchaseTime  time.Time
	createTime    time.Time // Set by storePurchases
	updateTime    time.Time // Set by storePurchases
	environment   api.ValidatedPurchase_Environment
}

func storePurchases(ctx context.Context, db *sql.DB, purchases []*storagePurchase) ([]*storagePurchase, error) {
	if len(purchases) < 1 {
		return nil, errors.New("expects at least one receipt")
	}

	statements := make([]string, 0, len(purchases))
	params := make([]interface{}, 0, len(purchases)*7)
	offset := 0
	for _, purchase := range purchases {
		statement := fmt.Sprintf("($%d, $%d, $%d, $%d, $%d, $%d, $%d)", offset+1, offset+2, offset+3, offset+4, offset+5, offset+6, offset+7)
		offset += 7
		statements = append(statements, statement)
		params = append(params, purchase.userID, purchase.store, purchase.transactionId, purchase.productId, purchase.purchaseTime, purchase.rawResponse, purchase.environment)
	}

	query := `
INSERT
INTO
    purchase
        (
            user_id,
            store,
            transaction_id,
            product_id,
            purchase_time,
            raw_response,
            environment
        )
VALUES
    ` + strings.Join(statements, ", ") + `
ON CONFLICT
    (transaction_id)
DO
    NOTHING
RETURNING
    transaction_id, create_time, update_time
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
		err := rows.Scan(&transactionId, &createTime, &updateTime)
		if err != nil {
			rows.Close()
			return nil, err
		}
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

func parseMillisecondUnixTimestamp(t int) time.Time {
	return time.Unix(0, 0).Add(time.Duration(t) * time.Millisecond)
}
