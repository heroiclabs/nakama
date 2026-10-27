package server

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

func (ri *RuntimeGoInitializer) RegisterPurchaseProvider(provider runtime.PurchaseProvider) error {
	return nil
}

func (ri *RuntimeGoInitializer) RegisterPurchaseNotificationProvider(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, provider string, notificationType runtime.NotificationType, purchase *api.ValidatedPurchase, providerPayload string) error) error {
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeValidatePurchase(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ValidatePurchaseRequest) (*api.ValidatePurchaseRequest, error)) error {
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterValidatePurchase(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseRequest) error) error {
	return nil
}

func (n *RuntimeGoNakamaModule) PurchaseValidate(ctx context.Context, provider, userID string, payload map[string]any, persist bool, overrides ...map[string]any) (*api.ValidatePurchaseResponse, error) {
	return nil, nil
}
