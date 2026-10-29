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

package apple

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var appleRootPEM = `
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

const Name = "apple"

type Provider struct {
	Config runtime.IAPAppleConfig
	Client *http.Client
}

type appleLegacyPurchase struct {
	TransactionId          string `json:"transaction_id"`
	OriginalTransactionId  string `json:"original_transaction_id"`
	ProductId              string `json:"product_id"`
	ExpiresDateMs          string `json:"expires_date_ms"`
	PurchaseDateMs         string `json:"purchase_date_ms"`
	OriginalPurchaseDateMs string `json:"original_purchase_date_ms"`
}

func (p *Provider) Name() string { return Name }

func (p *Provider) NotificationId() string { return p.Config.GetNotificationsEndpointId() }

func (p *Provider) Code() int { return int(api.StoreProvider_APPLE_APP_STORE) }

func (p *Provider) ValidatePurchase(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderPurchase, error) {
	receipt, _ := payload["receipt"].(string)
	if len(receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	tokens := strings.Split(receipt, ".")
	// Not a JWS: fall back to the deprecated verifyReceipt API.
	if len(tokens) != 3 {
		password := p.Config.GetSharedPassword()
		if override, ok := overrides["shared_password"].(string); ok {
			password = override
		}
		if password == "" {
			return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
		}

		var body bytes.Buffer
		if err := json.NewEncoder(&body).Encode(map[string]any{"receipt-data": receipt, "exclude-old-transactions": true, "password": password}); err != nil {
			return nil, err
		}
		requestBody := body.Bytes()

		var raw []byte
		var validation struct {
			Environment       string                `json:"environment"`
			IsRetryable       bool                  `json:"is-retryable"`
			LatestReceiptInfo []appleLegacyPurchase `json:"latest_receipt_info"`
			Receipt           *struct {
				InApp []appleLegacyPurchase `json:"in_app"`
			} `json:"receipt"`
			Status int `json:"status"`
		}
		// A sandbox receipt sent to production answers 21007 and must be retried against the sandbox.
		for _, verifyURL := range []string{"https://buy.itunes.apple.com/verifyReceipt", "https://sandbox.itunes.apple.com/verifyReceipt"} {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, verifyURL, bytes.NewReader(requestBody))
			if err != nil {
				return nil, err
			}
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
			resp, err := p.Client.Do(req)
			if err != nil {
				return nil, err
			}
			raw, err = io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				return nil, err
			}
			if resp.StatusCode != http.StatusOK {
				return nil, fmt.Errorf("non-200 response from Apple service, status=%d, payload=%s", resp.StatusCode, raw)
			}
			if err := json.Unmarshal(raw, &validation); err != nil {
				return nil, err
			}
			if validation.Status != 21007 {
				break
			}
		}

		if validation.Status != 0 {
			if validation.IsRetryable {
				return nil, status.Error(codes.Unavailable, "Apple IAP verification is currently unavailable. Try again later.")
			}
			return nil, status.Errorf(codes.FailedPrecondition, "Invalid Receipt. Status: %d", validation.Status)
		}

		environment := api.StoreEnvironment_PRODUCTION
		if validation.Environment == "Sandbox" {
			environment = api.StoreEnvironment_SANDBOX
		}
		sort.Slice(validation.LatestReceiptInfo, func(i, j int) bool {
			return sort.StringsAreSorted([]string{validation.LatestReceiptInfo[j].ExpiresDateMs, validation.LatestReceiptInfo[i].ExpiresDateMs})
		})
		// latest_receipt_info can hold purchases missing from in_app: https://developer.apple.com/forums/thread/63092
		var legacyPurchases []appleLegacyPurchase
		if validation.Receipt != nil {
			legacyPurchases = append(legacyPurchases, validation.Receipt.InApp...)
		}
		legacyPurchases = append(legacyPurchases, validation.LatestReceiptInfo...)

		purchases := make([]*runtime.IAPProviderPurchase, 0, len(legacyPurchases))
		seenTransactionIDs := make(map[string]struct{}, len(legacyPurchases))
		for _, purchase := range legacyPurchases {
			if purchase.ExpiresDateMs != "" {
				continue
			}
			if _, seen := seenTransactionIDs[purchase.TransactionId]; seen {
				continue
			}
			purchaseTime, err := strconv.ParseInt(purchase.PurchaseDateMs, 10, 64)
			if err != nil {
				return nil, err
			}
			seenTransactionIDs[purchase.TransactionId] = struct{}{}
			purchases = append(purchases, &runtime.IAPProviderPurchase{
				TransactionId: purchase.TransactionId,
				ProductId:     purchase.ProductId,
				PurchaseTime:  time.Unix(0, 0).Add(time.Duration(purchaseTime) * time.Millisecond),
				Environment:   environment,
				RawResponse:   string(raw),
			})
		}
		if len(purchases) == 0 && len(legacyPurchases) > 0 {
			return nil, status.Error(codes.FailedPrecondition, "Subscription Receipt. Use the appropriate function instead.")
		}

		return purchases, nil
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(tokens[0])
	if err != nil {
		return nil, err
	}
	var header struct {
		X5c []string `json:"x5c"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, err
	}
	if len(header.X5c) < 3 {
		return nil, errors.New("invalid jws header: x5c field must contain at least 3 certificates")
	}
	certs := make([]*x509.Certificate, 0, len(header.X5c))
	for _, encodedCert := range header.X5c[:3] {
		der, err := base64.StdEncoding.DecodeString(encodedCert)
		if err != nil {
			return nil, err
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}
		certs = append(certs, cert)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(appleRootPEM))
	intermediates := x509.NewCertPool()
	intermediates.AddCert(certs[1])
	if _, err := certs[0].Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates}); err != nil {
		return nil, err
	}
	// Apple's root also issues certificates that have nothing to do with the App Store, so require the
	// markers Apple puts on the receipt signing chain.
	intermediateMarked := false
	for _, extension := range certs[1].Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}) {
			intermediateMarked = true
		}
	}
	if !intermediateMarked {
		return nil, errors.New("invalid jws certificate chain: intermediate is not an Apple WWDR certificate")
	}
	leafMarked := false
	for _, extension := range certs[0].Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 11, 1}) {
			leafMarked = true
		}
	}
	if !leafMarked {
		return nil, errors.New("invalid jws certificate chain: leaf is not an App Store receipt signing certificate")
	}
	leafKey, ok := certs[0].PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("failed to parse leaf certificate public key")
	}
	signature, err := base64.RawURLEncoding.DecodeString(tokens[2])
	if err != nil {
		return nil, fmt.Errorf("failed to decode jws signature: %s", err.Error())
	}
	if len(signature) != 64 {
		return nil, fmt.Errorf("invalid jws signature: invalid length %d, expected 64", len(signature))
	}
	hash := sha256.Sum256([]byte(tokens[0] + "." + tokens[1]))
	if !ecdsa.Verify(leafKey, hash[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		return nil, errors.New("invalid jws signature: ecdsa verification failed")
	}

	jsonPayload, err := base64.RawURLEncoding.DecodeString(tokens[1])
	if err != nil {
		return nil, err
	}
	var transactionInfo *runtime.AppleNotificationTransactionInfo
	if err := json.Unmarshal(jsonPayload, &transactionInfo); err != nil {
		return nil, err
	}
	if transactionInfo.ExpiresDate != 0 {
		return nil, status.Error(codes.FailedPrecondition, "Subscription Receipt. Use the appropriate function instead.")
	}

	environment := api.StoreEnvironment_PRODUCTION
	if transactionInfo.Environment == "Sandbox" {
		environment = api.StoreEnvironment_SANDBOX
	}
	rawResponse, err := json.Marshal(map[string]string{"jws": receipt})
	if err != nil {
		return nil, status.Error(codes.Internal, "Error validating Apple JWS receipt")
	}

	return []*runtime.IAPProviderPurchase{{
		TransactionId: transactionInfo.TransactionId,
		ProductId:     transactionInfo.ProductId,
		PurchaseTime:  time.Unix(0, 0).Add(time.Duration(transactionInfo.PurchaseDate) * time.Millisecond),
		RefundTime:    time.Unix(0, 0).Add(time.Duration(transactionInfo.RevocationDate) * time.Millisecond),
		Environment:   environment,
		RawResponse:   string(rawResponse),
	}}, nil
}

func (p *Provider) ValidateSubscription(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload map[string]any, overrides map[string]any) ([]*runtime.IAPProviderSubscription, error) {
	password := p.Config.GetSharedPassword()
	if override, ok := overrides["shared_password"].(string); ok {
		password = override
	}
	if password == "" {
		return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	}
	receipt, _ := payload["receipt"].(string)
	if len(receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	tokens := strings.Split(receipt, ".")
	// Not a JWS: fall back to the deprecated verifyReceipt API.
	if len(tokens) != 3 {
		var body bytes.Buffer
		if err := json.NewEncoder(&body).Encode(map[string]any{"receipt-data": receipt, "exclude-old-transactions": true, "password": password}); err != nil {
			return nil, err
		}
		requestBody := body.Bytes()

		var raw []byte
		var validation struct {
			Environment       string                `json:"environment"`
			IsRetryable       bool                  `json:"is-retryable"`
			LatestReceiptInfo []appleLegacyPurchase `json:"latest_receipt_info"`
			Status            int                   `json:"status"`
		}
		// A sandbox receipt sent to production answers 21007 and must be retried against the sandbox.
		for _, verifyURL := range []string{"https://buy.itunes.apple.com/verifyReceipt", "https://sandbox.itunes.apple.com/verifyReceipt"} {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, verifyURL, bytes.NewReader(requestBody))
			if err != nil {
				return nil, err
			}
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
			resp, err := p.Client.Do(req)
			if err != nil {
				return nil, err
			}
			raw, err = io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				return nil, err
			}
			if resp.StatusCode != http.StatusOK {
				return nil, fmt.Errorf("non-200 response from Apple service, status=%d, payload=%s", resp.StatusCode, raw)
			}
			if err := json.Unmarshal(raw, &validation); err != nil {
				return nil, err
			}
			if validation.Status != 21007 {
				break
			}
		}

		if validation.Status != 0 {
			if validation.IsRetryable {
				return nil, status.Error(codes.Unavailable, "Apple IAP verification is currently unavailable. Try again later.")
			}
			return nil, status.Errorf(codes.FailedPrecondition, "Invalid Receipt. Status: %d", validation.Status)
		}

		environment := api.StoreEnvironment_PRODUCTION
		if validation.Environment == "Sandbox" {
			environment = api.StoreEnvironment_SANDBOX
		}
		sort.Slice(validation.LatestReceiptInfo, func(i, j int) bool {
			return sort.StringsAreSorted([]string{validation.LatestReceiptInfo[j].ExpiresDateMs, validation.LatestReceiptInfo[i].ExpiresDateMs})
		})

		subscriptions := make([]*runtime.IAPProviderSubscription, 0, len(validation.LatestReceiptInfo))
		for _, latest := range validation.LatestReceiptInfo {
			if latest.ExpiresDateMs == "" {
				continue
			}
			purchaseTime, err := strconv.ParseInt(latest.OriginalPurchaseDateMs, 10, 64)
			if err != nil {
				return nil, err
			}
			expiryTime, err := strconv.ParseInt(latest.ExpiresDateMs, 10, 64)
			if err != nil {
				return nil, err
			}
			subscriptions = append(subscriptions, &runtime.IAPProviderSubscription{
				OriginalTransactionId: latest.OriginalTransactionId,
				ProductId:             latest.ProductId,
				PurchaseTime:          time.Unix(0, 0).Add(time.Duration(purchaseTime) * time.Millisecond),
				ExpiryTime:            time.Unix(0, 0).Add(time.Duration(expiryTime) * time.Millisecond),
				Environment:           environment,
				RawResponse:           string(raw),
			})
		}
		if len(subscriptions) == 0 {
			return nil, status.Error(codes.FailedPrecondition, "Purchase Receipt. Use the appropriate function instead.")
		}

		return subscriptions, nil
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(tokens[0])
	if err != nil {
		return nil, err
	}
	var header struct {
		X5c []string `json:"x5c"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, err
	}
	if len(header.X5c) < 3 {
		return nil, errors.New("invalid jws header: x5c field must contain at least 3 certificates")
	}
	certs := make([]*x509.Certificate, 0, len(header.X5c))
	for _, encodedCert := range header.X5c[:3] {
		der, err := base64.StdEncoding.DecodeString(encodedCert)
		if err != nil {
			return nil, err
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}
		certs = append(certs, cert)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(appleRootPEM))
	intermediates := x509.NewCertPool()
	intermediates.AddCert(certs[1])
	if _, err := certs[0].Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates}); err != nil {
		return nil, err
	}
	intermediateMarked := false
	for _, extension := range certs[1].Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}) {
			intermediateMarked = true
		}
	}
	if !intermediateMarked {
		return nil, errors.New("invalid jws certificate chain: intermediate is not an Apple WWDR certificate")
	}
	leafMarked := false
	for _, extension := range certs[0].Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 11, 1}) {
			leafMarked = true
		}
	}
	if !leafMarked {
		return nil, errors.New("invalid jws certificate chain: leaf is not an App Store receipt signing certificate")
	}
	leafKey, ok := certs[0].PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("failed to parse leaf certificate public key")
	}
	signature, err := base64.RawURLEncoding.DecodeString(tokens[2])
	if err != nil {
		return nil, fmt.Errorf("failed to decode jws signature: %s", err.Error())
	}
	if len(signature) != 64 {
		return nil, fmt.Errorf("invalid jws signature: invalid length %d, expected 64", len(signature))
	}
	hash := sha256.Sum256([]byte(tokens[0] + "." + tokens[1]))
	if !ecdsa.Verify(leafKey, hash[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		return nil, errors.New("invalid jws signature: ecdsa verification failed")
	}

	jsonPayload, err := base64.RawURLEncoding.DecodeString(tokens[1])
	if err != nil {
		return nil, err
	}
	var transactionInfo *runtime.AppleNotificationTransactionInfo
	if err := json.Unmarshal(jsonPayload, &transactionInfo); err != nil {
		return nil, err
	}
	if transactionInfo.ExpiresDate == 0 {
		return nil, status.Error(codes.FailedPrecondition, "Purchase Receipt. Use the appropriate function instead.")
	}

	environment := api.StoreEnvironment_PRODUCTION
	if transactionInfo.Environment == "Sandbox" {
		environment = api.StoreEnvironment_SANDBOX
	}
	rawResponse, err := json.Marshal(map[string]string{"jws": receipt})
	if err != nil {
		return nil, status.Error(codes.Internal, "Error validating Apple JWS receipt")
	}

	return []*runtime.IAPProviderSubscription{{
		OriginalTransactionId: transactionInfo.OriginalTransactionId,
		ProductId:             transactionInfo.ProductId,
		PurchaseTime:          time.Unix(0, 0).Add(time.Duration(transactionInfo.OriginalPurchaseDate) * time.Millisecond),
		ExpiryTime:            time.Unix(0, 0).Add(time.Duration(transactionInfo.ExpiresDate) * time.Millisecond),
		RefundTime:            time.Unix(0, 0).Add(time.Duration(transactionInfo.RevocationDate) * time.Millisecond),
		Environment:           environment,
		RawResponse:           string(rawResponse),
	}}, nil
}

func (p *Provider) HandleNotification(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, body []byte, headers, query map[string][]string) ([]*runtime.IAPProviderNotification, error) {
	var signed struct {
		SignedPayload string `json:"signedPayload"`
	}
	if err := json.Unmarshal(body, &signed); err != nil {
		return nil, err
	}

	tokens := strings.Split(signed.SignedPayload, ".")
	if len(tokens) != 3 {
		return nil, fmt.Errorf("failed to validate apple jws header: invalid jws format: expected 3 parts, got %d", len(tokens))
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(tokens[0])
	if err != nil {
		return nil, err
	}
	var header struct {
		X5c []string `json:"x5c"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, err
	}
	if len(header.X5c) < 3 {
		return nil, errors.New("failed to validate apple jws header: x5c field must contain at least 3 certificates")
	}
	certs := make([]*x509.Certificate, 0, len(header.X5c))
	for _, encodedCert := range header.X5c[:3] {
		der, err := base64.StdEncoding.DecodeString(encodedCert)
		if err != nil {
			return nil, err
		}
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}
		certs = append(certs, cert)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(appleRootPEM))
	intermediates := x509.NewCertPool()
	intermediates.AddCert(certs[1])
	if _, err := certs[0].Verify(x509.VerifyOptions{Roots: roots, Intermediates: intermediates}); err != nil {
		return nil, err
	}
	intermediateMarked := false
	for _, extension := range certs[1].Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 2, 1}) {
			intermediateMarked = true
		}
	}
	if !intermediateMarked {
		return nil, errors.New("invalid jws certificate chain: intermediate is not an Apple WWDR certificate")
	}
	leafMarked := false
	for _, extension := range certs[0].Extensions {
		if extension.Id.Equal(asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 6, 11, 1}) {
			leafMarked = true
		}
	}
	if !leafMarked {
		return nil, errors.New("invalid jws certificate chain: leaf is not an App Store receipt signing certificate")
	}
	leafKey, ok := certs[0].PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, errors.New("failed to parse leaf certificate public key")
	}
	signature, err := base64.RawURLEncoding.DecodeString(tokens[2])
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(tokens[0] + "." + tokens[1]))
	if len(signature) != 64 || !ecdsa.Verify(leafKey, hash[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		return nil, errors.New("invalid jws signature: ecdsa verification failed")
	}

	jsonPayload, err := base64.RawURLEncoding.DecodeString(tokens[1])
	if err != nil {
		return nil, err
	}
	var notification struct {
		NotificationType string                         `json:"notificationType"`
		Subtype          string                         `json:"subtype"`
		Data             *runtime.AppleNotificationData `json:"data"`
	}
	if err := json.Unmarshal(jsonPayload, &notification); err != nil {
		return nil, err
	}
	if notification.Data == nil {
		notification.Data = &runtime.AppleNotificationData{}
	}
	var transactionInfo *runtime.AppleNotificationTransactionInfo
	if notification.Data.SignedTransactionInfo != "" {
		tokens = strings.Split(notification.Data.SignedTransactionInfo, ".")
		if len(tokens) < 3 {
			return nil, fmt.Errorf("unexpected apple signedTransactionInfo jws length: %d", len(tokens))
		}
		jsonPayload, err = base64.RawURLEncoding.DecodeString(tokens[1])
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(jsonPayload, &transactionInfo); err != nil {
			return nil, err
		}
	}
	var renewalInfo *runtime.AppleNotificationRenewalInfo
	if notification.Data.SignedRenewalInfo != "" {
		tokens = strings.Split(notification.Data.SignedRenewalInfo, ".")
		if len(tokens) < 3 {
			return nil, fmt.Errorf("unexpected apple signedRenewalInfo jws length: %d", len(tokens))
		}
		jsonPayload, err = base64.RawURLEncoding.DecodeString(tokens[1])
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(jsonPayload, &renewalInfo); err != nil {
			return nil, err
		}
	}
	notification.Data.TransactionInfo = transactionInfo
	notification.Data.RenewalInfo = renewalInfo

	switch notificationType := strings.ToUpper(notification.NotificationType); notificationType {
	case "DID_RENEW", "SUBSCRIBED", "DID_CHANGE_RENEWAL_PREF", "OFFER_REDEEMED":
		if transactionInfo == nil {
			return nil, fmt.Errorf("no transaction info for apple notification type %s", notificationType)
		}
		environment := api.StoreEnvironment_PRODUCTION
		if transactionInfo.Environment == "Sandbox" {
			environment = api.StoreEnvironment_SANDBOX
		}
		productID := transactionInfo.ProductId
		switch notification.Subtype {
		case "UPGRADE", "DOWNGRADE":
			if renewalInfo != nil {
				productID = renewalInfo.AutoRenewProductId
			} else {
				logger.WithField("notification_subtype", notification.Subtype).Warn("No renewal info for Apple IAP subscription plan change notification")
			}
		}
		notificationKind := runtime.IAPNotificationSubscribed
		if notificationType == "DID_RENEW" {
			notificationKind = runtime.IAPNotificationRenewed
		}

		return []*runtime.IAPProviderNotification{{
			Type:        notificationKind,
			UserId:      transactionInfo.AppAccountToken,
			RequireUser: true,
			Subscription: &runtime.IAPProviderSubscription{
				OriginalTransactionId: transactionInfo.OriginalTransactionId,
				ProductId:             productID,
				PurchaseTime:          time.Unix(0, 0).Add(time.Duration(transactionInfo.OriginalPurchaseDate) * time.Millisecond),
				ExpiryTime:            time.Unix(0, 0).Add(time.Duration(transactionInfo.ExpiresDate) * time.Millisecond),
				RefundTime:            time.Unix(0, 0).Add(time.Duration(transactionInfo.RevocationDate) * time.Millisecond),
				Environment:           environment,
			},
		}}, nil

	case "EXPIRED", "DID_CHANGE_RENEWAL_STATUS", "GRACE_PERIOD_EXPIRED", "REVOKED":
		if renewalInfo == nil {
			return nil, fmt.Errorf("no renewal info for apple notification type %s", notificationType)
		}
		environment := api.StoreEnvironment_PRODUCTION
		if renewalInfo.Environment == "Sandbox" {
			environment = api.StoreEnvironment_SANDBOX
		}
		expiryTime := time.Unix(0, 0).Add(time.Duration(renewalInfo.RenewalDate) * time.Millisecond)
		graceExpiryTime := time.Unix(0, 0).Add(time.Duration(renewalInfo.GracePeriodExpiresDate) * time.Millisecond)
		if graceExpiryTime.After(expiryTime) {
			expiryTime = graceExpiryTime
		}
		notificationKind := runtime.IAPNotificationExpired
		if notificationType == "DID_CHANGE_RENEWAL_STATUS" {
			// The built-in handler stores AUTO_RENEW_ENABLED but fires no hook; a zero type keeps that.
			notificationKind = 0
			if notification.Subtype == "AUTO_RENEW_DISABLED" {
				notificationKind = runtime.IAPNotificationCancelled
			}
		}

		return []*runtime.IAPProviderNotification{{
			Type:   notificationKind,
			UserId: renewalInfo.AppAccountToken,
			Subscription: &runtime.IAPProviderSubscription{
				OriginalTransactionId: renewalInfo.OriginalTransactionId,
				ProductId:             renewalInfo.ProductId,
				ExpiryTime:            expiryTime,
				Environment:           environment,
			},
		}}, nil

	case "REFUND":
		if transactionInfo == nil {
			return nil, errors.New("no transaction info for apple refund notification")
		}
		environment := api.StoreEnvironment_PRODUCTION
		if transactionInfo.Environment == "Sandbox" {
			environment = api.StoreEnvironment_SANDBOX
		}
		if transactionInfo.ExpiresDate != 0 {
			return []*runtime.IAPProviderNotification{{
				Type:   runtime.IAPNotificationRefunded,
				UserId: transactionInfo.AppAccountToken,
				Subscription: &runtime.IAPProviderSubscription{
					OriginalTransactionId: transactionInfo.OriginalTransactionId,
					ProductId:             transactionInfo.ProductId,
					PurchaseTime:          time.Unix(0, 0).Add(time.Duration(transactionInfo.OriginalPurchaseDate) * time.Millisecond),
					ExpiryTime:            time.Unix(0, 0).Add(time.Duration(transactionInfo.ExpiresDate) * time.Millisecond),
					RefundTime:            time.Unix(0, 0).Add(time.Duration(transactionInfo.RevocationDate) * time.Millisecond),
					Environment:           environment,
				},
			}}, nil
		}

		return []*runtime.IAPProviderNotification{{
			Type:   runtime.IAPNotificationRefunded,
			UserId: transactionInfo.AppAccountToken,
			Purchase: &runtime.IAPProviderPurchase{
				TransactionId: transactionInfo.TransactionId,
				ProductId:     transactionInfo.ProductId,
				PurchaseTime:  time.Unix(0, 0).Add(time.Duration(transactionInfo.PurchaseDate) * time.Millisecond),
				RefundTime:    time.Unix(0, 0).Add(time.Duration(transactionInfo.RevocationDate) * time.Millisecond),
				Environment:   environment,
			},
		}}, nil
	}

	return nil, nil
}
