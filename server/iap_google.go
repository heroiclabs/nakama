package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/iap"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type GooglePurchaseProvider struct {
	nk             runtime.NakamaModule
	logger         runtime.Logger
	purchaseFn     runtime.PurchaseRefundFn
	subscriptionFn runtime.SubscriptionRefundFn
	config         runtime.IAPConfig
	db             *sql.DB
	zapLogger      *zap.Logger
}

func (g *GooglePurchaseProvider) Init(purchaseRefundFn runtime.PurchaseRefundFn, subscriptionRefundFn runtime.SubscriptionRefundFn) {
	g.purchaseFn = purchaseRefundFn
	g.subscriptionFn = subscriptionRefundFn
}

func (g *GooglePurchaseProvider) GetProviderString() string {
	return runtime.Google.String()
}

func (g *GooglePurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string, overrides runtime.PurchaseProviderOverrides) ([]*runtime.StoragePurchase, error) {
	clientEmail := g.config.GetGoogle().GetClientEmail()
	privateKey := g.config.GetGoogle().GetPrivateKey()

	if overrides.ClientEmail != "" {
		clientEmail = overrides.ClientEmail
	}

	if overrides.PrivateKey != "" {
		privateKey = overrides.PrivateKey
	}

	if clientEmail == "" || privateKey == "" {
		return nil, status.Error(codes.FailedPrecondition, "Google IAP is not configured.")
	}

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		g.logger.Error("Error parsing user ID, error: %v", err)
	}

	gResponse, gReceipt, raw, err := iap.ValidateReceiptGoogle(ctx, iap.Httpc, clientEmail, privateKey, in.Receipt)
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				g.logger.Debug("Error validating Google receipt, error: %v, status_code: %v, payload: %v", vErr.Err, vErr.StatusCode, vErr.Payload)
				return nil, vErr
			} else {
				g.logger.Error("Error validating Google receipt, error: %v", err)
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
		UserID:        uuidUserID,
		Store:         api.StoreProvider_GOOGLE_PLAY_STORE,
		ProductId:     gReceipt.ProductID,
		TransactionId: gReceipt.PurchaseToken,
		RawResponse:   string(raw),
		PurchaseTime:  iap.ParseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		Environment:   purchaseEnv,
	}

	return []*runtime.StoragePurchase{sPurchase}, nil
}

func (g *GooglePurchaseProvider) SubscriptionValidate(ctx context.Context, in *api.ValidateSubscriptionRequest, userID string, overrides runtime.PurchaseProviderOverrides) ([]*runtime.StorageSubscription, error) {
	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		g.logger.Error("Error parsing user ID, error: %v", err)
	}

	clientEmail := g.config.GetGoogle().GetClientEmail()
	privateKey := g.config.GetGoogle().GetPrivateKey()

	if overrides.ClientEmail != "" {
		clientEmail = overrides.ClientEmail
	}

	if overrides.PrivateKey != "" {
		privateKey = overrides.PrivateKey
	}

	if clientEmail == "" || privateKey == "" {
		return nil, status.Error(codes.FailedPrecondition, "Google IAP is not configured.")
	}

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	gResponse, gReceipt, rawResponse, err := iap.ValidateSubscriptionReceiptGoogle(ctx, iap.Httpc, g.config.GetGoogle().GetClientEmail(), g.config.GetGoogle().GetPrivateKey(), in.Receipt)
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				g.logger.Error("Error validating Google receipt", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
				return nil, vErr
			} else {
				g.logger.Error("Error validating Google receipt", zap.Error(err))
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

	expireTime := iap.ParseMillisecondUnixTimestamp(expireTimeInt)

	active := false
	if expireTime.After(time.Now()) {
		active = true
	}

	storageSub := &runtime.StorageSubscription{
		OriginalTransactionId: gReceipt.PurchaseToken,
		UserID:                uuidUserID,
		Store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
		ProductId:             gReceipt.ProductID,
		PurchaseTime:          iap.ParseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		Environment:           purchaseEnv,
		ExpireTime:            expireTime,
		RawResponse:           string(rawResponse),
		Active:                active,
	}

	if gResponse.LinkedPurchaseToken != "" {
		// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
		storageSub.OriginalTransactionId = gResponse.LinkedPurchaseToken
	}

	return []*runtime.StorageSubscription{storageSub}, nil
}

func (g *GooglePurchaseProvider) HandleRefundWrapper(ctx context.Context) (http.HandlerFunc, error) {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx = context.WithValue(ctx, "w", w)
		ctx = context.WithValue(ctx, "r", r)
		g.HandleRefund(ctx)
	}, nil
}

func (g *GooglePurchaseProvider) HandleRefund(ctx context.Context) error {
	var w http.ResponseWriter
	if v := ctx.Value("w"); v != nil {
		w = v.(http.ResponseWriter)
	}

	var r *http.Request
	if v := ctx.Value("w"); v != nil {
		r = v.(*http.Request)
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		g.logger.Error("Failed to decode App Store notification body, error: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}
	defer r.Body.Close()

	g.zapLogger = g.zapLogger.With(zap.String("notification_body", string(body)))

	var notification *iap.GoogleStoreNotification
	if err := json.Unmarshal(body, &notification); err != nil {
		g.zapLogger.Error("Failed to unmarshal Google Play Billing notification", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	jsonData, err := base64.URLEncoding.DecodeString(notification.Message.Data)
	if err != nil {
		g.zapLogger.Error("Failed to base64 decode Google Play Billing notification data")
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	var googleNotification *iap.GoogleDeveloperNotification
	if err = json.Unmarshal(jsonData, &googleNotification); err != nil {
		g.zapLogger.Error("Failed to json unmarshal Google Play Billing notification payload", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	if googleNotification.SubscriptionNotification == nil {
		// Notification is not for subscription, ack and return. https://developer.android.com/google/play/billing/rtdn-reference#one-time
		w.WriteHeader(http.StatusOK)
		return nil
	}

	receipt := &iap.ReceiptGoogle{
		PurchaseToken: googleNotification.SubscriptionNotification.PurchaseToken,
		ProductID:     googleNotification.SubscriptionNotification.SubscriptionId,
		PackageName:   googleNotification.PackageName,
	}

	encodedReceipt, err := json.Marshal(receipt)
	if err != nil {
		g.zapLogger.Error("Failed to marshal Google receipt.", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	gResponse, _, _, err := iap.ValidateSubscriptionReceiptGoogle(r.Context(), iap.Httpc, g.config.GetGoogle().GetClientEmail(), g.config.GetGoogle().GetPrivateKey(), string(encodedReceipt))
	if err != nil {
		var vErr *iap.ValidationError
		if errors.As(err, &vErr) {
			g.zapLogger.Error("Error validating Google receipt in notification callback", zap.Error(vErr.Err), zap.Int("status_code", vErr.StatusCode), zap.String("payload", vErr.Payload))
		} else {
			g.zapLogger.Error("Error validating Google receipt in notification callback", zap.Error(err))
		}
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	g.zapLogger.Debug("Google IAP subscription notification received", zap.String("notification_payload", string(jsonData)), zap.Any("api_response", gResponse))

	var uid uuid.UUID
	if gResponse.ObfuscatedExternalAccountId != "" {
		extUID, err := uuid.FromString(gResponse.ObfuscatedExternalAccountId)
		if err != nil {
			w.WriteHeader(http.StatusOK)
			return nil
		}
		uid = extUID
	} else if gResponse.ObfuscatedExternalProfileId != "" {
		extUID, err := uuid.FromString(gResponse.ObfuscatedExternalProfileId)
		if err != nil {
			w.WriteHeader(http.StatusOK)
			return nil
		}
		uid = extUID
	} else if gResponse.ProfileId != "" {
		var dbUID uuid.UUID
		if err = g.db.QueryRowContext(r.Context(), "SELECT id FROM users WHERE google_id = $1", gResponse.ProfileId).Scan(&dbUID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				g.zapLogger.Warn("Google Play Billing subscription notification user not found", zap.String("profile_id", gResponse.ProfileId), zap.String("payload", string(body)))
				w.WriteHeader(http.StatusOK) // Subscription could not be assigned to a user ID, ack and ignore it.
				return nil
			}
			w.WriteHeader(http.StatusInternalServerError)
			return nil
		}
		uid = dbUID
	} else {
		// Get user id by existing validated subscription.
		purchaseToken := googleNotification.SubscriptionNotification.PurchaseToken
		if gResponse.LinkedPurchaseToken != "" {
			// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
			purchaseToken = gResponse.LinkedPurchaseToken
		}
		sub, err := iap.GetSubscriptionByOriginalTransactionId(r.Context(), g.zapLogger, g.db, purchaseToken)
		if err != nil || sub == nil {
			w.WriteHeader(http.StatusInternalServerError)
			return nil
		}
		uid = uuid.Must(uuid.FromString(sub.UserId))
	}

	env := api.StoreEnvironment_PRODUCTION
	if gResponse.PurchaseType == 0 {
		env = api.StoreEnvironment_SANDBOX
	}

	expireTimeInt, err := strconv.ParseInt(gResponse.ExpiryTimeMillis, 10, 64)
	if err != nil {
		g.zapLogger.Error("Failed to convert Google Play Billing notification 'ExpiryTimeMillis' string to int", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	purchaseTime, err := strconv.ParseInt(gResponse.StartTimeMillis, 10, 64)
	if err != nil {
		g.zapLogger.Error("Failed to convert Google Play Billing notification 'StartTimeMillis' string to int", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	storageSub := &runtime.StorageSubscription{
		OriginalTransactionId: googleNotification.SubscriptionNotification.PurchaseToken,
		UserID:                uid,
		Store:                 api.StoreProvider_GOOGLE_PLAY_STORE,
		ProductId:             googleNotification.SubscriptionNotification.SubscriptionId,
		PurchaseTime:          iap.ParseMillisecondUnixTimestamp(purchaseTime),
		Environment:           env,
		ExpireTime:            iap.ParseMillisecondUnixTimestamp(expireTimeInt),
		RawNotification:       string(body),
	}

	if gResponse.LinkedPurchaseToken != "" {
		// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
		storageSub.OriginalTransactionId = gResponse.LinkedPurchaseToken
	}

	if err = ExecuteInTx(r.Context(), g.db, func(tx *sql.Tx) error {
		if err = iap.UpsertSubscription(r.Context(), tx, storageSub); err != nil {
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
			return nil
		}
		g.logger.Error("Failed to store Google Play Billing notification subscription data", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	w.WriteHeader(http.StatusOK)
	return nil
}

func NewGooglePurchaseProvider(nk runtime.NakamaModule, logger runtime.Logger, db *sql.DB, config runtime.IAPConfig, zapLogger *zap.Logger) runtime.PurchaseProvider {
	purchaseProvider := &GooglePurchaseProvider{
		nk:        nk,
		logger:    logger,
		db:        db,
		config:    config,
		zapLogger: zapLogger,
	}

	return purchaseProvider
}
