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

package facebookinstant

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const Name = "facebookinstant"

type Provider struct {
	Config runtime.IAPFacebookInstantConfig
}

func (p *Provider) Name() string { return Name }

func (p *Provider) NotificationId() string { return "" }

func (p *Provider) Code() int { return int(api.StoreProvider_FACEBOOK_INSTANT_STORE) }

func (p *Provider) ValidatePurchase(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error) {
	appSecret := p.Config.GetAppSecret()
	if appSecret == "" {
		return nil, status.Error(codes.FailedPrecondition, "Facebook Instant IAP is not configured.")
	}

	signedRequest, _ := payload["signed_request"].(string)
	if len(signedRequest) < 1 {
		return nil, status.Error(codes.InvalidArgument, "SignedRequest cannot be empty.")
	}

	parts := strings.Split(signedRequest, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid signedRequest format")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, errors.New("error decoding signedRequest first part:" + err.Error())
	}
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write([]byte(parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return nil, errors.New("signedRequest verification failed")
	}
	rawResponse, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("error decoding signedRequest second part:" + err.Error())
	}
	var payment struct {
		ProductId     string  `json:"product_id"`
		PurchaseTime  float64 `json:"purchase_time"`
		PurchaseToken string  `json:"purchase_token"`
	}
	if err := json.Unmarshal(rawResponse, &payment); err != nil {
		return nil, errors.New("error parsing JSON payload:" + err.Error())
	}

	return []*runtime.IAPProviderPurchase{{
		TransactionId: payment.PurchaseToken,
		ProductId:     payment.ProductId,
		PurchaseTime:  time.Unix(int64(payment.PurchaseTime), 0),
		Environment:   api.StoreEnvironment_PRODUCTION,
		RawResponse:   string(rawResponse),
	}}, nil
}

func (p *Provider) ValidateSubscription(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error) {
	return nil, status.Error(codes.Unimplemented, "Facebook Instant IAP does not support subscriptions")
}

func (p *Provider) HandleNotification(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error) {
	return nil, status.Error(codes.Unimplemented, "Facebook Instant IAP does not send notifications")
}
