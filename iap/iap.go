// Copyright 2020 Heroic Labs.
// All rights reserved.
//
// NOTICE: All information contained herein is, and remains the property of Heroic
// Labs. and its suppliers, if any. The intellectual and technical concepts
// contained herein are proprietary to Heroic Labs. and its suppliers and may be
// covered by U.S. and Foreign Patents, patents in process, and are protected by
// trade secret or copyright law. Dissemination of this information or reproduction
// of this material is strictly forbidden unless prior written permission is
// obtained from Heroic Labs.

package iap

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/dgrijalva/jwt-go"
)

const (
	AppleReceiptValidationUrlSandbox    = "https://sandbox.itunes.apple.com/verifyReceipt"
	AppleReceiptValidationUrlProduction = "https://buy.itunes.apple.com/verifyReceipt"
)

const (
	AppleReceiptIsValid           = 0
	HuaweiReceiptIsValid          = 0
	HuaweiSandboxPurchaseType     = 0
	AppleReceiptIsFromTestSandbox = 21007 // Receipt from test env was sent to prod. Should retry against the sandbox env.
)

const (
	AppleSandboxEnvironment    = "Sandbox"
	AppleProductionEnvironment = "Production"
)

const accessTokenExpiresGracePeriod = 300 // 5 min grace period

var (
	ErrNon200ServiceApple     = errors.New("non-200 response from Apple service")
	ErrNon200ServiceGoogle    = errors.New("non-200 response from Google service")
	ErrNon200ServiceHuawei    = errors.New("non-200 response from Huawei service")
	ErrInvalidSignatureHuawei = errors.New("inAppPurchaseData invalid signature")
)

var cachedTokenGoogle accessTokenGoogle
var cachedTokenHuawei accessTokenHuawei

type ValidateReceiptAppleResponseReceiptInApp struct {
	OriginalTransactionID string `json:"original_transaction_id"`
	TransactionId         string `json:"transaction_id"` // Different than OriginalTransactionId if the user Auto-renews subscription or restores a purchase.
	ProductID             string `json:"product_id"`
	ExpiresDateMs         string `json:"expires_date_ms"` // Subscription expiration or renewal date.
	PurchaseDateMs        string `json:"purchase_date_ms"`
}

type ValidateReceiptAppleResponseReceipt struct {
	OriginalPurchaseDateMs string                                      `json:"original_purchase_date_ms"`
	InApp                  []*ValidateReceiptAppleResponseReceiptInApp `json:"in_app"`
}

type ValidateReceiptAppleResponse struct {
	IsRetryable bool                                 `json:"is-retryable"` // If true, request must be retried later.
	Status      int                                  `json:"status"`
	Receipt     *ValidateReceiptAppleResponseReceipt `json:"receipt"`
	Environment string                               `json:"environment"` // possible values: 'Sandbox', 'Production'.
}

// Validate an IAP receipt with Apple. This function will check against both the production and sandbox Apple URLs.
func ValidateReceiptApple(ctx context.Context, httpc *http.Client, receipt, password string) (*ValidateReceiptAppleResponse, []byte, error) {
	resp, raw, err := ValidateReceiptAppleWithUrl(ctx, httpc, AppleReceiptValidationUrlProduction, receipt, password)
	if err != nil {
		return nil, nil, err
	}

	switch resp.Status {
	case AppleReceiptIsFromTestSandbox:
		// Receipt should be checked with the Apple sandbox.
		return ValidateReceiptAppleWithUrl(ctx, httpc, AppleReceiptValidationUrlSandbox, receipt, password)
	}

	return resp, raw, nil
}

// Validate an IAP receipt with Apple against the specified URL.
func ValidateReceiptAppleWithUrl(ctx context.Context, httpc *http.Client, url, receipt, password string) (*ValidateReceiptAppleResponse, []byte, error) {
	if len(url) < 1 {
		return nil, nil, errors.New("'url' must not be empty")
	}

	if len(receipt) < 1 {
		return nil, nil, errors.New("'receipt' must not be empty")
	}

	if len(password) < 1 {
		return nil, nil, errors.New("'password' must not be empty")
	}

	payload := map[string]interface{}{
		"receipt-data":             receipt,
		"exclude-old-transactions": true,
		"password":                 password,
	}

	var w bytes.Buffer
	if err := json.NewEncoder(&w).Encode(&payload); err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, &w)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		buf, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return nil, nil, err
		}

		var out ValidateReceiptAppleResponse
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, nil, err
		}

		switch out.Status {
		case AppleReceiptIsFromTestSandbox:
			fallthrough
		case AppleReceiptIsValid:
			fallthrough
		default:
			return &out, buf, nil
		}
	default:
		return nil, nil, ErrNon200ServiceApple
	}
}

type ReceiptGoogle struct {
	OrderID       string `json:"orderId"`
	PackageName   string `json:"packageName"`
	ProductID     string `json:"productId"`
	PurchaseState int    `json:"purchaseState"`
	PurchaseTime  int64  `json:"purchaseTime"`
	PurchaseToken string `json:"purchaseToken"`
}

type ValidateReceiptGoogleResponse struct {
	AcknowledgementState int    `json:"acknowledgementState"`
	ConsumptionState     int    `json:"consumptionState"`
	DeveloperPayload     string `json:"developerPayload"`
	Kind                 string `json:"kind"`
	OrderId              string `json:"orderId"`
	PurchaseState        int    `json:"purchaseState"`
	PurchaseTimeMillis   string `json:"purchaseTimeMillis"`
	PurchaseType         int    `json:"purchaseType"`
	RegionCode           string `json:"regionCode"`
}

// A helper function to unwrap a receipt response from the Android Publisher API.
//
// The standard structure looks like:
//   "{\"json\":\"{\\\"orderId\\\":\\\"..\\\",\\\"packageName\\\":\\\"..\\\",\\\"productId\\\":\\\"..\\\",
//       \\\"purchaseTime\\\":1607721533824,\\\"purchaseState\\\":0,\\\"purchaseToken\\\":\\\"..\\\",
//       \\\"acknowledged\\\":false}\",\"signature\":\"..\",\"skuDetails\":\"{\\\"productId\\\":\\\"..\\\",
//       \\\"type\\\":\\\"inapp\\\",\\\"price\\\":\\\"\\u20ac82.67\\\",\\\"price_amount_micros\\\":82672732,
//       \\\"price_currency_code\\\":\\\"EUR\\\",\\\"title\\\":\\\"..\\\",\\\"description\\\":\\\"..\\\",
//       \\\"skuDetailsToken\\\":\\\"..\\\"}\"}"
func decodeReceiptGoogle(receipt string) (*ReceiptGoogle, error) {
	var wrapper map[string]interface{}
	if err := json.Unmarshal([]byte(receipt), &wrapper); err != nil {
		return nil, err
	}

	unwrapped, ok := wrapper["json"].(string)
	if !ok {
		return nil, errors.New("'json' field not found, receipt is malformed")
	}

	var gr ReceiptGoogle
	if err := json.Unmarshal([]byte(unwrapped), &gr); err != nil {
		return nil, err
	}
	return &gr, nil
}

type accessTokenGoogle struct {
	AccessToken  string    `json:"access_token"`
	ExpiresIn    int       `json:"expires_in"` // Seconds
	TokenType    string    `json:"token_type"`
	RefreshToken string    `json:"refresh_token"`
	Scope        string    `json:"scope"`
	fetchedAt    time.Time // Set when token is received
	sync.RWMutex
}

func (at *accessTokenGoogle) Expired() bool {
	return at.fetchedAt.Add(time.Duration(at.ExpiresIn)*time.Second - accessTokenExpiresGracePeriod*time.Second).Before(time.Now())
}

// Request an authenticated context (token) from Google for the Android publisher service.
// https://developers.google.com/identity/protocols/oauth2#serviceaccount
func getGoogleAccessToken(ctx context.Context, httpc *http.Client, email string, privateKey string) (string, error) {
	const authUrl = "https://accounts.google.com/o/oauth2/token"

	cachedTokenGoogle.RLock()
	if cachedTokenGoogle.AccessToken != "" && !cachedTokenGoogle.Expired() {
		cachedTokenGoogle.RUnlock()
		return cachedTokenGoogle.AccessToken, nil
	}
	cachedTokenGoogle.RUnlock()
	cachedTokenGoogle.Lock()
	defer cachedTokenGoogle.Unlock()
	if cachedTokenGoogle.AccessToken != "" && !cachedTokenGoogle.Expired() {
		return cachedTokenGoogle.AccessToken, nil
	}
	type GoogleClaims struct {
		Scope string `json:"scope,omitempty"`
		jwt.StandardClaims
	}

	now := time.Now()
	claims := &GoogleClaims{
		"https://www.googleapis.com/auth/androidpublisher",
		jwt.StandardClaims{
			Audience:  authUrl,
			ExpiresAt: now.Add(1 * time.Hour).Unix(),
			IssuedAt:  now.Unix(),
			Issuer:    email,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	block, _ := pem.Decode([]byte(privateKey))
	if block == nil {
		return "", errors.New("google iap private key invalid")
	}

	pk, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", err
	}
	signed, err := token.SignedString(pk)
	if err != nil {
		return "", err
	}

	data := url.Values{}
	data.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	data.Set("assertion", signed)
	body := data.Encode()

	req, err := http.NewRequestWithContext(ctx, "POST", authUrl, strings.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		buf, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return "", err
		}

		cachedTokenGoogle.fetchedAt = time.Now()
		if err := json.Unmarshal(buf, &cachedTokenGoogle); err != nil {
			return "", err
		}
		return cachedTokenGoogle.AccessToken, nil
	default:
		return "", fmt.Errorf("non-200 response from Google auth: %+v", resp)
	}
}

// Validate an IAP receipt with the Android Publisher API and the Google credentials.
func ValidateReceiptGoogle(ctx context.Context, httpc *http.Client, clientEmail string, privateKey string, receipt string) (*ValidateReceiptGoogleResponse, *ReceiptGoogle, []byte, error) {
	if len(clientEmail) < 1 {
		return nil, nil, nil, errors.New("'clientEmail' must not be empty")
	}

	if len(privateKey) < 1 {
		return nil, nil, nil, errors.New("'privateKey' must not be empty")
	}

	if len(receipt) < 1 {
		return nil, nil, nil, errors.New("'receipt' must not be empty")
	}

	token, err := getGoogleAccessToken(ctx, httpc, clientEmail, privateKey)
	if err != nil {
		return nil, nil, nil, err
	}

	return validateReceiptGoogleWithIDs(ctx, httpc, token, receipt)
}

// Validate an IAP receipt with the Android Publisher API using a Google token.
func validateReceiptGoogleWithIDs(ctx context.Context, httpc *http.Client, token string, receipt string) (*ValidateReceiptGoogleResponse, *ReceiptGoogle, []byte, error) {
	if len(token) < 1 {
		return nil, nil, nil, errors.New("'token' must not be empty")
	}

	if len(receipt) < 1 {
		return nil, nil, nil, errors.New("'receipt' must not be empty")
	}

	gr, err := decodeReceiptGoogle(receipt)
	if err != nil {
		return nil, nil, nil, err
	}

	u := &url.URL{
		Host:     "androidpublisher.googleapis.com",
		Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s", gr.PackageName, gr.ProductID, gr.PurchaseToken),
		RawQuery: fmt.Sprintf("access_token=%s", token),
		Scheme:   "https",
	}
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, nil, nil, err
	}

	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		buf, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return nil, nil, nil, err
		}

		out := &ValidateReceiptGoogleResponse{}
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, nil, nil, err
		}

		return out, gr, buf, nil
	default:
		return nil, nil, nil, ErrNon200ServiceGoogle
	}
}

type InAppPurchaseDataHuawei struct {
	ApplicationID string `json:"applicationId"`
	AutoRenewing  bool   `json:"autoRenewing"`
	OrderId       string `json:"orderId"`
	Kind          int    `json:"kind"`
	PackageName   string `json:"packageName"`
	ProductId     string `json:"productId"`
	PurchaseTime  int64  `json:"purchaseTime"`
	PurchaseToken string `json:"purchaseToken"`
	AccountFlag   int    `json:"accountFlag"`
	PurchaseType  int    `json:"purchaseType"` // Omitted field in production, value set to 0 in sandbox env.
}

type ValidateReceiptHuaweiResponse struct {
	ResponseCode      string                  `json:"responseCode"`
	ResponseMessage   string                  `json:"responseMessage"`
	PurchaseTokenData InAppPurchaseDataHuawei `json:"purchaseTokenData"`
	DataSignature     string                  `json:"dataSignature"`
}

type accessTokenHuawei struct {
	// App-level access token.
	AccessToken string `json:"access_token"`

	// Remaining validity period of an access token, in seconds.
	ExpiresIn int64 `json:"expires_in"`
	// This value is always Bearer, indicating the type of the returned access token.
	// TokenType    string	`json:"token_type"`

	// Save the timestamp when AccessToken is obtained
	ExpiredAt int64 `json:"-"`

	// Request header string
	HeaderString string `json:"-"`

	sync.RWMutex
}

func (at *accessTokenHuawei) Expired() bool {
	return at.ExpiredAt-accessTokenExpiresGracePeriod <= time.Now().Unix()
}

func getHuaweiAccessToken(ctx context.Context, httpc *http.Client, clientID, clientSecret string) (string, error) {
	const authUrl = "https://oauth-login.cloud.huawei.com/oauth2/v3/token"

	cachedTokenHuawei.RLock()
	if cachedTokenHuawei.AccessToken != "" && !cachedTokenHuawei.Expired() {
		cachedTokenHuawei.RUnlock()
		return cachedTokenHuawei.AccessToken, nil
	}
	cachedTokenHuawei.RUnlock()
	cachedTokenHuawei.Lock()
	defer cachedTokenHuawei.Unlock()
	if cachedTokenHuawei.AccessToken != "" && !cachedTokenHuawei.Expired() {
		return cachedTokenHuawei.AccessToken, nil
	}
	urlValue := url.Values{"grant_type": {"client_credentials"}, "client_id": {clientID}, "client_secret": {clientSecret}}
	body := urlValue.Encode()
	req, err := http.NewRequestWithContext(ctx, "POST", authUrl, strings.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := httpc.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		buf, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return "", err
		}

		var out accessTokenHuawei
		if err := json.Unmarshal(buf, &out); err != nil {
			return "", err
		}
		return out.AccessToken, nil
	default:
		return "", fmt.Errorf("non-200 response from Huawei auth: %+v", resp)
	}
}

// Validate an IAP receipt with the Huawei API
func ValidateReceiptHuawei(ctx context.Context, httpc *http.Client, pubKey, clientID, clientSecret, purchaseData, signature string) (*ValidateReceiptHuaweiResponse, *InAppPurchaseDataHuawei, []byte, error) {
	if len(purchaseData) < 1 {
		return nil, nil, nil, errors.New("'purchaseData' must not be empty")
	}

	if len(signature) < 1 {
		return nil, nil, nil, errors.New("'signature' must not be empty")
	}

	data := &InAppPurchaseDataHuawei{PurchaseType: -1} // Set sentinel value because field is omitted in prod purchases.
	if err := json.Unmarshal([]byte(purchaseData), &data); err != nil {
		return nil, nil, nil, err
	}

	// Verify Signature
	err := verifySignatureHuawei(pubKey, purchaseData, signature)
	if err != nil {
		return nil, nil, nil, ErrInvalidSignatureHuawei
	}

	token, err := getHuaweiAccessToken(ctx, httpc, clientID, clientSecret)
	if err != nil {
		return nil, nil, nil, err
	}

	rootUrl := "https://orders-at-dre.iap.dbankcloud.com"
	if data.AccountFlag != 1 {
		rootUrl = "https://orders-dre.iap.hicloud.com"
	}

	u := &url.URL{
		Host:   rootUrl,
		Path:   fmt.Sprintf("%s/applications/purchases/tokens/verify", rootUrl),
		Scheme: "https",
	}

	reqBody, err := json.Marshal(map[string]string{
		"purchaseToken": data.PurchaseToken,
		"productId":     data.ProductId,
	})
	if err != nil {
		return nil, nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", u.String(), bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := httpc.Do(req)
	if err != nil {
		return nil, nil, nil, err
	}

	switch res.StatusCode {
	case 200:
		buf, err := ioutil.ReadAll(res.Body)
		if err != nil {
			return nil, data, nil, err
		}

		out := &ValidateReceiptHuaweiResponse{}
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, data, nil, err
		}

		return out, data, buf, nil
	default:
		return nil, nil, nil, ErrNon200ServiceHuawei
	}
}

// VerifySignature validate inapp order or subscription data signature. Returns nil if pass.
//
// Document: https://developer.huawei.com/consumer/en/doc/development/HMSCore-Guides-V5/verifying-signature-returned-result-0000001050033088-V5
// Source code originated from https://github.com/HMS-Core/hms-iap-serverdemo/blob/92241f97fed1b68ddeb7cb37ea4ca6e6d33d2a87/demo/demo.go#L60
func verifySignatureHuawei(base64EncodedPublicKey string, data string, signature string) (err error) {
	publicKeyByte, err := base64.StdEncoding.DecodeString(base64EncodedPublicKey)
	if err != nil {
		return err
	}
	pub, err := x509.ParsePKIXPublicKey(publicKeyByte)
	if err != nil {
		return err
	}
	hashed := sha256.Sum256([]byte(data))
	signatureByte, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return err
	}
	return rsa.VerifyPKCS1v15(pub.(*rsa.PublicKey), crypto.SHA256, hashed[:], signatureByte)
}
