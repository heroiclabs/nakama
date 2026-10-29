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
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sort"
	"strings"
)

const AppleRootPEM = `
-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`

const (
	AppleReceiptValidationUrlSandbox    = "https://sandbox.itunes.apple.com/verifyReceipt"
	AppleReceiptValidationUrlProduction = "https://buy.itunes.apple.com/verifyReceipt"
)

const (
	AppleReceiptIsValid           = 0
	AppleReceiptIsFromTestSandbox = 21007 // Receipt from test env was sent to prod. Should retry against the sandbox env.
)

const (
	AppleSandboxEnvironment    = "Sandbox"
	AppleProductionEnvironment = "Production"
)

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
	ErrNon200ServiceApple = errors.New("non-200 response from Apple service")
)

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
func ValidateLegacyReceiptApple(ctx context.Context, httpc *http.Client, password, receipt string) (*ValidateReceiptAppleResponse, []byte, error) {
	resp, raw, err := ValidateLegacyReceiptAppleWithUrl(ctx, httpc, AppleReceiptValidationUrlProduction, receipt, password)
	if err != nil {
		return nil, nil, err
	}

	switch resp.Status {
	case AppleReceiptIsFromTestSandbox:
		// Receipt should be checked with the Apple sandbox.
		return ValidateLegacyReceiptAppleWithUrl(ctx, httpc, AppleReceiptValidationUrlSandbox, receipt, password)
	}

	return resp, raw, nil
}

// Validate an IAP receipt with Apple against the specified URL.
func ValidateLegacyReceiptAppleWithUrl(ctx context.Context, httpc *http.Client, url, receipt, password string) (*ValidateReceiptAppleResponse, []byte, error) {
	if len(url) < 1 {
		return nil, nil, errors.New("'url' must not be empty")
	}

	if len(receipt) < 1 {
		return nil, nil, errors.New("'receipt' must not be empty")
	}

	if len(password) < 1 {
		return nil, nil, errors.New("'password' must not be empty")
	}

	payload := map[string]any{
		"receipt-data":             receipt,
		"exclude-old-transactions": true,
		"password":                 password,
	}

	var w bytes.Buffer
	if err := json.NewEncoder(&w).Encode(&payload); err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &w)
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

		return &out, buf, nil
	default:
		return nil, nil, &ValidationError{
			Err:        ErrNon200ServiceApple,
			StatusCode: resp.StatusCode,
			Payload:    string(buf),
		}
	}
}

func ValidateAppleJwsSignature(receipt string) error {
	jwsTokens := strings.Split(receipt, ".")
	if len(jwsTokens) != 3 {
		return fmt.Errorf("invalid jws format: expected 3 parts, got %d", len(jwsTokens))
	}
	header := jwsTokens[0]
	payload := jwsTokens[1]
	signature := jwsTokens[2]

	headerByte, err := base64.RawURLEncoding.DecodeString(header)
	if err != nil {
		return err
	}

	type Header struct {
		Alg string   `json:"alg"`
		X5c []string `json:"x5c"`
	}
	var jwsHeader Header
	if err = json.Unmarshal(headerByte, &jwsHeader); err != nil {
		return err
	}

	if len(jwsHeader.X5c) < 3 {
		return fmt.Errorf("invalid jws header: x5c field must contain at least 3 certificates")
	}

	certs := make([][]byte, 0)
	for _, encodedCert := range jwsHeader.X5c {
		cert, err := base64.StdEncoding.DecodeString(encodedCert)
		if err != nil {
			return err
		}
		certs = append(certs, cert)
	}

	rootCert := x509.NewCertPool()
	ok := rootCert.AppendCertsFromPEM([]byte(AppleRootPEM))
	if !ok {
		return errors.New("failed to parse AppleRootPEM")
	}

	leafCert, err := x509.ParseCertificate(certs[0])
	if err != nil {
		return err
	}

	interCert, err := x509.ParseCertificate(certs[1])
	if err != nil {
		return err
	}
	intermediates := x509.NewCertPool()
	intermediates.AddCert(interCert)

	_, err = x509.ParseCertificate(certs[2])
	if err != nil {
		return err
	}

	opts := x509.VerifyOptions{
		Roots:         rootCert,
		Intermediates: intermediates,
	}

	_, err = leafCert.Verify(opts)
	if err != nil {
		return err
	}

	leafCertRsaPubKey, ok := leafCert.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return fmt.Errorf("failed to parse leaf certificate public key")
	}

	signingInput := []byte(fmt.Sprintf("%s.%s", header, payload))
	hash := sha256.Sum256(signingInput)

	sigBytes, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("failed to decode jws signature: %w", err)
	}

	if len(sigBytes) != 64 {
		return fmt.Errorf("invalid jws signature: invalid length %d, expected 64", len(sigBytes))
	}

	r := new(big.Int).SetBytes(sigBytes[:32])
	s := new(big.Int).SetBytes(sigBytes[32:])

	if !ecdsa.Verify(leafCertRsaPubKey, hash[:], r, s) {
		return errors.New("invalid jws signature: ecdsa verification failed")
	}

	return nil
}
