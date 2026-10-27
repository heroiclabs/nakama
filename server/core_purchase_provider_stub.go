package server

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
)

func ValidatePurchase(ctx context.Context, logger *zap.Logger, db *sql.DB, registry *RuntimePurchaseProviderRegistry, userID uuid.UUID, traceID, providerName string, payload, overrides map[string]any, persist bool) (*api.ValidatePurchaseResponse, error) {
	return nil, nil
}

func purchaseProviderNotificationHandler(logger *zap.Logger, db *sql.DB, registry *RuntimePurchaseProviderRegistry, provider *RuntimePurchaseProviderFunctions, hook RuntimePurchaseNotificationProviderFunction) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {}
}
