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
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestValidateJWSApple_InvalidFormat(t *testing.T) {
	tests := []struct {
		name string
		jws  string
	}{
		{"empty string", ""},
		{"no dots", "nodots"},
		{"one dot", "one.dot"},
		{"too many dots", "one.two.three.four"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := ValidateJWSApple(tt.jws)
			if err == nil {
				t.Error("expected error for invalid format, got nil")
			}
			if !strings.Contains(err.Error(), "invalid JWS format") {
				t.Errorf("expected 'invalid JWS format' error, got: %v", err)
			}
		})
	}
}

func TestValidateJWSApple_InvalidHeader(t *testing.T) {
	tests := []struct {
		name   string
		header string
	}{
		{"invalid base64", "not-valid-base64!!!"},
		{"valid base64 but not json", base64.RawURLEncoding.EncodeToString([]byte("not json"))},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jws := tt.header + ".payload.signature"
			_, _, err := ValidateJWSApple(jws)
			if err == nil {
				t.Error("expected error for invalid header, got nil")
			}
		})
	}
}

func TestValidateJWSApple_InvalidAlgorithm(t *testing.T) {
	// Create header with wrong algorithm
	header := jwsHeader{Alg: "RS256", X5c: []string{}}
	headerBytes, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	jws := headerB64 + ".payload.signature"
	_, _, err := ValidateJWSApple(jws)

	if err == nil {
		t.Error("expected error for invalid algorithm, got nil")
	}
	if err != ErrJWSInvalidAlgorithm {
		t.Errorf("expected ErrJWSInvalidAlgorithm, got: %v", err)
	}
}

func TestValidateJWSApple_InsufficientCertificates(t *testing.T) {
	// Create header with ES256 but only 1 certificate
	header := jwsHeader{
		Alg: "ES256",
		X5c: []string{"c29tZWNlcnQ="}, // "somecert" in base64
	}
	headerBytes, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	jws := headerB64 + ".payload.signature"
	_, _, err := ValidateJWSApple(jws)

	if err == nil {
		t.Error("expected error for insufficient certificates, got nil")
	}
	if !strings.Contains(err.Error(), "expected at least 2 certificates") {
		t.Errorf("expected certificate count error, got: %v", err)
	}
}

func TestValidateJWSApple_InvalidCertificateEncoding(t *testing.T) {
	// Create header with invalid certificate encoding
	header := jwsHeader{
		Alg: "ES256",
		X5c: []string{"not-valid-base64!!!", "also-invalid!!!"},
	}
	headerBytes, _ := json.Marshal(header)
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	jws := headerB64 + ".payload.signature"
	_, _, err := ValidateJWSApple(jws)

	if err == nil {
		t.Error("expected error for invalid certificate encoding, got nil")
	}
}

func TestValidateJWSApple_InvalidSignatureLength(t *testing.T) {
	// This test verifies signature length validation
	// We need to create a JWS that passes header/cert validation but has wrong signature length
	// For unit testing, we can test the verifyES256Signature function directly

	// Generate a test key
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	// Test with wrong signature length
	signingInput := []byte("test.payload")
	wrongSig := []byte("tooshort")

	err = verifyES256Signature(&privateKey.PublicKey, signingInput, wrongSig)
	if err == nil {
		t.Error("expected error for invalid signature length, got nil")
	}
	if !strings.Contains(err.Error(), "invalid signature length") {
		t.Errorf("expected signature length error, got: %v", err)
	}
}

func TestVerifyES256Signature_Valid(t *testing.T) {
	// Generate a test key pair
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	// Create signing input
	signingInput := []byte("header.payload")

	// Sign the input
	hash := sha256.Sum256(signingInput)
	r, s, err := ecdsa.Sign(rand.Reader, privateKey, hash[:])
	if err != nil {
		t.Fatalf("failed to sign: %v", err)
	}

	// Create signature in JWS format (r || s, each padded to 32 bytes)
	signature := make([]byte, 64)
	rBytes := r.Bytes()
	sBytes := s.Bytes()
	copy(signature[32-len(rBytes):32], rBytes)
	copy(signature[64-len(sBytes):64], sBytes)

	// Verify
	err = verifyES256Signature(&privateKey.PublicKey, signingInput, signature)
	if err != nil {
		t.Errorf("expected valid signature to verify, got error: %v", err)
	}
}

func TestVerifyES256Signature_Invalid(t *testing.T) {
	// Generate a test key pair
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	// Create a valid-looking but wrong signature
	wrongSig := make([]byte, 64)
	rand.Read(wrongSig)

	signingInput := []byte("header.payload")

	err = verifyES256Signature(&privateKey.PublicKey, signingInput, wrongSig)
	if err != ErrJWSSignatureInvalid {
		t.Errorf("expected ErrJWSSignatureInvalid, got: %v", err)
	}
}

func TestJWSTransactionDecodedPayload_Parsing(t *testing.T) {
	// Test that we can parse a valid payload JSON
	payloadJSON := `{
		"transactionId": "123456789",
		"originalTransactionId": "123456789",
		"bundleId": "com.example.app",
		"productId": "com.example.product",
		"purchaseDate": 1704067200000,
		"originalPurchaseDate": 1704067200000,
		"quantity": 1,
		"type": "Consumable",
		"inAppOwnershipType": "PURCHASED",
		"signedDate": 1704067200000,
		"environment": "Sandbox",
		"storefront": "USA",
		"storefrontId": "143441",
		"currency": "USD",
		"price": 99
	}`

	var payload JWSTransactionDecodedPayload
	err := json.Unmarshal([]byte(payloadJSON), &payload)
	if err != nil {
		t.Fatalf("failed to parse payload: %v", err)
	}

	if payload.TransactionId != "123456789" {
		t.Errorf("expected transactionId '123456789', got '%s'", payload.TransactionId)
	}
	if payload.BundleId != "com.example.app" {
		t.Errorf("expected bundleId 'com.example.app', got '%s'", payload.BundleId)
	}
	if payload.ProductId != "com.example.product" {
		t.Errorf("expected productId 'com.example.product', got '%s'", payload.ProductId)
	}
	if payload.Type != "Consumable" {
		t.Errorf("expected type 'Consumable', got '%s'", payload.Type)
	}
	if payload.Environment != "Sandbox" {
		t.Errorf("expected environment 'Sandbox', got '%s'", payload.Environment)
	}
	if payload.Price != 99 {
		t.Errorf("expected price 99, got %d", payload.Price)
	}
}

func TestJWSTransactionDecodedPayload_SubscriptionFields(t *testing.T) {
	// Test subscription-specific fields
	payloadJSON := `{
		"transactionId": "123456789",
		"originalTransactionId": "123456789",
		"bundleId": "com.example.app",
		"productId": "com.example.subscription",
		"subscriptionGroupIdentifier": "12345",
		"purchaseDate": 1704067200000,
		"originalPurchaseDate": 1704067200000,
		"expiresDate": 1706745600000,
		"quantity": 1,
		"type": "Auto-Renewable Subscription",
		"inAppOwnershipType": "PURCHASED",
		"signedDate": 1704067200000,
		"environment": "Production"
	}`

	var payload JWSTransactionDecodedPayload
	err := json.Unmarshal([]byte(payloadJSON), &payload)
	if err != nil {
		t.Fatalf("failed to parse subscription payload: %v", err)
	}

	if payload.SubscriptionGroupId != "12345" {
		t.Errorf("expected subscriptionGroupIdentifier '12345', got '%s'", payload.SubscriptionGroupId)
	}
	if payload.ExpiresDate != 1706745600000 {
		t.Errorf("expected expiresDate 1706745600000, got %d", payload.ExpiresDate)
	}
	if payload.Type != "Auto-Renewable Subscription" {
		t.Errorf("expected type 'Auto-Renewable Subscription', got '%s'", payload.Type)
	}
}

func TestAppleRootCAG3_Valid(t *testing.T) {
	// Verify that the embedded Apple Root CA G3 is valid
	cert, err := x509.ParseCertificate(AppleRootCAG3)
	if err != nil {
		t.Fatalf("failed to parse embedded Apple Root CA G3: %v", err)
	}

	if cert.Subject.CommonName != "Apple Root CA - G3" {
		t.Errorf("expected CN 'Apple Root CA - G3', got '%s'", cert.Subject.CommonName)
	}

	if cert.Subject.Organization[0] != "Apple Inc." {
		t.Errorf("expected Organization 'Apple Inc.', got '%s'", cert.Subject.Organization[0])
	}

	// Verify it's a CA certificate
	if !cert.IsCA {
		t.Error("expected Apple Root CA G3 to be a CA certificate")
	}

	// Check validity period (Apple Root CA G3 is valid until 2039)
	if time.Now().After(cert.NotAfter) {
		t.Errorf("Apple Root CA G3 has expired: %v", cert.NotAfter)
	}
}

// Helper function to create a self-signed certificate for testing
func createTestCertificate(t *testing.T, isCA bool, parent *x509.Certificate, parentKey *ecdsa.PrivateKey) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject: pkix.Name{
			Organization: []string{"Test Org"},
			CommonName:   "Test Certificate",
		},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour * 24),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
		BasicConstraintsValid: true,
		IsCA:                  isCA,
	}

	if isCA {
		template.KeyUsage |= x509.KeyUsageCertSign
	}

	signingKey := privateKey
	signingCert := template
	if parent != nil && parentKey != nil {
		signingKey = parentKey
		signingCert = parent
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, signingCert, &privateKey.PublicKey, signingKey)
	if err != nil {
		t.Fatalf("failed to create certificate: %v", err)
	}

	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		t.Fatalf("failed to parse created certificate: %v", err)
	}

	return cert, privateKey
}

func TestValidateCertChain_NotTrustedByApple(t *testing.T) {
	// Create a self-signed certificate chain (not signed by Apple)
	rootCert, rootKey := createTestCertificate(t, true, nil, nil)
	leafCert, _ := createTestCertificate(t, false, rootCert, rootKey)

	// Encode certificates
	x5c := []string{
		base64.StdEncoding.EncodeToString(leafCert.Raw),
		base64.StdEncoding.EncodeToString(rootCert.Raw),
	}

	_, err := validateAppleCertChain(x5c)
	if err == nil {
		t.Error("expected error for non-Apple certificate chain, got nil")
	}
	// Should fail because it's not signed by Apple Root CA
	if !strings.Contains(err.Error(), "not signed by Apple") && !strings.Contains(err.Error(), "certificate signed by unknown authority") {
		t.Errorf("expected Apple trust error, got: %v", err)
	}
}
