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

package iap

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestHuaweiValidationNeverReachesHuaweiBecauseTheVerifyURLIsMalformed(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicKey, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	purchaseData := `{"productId":"gems_100","purchaseToken":"purchase-token","accountFlag":0}`
	hashed := sha256.Sum256([]byte(purchaseData))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hashed[:])
	require.NoError(t, err)

	var requested []string
	httpc := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requested = append(requested, req.URL.String())
		body := `{"responseCode":"0","purchaseTokenData":{"productId":"gems_100","purchaseToken":"purchase-token"}}`
		if req.URL.Host == "oauth-login.cloud.huawei.com" {
			body = `{"access_token":"access-token","expires_in":3600}`
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})}

	_, _, _, err = ValidateReceiptHuawei(context.Background(), httpc, base64.StdEncoding.EncodeToString(publicKey), "client-id", "client-secret", purchaseData, base64.StdEncoding.EncodeToString(signature))

	var urlErr *url.Error
	require.ErrorAs(t, err, &urlErr)
	assert.Equal(t, "https://https:%2F%2Forders-dre.iap.hicloud.com/https://orders-dre.iap.hicloud.com/applications/purchases/tokens/verify", urlErr.URL)
	assert.Equal(t, []string{"https://oauth-login.cloud.huawei.com/oauth2/v3/token"}, requested)
}
