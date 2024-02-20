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
	"crypto/hmac"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v4"
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

var cachedTokensGoogle = &googleTokenCache{
	tokenMap: make(map[string]*accessTokenGoogle),
}
var cachedTokenHuawei accessTokenHuawei

type googleTokenCache struct {
	sync.RWMutex
	tokenMap map[string]*accessTokenGoogle
}

type ValidationError struct {
	Err        error
	StatusCode int
	Payload    string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s, status=%d, payload=%s", e.Err.Error(), e.StatusCode, e.Payload)
}
func (e *ValidationError) Unwrap() error { return e.Err }

var (
	ErrNon200ServiceApple     = errors.New("non-200 response from Apple service")
	ErrNon200ServiceGoogle    = errors.New("non-200 response from Google service")
	ErrNon200ServiceHuawei    = errors.New("non-200 response from Huawei service")
	ErrInvalidSignatureHuawei = errors.New("inAppPurchaseData invalid signature")
)

func init() {
	// Hint to the JWT encoder that single-string arrays should be marshaled as strings.
	// This ensures that for example `["foo"]` is marshaled as `"foo"`.
	// Note: this is required particularly for Google IAP verification JWT audience fields.
	jwt.MarshalSingleStringAsArray = false
}

// Apple

type ValidateReceiptAppleResponseReceiptInApp struct {
	OriginalTransactionID string `json:"original_transaction_id"`
	TransactionId         string `json:"transaction_id"` // Different from OriginalTransactionId if the user Auto-renews subscription or restores a purchase.
	ProductID             string `json:"product_id"`
	ExpiresDateMs         string `json:"expires_date_ms"` // Subscription expiration or renewal date.
	PurchaseDateMs        string `json:"purchase_date_ms"`
	CancellationDateMs    string `json:"cancellation_date_ms"`
}

type ValidateReceiptAppleResponseReceipt struct {
	OriginalPurchaseDateMs string                                      `json:"original_purchase_date_ms"`
	InApp                  []*ValidateReceiptAppleResponseReceiptInApp `json:"in_app"`
}

type ValidateReceiptAppleResponseLatestReceiptInfo struct {
	CancellationDateMs          string `json:"cancellation_date_ms"`
	CancellationReason          string `json:"cancellation_reason"`
	ExpiresDateMs               string `json:"expires_date_ms"`
	InAppOwnershipType          string `json:"in_app_ownership_type"`
	IsInIntroOfferPeriod        string `json:"is_in_intro_offer_period"` // "true" or "false"
	IsTrialPeriod               string `json:"is_trial_period"`
	IsUpgraded                  string `json:"is_upgraded"`
	OfferCodeRefName            string `json:"offer_code_ref_name"`
	OriginalPurchaseDateMs      string `json:"original_purchase_date_ms"`
	OriginalTransactionId       string `json:"original_transaction_id"` // First subscription transaction
	ProductId                   string `json:"product_id"`
	PromotionalOfferId          string `json:"promotional_offer_id"`
	PurchaseDateMs              string `json:"purchase_date_ms"`
	Quantity                    string `json:"quantity"`
	SubscriptionGroupIdentifier string `json:"subscription_group_identifier"`
	TransactionId               string `json:"transaction_id"` // Different from OriginalTransactionId if the user Auto-renews subscription or restores a purchase.
}

type ValidateReceiptAppleResponsePendingRenewalInfo struct {
	AutoRenewProductId       string `json:"auto_renew_product_id"`
	AutoRenewStatus          string `json:"auto_renew_status"` // 1: subscription will renew at end of current subscription period, 0: the customer has turned off automatic renewal for the subscription.
	ExpirationIntent         string `json:"expiration_intent"`
	GracePeriodExpiresDateMs string `json:"grace_period_expires_date_ms"`
	IsInBillingRetryPeriod   string `json:"is_in_billing_retry_period"`
	OfferCodeRefName         string `json:"offer_code_ref_name"`
	OriginalTransactionId    string `json:"original_transaction_id"`
	PriceConsentStatus       string `json:"price_consent_status"`
	ProductId                string `json:"product_id"`
	PromotionalOfferId       string `json:"promotional_offer_id"`
}

type ValidateReceiptAppleResponse struct {
	Environment        string                                           `json:"environment"`  // possible values: 'Sandbox', 'Production'.
	IsRetryable        bool                                             `json:"is-retryable"` // If true, request must be retried later.
	LatestReceipt      string                                           `json:"latest_receipt"`
	LatestReceiptInfo  []ValidateReceiptAppleResponseLatestReceiptInfo  `json:"latest_receipt_info"`
	PendingRenewalInfo []ValidateReceiptAppleResponsePendingRenewalInfo `json:"pending_renewal_info"` // Only returned for auto-renewable subscriptions.
	Receipt            *ValidateReceiptAppleResponseReceipt             `json:"receipt"`
	Status             int                                              `json:"status"`
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

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, err
	}

	switch resp.StatusCode {
	case 200:
		var out ValidateReceiptAppleResponse
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, nil, err
		}

		// Sort by ExpiresDateMs in desc order
		sort.Slice(out.LatestReceiptInfo, func(i, j int) bool {
			return sort.StringsAreSorted([]string{out.LatestReceiptInfo[j].ExpiresDateMs, out.LatestReceiptInfo[i].ExpiresDateMs})
		})

		switch out.Status {
		case AppleReceiptIsFromTestSandbox:
			fallthrough
		case AppleReceiptIsValid:
			fallthrough
		default:
			return &out, buf, nil
		}
	default:
		return nil, nil, &ValidationError{
			Err:        ErrNon200ServiceApple,
			StatusCode: resp.StatusCode,
			Payload:    string(buf),
		}
	}
}

// Google

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
//
//	"{\"json\":\"{\\\"orderId\\\":\\\"..\\\",\\\"packageName\\\":\\\"..\\\",\\\"productId\\\":\\\"..\\\",
//	    \\\"purchaseTime\\\":1607721533824,\\\"purchaseState\\\":0,\\\"purchaseToken\\\":\\\"..\\\",
//	    \\\"acknowledged\\\":false}\",\"signature\":\"..\",\"skuDetails\":\"{\\\"productId\\\":\\\"..\\\",
//	    \\\"type\\\":\\\"inapp\\\",\\\"price\\\":\\\"\\u20ac82.67\\\",\\\"price_amount_micros\\\":82672732,
//	    \\\"price_currency_code\\\":\\\"EUR\\\",\\\"title\\\":\\\"..\\\",\\\"description\\\":\\\"..\\\",
//	    \\\"skuDetailsToken\\\":\\\"..\\\"}\"}"
func decodeReceiptGoogle(receipt string) (*ReceiptGoogle, error) {
	var wrapper map[string]interface{}
	if err := json.Unmarshal([]byte(receipt), &wrapper); err != nil {
		return nil, err
	}

	unwrapped, ok := wrapper["json"].(string)
	if !ok {
		// If there is no 'json' field, assume the receipt is not in a
		// wrapper. Just attempt and decode from the top level instead.
		unwrapped = receipt
	}

	var gr ReceiptGoogle
	if err := json.Unmarshal([]byte(unwrapped), &gr); err != nil {
		return nil, errors.New("receipt is malformed")
	}
	if gr.PackageName == "" {
		return nil, errors.New("receipt is malformed")
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
}

func (at *accessTokenGoogle) Expired() bool {
	return at.fetchedAt.Add(time.Duration(at.ExpiresIn)*time.Second - accessTokenExpiresGracePeriod*time.Second).Before(time.Now())
}

// Request an authenticated context (token) from Google for the Android publisher service.
// https://developers.google.com/identity/protocols/oauth2#serviceaccount
func getGoogleAccessToken(ctx context.Context, httpc *http.Client, email, privateKey string) (string, error) {
	const authUrl = "https://accounts.google.com/o/oauth2/token"

	cachedTokensGoogle.RLock()
	cacheToken, found := cachedTokensGoogle.tokenMap[email]
	if found && cacheToken.AccessToken != "" && !cacheToken.Expired() {
		cachedTokensGoogle.RUnlock()
		return cacheToken.AccessToken, nil
	}
	cachedTokensGoogle.RUnlock()

	cachedTokensGoogle.Lock()
	cacheToken, found = cachedTokensGoogle.tokenMap[email]
	if found && cacheToken.AccessToken != "" && !cacheToken.Expired() {
		cachedTokensGoogle.Unlock()
		return cacheToken.AccessToken, nil
	}
	defer cachedTokensGoogle.Unlock()

	type GoogleClaims struct {
		Scope string `json:"scope,omitempty"`
		jwt.RegisteredClaims
	}

	now := time.Now()
	claims := &GoogleClaims{
		"https://www.googleapis.com/auth/androidpublisher",
		jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{authUrl},
			ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
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

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	switch resp.StatusCode {
	case 200:
		newToken := accessTokenGoogle{}
		if err := json.Unmarshal(buf, &newToken); err != nil {
			return "", err
		}
		newToken.fetchedAt = time.Now()
		cachedTokensGoogle.tokenMap[email] = &newToken
		return newToken.AccessToken, nil
	default:
		return "", &ValidationError{
			Err:        errors.New("non-200 response from Google auth"),
			StatusCode: resp.StatusCode,
			Payload:    string(buf),
		}
	}
}

// Validate an IAP receipt with the Android Publisher API and the Google credentials.
func ValidateReceiptGoogle(ctx context.Context, httpc *http.Client, clientEmail, privateKey, receipt string) (*ValidateReceiptGoogleResponse, *ReceiptGoogle, []byte, error) {
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
func validateReceiptGoogleWithIDs(ctx context.Context, httpc *http.Client, token, receipt string) (*ValidateReceiptGoogleResponse, *ReceiptGoogle, []byte, error) {
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

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, nil, err
	}

	switch resp.StatusCode {
	case 200:
		out := &ValidateReceiptGoogleResponse{}
		out.PurchaseType = -1 // Set sentinel value as this field is omitted in production, and if set to 0 it means the purchase was done in sandbox env.
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, nil, nil, err
		}

		return out, gr, buf, nil
	default:
		return nil, nil, nil, &ValidationError{
			Err:        ErrNon200ServiceGoogle,
			StatusCode: resp.StatusCode,
			Payload:    string(buf),
		}
	}
}

func ListVoidedReceiptsGoogle(ctx context.Context, httpc *http.Client, clientEmail, privateKey, packageName string) ([]ListVoidedReceiptsGoogleVoidedPurchase, error) {
	if len(clientEmail) < 1 {
		return nil, errors.New("'clientEmail' must not be empty")
	}

	if len(privateKey) < 1 {
		return nil, errors.New("'privateKey' must not be empty")
	}

	token, err := getGoogleAccessToken(ctx, httpc, clientEmail, privateKey)
	if err != nil {
		return nil, err
	}

	return listVoidedReceiptsGoogleWithIDs(ctx, httpc, packageName, token)
}

type listVoidedReceiptsGoogleResponse struct {
	PageInfo        ListVoidedReceiptsGooglePageInfo         `json:"pageInfo"`
	TokenPagination ListVoidedReceiptsGoogleTokenPagination  `json:"tokenPagination"`
	VoidedPurchases []ListVoidedReceiptsGoogleVoidedPurchase `json:"voidedPurchases"`
}

type ListVoidedReceiptsGooglePageInfo struct {
	TotalResults  int `json:"totalResults"`
	ResultPerPage int `json:"resultPerPage"`
	StartIndex    int `json:"startIndex"`
}

type ListVoidedReceiptsGoogleTokenPagination struct {
	NextPageToken     string `json:"nextPageToken"`
	PreviousPageToken string `json:"previousPageToken"`
}

type ListVoidedReceiptsGoogleVoidedPurchase struct {
	Kind               string `json:"kind"`
	PurchaseToken      string `json:"purchaseToken"`
	PurchaseTimeMillis string `json:"purchaseTimeMillis"`
	VoidedTimeMillis   string `json:"voidedTimeMillis"`
	OrderId            string `json:"orderId"`
	VoidedSource       int    `json:"voidedSource"`
	VoidedReason       int    `json:"voidedReason"`
}

func listVoidedReceiptsGoogleWithIDs(ctx context.Context, httpc *http.Client, packageName, token string) ([]ListVoidedReceiptsGoogleVoidedPurchase, error) {
	if len(token) < 1 {
		return nil, errors.New("'token' must not be empty")
	}

	voidedPurchases := make([]ListVoidedReceiptsGoogleVoidedPurchase, 0)
	var nextPageToken string
	for {
		var err error
		var newVoidedPurchases []ListVoidedReceiptsGoogleVoidedPurchase
		newVoidedPurchases, nextPageToken, err = requestVoidedTransactionsGoogle(ctx, httpc, packageName, token, nextPageToken)
		if err != nil {
			return nil, err
		}
		voidedPurchases = append(voidedPurchases, newVoidedPurchases...)

		if nextPageToken == "" {
			break
		}
	}

	return voidedPurchases, nil
}

func requestVoidedTransactionsGoogle(ctx context.Context, httpc *http.Client, packageName, token, nextPageToken string) ([]ListVoidedReceiptsGoogleVoidedPurchase, string, error) {
	u := &url.URL{
		Host:     "androidpublisher.googleapis.com",
		Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/voidedpurchases", packageName),
		RawQuery: fmt.Sprintf("access_token=%s&type=1", token),
		Scheme:   "https",
	}
	if nextPageToken != "" {
		u.RawQuery = fmt.Sprintf("access_token=%s&type=1&pageSelection.token=%s", token, nextPageToken)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := httpc.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	var voidedReceipts []ListVoidedReceiptsGoogleVoidedPurchase
	var pageToken string

	switch resp.StatusCode {
	case 200:
		voidedReceiptsResponse := &listVoidedReceiptsGoogleResponse{}
		if err = json.Unmarshal(buf, &voidedReceiptsResponse); err != nil {
			return nil, "", err
		}
		if voidedReceiptsResponse.VoidedPurchases != nil {
			voidedReceipts = voidedReceiptsResponse.VoidedPurchases
		} else {
			voidedReceipts = make([]ListVoidedReceiptsGoogleVoidedPurchase, 0)
		}
		pageToken = voidedReceiptsResponse.TokenPagination.NextPageToken
	default:
		return nil, "", fmt.Errorf("failed to retrieve Google voided purchases - status: %d, payload: %s", resp.StatusCode, string(buf))
	}

	return voidedReceipts, pageToken, nil
}

// https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions#get
type ValidateSubscriptionReceiptGoogleResponse struct {
	// TODO: add introductoryPriceInfo, cancelSurveyResult and priceChange fields
	Kind                        string `json:"kind"`
	StartTimeMillis             string `json:"startTimeMillis"`
	ExpiryTimeMillis            string `json:"expiryTimeMillis"`
	AutoResumeTimeMillis        string `json:"autoResumeTimeMillis"`
	AutoRenewing                bool   `json:"autoRenewing"`
	PriceCurrencyCode           string `json:"priceCurrencyCode"`
	PriceAmountMicros           string `json:"priceAmountMicros"`
	CountryCode                 string `json:"countryCode"`
	DeveloperPayload            string `json:"developerPayload"`
	PaymentState                int    `json:"paymentState"`
	CancelReason                int    `json:"cancelReason"`
	UserCancellationTimeMillis  string `json:"userCancellationTimeMillis"`
	OrderId                     string `json:"orderId"`
	LinkedPurchaseToken         string `json:"linkedPurchaseToken"`
	PurchaseType                int    `json:"purchaseType"`
	ProfileName                 string `json:"profileName"`
	EmailAddress                string `json:"emailAddress"`
	GivenName                   string `json:"givenName"`
	FamilyName                  string `json:"familyName"`
	ProfileId                   string `json:"profileId"`
	AcknowledgementState        int    `json:"acknowledgementState"`
	ExternalAccountId           string `json:"externalAccountId"`
	PromotionType               int    `json:"promotionType"`
	PromotionCode               string `json:"promotionCode"`
	ObfuscatedExternalAccountId string `json:"obfuscatedExternalAccountId"`
	ObfuscatedExternalProfileId string `json:"obfuscatedExternalProfileId"`
}

// Validate an IAP Subscription receipt with the Android Publisher API and the Google credentials.
func ValidateSubscriptionReceiptGoogle(ctx context.Context, httpc *http.Client, clientEmail string, privateKey string, receipt string) (*ValidateSubscriptionReceiptGoogleResponse, *ReceiptGoogle, []byte, error) {
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

	return ValidateSubscriptionReceiptGoogleWithIDs(ctx, httpc, token, receipt)
}

func ValidateSubscriptionReceiptGoogleWithIDs(ctx context.Context, httpc *http.Client, token, receipt string) (*ValidateSubscriptionReceiptGoogleResponse, *ReceiptGoogle, []byte, error) {
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
		Path:     fmt.Sprintf("androidpublisher/v3/applications/%s/purchases/subscriptions/%s/tokens/%s", gr.PackageName, gr.ProductID, gr.PurchaseToken),
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

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, nil, err
	}

	switch resp.StatusCode {
	case 200:
		out := &ValidateSubscriptionReceiptGoogleResponse{}
		out.PurchaseType = -1 // Set sentinel value as this field is omitted in production, and if set to 0 it means the purchase was done in sandbox env
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, nil, nil, err
		}

		return out, gr, buf, nil
	default:
		return nil, nil, nil, &ValidationError{
			Err:        ErrNon200ServiceGoogle,
			StatusCode: resp.StatusCode,
			Payload:    string(buf),
		}
	}
}

// Huawei

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

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	switch resp.StatusCode {
	case 200:
		var out accessTokenHuawei
		if err := json.Unmarshal(buf, &out); err != nil {
			return "", err
		}
		return out.AccessToken, nil
	default:
		return "", &ValidationError{
			Err:        errors.New("non-200 response from Huawei auth"),
			StatusCode: resp.StatusCode,
			Payload:    string(buf),
		}
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

	buf, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, data, nil, err
	}

	switch res.StatusCode {
	case 200:
		out := &ValidateReceiptHuaweiResponse{}
		if err := json.Unmarshal(buf, &out); err != nil {
			return nil, data, nil, err
		}

		return out, data, buf, nil
	default:
		return nil, nil, nil, &ValidationError{
			Err:        ErrNon200ServiceHuawei,
			StatusCode: res.StatusCode,
			Payload:    string(buf),
		}
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

type FacebookInstantPaymentInfo struct {
	Algorithm         string  `json:"algorithm"`
	AppId             string  `json:"app_id"`
	IsConsumed        bool    `json:"is_consumed"`
	IssuedAt          float64 `json:"issued_at"`
	PaymentActionType string  `json:"payment_action_type"`
	PaymentId         string  `json:"payment_id"`
	ProductId         string  `json:"product_id"`
	PurchasePrice     struct {
		Amount   string `json:"amount"`
		Currency string `json:"currency"`
	} `json:"purchase_price"`
	PurchaseTime  float64 `json:"purchase_time"`
	PurchaseToken string  `json:"purchase_token"`
}

// ValidateReceiptFacebookInstant from: https://developers.facebook.com/docs/games/monetize/in-app-purchases/instant-games#verification
func ValidateReceiptFacebookInstant(appSecret, signedRequest string) (*FacebookInstantPaymentInfo, string, error) {
	parts := strings.Split(signedRequest, ".")
	if len(parts) != 2 {
		return nil, "", errors.New("invalid signedRequest format")
	}

	// Decode the first part (SHA256 hash of the payment information)
	signature, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, "", errors.New("error decoding signedRequest first part:" + err.Error())
	}

	// Compute the HMAC-SHA256 hash of the payload using the app secret
	hmacHash := hmac.New(sha256.New, []byte(appSecret))
	hmacHash.Write([]byte(parts[1]))
	computedSignature := hmacHash.Sum(nil)

	// Compare the computed signature with the received signature
	isValid := hmac.Equal(signature, computedSignature)

	if !isValid {
		return nil, "", errors.New("signedRequest verification failed")
	}

	// Decode the second part (payment information)
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, "", errors.New("error decoding signedRequest second part:" + err.Error())
	}

	// Parse the JSON payment information
	var payment *FacebookInstantPaymentInfo
	if err := json.Unmarshal(payload, &payment); err != nil {
		return nil, "", errors.New("error parsing JSON payload:" + err.Error())
	}

	return payment, string(payload), nil
}
