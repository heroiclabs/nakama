// Copyright 2026 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package samsung

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const Name = "samsung"

type Provider struct {
	Config runtime.IAPSamsungConfig
	Client *http.Client
}

func (p *Provider) Name() string { return Name }

func (p *Provider) NotificationId() string { return "" }

func (p *Provider) Code() int { return int(api.StoreProvider_SAMSUNG_GALAXY_STORE) }

func (p *Provider) ValidatePurchase(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error) {
	purchaseId, _ := payload["purchase_id"].(string)
	if len(purchaseId) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Purchase ID cannot be empty.")
	}
	packageName := p.Config.GetPackageName()

	receiptURL, err := url.Parse("https://iap.samsungapps.com/iap/v6/receipt")
	if err != nil {
		return nil, fmt.Errorf("failed to build Samsung IAP receipt URL: %s, status=0, payload=", err.Error())
	}
	query := receiptURL.Query()
	query.Set("purchaseID", purchaseId)
	receiptURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, receiptURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build Samsung IAP request: %s, status=0, payload=", err.Error())
	}
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Samsung IAP request failed: %s, status=0, payload=", err.Error())
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s, status=%d, payload=", err.Error(), resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Samsung IAP returned HTTP %d, status=%d, payload=%s", resp.StatusCode, resp.StatusCode, raw)
	}

	var receipt struct {
		Status       string `json:"status"`
		Mode         string `json:"mode"`
		PackageName  string `json:"packageName"`
		ItemId       string `json:"itemId"`
		PurchaseDate string `json:"purchaseDate"`
		ErrorCode    int    `json:"errorCode"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := json.Unmarshal(raw, &receipt); err != nil {
		return nil, fmt.Errorf("failed to parse Samsung IAP response: %s, status=%d, payload=%s", err.Error(), resp.StatusCode, raw)
	}
	if receipt.Status != "success" {
		errMsg := receipt.ErrorMessage
		if errMsg == "" {
			errMsg = receipt.Status
		}
		return nil, fmt.Errorf("Samsung IAP: purchase validation failed: %s (errorCode=%d), status=%d, payload=%s", errMsg, receipt.ErrorCode, resp.StatusCode, raw)
	}
	if packageName != "" && receipt.PackageName != "" && receipt.PackageName != packageName {
		return nil, fmt.Errorf("Samsung IAP: package name mismatch (expected %s, got %s), status=%d, payload=%s", packageName, receipt.PackageName, resp.StatusCode, raw)
	}
	if receipt.ItemId == "" {
		return nil, fmt.Errorf("Samsung IAP response missing itemId, status=%d, payload=%s", resp.StatusCode, raw)
	}

	environment := api.StoreEnvironment_PRODUCTION
	if receipt.Mode == "TEST" {
		environment = api.StoreEnvironment_SANDBOX
	}
	// A purchase date Samsung sends in another layout is stored as the zero time, as the built-in store does.
	purchaseTime, _ := time.ParseInLocation("2006-01-02 15:04:05", receipt.PurchaseDate, time.UTC)

	return []*runtime.IAPProviderPurchase{{
		TransactionId: purchaseId,
		ProductId:     receipt.ItemId,
		PurchaseTime:  purchaseTime,
		Environment:   environment,
		RawResponse:   string(raw),
	}}, nil
}

func (p *Provider) ValidateSubscription(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error) {
	return nil, status.Error(codes.Unimplemented, "Samsung IAP does not support subscriptions")
}

func (p *Provider) HandleNotification(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error) {
	return nil, status.Error(codes.Unimplemented, "Samsung IAP does not send notifications")
}
