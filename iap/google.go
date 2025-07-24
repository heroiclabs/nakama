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

func (g *GooglePurchaseProvider) PurchaseValidate(ctx context.Context, in *api.ValidatePurchaseRequest, userID string, persist bool) (*api.ValidatePurchaseResponse, error) {
	uuidUserID, err := uuid.FromString(userID)
	if err != nil {
		g.logger.Error("Error parsing user ID, error: %v", err)
	}

	gResponse, gReceipt, raw, err := ValidateReceiptGoogle(ctx, Httpc, g.config.GetGoogle().GetClientEmail(), g.config.GetGoogle().GetPrivateKey(), in.Receipt)
	if err != nil {
		if err != context.Canceled {
			var vErr *ValidationError
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

	sPurchase := &StoragePurchase{
		UserID:        uuidUserID,
		Store:         api.StoreProvider_GOOGLE_PLAY_STORE,
		ProductId:     gReceipt.ProductID,
		TransactionId: gReceipt.PurchaseToken,
		RawResponse:   string(raw),
		PurchaseTime:  ParseMillisecondUnixTimestamp(gReceipt.PurchaseTime),
		Environment:   purchaseEnv,
	}

	if !persist {
		validatedPurchases := []*api.ValidatedPurchase{
			{
				UserId:           userID,
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

	purchases, err := UpsertPurchases(ctx, g.db, []*StoragePurchase{sPurchase})
	if err != nil {
		if err != context.Canceled {
			g.logger.Error("Error storing Google receipt", err)
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

func (g *GooglePurchaseProvider) SubscriptionValidate(ctx context.Context, userID, password, receipt string, persist bool) (*api.ValidateSubscriptionResponse, error) {
	return nil, nil
}

func (g *GooglePurchaseProvider) HandleRefund(ctx context.Context) (http.HandlerFunc, error) {
	return nil, nil
}

func (g *GooglePurchaseProvider) ValidateRequest(in *api.ValidatePurchaseRequest) error {
	if g.config.GetGoogle().GetClientEmail() == "" || g.config.GetGoogle().GetPrivateKey() == "" {
		return status.Error(codes.FailedPrecondition, "Google IAP is not configured.")
	}

	if len(in.Purchase) < 1 {
		return status.Error(codes.InvalidArgument, "Purchase cannot be empty.")
	}

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
