// Copyright 2024 The Nakama Authors
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

package iap

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const samsungPurchaseDateLayout = "2006-01-02 15:04:05"

func ParseSamsungPurchaseDate(date string) time.Time {
	if date == "" {
		return time.Time{}
	}
	t, err := time.ParseInLocation(samsungPurchaseDateLayout, date, time.UTC)
	if err != nil {
		return time.Time{}
	}
	return t
}

const (
	samsungDevApiBase     = "https://devapi.samsungapps.com"
	samsungReceiptApiBase = "https://iap.samsungapps.com"
)

const (
	SamsungPurchaseStatusSuccess = "success"
	SamsungModeTest              = "TEST"
)

// SamsungPurchaseResponse is the response from the Samsung IAP receipt API.
// https://developer.samsung.com/iap/programming-guide/samsung-iap-server-api.html
type SamsungPurchaseResponse struct {
	Status        string `json:"status"`
	Mode          string `json:"mode"`
	OrderId       string `json:"orderId"`
	PaymentId     string `json:"paymentId"`
	PackageName   string `json:"packageName"`
	ItemId        string `json:"itemId"`
	ItemName      string `json:"itemName"`
	ItemDesc      string `json:"itemDesc"`
	ItemType      string `json:"itemType"`
	PaymentAmount string `json:"paymentAmount"`
	PaymentMethod string `json:"paymentMethod"`
	PurchaseDate  string `json:"purchaseDate"`
	ErrorCode     int    `json:"errorCode"`
	ErrorMessage  string `json:"errorMessage"`
}

func (r *SamsungPurchaseResponse) IsSandbox() bool {
	return r.Mode == SamsungModeTest
}

type samsungAccessToken struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	ExpiresIn   int    `json:"expiresIn"`
	fetchedAt   time.Time
}

type samsungAccessTokenResponse struct {
	AccessToken string `json:"accessToken"`
	CreatedItem *struct {
		AccessToken string `json:"accessToken"`
	} `json:"createdItem"`
}

type samsungTokenCache struct {
	sync.RWMutex
	token *samsungAccessToken
}

var cachedTokenSamsung samsungTokenCache

func (at *samsungAccessToken) Expired() bool {
	if at.ExpiresIn <= 0 {
		return false
	}
	return at.fetchedAt.Add(time.Duration(at.ExpiresIn)*time.Second - accessTokenExpiresGracePeriod*time.Second).Before(time.Now())
}

func parseSamsungPrivateKey(privateKeyPEM string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, fmt.Errorf("samsung IAP private key invalid")
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("failed to parse samsung IAP private key: %w", err)
		}
	}

	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("samsung IAP private key is not RSA")
	}

	return rsaKey, nil
}

func createSamsungJWT(serviceAccountID string, privateKey *rsa.PrivateKey) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":    serviceAccountID,
		"scopes": []string{"publishing"},
		"iat":    now.Unix(),
		"exp":    now.Add(19 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(privateKey)
}

func getSamsungAccessToken(ctx context.Context, httpc *http.Client, serviceAccountID, privateKeyPEM string) (string, error) {
	cachedTokenSamsung.RLock()
	if cachedTokenSamsung.token != nil && cachedTokenSamsung.token.AccessToken != "" && !cachedTokenSamsung.token.Expired() {
		cachedTokenSamsung.RUnlock()
		return cachedTokenSamsung.token.AccessToken, nil
	}
	cachedTokenSamsung.RUnlock()

	cachedTokenSamsung.Lock()
	defer cachedTokenSamsung.Unlock()
	if cachedTokenSamsung.token != nil && cachedTokenSamsung.token.AccessToken != "" && !cachedTokenSamsung.token.Expired() {
		return cachedTokenSamsung.token.AccessToken, nil
	}

	privateKey, err := parseSamsungPrivateKey(normalizeSamsungPrivateKey(privateKeyPEM))
	if err != nil {
		return "", &ValidationError{Err: err}
	}

	jwtToken, err := createSamsungJWT(serviceAccountID, privateKey)
	if err != nil {
		return "", &ValidationError{Err: fmt.Errorf("failed to create Samsung IAP JWT: %w", err)}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, samsungDevApiBase+"/auth/accessToken", nil)
	if err != nil {
		return "", &ValidationError{Err: fmt.Errorf("failed to build Samsung IAP auth request: %w", err)}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+jwtToken)

	resp, err := httpc.Do(req)
	if err != nil {
		return "", &ValidationError{Err: fmt.Errorf("Samsung IAP auth request failed: %w", err)}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", &ValidationError{Err: err, StatusCode: resp.StatusCode}
	}

	switch resp.StatusCode {
	case http.StatusOK:
		var tokenResp samsungAccessTokenResponse
		if err := json.Unmarshal(raw, &tokenResp); err != nil {
			return "", &ValidationError{
				Err:        fmt.Errorf("failed to parse Samsung IAP auth response: %w", err),
				StatusCode: resp.StatusCode,
				Payload:    string(raw),
			}
		}

		accessToken := tokenResp.AccessToken
		if accessToken == "" && tokenResp.CreatedItem != nil {
			accessToken = tokenResp.CreatedItem.AccessToken
		}
		if accessToken == "" {
			return "", &ValidationError{
				Err:        fmt.Errorf("Samsung IAP auth response missing accessToken"),
				StatusCode: resp.StatusCode,
				Payload:    string(raw),
			}
		}

		token := samsungAccessToken{
			AccessToken: accessToken,
			fetchedAt:   time.Now(),
		}
		cachedTokenSamsung.token = &token
		return accessToken, nil
	case http.StatusUnauthorized:
		return "", &ValidationError{
			Err:        fmt.Errorf("Samsung IAP: failed to verify gateway server authorization"),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	default:
		return "", &ValidationError{
			Err:        fmt.Errorf("Samsung IAP auth returned HTTP %d", resp.StatusCode),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}
}

// ValidateReceiptSamsung validates a Samsung Galaxy Store IAP purchase against the
// Samsung IAP receipt API.
//
// serviceAccountID and privateKeyPEM are retained for configuration parity with other
// Galaxy Store Developer APIs; receipt verification does not use them.
// packageName is the application package name registered in Galaxy Store.
// purchaseId comes from the Samsung IAP SDK PurchaseVo.
//
// Returns the parsed receipt response, the raw response body, and any error.
func ValidateReceiptSamsung(ctx context.Context, httpc *http.Client, _, _, packageName, purchaseId string) (*SamsungPurchaseResponse, []byte, error) {
	if purchaseId == "" {
		return nil, nil, &ValidationError{Err: fmt.Errorf("Samsung IAP: purchaseId is required")}
	}

	receiptURL, err := url.Parse(samsungReceiptApiBase + "/iap/v6/receipt")
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("failed to build Samsung IAP receipt URL: %w", err)}
	}
	query := receiptURL.Query()
	query.Set("purchaseID", purchaseId)
	receiptURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, receiptURL.String(), nil)
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("failed to build Samsung IAP request: %w", err)}
	}

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, nil, &ValidationError{Err: fmt.Errorf("Samsung IAP request failed: %w", err)}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, &ValidationError{Err: err, StatusCode: resp.StatusCode}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Samsung IAP returned HTTP %d", resp.StatusCode),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	var receiptResp SamsungPurchaseResponse
	if err := json.Unmarshal(raw, &receiptResp); err != nil {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("failed to parse Samsung IAP response: %w", err),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	if receiptResp.Status != SamsungPurchaseStatusSuccess {
		errMsg := receiptResp.ErrorMessage
		if errMsg == "" {
			errMsg = receiptResp.Status
		}
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Samsung IAP: purchase validation failed: %s", errMsg),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	if packageName != "" && receiptResp.PackageName != "" && receiptResp.PackageName != packageName {
		return nil, raw, &ValidationError{
			Err: fmt.Errorf("Samsung IAP: package name mismatch (expected %s, got %s)", packageName, receiptResp.PackageName),
		}
	}

	if receiptResp.ItemId == "" {
		return nil, raw, &ValidationError{
			Err:        fmt.Errorf("Samsung IAP response missing itemId"),
			StatusCode: resp.StatusCode,
			Payload:    string(raw),
		}
	}

	return &receiptResp, raw, nil
}

func normalizeSamsungPrivateKey(privateKey string) string {
	return strings.ReplaceAll(privateKey, "\\n", "\n")
}
