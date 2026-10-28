package server

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

type purchaseNotificationHandler interface {
	HandlePurchaseNotification(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, body []byte, headers, query map[string][]string) (*runtime.ProviderPurchase, string, error)
}

func (ri *RuntimeGoInitializer) RegisterSubscriptionNotificationProvider(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, provider string, notificationType runtime.NotificationType, subscription *api.ValidatedSubscription, providerPayload string) error) error {
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeValidateSubscription(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ValidateSubscriptionRequest) (*api.ValidateSubscriptionRequest, error)) error {
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterValidateSubscription(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionRequest) error) error {
	return nil
}

func (n *RuntimeGoNakamaModule) SubscriptionValidate(ctx context.Context, provider, userID string, payload map[string]any, persist bool, overrides ...map[string]any) (*api.ValidateSubscriptionResponse, error) {
	return nil, nil
}
