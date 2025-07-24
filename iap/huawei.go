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
	"google.golang.org/protobuf/types/known/timestamppb"
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

func (h *HuaweiPurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string, persist bool) (*api.ValidatePurchaseResponse, error) {
	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		h.logger.Error("Error parsing user ID, error: %v", err)
	}

	validation, data, raw, err := ValidateReceiptHuawei(ctx, Httpc, h.config.GetHuawei().GetPublicKey(), h.config.GetHuawei().GetClientID(), h.config.GetHuawei().GetClientSecret(), in.Purchase, in.Signature)
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

	sPurchase := &StoragePurchase{
		UserID:        uuidUserID,
		Store:         api.StoreProvider_HUAWEI_APP_GALLERY,
		ProductId:     validation.PurchaseTokenData.ProductId,
		TransactionId: validation.PurchaseTokenData.PurchaseToken,
		RawResponse:   string(raw),
		PurchaseTime:  ParseMillisecondUnixTimestamp(data.PurchaseTime),
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

	purchases, err := UpsertPurchases(ctx, h.db, []*StoragePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			h.logger.Error("Error storing Huawei receipt, error: %v", err)
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

func (h *HuaweiPurchaseProvider) SubscriptionValidate(ctx context.Context, userID, password, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	return nil, nil
}

func (h *HuaweiPurchaseProvider) HandleRefund(ctx context.Context) (http.HandlerFunc, error) {
	h.logger.Info("Handling refund not implemented yet")

	return nil, nil
}

func (h *HuaweiPurchaseProvider) ValidateRequest(in *api.ValidatePurchaseRequest) error {
	if h.config.GetHuawei().GetPublicKey() == "" ||
		h.config.GetHuawei().GetClientID() == "" ||
		h.config.GetHuawei().GetClientSecret() == "" {
		return status.Error(codes.FailedPrecondition, "Huawei IAP is not configured.")
	}

	if len(in.Purchase) < 1 {
		return status.Error(codes.InvalidArgument, "Purchase cannot be empty.")
	}

	if len(in.Signature) < 1 {
		return status.Error(codes.InvalidArgument, "Signature cannot be empty.")
	}

	return nil
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
