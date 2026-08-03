// Copyright 2026 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package social

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"golang.org/x/oauth2"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestCheckGoogleTokenValidatesAudience(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	const (
		targetClient = "target-client.apps.googleusercontent.com"
		mobileClient = "mobile-client.apps.googleusercontent.com"
		otherClient  = "other-client.apps.googleusercontent.com"
	)

	client := NewClient(zap.NewNop(), time.Second, nil, targetClient, mobileClient)
	client.googleCerts = []*rsa.PublicKey{&key.PublicKey}
	client.googleCertsRefreshAt = time.Now().Add(time.Hour).Unix()

	now := time.Now().UTC()
	signToken := func(t *testing.T, audience, authorizedParty any) string {
		t.Helper()
		claims := jwt.MapClaims{
			"iss": "https://accounts.google.com",
			"sub": "synthetic-google-subject",
			"iat": now.Unix(),
			"exp": now.Add(10 * time.Minute).Unix(),
		}
		if audience != nil {
			claims["aud"] = audience
		}
		if authorizedParty != nil {
			claims["azp"] = authorizedParty
		}
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		serialized, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return serialized
	}

	for _, tc := range []struct {
		name            string
		audience        any
		authorizedParty any
		wantErr         bool
	}{
		{name: "configured audience without authorized party", audience: targetClient},
		{name: "configured audience and presenter", audience: targetClient, authorizedParty: targetClient},
		{name: "configured audience and separately allowed presenter", audience: targetClient, authorizedParty: mobileClient},
		{name: "different OAuth client", audience: otherClient, authorizedParty: otherClient, wantErr: true},
		{name: "untrusted authorized presenter", audience: targetClient, authorizedParty: otherClient, wantErr: true},
		{name: "array audience rejected", audience: []string{targetClient}, authorizedParty: targetClient, wantErr: true},
		{name: "missing audience rejected", authorizedParty: targetClient, wantErr: true},
		{name: "malformed authorized presenter rejected", audience: targetClient, authorizedParty: 1, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := client.CheckGoogleToken(context.Background(), signToken(t, tc.audience, tc.authorizedParty))
			if tc.wantErr && err == nil {
				t.Fatal("invalid Google client claims were accepted")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("valid Google client claims were rejected: %v", err)
			}
		})
	}

	t.Run("OAuth configuration client ID is accepted", func(t *testing.T) {
		client := NewClient(zap.NewNop(), time.Second, &oauth2.Config{ClientID: targetClient})
		client.googleCerts = []*rsa.PublicKey{&key.PublicKey}
		client.googleCertsRefreshAt = time.Now().Add(time.Hour).Unix()
		if _, err := client.CheckGoogleToken(context.Background(), signToken(t, targetClient, nil)); err != nil {
			t.Fatalf("OAuth configuration client ID was rejected: %v", err)
		}
	})

	t.Run("unconfigured client IDs accepted for backward compatibility", func(t *testing.T) {
		core, _ := observer.New(zap.WarnLevel)
		client := NewClient(zap.New(core), time.Second, nil)
		client.googleCerts = []*rsa.PublicKey{&key.PublicKey}
		client.googleCertsRefreshAt = time.Now().Add(time.Hour).Unix()
		if _, err := client.CheckGoogleToken(context.Background(), signToken(t, targetClient, nil)); err != nil {
			t.Fatalf("token without a configured OAuth client ID was rejected: %v", err)
		}
	})
}

func TestCheckGoogleTokenPreservesAuthorizationCodeFlow(t *testing.T) {
	var tokenRequests, profileRequests int
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		var body string
		switch request.URL.Host {
		case "oauth.example.test":
			tokenRequests++
			body = `{"access_token":"synthetic-access-token","token_type":"Bearer","expires_in":3600}`
		case "www.googleapis.com":
			profileRequests++
			body = `{"playerId":"synthetic-player","displayName":"Synthetic Player"}`
		default:
			t.Fatalf("unexpected HTTP request: %s", request.URL)
		}

		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    request,
		}, nil
	})
	httpClient := &http.Client{Transport: transport}
	oauthConfig := &oauth2.Config{
		ClientID:     "play-games-client",
		ClientSecret: "synthetic-secret",
		Endpoint: oauth2.Endpoint{
			TokenURL: "https://oauth.example.test/token",
		},
	}
	client := NewClient(zap.NewNop(), time.Second, oauthConfig)
	client.client = httpClient
	client.googleCertsRefreshAt = time.Now().Add(time.Hour).Unix()
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, httpClient)

	profile, err := client.CheckGoogleToken(ctx, "synthetic-authorization-code")
	if err != nil {
		t.Fatalf("Google authorization code flow failed: %v", err)
	}
	if got, want := profile.GetGoogleId(), "synthetic-player"; got != want {
		t.Fatalf("unexpected Google Play Games player ID: got %q, want %q", got, want)
	}
	if tokenRequests != 1 || profileRequests != 1 {
		t.Fatalf("unexpected Google authorization code requests: token=%d profile=%d", tokenRequests, profileRequests)
	}
}

func TestCheckGoogleTokenDoesNotExchangeMalformedJWT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	var requests int
	httpClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		return nil, nil
	})}
	client := NewClient(zap.NewNop(), time.Second, &oauth2.Config{
		ClientID: "target-client.apps.googleusercontent.com",
		Endpoint: oauth2.Endpoint{TokenURL: "https://oauth.example.test/token"},
	})
	client.client = httpClient
	client.googleCerts = []*rsa.PublicKey{&key.PublicKey}
	client.googleCertsRefreshAt = time.Now().Add(time.Hour).Unix()
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, httpClient)

	if _, err := client.CheckGoogleToken(ctx, "not.a.jwt"); err == nil {
		t.Fatal("malformed JWT was accepted")
	}
	if requests != 0 {
		t.Fatalf("malformed JWT triggered %d external requests", requests)
	}
}
