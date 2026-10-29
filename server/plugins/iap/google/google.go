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

package google

import (
	"context"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Google limits how often a service account can request access tokens, so each one is reused until shortly before it expires.
var tokens = struct {
	sync.Mutex
	byClientEmail map[string]googleAccessToken
}{byClientEmail: make(map[string]googleAccessToken)}

type googleAccessToken struct {
	accessToken string
	expiresAt   time.Time
}

func init() {
	// Google rejects a token request whose single audience is marshaled as an array.
	jwt.MarshalSingleStringAsArray = false
}

const Name = "google"

type Provider struct {
	Config runtime.IAPGoogleConfig
	Client *http.Client
}

func (p *Provider) Name() string { return Name }

func (p *Provider) NotificationId() string { return p.Config.GetNotificationsEndpointId() }

func (p *Provider) Code() int { return int(api.StoreProvider_GOOGLE_PLAY_STORE) }

func (p *Provider) ValidatePurchase(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error) {
	clientEmail, privateKey := p.Config.GetClientEmail(), p.Config.GetPrivateKey()
	if override, ok := overrides["client_email"].(string); ok {
		clientEmail = override
	}
	if override, ok := overrides["private_key"].(string); ok {
		privateKey = override
	}
	if clientEmail == "" || privateKey == "" {
		return nil, status.Error(codes.FailedPrecondition, "Google IAP is not configured.")
	}
	receipt, _ := payload["purchase"].(string)
	if len(receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Purchase cannot be empty.")
	}

	tokens.Lock()
	cached := tokens.byClientEmail[clientEmail]
	tokens.Unlock()
	accessToken := cached.accessToken
	if !time.Now().Before(cached.expiresAt) {
		const authUrl = "https://accounts.google.com/o/oauth2/token"
		now := time.Now()
		claims := &struct {
			Scope string `json:"scope,omitempty"`
			jwt.RegisteredClaims
		}{
			"https://www.googleapis.com/auth/androidpublisher",
			jwt.RegisteredClaims{
				Audience:  jwt.ClaimStrings{authUrl},
				ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(now),
				Issuer:    clientEmail,
			},
		}
		block, _ := pem.Decode([]byte(privateKey))
		if block == nil {
			return nil, errors.New("google iap private key invalid")
		}
		privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(privateKey)
		if err != nil {
			return nil, err
		}
		form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {signed}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, authUrl, strings.NewReader(form.Encode()))
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
			return nil, fmt.Errorf("non-200 response from Google auth, status=%d, payload=%s", resp.StatusCode, buf)
		}
		var token struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}
		if err := json.Unmarshal(buf, &token); err != nil {
			return nil, err
		}
		accessToken = token.AccessToken
		tokens.Lock()
		tokens.byClientEmail[clientEmail] = googleAccessToken{accessToken: token.AccessToken, expiresAt: time.Now().Add(time.Duration(token.ExpiresIn)*time.Second - 5*time.Minute)}
		tokens.Unlock()
	}

	var wrapper map[string]any
	if err := json.Unmarshal([]byte(receipt), &wrapper); err != nil {
		return nil, err
	}
	// Receipts from the Play Billing library wrap the purchase JSON in a "json" field.
	unwrapped, ok := wrapper["json"].(string)
	if !ok {
		unwrapped = receipt
	}
	var googleReceipt struct {
		PackageName   string `json:"packageName"`
		ProductID     string `json:"productId"`
		PurchaseState int    `json:"purchaseState"`
		PurchaseTime  int64  `json:"purchaseTime"`
		PurchaseToken string `json:"purchaseToken"`
	}
	if err := json.Unmarshal([]byte(unwrapped), &googleReceipt); err != nil || googleReceipt.PackageName == "" {
		return nil, errors.New("receipt is malformed")
	}

	u := &url.URL{
		Host:     "androidpublisher.googleapis.com",
		Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s", googleReceipt.PackageName, googleReceipt.ProductID, googleReceipt.PurchaseToken),
		RawQuery: fmt.Sprintf("access_token=%s", accessToken),
		Scheme:   "https",
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 response from Google service, status=%d, payload=%s", resp.StatusCode, raw)
	}
	// Production purchases omit purchaseType, and sandbox ones send 0.
	response := struct {
		PurchaseType int `json:"purchaseType"`
	}{PurchaseType: -1}
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, err
	}

	environment := api.StoreEnvironment_PRODUCTION
	if response.PurchaseType == 0 {
		environment = api.StoreEnvironment_SANDBOX
	}
	if googleReceipt.PurchaseState != 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "Invalid Receipt. State: %d", googleReceipt.PurchaseState)
	}

	return []*runtime.IAPProviderPurchase{{
		TransactionId: googleReceipt.PurchaseToken,
		ProductId:     googleReceipt.ProductID,
		PurchaseTime:  time.Unix(0, 0).Add(time.Duration(googleReceipt.PurchaseTime) * time.Millisecond),
		Environment:   environment,
		RawResponse:   string(raw),
	}}, nil
}

func (p *Provider) ValidateSubscription(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error) {
	clientEmail, privateKey := p.Config.GetClientEmail(), p.Config.GetPrivateKey()
	if override, ok := overrides["client_email"].(string); ok {
		clientEmail = override
	}
	if override, ok := overrides["private_key"].(string); ok {
		privateKey = override
	}
	if clientEmail == "" || privateKey == "" {
		return nil, status.Error(codes.FailedPrecondition, "Google IAP is not configured.")
	}
	receipt, _ := payload["receipt"].(string)
	if len(receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	var wrapper map[string]any
	if err := json.Unmarshal([]byte(receipt), &wrapper); err != nil {
		return nil, err
	}
	unwrapped, ok := wrapper["json"].(string)
	if !ok {
		unwrapped = receipt
	}
	var googleReceipt struct {
		PackageName   string `json:"packageName"`
		ProductID     string `json:"productId"`
		PurchaseTime  int64  `json:"purchaseTime"`
		PurchaseToken string `json:"purchaseToken"`
	}
	if err := json.Unmarshal([]byte(unwrapped), &googleReceipt); err != nil || googleReceipt.PackageName == "" {
		return nil, errors.New("receipt is malformed")
	}
	if len(googleReceipt.PurchaseToken) < 1 {
		return nil, errors.New("'purchaseToken' must not be empty")
	}

	tokens.Lock()
	cached := tokens.byClientEmail[clientEmail]
	tokens.Unlock()
	accessToken := cached.accessToken
	if !time.Now().Before(cached.expiresAt) {
		const authUrl = "https://accounts.google.com/o/oauth2/token"
		now := time.Now()
		claims := &struct {
			Scope string `json:"scope,omitempty"`
			jwt.RegisteredClaims
		}{
			"https://www.googleapis.com/auth/androidpublisher",
			jwt.RegisteredClaims{
				Audience:  jwt.ClaimStrings{authUrl},
				ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(now),
				Issuer:    clientEmail,
			},
		}
		block, _ := pem.Decode([]byte(privateKey))
		if block == nil {
			return nil, errors.New("google iap private key invalid")
		}
		privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(privateKey)
		if err != nil {
			return nil, err
		}
		form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {signed}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, authUrl, strings.NewReader(form.Encode()))
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
			return nil, fmt.Errorf("non-200 response from Google auth, status=%d, payload=%s", resp.StatusCode, buf)
		}
		var token struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}
		if err := json.Unmarshal(buf, &token); err != nil {
			return nil, err
		}
		accessToken = token.AccessToken
		tokens.Lock()
		tokens.byClientEmail[clientEmail] = googleAccessToken{accessToken: token.AccessToken, expiresAt: time.Now().Add(time.Duration(token.ExpiresIn)*time.Second - 5*time.Minute)}
		tokens.Unlock()
	}

	u := &url.URL{
		Host:     "androidpublisher.googleapis.com",
		Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/subscriptionsv2/tokens/%s", googleReceipt.PackageName, googleReceipt.PurchaseToken),
		RawQuery: fmt.Sprintf("access_token=%s", accessToken),
		Scheme:   "https",
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 response from Google service, status=%d, payload=%s", resp.StatusCode, raw)
	}
	var googleSubscription *runtime.SubscriptionV2GoogleResponse
	if err := json.Unmarshal(raw, &googleSubscription); err != nil {
		return nil, err
	}
	if len(googleSubscription.LineItems) < 1 {
		return nil, errors.New("subscription has no line items")
	}

	environment := api.StoreEnvironment_PRODUCTION
	if googleSubscription.TestPurchase != nil {
		environment = api.StoreEnvironment_SANDBOX
	}
	originalTransactionID := googleReceipt.PurchaseToken
	// https://medium.com/androiddevelopers/implementing-linkedpurchasetoken-correctly-to-prevent-duplicate-subscriptions-82dfbf7167da
	if googleSubscription.LinkedPurchaseToken != "" {
		originalTransactionID = googleSubscription.LinkedPurchaseToken
	}

	return []*runtime.IAPProviderSubscription{{
		OriginalTransactionId: originalTransactionID,
		ProductId:             googleReceipt.ProductID,
		PurchaseTime:          time.Unix(0, 0).Add(time.Duration(googleReceipt.PurchaseTime) * time.Millisecond),
		ExpiryTime:            googleSubscription.LineItems[0].ExpiryTime,
		Environment:           environment,
		RawResponse:           string(raw),
	}}, nil
}

func (p *Provider) HandleNotification(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error) {
	var notification struct {
		Message struct {
			Data string `json:"data"`
		} `json:"message"`
	}
	if err := json.Unmarshal(body, &notification); err != nil {
		return nil, err
	}
	jsonData, err := base64.StdEncoding.DecodeString(notification.Message.Data)
	if err != nil {
		return nil, err
	}
	var googleNotification *runtime.GoogleDeveloperNotificationData
	if err := json.Unmarshal(jsonData, &googleNotification); err != nil {
		return nil, err
	}

	var purchaseToken string
	switch {
	case googleNotification.SubscriptionNotification != nil:
		purchaseToken = googleNotification.SubscriptionNotification.PurchaseToken
	case googleNotification.VoidedPurchaseNotification != nil:
		purchaseToken = googleNotification.VoidedPurchaseNotification.PurchaseToken
	default:
		return nil, nil
	}

	tokens.Lock()
	cached := tokens.byClientEmail[p.Config.GetClientEmail()]
	tokens.Unlock()
	accessToken := cached.accessToken
	if !time.Now().Before(cached.expiresAt) {
		const authUrl = "https://accounts.google.com/o/oauth2/token"
		now := time.Now()
		claims := &struct {
			Scope string `json:"scope,omitempty"`
			jwt.RegisteredClaims
		}{
			"https://www.googleapis.com/auth/androidpublisher",
			jwt.RegisteredClaims{
				Audience:  jwt.ClaimStrings{authUrl},
				ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(now),
				Issuer:    p.Config.GetClientEmail(),
			},
		}
		block, _ := pem.Decode([]byte(p.Config.GetPrivateKey()))
		if block == nil {
			return nil, errors.New("google iap private key invalid")
		}
		privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(privateKey)
		if err != nil {
			return nil, err
		}
		form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {signed}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, authUrl, strings.NewReader(form.Encode()))
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
			return nil, fmt.Errorf("non-200 response from Google auth, status=%d, payload=%s", resp.StatusCode, buf)
		}
		var token struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
		}
		if err := json.Unmarshal(buf, &token); err != nil {
			return nil, err
		}
		accessToken = token.AccessToken
		tokens.Lock()
		tokens.byClientEmail[p.Config.GetClientEmail()] = googleAccessToken{accessToken: token.AccessToken, expiresAt: time.Now().Add(time.Duration(token.ExpiresIn)*time.Second - 5*time.Minute)}
		tokens.Unlock()
	}

	if googleNotification.SubscriptionNotification != nil || googleNotification.VoidedPurchaseNotification.ProductType == runtime.GoogleProductTypeSubscription {
		u := &url.URL{
			Host:     "androidpublisher.googleapis.com",
			Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/subscriptionsv2/tokens/%s", googleNotification.PackageName, purchaseToken),
			RawQuery: fmt.Sprintf("access_token=%s", accessToken),
			Scheme:   "https",
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := p.Client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("non-200 response from Google service, status=%d, payload=%s", resp.StatusCode, raw)
		}
		var googleSubscription *runtime.SubscriptionV2GoogleResponse
		if err := json.Unmarshal(raw, &googleSubscription); err != nil {
			return nil, err
		}
		if len(googleSubscription.LineItems) < 1 {
			return nil, errors.New("subscription has no line items")
		}

		userID := googleSubscription.GetObfuscatedExternalAccountId()
		if userID == "" {
			userID = googleSubscription.GetObfuscatedExternalProfileId()
		}
		if userID != "" {
			if _, err := uuid.FromString(userID); err != nil {
				logger.WithField("error", err).Error("failed to extract account id")
				return nil, nil
			}
		}

		var notificationType runtime.NotificationType
		var refundTime time.Time
		if googleNotification.SubscriptionNotification != nil {
			switch googleNotification.SubscriptionNotification.NotificationType {
			case runtime.GoogleSubscriptionPurchased:
				notificationType = runtime.IAPNotificationSubscribed
			case runtime.GoogleSubscriptionRenewed:
				notificationType = runtime.IAPNotificationRenewed
			case runtime.GoogleSubscriptionExpired:
				notificationType = runtime.IAPNotificationExpired
			case runtime.GoogleSubscriptionCanceled:
				notificationType = runtime.IAPNotificationCancelled
			default:
				return nil, nil
			}
		} else {
			notificationType = runtime.IAPNotificationRefunded
			refundTime = time.Now()
		}

		originalTransactionID := purchaseToken
		if googleSubscription.LinkedPurchaseToken != "" {
			originalTransactionID = googleSubscription.LinkedPurchaseToken
		}
		environment := api.StoreEnvironment_PRODUCTION
		if googleSubscription.TestPurchase != nil {
			environment = api.StoreEnvironment_SANDBOX
		}

		return []*runtime.IAPProviderNotification{{
			Type:   notificationType,
			UserId: userID,
			Subscription: &runtime.IAPProviderSubscription{
				OriginalTransactionId: originalTransactionID,
				ProductId:             googleSubscription.LineItems[0].ProductId,
				ExpiryTime:            googleSubscription.LineItems[0].ExpiryTime,
				RefundTime:            refundTime,
				Environment:           environment,
			},
		}}, nil
	}

	u := &url.URL{
		Host:     "androidpublisher.googleapis.com",
		Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/productsv2/tokens/%s", googleNotification.PackageName, purchaseToken),
		RawQuery: fmt.Sprintf("access_token=%s", accessToken),
		Scheme:   "https",
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := p.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("non-200 response from Google service, status=%d, payload=%s", resp.StatusCode, raw)
	}
	var googlePurchase *runtime.PurchaseV2GoogleResponse
	if err := json.Unmarshal(raw, &googlePurchase); err != nil {
		return nil, err
	}

	userID := googlePurchase.GetObfuscatedExternalAccountId()
	if userID == "" {
		userID = googlePurchase.GetObfuscatedExternalProfileId()
	}
	environment := api.StoreEnvironment_PRODUCTION
	if googlePurchase.TestPurchaseContext != nil {
		environment = api.StoreEnvironment_SANDBOX
	}

	return []*runtime.IAPProviderNotification{{
		Type:   runtime.IAPNotificationRefunded,
		UserId: userID,
		Purchase: &runtime.IAPProviderPurchase{
			TransactionId: purchaseToken,
			ProductId:     googlePurchase.ProductLineItem[0].ProductId,
			PurchaseTime:  googlePurchase.PurchaseCompletionTime,
			RefundTime:    time.Now(),
			Environment:   environment,
		},
	}}, nil
}
