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
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var ErrPurchasesListInvalidCursor = errors.New("purchases list cursor invalid")

var httpc = &http.Client{Timeout: 5 * time.Second}

func ValidatePurchasesApple(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, password, receipt string, persist bool) (*api.ValidatePurchaseResponse, error) {
	validation, raw, err := iap.ValidateReceiptApple(ctx, httpc, receipt, password)
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

	if !persist {
		// Skip storing the receipts
		validatedPurchases := make([]*api.ValidatedPurchase, 0, len(storagePurchases))
		for _, p := range storagePurchases {
			validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
				ProductId:        p.productId,
				TransactionId:    p.transactionId,
				Store:            p.store,
				PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
				ProviderResponse: string(raw),
				Environment:      p.environment,
			})
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := storePurchases(ctx, db, storagePurchases)
	if err != nil {
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: p.createTime.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: p.updateTime.Unix()},
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

	//gResponse.PurchaseType
	purchaseEnv := api.ValidatedPurchase_PRODUCTION
	if gResponse.PurchaseType == 0 {
		purchaseEnv = api.ValidatedPurchase_SANDBOX
	}

	sPurchase := &storagePurchase{
		userID:        userID,
		store:         api.ValidatedPurchase_GOOGLE_PLAY_STORE,
		productId:     gReceipt.ProductID,
		transactionId: gReceipt.PurchaseToken,
		rawResponse:   string(raw),
		purchaseTime:  parseMillisecondUnixTimestamp(int(gReceipt.PurchaseTime)),
		environment:   purchaseEnv,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				ProductId:        sPurchase.productId,
				TransactionId:    sPurchase.transactionId,
				Store:            sPurchase.store,
				PurchaseTime:     &timestamppb.Timestamp{Seconds: sPurchase.purchaseTime.Unix()},
				ProviderResponse: string(raw),
				Environment:      sPurchase.environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := storePurchases(ctx, db, []*storagePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Google receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: p.createTime.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: p.updateTime.Unix()},
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
		var vErr *iap.ValidationError
		if err != context.Canceled {
			if errors.As(err, &vErr) {
				logger.Error("Error validating Huawei receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr.Err
			} else {
				logger.Error("Error validating Huawei receipt", zap.Error(err))
			}
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

	sPurchase := &storagePurchase{
		userID:        userID,
		store:         api.ValidatedPurchase_HUAWEI_APP_GALLERY,
		productId:     validation.PurchaseTokenData.ProductId,
		transactionId: validation.PurchaseTokenData.PurchaseToken,
		rawResponse:   string(raw),
		purchaseTime:  parseMillisecondUnixTimestamp(int(data.PurchaseTime)),
		environment:   env,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				ProductId:        sPurchase.productId,
				TransactionId:    sPurchase.transactionId,
				Store:            sPurchase.store,
				PurchaseTime:     &timestamppb.Timestamp{Seconds: sPurchase.purchaseTime.Unix()},
				ProviderResponse: string(raw),
				Environment:      sPurchase.environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := storePurchases(ctx, db, []*storagePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			logger.Error("Error storing Huawei receipt", zap.Error(err))
		}
		return nil, err
	}

	validatedPurchases := make([]*api.ValidatedPurchase, 0, len(purchases))
	for _, p := range purchases {
		validatedPurchases = append(validatedPurchases, &api.ValidatedPurchase{
			ProductId:        p.productId,
			TransactionId:    p.transactionId,
			Store:            p.store,
			PurchaseTime:     &timestamppb.Timestamp{Seconds: p.purchaseTime.Unix()},
			CreateTime:       &timestamppb.Timestamp{Seconds: p.createTime.Unix()},
			UpdateTime:       &timestamppb.Timestamp{Seconds: p.updateTime.Unix()},
			ProviderResponse: string(raw),
			SeenBefore:       p.seenBefore,
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
	IsNext        bool
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

	comparationOp := "<="
	sortConf := "DESC"
	if incomingCursor != nil && !incomingCursor.IsNext {
		comparationOp = ">"
		sortConf = "ASC"
	}

	params := make([]interface{}, 0, 4)
	predicateConf := ""
	if incomingCursor != nil {
		if userID == "" {
			predicateConf = fmt.Sprintf(" WHERE (user_id, purchase_time, transaction_id) %s ($1, $2, $3)", comparationOp)
		} else {
			predicateConf = fmt.Sprintf(" WHERE user_id = $1 AND (purchase_time, transaction_id) %s ($2, $3)", comparationOp)
		}
		params = append(params, incomingCursor.UserId, incomingCursor.PurchaseTime.AsTime(), incomingCursor.TransactionId)
	} else {
		if userID != "" {
			predicateConf = " WHERE user_id = $1"
			params = append(params, userID)
		}
	}

	if limit > 0 {
		params = append(params, limit+1)
	} else {
		params = append(params, 101) // Default limit to 100 purchases if not set
	}

	query := fmt.Sprintf(`
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
	%s
	ORDER BY purchase_time %s LIMIT $%v`, predicateConf, sortConf, len(params))

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving purchases.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	var nextCursor *purchasesListCursor
	var prevCursor *purchasesListCursor
	purchases := make([]*api.ValidatedPurchase, 0, limit)

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
			nextCursor = &purchasesListCursor{
				TransactionId: transactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        userID.String(),
				IsNext:        true,
			}
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

		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &purchasesListCursor{
				TransactionId: transactionId,
				PurchaseTime:  timestamppb.New(purchaseTime.Time),
				UserId:        userID.String(),
				IsNext:        false,
			}
		}
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving purchases.", zap.Error(err))
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

		for i, j := 0, len(purchases)-1; i < j; i, j = i+1, j-1 {
			purchases[i], purchases[j] = purchases[j], purchases[i]
		}
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
	store         api.ValidatedPurchase_Store
	productId     string
	transactionId string
	rawResponse   string
	purchaseTime  time.Time
	createTime    time.Time // Set by storePurchases
	updateTime    time.Time // Set by storePurchases
	environment   api.ValidatedPurchase_Environment
	seenBefore    bool // Set by storePurchases
}

func storePurchases(ctx context.Context, db *sql.DB, purchases []*storagePurchase) ([]*storagePurchase, error) {
	if len(purchases) < 1 {
		return nil, errors.New("expects at least one receipt")
	}

	statements := make([]string, 0, len(purchases))
	params := make([]interface{}, 0, len(purchases)*7)
	transactionIDsToPurchase := make(map[string]*storagePurchase)
	offset := 0
	for _, purchase := range purchases {
		statement := fmt.Sprintf("($%d, $%d, $%d, $%d, $%d, $%d, $%d)", offset+1, offset+2, offset+3, offset+4, offset+5, offset+6, offset+7)
		offset += 7
		statements = append(statements, statement)
		params = append(params, purchase.userID, purchase.store, purchase.transactionId, purchase.productId, purchase.purchaseTime, purchase.rawResponse, purchase.environment)
		transactionIDsToPurchase[purchase.transactionId] = purchase
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
	insertedTransactionIDs := make(map[string]struct{})
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		// Newly inserted purchases
		var transactionId string
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		if err = rows.Scan(&transactionId, &createTime, &updateTime); err != nil {
			rows.Close()
			return nil, err
		}
		storedPurchase, _ := transactionIDsToPurchase[transactionId]
		storedPurchase.createTime = createTime.Time
		storedPurchase.updateTime = updateTime.Time
		storedPurchase.seenBefore = false
		insertedTransactionIDs[storedPurchase.transactionId] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Go over purchases that have not been inserted (already exist in the DB) and fetch createTime and updateTime
	if len(transactionIDsToPurchase) > len(insertedTransactionIDs) {
		seenIDs := make([]string, 0, len(transactionIDsToPurchase))
		for tID, _ := range transactionIDsToPurchase {
			if _, ok := insertedTransactionIDs[tID]; !ok {
				seenIDs = append(seenIDs, tID)
			}
		}

		rows, err = db.QueryContext(ctx, "SELECT transaction_id, create_time, update_time FROM purchase WHERE transaction_id IN ($1)", strings.Join(seenIDs, ", "))
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			// Already seen purchases
			var transactionId string
			var createTime pgtype.Timestamptz
			var updateTime pgtype.Timestamptz
			if err = rows.Scan(&transactionId, &createTime, &updateTime); err != nil {
				rows.Close()
				return nil, err
			}
			storedPurchase, _ := transactionIDsToPurchase[transactionId]
			storedPurchase.createTime = createTime.Time
			storedPurchase.updateTime = updateTime.Time
			storedPurchase.seenBefore = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	storedPurchases := make([]*storagePurchase, 0, len(transactionIDsToPurchase))
	for _, purchase := range transactionIDsToPurchase {
		storedPurchases = append(storedPurchases, purchase)
	}

	return storedPurchases, nil
}

func parseMillisecondUnixTimestamp(t int) time.Time {
	return time.Unix(0, 0).Add(time.Duration(t) * time.Millisecond)
}
