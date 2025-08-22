package iap

import (
	"context"
	"database/sql"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"net/http"
	"time"
)

type FacebookPurchaseProvider struct {
	nk             runtime.NakamaModule
	logger         runtime.Logger
	purchaseFn     runtime.PurchaseRefundFn
	subscriptionFn runtime.SubscriptionRefundFn
	config         runtime.IAPConfig
	db             *sql.DB
	zapLogger      *zap.Logger
}

func (f *FacebookPurchaseProvider) Init(purchaseRefundFn runtime.PurchaseRefundFn, subscriptionRefundFn runtime.SubscriptionRefundFn) {
	f.purchaseFn = purchaseRefundFn
	f.subscriptionFn = subscriptionRefundFn
}

func (f *FacebookPurchaseProvider) GetProviderString() string {
	return runtime.Facebook.String()
}

func (f *FacebookPurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string) ([]*runtime.StoragePurchase, error) {
	if f.config.GetFacebookInstant().GetAppSecret() == "" {
		return nil, status.Error(codes.FailedPrecondition, "Facebook Instant IAP is not configured.")
	}

	signedRequest := in.Receipt

	if len(signedRequest) < 1 {
		return nil, status.Error(codes.InvalidArgument, "SignedRequest cannot be empty.")
	}

	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		f.logger.Error("Error parsing user ID, error: %v", err)
	}

	payment, rawResponse, err := ValidateReceiptFacebookInstant(f.config.GetFacebookInstant().GetAppSecret(), signedRequest)
	if err != nil {
		if err != context.Canceled {
			f.logger.Error("Error validating Facebook Instant receipt", zap.Error(err))
		}
		return nil, err
	}

	sPurchase := &runtime.StoragePurchase{
		UserID:        uuidUserID,
		Store:         api.StoreProvider_FACEBOOK_INSTANT_STORE,
		ProductId:     payment.ProductId,
		TransactionId: payment.PurchaseToken,
		RawResponse:   rawResponse,
		PurchaseTime:  time.Unix(int64(payment.PurchaseTime), 0),
		Environment:   api.StoreEnvironment_PRODUCTION,
	}

	return []*runtime.StoragePurchase{sPurchase}, nil
}

func (f *FacebookPurchaseProvider) SubscriptionValidate(ctx context.Context, in *api.ValidateSubscriptionRequest, userID string) ([]*runtime.StorageSubscription, error) {
	f.logger.Info("sub validate not supported")

	return nil, runtime.ErrPurchaseProviderFunctionalityNotSupported
}

func (f *FacebookPurchaseProvider) HandleRefundWrapper(ctx context.Context) (http.HandlerFunc, error) {
	f.logger.Info("Handling refund not supported")

	return nil, runtime.ErrPurchaseProviderFunctionalityNotSupported
}

func (f *FacebookPurchaseProvider) HandleRefund(ctx context.Context) error {
	f.logger.Info("Handling refund not supported")

	return runtime.ErrPurchaseProviderFunctionalityNotSupported
}

func NewFacebookPurchaseProvider(nk runtime.NakamaModule, logger runtime.Logger, db *sql.DB, config runtime.IAPConfig, zapLogger *zap.Logger) runtime.PurchaseProvider {
	purchaseProvider := &FacebookPurchaseProvider{
		nk:        nk,
		logger:    logger,
		db:        db,
		config:    config,
		zapLogger: zapLogger,
	}

	return purchaseProvider
}
