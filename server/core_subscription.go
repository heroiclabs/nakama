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
	"database/sql"
	"encoding/base64"
	"encoding/gob"
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
var errSubscriptionOwnedByAnotherStore = errors.New("subscription original transaction ID belongs to another store")

type subscriptionsListCursor struct {
	OriginalTransactionId string
	PurchaseTime          *timestamppb.Timestamp
	UserId                string
	IsNext                bool
	After                 time.Time
	Before                time.Time
	Store                 string // String instead of *int since gob decodes a pointer to 0 as nil, losing an Apple store filter.
}

func ListSubscriptions(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, userID string, limit int, cursor string, after, before time.Time, storeFilter *int) (*api.SubscriptionList, error) {
	var cursorStore string
	if storeFilter != nil {
		cursorStore = strconv.Itoa(*storeFilter)
	}

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
		if !after.Equal(incomingCursor.After) {
			return nil, ErrSubscriptionsListInvalidCursor
		}
		if !before.Equal(incomingCursor.Before) {
			return nil, ErrSubscriptionsListInvalidCursor
		}
		if cursorStore != incomingCursor.Store {
			return nil, ErrSubscriptionsListInvalidCursor
		}
	}

	comparisonOp := "<="
	sortConf := "DESC"
	if incomingCursor != nil && !incomingCursor.IsNext {
		comparisonOp = ">"
		sortConf = "ASC"
	}

	params := make([]any, 0, 6)
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

	if !after.IsZero() {
		if len(params) == 0 {
			params = append(params, after)
			predicateConf += fmt.Sprintf(" WHERE purchase_time >= $%v", len(params))
		} else {
			params = append(params, after)
			predicateConf += fmt.Sprintf(" AND purchase_time >= $%v", len(params))
		}
	}
	if !before.IsZero() {
		if len(params) == 0 {
			params = append(params, before)
			predicateConf += fmt.Sprintf(" WHERE purchase_time <= $%v", len(params))
		} else {
			params = append(params, before)
			predicateConf += fmt.Sprintf(" AND purchase_time <= $%v", len(params))
		}
	}
	if storeFilter != nil {
		if len(params) == 0 {
			params = append(params, *storeFilter)
			predicateConf += fmt.Sprintf(" WHERE store = $%v", len(params))
		} else {
			params = append(params, *storeFilter)
			predicateConf += fmt.Sprintf(" AND store = $%v", len(params))
		}
	}

	// Add limit to query.
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

	var nextCursor *subscriptionsListCursor
	var prevCursor *subscriptionsListCursor
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
			nextCursor = &subscriptionsListCursor{
				OriginalTransactionId: originalTransactionId,
				PurchaseTime:          timestamppb.New(purchaseTime.Time),
				UserId:                dbUserID.String(),
				IsNext:                true,
				After:                 after,
				Before:                before,
				Store:                 cursorStore,
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
		if name := registry.GetName(int(store)); name != "" {
			subscription.Provider = name
		}

		subscriptions = append(subscriptions, subscription)

		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &subscriptionsListCursor{
				OriginalTransactionId: originalTransactionId,
				PurchaseTime:          timestamppb.New(purchaseTime.Time),
				UserId:                dbUserID.String(),
				IsNext:                false,
				After:                 after,
				Before:                before,
				Store:                 cursorStore,
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

		slices.Reverse(subscriptions)
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

func ValidateSubscription(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, userID uuid.UUID, traceID, providerName string, payload, overrides map[string]any, persist bool) (*api.ValidateIAPSubscriptionResponse, error) {
	provider := registry.Get(providerName)
	if provider == nil {
		return nil, status.Error(codes.InvalidArgument, "IAP provider not found: "+providerName)
	}

	subscriptions, err, code := provider.validateSubscription(ctx, traceID, payload, overrides)
	if err != nil {
		if _, ok := status.FromError(err); ok {
			return nil, err
		}
		return nil, status.Error(code, err.Error())
	}

	if len(subscriptions) == 0 {
		logger.Warn("IAP provider returned no subscriptions.", zap.String("provider", provider.name))
		return nil, status.Error(codes.FailedPrecondition, "Invalid Receipt. No subscriptions found.")
	}

	// Every subscription is stored in the order the provider listed them, repeats included, so the last
	// entry for an original transaction ID is the one that stays, as with Apple's legacy receipts.
	storageSubs := make([]*storageSubscription, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		if subscription == nil || subscription.OriginalTransactionId == "" {
			logger.Error("IAP provider returned a subscription without an original transaction ID.", zap.String("provider", provider.name))
			return nil, status.Error(codes.FailedPrecondition, "Invalid Receipt. Original transaction ID is required.")
		}

		refundTime := subscription.RefundTime
		if refundTime.IsZero() {
			refundTime = time.Unix(0, 0)
		}
		storageSubs = append(storageSubs, &storageSubscription{
			userID:                userID,
			originalTransactionId: subscription.OriginalTransactionId,
			store:                 api.StoreProvider(provider.storeCode),
			productId:             subscription.ProductId,
			purchaseTime:          subscription.PurchaseTime,
			environment:           subscription.Environment,
			expireTime:            subscription.ExpiryTime,
			refundTime:            refundTime,
			rawResponse:           subscription.RawResponse,
		})
	}

	storageSub := storageSubs[0]
	validatedSub := &api.ValidatedSubscription{
		UserId:                userID.String(),
		ProductId:             storageSub.productId,
		OriginalTransactionId: storageSub.originalTransactionId,
		Store:                 storageSub.store,
		Provider:              provider.name,
		PurchaseTime:          timestamppb.New(storageSub.purchaseTime),
		Environment:           storageSub.environment,
		ExpiryTime:            timestamppb.New(storageSub.expireTime),
		RefundTime:            timestamppb.New(storageSub.refundTime),
		ProviderResponse:      storageSub.rawResponse,
		Active:                storageSub.Active(),
	}

	if !persist {
		return &api.ValidateIAPSubscriptionResponse{Subscription: validatedSub}, nil
	}

	if err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		for _, sub := range storageSubs {
			if err := upsertSubscription(ctx, tx, sub); err != nil {
				if errors.Is(err, errSubscriptionOwnedByAnotherStore) {
					logger.Warn("IAP provider original transaction ID belongs to another store, not storing.", zap.String("provider", provider.name), zap.String("original_transaction_id", sub.originalTransactionId))
					continue
				}
				return err
			}
		}
		return nil
	}); err != nil {
		if !errors.Is(err, context.Canceled) {
			logger.Error("Error storing subscription from provider", zap.String("provider", provider.name), zap.Error(err))
		}
		return nil, err
	}

	if storageSub.createTime.IsZero() {
		return &api.ValidateIAPSubscriptionResponse{Subscription: validatedSub}, nil
	}

	suid := storageSub.userID.String()
	if storageSub.userID.IsNil() {
		suid = ""
	}

	validatedSub.UserId = suid
	validatedSub.CreateTime = timestamppb.New(storageSub.createTime)
	validatedSub.UpdateTime = timestamppb.New(storageSub.updateTime)
	validatedSub.ExpiryTime = timestamppb.New(storageSub.expireTime)
	validatedSub.RefundTime = timestamppb.New(storageSub.refundTime)
	validatedSub.ProviderResponse = storageSub.rawResponse
	validatedSub.ProviderNotification = storageSub.rawNotification
	validatedSub.Active = storageSub.Active()

	return &api.ValidateIAPSubscriptionResponse{Subscription: validatedSub}, nil
}

func GetSubscriptionByProductId(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, userID, productID string) (*api.ValidatedSubscription, error) {
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
		if errors.Is(err, sql.ErrNoRows) {
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

	subscription := &api.ValidatedSubscription{
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
	}
	if name := registry.GetName(int(store)); name != "" {
		subscription.Provider = name
	}

	return subscription, nil
}

func getSubscriptionByOriginalTransactionId(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, originalTransactionId string) (*api.ValidatedSubscription, error) {
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
		if errors.Is(err, sql.ErrNoRows) {
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

	subscription := &api.ValidatedSubscription{
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
	}
	if name := registry.GetName(int(dbStore)); name != "" {
		subscription.Provider = name
	}

	return subscription, nil
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

func (s *storageSubscription) Active() bool {
	if s.expireTime.After(time.Now()) && s.refundTime.Unix() == 0 {
		return true
	}

	return false
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
		product_id = $4,
		expire_time = $7,
		update_time = now(),
		raw_response = coalesce(to_jsonb(nullif($8, '')), subscription.raw_response::jsonb),
		raw_notification = coalesce(to_jsonb(nullif($9, '')), subscription.raw_notification::jsonb),
		refund_time = coalesce(nullif($10, '1970-01-01 00:00:00+00'), subscription.refund_time)
	WHERE
		subscription.store = EXCLUDED.store
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
		if errors.Is(err, sql.ErrNoRows) {
			// The conflict update's store predicate rejected the row: another store owns this original transaction ID.
			return errSubscriptionOwnedByAnotherStore
		}
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
func iapProviderNotificationHandler(logger *zap.Logger, db *sql.DB, registry *RuntimeIAPProviderRegistry, provider *RuntimeIAPProviderFunctions, purchaseHook RuntimeIAPPurchaseNotificationFunction, subscriptionHook RuntimeIAPSubscriptionNotificationFunction) http.HandlerFunc {
	logger = logger.With(zap.String("provider", provider.name))
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
				logger.Warn("IAP provider notification body is too large", zap.Error(err))
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				return
			}
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
					if errors.Is(err, errSubscriptionOwnedByAnotherStore) {
						logger.Warn("IAP provider subscription notification original transaction ID belongs to another store", zap.String("original_transaction_id", subscription.OriginalTransactionId))
						continue
					}
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

			dbPurchases, err := upsertPurchases(r.Context(), db, purchaseToStore)
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
			if dbPurchases[0].createTime.IsZero() {
				logger.Warn("IAP provider refund notification transaction ID belongs to another store", zap.String("transaction_id", purchase.TransactionId))
				continue
			}

			if purchaseHook != nil {
				dbPurchase := dbPurchases[0]
				suid := uid.String()
				// Avoid reporting deleted users as system users.
				if uid.IsNil() {
					suid = ""
				}
				validatedPurchase := &api.ValidatedPurchase{
					UserId:           suid,
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
