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

package huawei

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const Name = "huawei"

type Provider struct {
	Config runtime.IAPHuaweiConfig
	Client *http.Client
}

type huaweiPurchaseData struct {
	ProductId     string `json:"productId"`
	PurchaseTime  int64  `json:"purchaseTime"`
	PurchaseToken string `json:"purchaseToken"`
	AccountFlag   int    `json:"accountFlag"`
	PurchaseType  int    `json:"purchaseType"`
}

func (p *Provider) Name() string { return Name }

func (p *Provider) NotificationId() string { return "" }

func (p *Provider) Code() int { return int(api.StoreProvider_HUAWEI_APP_GALLERY) }

func (p *Provider) ValidatePurchase(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error) {
	if p.Config.GetPublicKey() == "" || p.Config.GetClientID() == "" || p.Config.GetClientSecret() == "" {
		return nil, status.Error(codes.FailedPrecondition, "Huawei IAP is not configured.")
	}
	purchase, _ := payload["purchase"].(string)
	if len(purchase) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Purchase cannot be empty.")
	}
	signature, _ := payload["signature"].(string)
	if len(signature) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Signature cannot be empty.")
	}

	// Production purchases omit purchaseType, and sandbox ones send 0.
	data := &huaweiPurchaseData{PurchaseType: -1}
	if err := json.Unmarshal([]byte(purchase), &data); err != nil {
		return nil, err
	}

	publicKey, err := base64.StdEncoding.DecodeString(p.Config.GetPublicKey())
	if err != nil {
		return nil, errors.New("inAppPurchaseData invalid signature")
	}
	pub, err := x509.ParsePKIXPublicKey(publicKey)
	if err != nil {
		return nil, errors.New("inAppPurchaseData invalid signature")
	}
	signatureBytes, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return nil, errors.New("inAppPurchaseData invalid signature")
	}
	hashed := sha256.Sum256([]byte(purchase))
	if err := rsa.VerifyPKCS1v15(pub.(*rsa.PublicKey), crypto.SHA256, hashed[:], signatureBytes); err != nil {
		return nil, errors.New("inAppPurchaseData invalid signature")
	}

	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {p.Config.GetClientID()}, "client_secret": {p.Config.GetClientSecret()}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth-login.cloud.huawei.com/oauth2/v3/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 response from Huawei auth, status=%d, payload=%s", resp.StatusCode, buf)
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(buf, &token); err != nil {
		return nil, err
	}

	rootUrl := "https://orders-at-dre.iap.dbankcloud.com"
	if data.AccountFlag != 1 {
		rootUrl = "https://orders-dre.iap.hicloud.com"
	}
	reqBody, err := json.Marshal(map[string]string{"purchaseToken": data.PurchaseToken, "productId": data.ProductId})
	if err != nil {
		return nil, err
	}
	req, err = http.NewRequestWithContext(ctx, http.MethodPost, rootUrl+"/applications/purchases/tokens/verify", bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	res, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 response from Huawei service, status=%d, payload=%s", res.StatusCode, raw)
	}
	var validation struct {
		ResponseCode      string             `json:"responseCode"`
		PurchaseTokenData huaweiPurchaseData `json:"purchaseTokenData"`
	}
	if err := json.Unmarshal(raw, &validation); err != nil {
		return nil, err
	}
	if validation.ResponseCode != "0" {
		return nil, status.Errorf(codes.FailedPrecondition, "Invalid Receipt. Code: %s", validation.ResponseCode)
	}

	environment := api.StoreEnvironment_PRODUCTION
	if data.PurchaseType == 0 {
		environment = api.StoreEnvironment_SANDBOX
	}

	return []*runtime.IAPProviderPurchase{{
		TransactionId: validation.PurchaseTokenData.PurchaseToken,
		ProductId:     validation.PurchaseTokenData.ProductId,
		PurchaseTime:  time.Unix(0, 0).Add(time.Duration(data.PurchaseTime) * time.Millisecond),
		Environment:   environment,
		RawResponse:   string(raw),
	}}, nil
}

func (p *Provider) ValidateSubscription(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error) {
	return nil, status.Error(codes.Unimplemented, "Huawei IAP does not support subscriptions")
}

func (p *Provider) HandleNotification(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error) {
	return nil, status.Error(codes.Unimplemented, "Huawei IAP does not send notifications")
}
