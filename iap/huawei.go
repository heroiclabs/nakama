package iap

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"net/http"
	"strconv"
)

type HuaweiPurchaseProvider struct {
	nk             runtime.NakamaModule
	logger         runtime.Logger
	purchaseFn     runtime.PurchaseRefundFn
	subscriptionFn runtime.SubscriptionRefundFn
	config         runtime.IAPConfig
	db             *sql.DB
	zapLogger      *zap.Logger
}

func (h *HuaweiPurchaseProvider) Init(purchaseRefundFn runtime.PurchaseRefundFn, subscriptionRefundFn runtime.SubscriptionRefundFn) {
	h.purchaseFn = purchaseRefundFn
	h.subscriptionFn = subscriptionRefundFn
}

func (h *HuaweiPurchaseProvider) GetProviderString() string {
	return runtime.Huawei.String()
}

func (h *HuaweiPurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string) ([]*runtime.StoragePurchase, error) {
	if h.config.GetHuawei().GetPublicKey() == "" ||
		h.config.GetHuawei().GetClientID() == "" ||
		h.config.GetHuawei().GetClientSecret() == "" {
		return nil, status.Error(codes.FailedPrecondition, "Huawei IAP is not configured.")
	}

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	if len(in.Signature) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Signature cannot be empty.")
	}

	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		h.logger.Error("Error parsing user ID, error: %v", err)
	}

	validation, data, raw, err := ValidateReceiptHuawei(ctx, Httpc, h.config.GetHuawei().GetPublicKey(), h.config.GetHuawei().GetClientID(), h.config.GetHuawei().GetClientSecret(), in.Receipt, in.Signature)
	if err != nil {
		if err != context.Canceled {
			var vErr *ValidationError
			if errors.As(err, &vErr) {
				h.logger.Debug("Error validating Huawei receipt, error: %v, status_code: %v, payload: %v", vErr.Err, vErr.StatusCode, vErr.Payload)
				return nil, vErr
			} else {
				h.logger.Error("Error validating Huawei receipt, error: %v", err)
			}
		}
		return nil, err
	}

	if validation.ResponseCode != strconv.Itoa(HuaweiReceiptIsValid) {
		return nil, status.Error(codes.FailedPrecondition, fmt.Sprintf("Invalid Receipt. Code: %s", validation.ResponseCode))
	}

	env := api.StoreEnvironment_PRODUCTION
	if data.PurchaseType == HuaweiSandboxPurchaseType {
		env = api.StoreEnvironment_SANDBOX
	}

	sPurchase := &runtime.StoragePurchase{
		UserID:        uuidUserID,
		Store:         api.StoreProvider_HUAWEI_APP_GALLERY,
		ProductId:     validation.PurchaseTokenData.ProductId,
		TransactionId: validation.PurchaseTokenData.PurchaseToken,
		RawResponse:   string(raw),
		PurchaseTime:  ParseMillisecondUnixTimestamp(data.PurchaseTime),
		Environment:   env,
	}

	return []*runtime.StoragePurchase{sPurchase}, nil
}

func (h *HuaweiPurchaseProvider) SubscriptionValidate(ctx context.Context, in *api.ValidateSubscriptionRequest, userID string) ([]*runtime.StorageSubscription, error) {
	h.logger.Info("Handling refund not supported")

	return nil, runtime.ErrPurchaseProviderFunctionalityNotSupported
}

func (h *HuaweiPurchaseProvider) HandleRefund(ctx context.Context) (http.HandlerFunc, error) {
	h.logger.Info("Handling refund not supported")

	return nil, runtime.ErrPurchaseProviderFunctionalityNotSupported
}

func NewHuaweiPurchaseProvider(nk runtime.NakamaModule, logger runtime.Logger, db *sql.DB, config runtime.IAPConfig, zapLogger *zap.Logger) runtime.PurchaseProvider {
	purchaseProvider := &HuaweiPurchaseProvider{
		nk:        nk,
		logger:    logger,
		db:        db,
		config:    config,
		zapLogger: zapLogger,
	}

	return purchaseProvider
}
