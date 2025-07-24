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
	"google.golang.org/protobuf/types/known/timestamppb"
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

func (f *FacebookPurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string, persist bool) (*api.ValidatePurchaseResponse, error) {
	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		f.logger.Error("Error parsing user ID, error: %v", err)
	}

	payment, rawResponse, err := ValidateReceiptFacebookInstant(f.config.GetFacebookInstant().GetAppSecret(), in.SignedRequest)
	if err != nil {
		if err != context.Canceled {
			f.logger.Error("Error validating Facebook Instant receipt", zap.Error(err))
		}
		return nil, err
	}

	sPurchase := &StoragePurchase{
		UserID:        uuidUserID,
		Store:         api.StoreProvider_FACEBOOK_INSTANT_STORE,
		ProductId:     payment.ProductId,
		TransactionId: payment.PurchaseToken,
		RawResponse:   rawResponse,
		PurchaseTime:  time.Unix(int64(payment.PurchaseTime), 0),
		Environment:   api.StoreEnvironment_PRODUCTION,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID,
				ProductId:        sPurchase.ProductId,
				TransactionId:    sPurchase.TransactionId,
				Store:            sPurchase.Store,
				PurchaseTime:     timestamppb.New(sPurchase.PurchaseTime),
				ProviderResponse: rawResponse,
				Environment:      sPurchase.Environment,
			},
		}

		return &api.ValidatePurchaseResponse{ValidatedPurchases: validatedPurchases}, nil
	}

	purchases, err := UpsertPurchases(ctx, f.db, []*StoragePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			f.logger.Error("Error storing Facebook Instant receipt, error: %v", err)
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
			ProviderResponse: rawResponse,
			SeenBefore:       p.SeenBefore,
			Environment:      p.Environment,
		})
	}

	return &api.ValidatePurchaseResponse{
		ValidatedPurchases: validatedPurchases,
	}, nil
}

func (f *FacebookPurchaseProvider) SubscriptionValidate(ctx context.Context, userID, password, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	return nil, nil
}

func (f *FacebookPurchaseProvider) HandleRefund(ctx context.Context) (http.HandlerFunc, error) {
	f.logger.Info("Handling refund not implemented yet")

	return nil, nil
}

func (f *FacebookPurchaseProvider) ValidateRequest(in *api.ValidatePurchaseRequest) error {
	if f.config.GetFacebookInstant().GetAppSecret() == "" {
		return status.Error(codes.FailedPrecondition, "Facebook Instant IAP is not configured.")
	}

	if len(in.SignedRequest) < 1 {
		return status.Error(codes.InvalidArgument, "SignedRequest cannot be empty.")
	}

	return nil
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
