package server

import (
	"context"
	"crypto/x509"
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
	"google.golang.org/protobuf/types/known/timestamppb"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type ApplePurchaseProvider struct {
	nk             runtime.NakamaModule
	logger         runtime.Logger
	purchaseFn     runtime.PurchaseRefundFn
	subscriptionFn runtime.SubscriptionRefundFn
	config         runtime.IAPConfig
	db             *sql.DB
	zapLogger      *zap.Logger
}

func (a *ApplePurchaseProvider) Init(purchaseRefundFn runtime.PurchaseRefundFn, subscriptionRefundFn runtime.SubscriptionRefundFn) {
	a.purchaseFn = purchaseRefundFn
	a.subscriptionFn = subscriptionRefundFn
}

func (a *ApplePurchaseProvider) GetProviderString() string {
	return runtime.Apple.String()
}

func (a *ApplePurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string) ([]*runtime.StoragePurchase, error) {
	if a.config.GetApple().GetSharedPassword() == "" {
		return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	}

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		a.logger.Error("Error parsing user ID, error: %v", err)
	}

	validation, raw, err := iap.ValidateReceiptApple(ctx, iap.Httpc, in.Receipt, a.config.GetApple().GetSharedPassword())
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				a.logger.Debug("Error validating Apple receipt, error: &v, status_code: %v, payload: %v", vErr.Err, vErr.StatusCode, vErr.Payload)
				return nil, vErr
			} else {
				a.logger.Error("Error validating Apple receipt, error: %v", err)
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
			UserID:        uuidUserID,
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
			UserID:        uuidUserID,
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

	return storagePurchases, nil

}

func (a *ApplePurchaseProvider) SubscriptionValidate(ctx context.Context, in *api.ValidateSubscriptionRequest, userID string) ([]*runtime.StorageSubscription, error) {
	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		a.logger.Error("Error parsing user ID, error: %v", err)
	}

	if a.config.GetApple().GetSharedPassword() == "" {
		return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	}

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	validation, rawResponse, err := iap.ValidateReceiptApple(ctx, iap.Httpc, in.Receipt, a.config.GetApple().GetSharedPassword())
	if err != nil {
		if err != context.Canceled {
			var vErr *iap.ValidationError
			if errors.As(err, &vErr) {
				a.logger.Error("Error validating Apple receipt, error: &v, status_code: %v, payload: %v", vErr.Err, vErr.StatusCode, vErr.Payload)
				return nil, vErr
			} else {
				a.logger.Error("Error validating Apple receipt", zap.Error(err))
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

	var found bool
	var receiptInfo iap.ValidateReceiptAppleResponseLatestReceiptInfo
	storageSubscriptions := make([]*runtime.StorageSubscription, 0, len(validation.Receipt.InApp)+len(validation.LatestReceiptInfo))

	for _, latestReceiptInfo := range validation.LatestReceiptInfo {
		if latestReceiptInfo.ExpiresDateMs == "" {
			// Not a subscription, skip.
			continue
		}
		receiptInfo = latestReceiptInfo
		found = true

		purchaseTime, err := strconv.ParseInt(receiptInfo.OriginalPurchaseDateMs, 10, 64)
		if err != nil {
			return nil, err
		}

		expireTimeInt, err := strconv.ParseInt(receiptInfo.ExpiresDateMs, 10, 64)
		if err != nil {
			return nil, err
		}

		expireTime := iap.ParseMillisecondUnixTimestamp(expireTimeInt)

		active := false
		if expireTime.After(time.Now()) {
			active = true
		}

		// change this to an array of storage subscriptions
		storageSubscriptions = append(storageSubscriptions, &runtime.StorageSubscription{
			UserID:                uuidUserID,
			Store:                 api.StoreProvider_APPLE_APP_STORE,
			ProductId:             receiptInfo.ProductId,
			OriginalTransactionId: receiptInfo.OriginalTransactionId,
			PurchaseTime:          iap.ParseMillisecondUnixTimestamp(purchaseTime),
			Environment:           env,
			ExpireTime:            expireTime,
			RawResponse:           string(rawResponse),
			Active:                active,
		})

	}
	if !found {
		// Receipt is for a purchase (or otherwise has no subscriptions for any reason) so ValidatePurchaseApple should be used instead.
		return nil, status.Error(codes.FailedPrecondition, "Purchase Receipt. Use the appropriate function instead.")
	}

	return storageSubscriptions, nil
}

func (a *ApplePurchaseProvider) HandleRefundWrapper(ctx context.Context) (http.HandlerFunc, error) {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx = context.WithValue(ctx, "w", w)
		ctx = context.WithValue(ctx, "r", r)
		a.HandleRefund(ctx)
	}, nil
}

func (a *ApplePurchaseProvider) HandleRefund(ctx context.Context) error {
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
		a.logger.Error("Failed to decode App Store notification body", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}
	defer r.Body.Close()

	var applePayload *iap.AppleNotificationSignedPayload
	if err := json.Unmarshal(body, &applePayload); err != nil {
		a.logger.Error("Failed to unmarshal App Store notification", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	tokens := strings.Split(applePayload.SignedPayload, ".")
	if len(tokens) < 3 {
		a.logger.Error("Unexpected App Store notification JWS token length")
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	seg := tokens[0]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	headerByte, err := base64.StdEncoding.DecodeString(seg)
	if err != nil {
		a.logger.Error("Failed to decode Apple notification JWS header", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	type Header struct {
		Alg string   `json:"alg"`
		X5c []string `json:"x5c"`
	}
	var header Header

	if err = json.Unmarshal(headerByte, &header); err != nil {
		a.logger.Error("Failed to unmarshal Apple notification JWS header", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	certs := make([][]byte, 0)
	for _, encodedCert := range header.X5c {
		cert, err := base64.StdEncoding.DecodeString(encodedCert)
		if err != nil {
			a.logger.Error("Failed to decode Apple notification JWS header certificate", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return nil
		}
		certs = append(certs, cert)
	}

	rootCert := x509.NewCertPool()
	ok := rootCert.AppendCertsFromPEM([]byte(iap.AppleRootPEM))
	if !ok {
		a.logger.Error("Failed to parse Apple root certificate", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	interCert, err := x509.ParseCertificate(certs[1])
	if err != nil {
		a.logger.Error("Failed to parse Apple notification intermediate certificate", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}
	intermedia := x509.NewCertPool()
	intermedia.AddCert(interCert)

	cert, err := x509.ParseCertificate(certs[2])
	if err != nil {
		a.logger.Error("Failed to parse Apple notification certificate", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	opts := x509.VerifyOptions{
		Roots:         rootCert,
		Intermediates: intermedia,
	}

	_, err = cert.Verify(opts)
	if err != nil {
		a.logger.Error("Failed to validate Apple notification signature", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	seg = tokens[1]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	jsonPayload, err := base64.StdEncoding.DecodeString(seg)
	if err != nil {
		a.logger.Error("Failed to base64 decode App Store notification payload", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	var notificationPayload *iap.AppleNotificationPayload
	if err = json.Unmarshal(jsonPayload, &notificationPayload); err != nil {
		a.logger.Error("Failed to json unmarshal App Store notification payload", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	tokens = strings.Split(notificationPayload.Data.SignedTransactionInfo, ".")
	if len(tokens) < 3 {
		a.logger.Error("Unexpected App Store notification SignedTransactionInfo JWS token length")
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	seg = tokens[1]
	if l := len(seg) % 4; l > 0 {
		seg += strings.Repeat("=", 4-l)
	}

	jsonPayload, err = base64.StdEncoding.DecodeString(seg)
	if err != nil {
		a.logger.Error("Failed to base64 decode App Store notification payload", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	var signedTransactionInfo *iap.AppleNotificationTransactionInfo
	if err = json.Unmarshal(jsonPayload, &signedTransactionInfo); err != nil {
		a.logger.Error("Failed to json unmarshal App Store notification SignedTransactionInfo JWS token", zap.Error(err))
		w.WriteHeader(http.StatusInternalServerError)
		return nil
	}

	a.logger.Debug("Apple IAP notification received", zap.Any("notification_payload", signedTransactionInfo))

	uid := uuid.Nil
	if signedTransactionInfo.AppAccountToken != "" {
		tokenUID, err := uuid.FromString(signedTransactionInfo.AppAccountToken)
		if err != nil {
			a.logger.Warn("App Store subscription notification AppAccountToken is an invalid uuid", zap.String("app_account_token", signedTransactionInfo.AppAccountToken), zap.Error(err), zap.String("payload", string(body)))
		} else {
			uid = tokenUID
		}
	}

	env := api.StoreEnvironment_PRODUCTION
	if notificationPayload.Data.Environment == iap.AppleSandboxEnvironment {
		env = api.StoreEnvironment_SANDBOX
	}

	if signedTransactionInfo.ExpiresDateMs != 0 {
		// Notification regarding a subscription.
		if uid.IsNil() {
			// No user ID was found in receipt, lookup a validated subscription.
			s, err := iap.GetSubscriptionByOriginalTransactionId(r.Context(), a.zapLogger, a.db, signedTransactionInfo.OriginalTransactionId)
			if err != nil || s == nil {
				w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
				return nil
			}
			uid = uuid.Must(uuid.FromString(s.UserId))
		}

		sub := &runtime.StorageSubscription{
			UserID:                uid,
			OriginalTransactionId: signedTransactionInfo.OriginalTransactionId,
			Store:                 api.StoreProvider_APPLE_APP_STORE,
			ProductId:             signedTransactionInfo.ProductId,
			PurchaseTime:          iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.OriginalPurchaseDateMs),
			Environment:           env,
			ExpireTime:            iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.ExpiresDateMs),
			RawNotification:       string(body),
			RefundTime:            iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.RevocationDateMs),
		}

		if err = ExecuteInTx(r.Context(), a.db, func(tx *sql.Tx) error {
			if err = iap.UpsertSubscription(r.Context(), tx, sub); err != nil {
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
			a.logger.Error("Failed to store App Store notification subscription data", zap.Error(err))
			w.WriteHeader(http.StatusInternalServerError)
			return nil
		}

		active := false
		if sub.ExpireTime.After(time.Now()) && sub.RefundTime.Unix() == 0 {
			active = true
		}

		var suid string
		if !sub.UserID.IsNil() {
			suid = sub.UserID.String()
		}

		if strings.ToUpper(notificationPayload.NotificationType) == iap.AppleNotificationTypeRefund {
			validatedSub := &api.ValidatedSubscription{
				UserId:                suid,
				ProductId:             sub.ProductId,
				OriginalTransactionId: sub.OriginalTransactionId,
				Store:                 api.StoreProvider_APPLE_APP_STORE,
				PurchaseTime:          timestamppb.New(sub.PurchaseTime),
				CreateTime:            timestamppb.New(sub.CreateTime),
				UpdateTime:            timestamppb.New(sub.UpdateTime),
				Environment:           env,
				ExpiryTime:            timestamppb.New(sub.ExpireTime),
				RefundTime:            timestamppb.New(sub.RefundTime),
				ProviderResponse:      sub.RawResponse,
				ProviderNotification:  sub.RawNotification,
				Active:                active,
			}

			if a.subscriptionFn != nil {
				if err = a.subscriptionFn(r.Context(), a.logger, a.db, a.nk, validatedSub, string(body)); err != nil {
					a.logger.Error("Error invoking Apple subscription refund runtime function", zap.Error(err))
					w.WriteHeader(http.StatusOK)
					return nil
				}
			}
		}

	} else {
		// Notification regarding a purchase.
		if uid.IsNil() {
			// No user ID was found in receipt, lookup a validated subscription.
			p, err := iap.GetPurchaseByTransactionId(r.Context(), a.zapLogger, a.db, signedTransactionInfo.TransactionId)
			if err != nil || p == nil {
				// User validated purchase not found.
				w.WriteHeader(http.StatusInternalServerError) // Return error to keep retrying.
				return nil
			}
			uid = uuid.Must(uuid.FromString(p.UserId))
		}

		if strings.ToUpper(notificationPayload.NotificationType) == iap.AppleNotificationTypeRefund {
			purchase := &runtime.StoragePurchase{
				UserID:        uid,
				Store:         api.StoreProvider_APPLE_APP_STORE,
				ProductId:     signedTransactionInfo.ProductId,
				TransactionId: signedTransactionInfo.TransactionId,
				PurchaseTime:  iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.PurchaseDateMs),
				RefundTime:    iap.ParseMillisecondUnixTimestamp(signedTransactionInfo.RevocationDateMs),
				Environment:   env,
			}

			dbPurchases, err := iap.UpsertPurchases(r.Context(), a.db, []*runtime.StoragePurchase{purchase})
			if err != nil {
				a.logger.Error("Failed to store App Store notification purchase data")
				w.WriteHeader(http.StatusInternalServerError)
				return nil
			}

			if a.purchaseFn != nil {
				dbPurchase := dbPurchases[0]
				suid := dbPurchase.UserID.String()
				if dbPurchase.UserID.IsNil() {
					suid = ""
				}
				validatedPurchase := &api.ValidatedPurchase{
					UserId:           suid,
					ProductId:        signedTransactionInfo.ProductId,
					TransactionId:    signedTransactionInfo.TransactionId,
					Store:            api.StoreProvider_APPLE_APP_STORE,
					CreateTime:       timestamppb.New(dbPurchase.CreateTime),
					UpdateTime:       timestamppb.New(dbPurchase.UpdateTime),
					PurchaseTime:     timestamppb.New(dbPurchase.PurchaseTime),
					RefundTime:       timestamppb.New(dbPurchase.RefundTime),
					ProviderResponse: string(body),
					Environment:      env,
					SeenBefore:       dbPurchase.SeenBefore,
				}

				if err = a.purchaseFn(r.Context(), a.logger, a.db, a.nk, validatedPurchase, string(body)); err != nil {
					a.logger.Error("Error invoking Apple purchase refund runtime function", zap.Error(err))
					w.WriteHeader(http.StatusOK)
					return nil
				}
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	return nil
}

func NewApplePurchaseProvider(nk runtime.NakamaModule, logger runtime.Logger, db *sql.DB, config runtime.IAPConfig, zapLogger *zap.Logger) runtime.PurchaseProvider {
	purchaseProvider := &ApplePurchaseProvider{
		nk:        nk,
		logger:    logger,
		db:        db,
		config:    config,
		zapLogger: zapLogger,
	}

	return purchaseProvider
}
