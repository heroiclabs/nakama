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
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
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
