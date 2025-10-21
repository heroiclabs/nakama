// Copyright 2025 The Nakama Authors
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

package main

import (
	"context"
	"fmt"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// CognitoConfig holds Cognito-specific configuration
type CognitoConfig struct {
	Issuer      string
	Audience    string
	JWKSCacheTTL time.Duration
}

// JWKSCache holds the JWKS keyfunc for token verification
type JWKSCache struct {
	keyfunc keyfunc.Keyfunc
}

// InitJWKSCache initializes the JWKS cache with the given Cognito issuer
func InitJWKSCache(ctx context.Context, issuer string, cacheTTL time.Duration) (*JWKSCache, error) {
	jwksURL := fmt.Sprintf("%s/.well-known/jwks.json", issuer)

	// Use NewDefaultCtx to create a keyfunc with context support
	k, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		return nil, WrapError(err, "failed to initialize JWKS cache")
	}

	return &JWKSCache{keyfunc: k}, nil
}

// Close is a no-op for v3 API
func (j *JWKSCache) Close() {
	// In keyfunc v3, cleanup is handled differently
}

// CognitoClaims represents the claims in a Cognito ID token
type CognitoClaims struct {
	jwt.RegisteredClaims
	TokenUse      string `json:"token_use"`
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified,omitempty"`
	Name          string `json:"name,omitempty"`
	Picture       string `json:"picture,omitempty"`
}

// VerifyCognitoIDToken verifies a Cognito ID token and returns the claims
func VerifyCognitoIDToken(ctx context.Context, tokenStr string, config CognitoConfig, jwksCache *JWKSCache) (*CognitoClaims, error) {
	if tokenStr == "" {
		return nil, ErrMissingIDToken
	}

	// Parse and verify the token
	token, err := jwt.ParseWithClaims(tokenStr, &CognitoClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Verify signing algorithm
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}

		// Get the key from JWKS
		key, err := jwksCache.keyfunc.Keyfunc(token)
		if err != nil {
			return nil, WrapError(err, "failed to get signing key")
		}

		return key, nil
	})

	if err != nil {
		return nil, WrapError(err, "token parse failed")
	}

	if !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*CognitoClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	// Verify issuer
	if claims.Issuer != config.Issuer {
		return nil, fmt.Errorf("%w: expected %s, got %s", ErrInvalidIssuer, config.Issuer, claims.Issuer)
	}

	// Verify audience
	validAudience := false
	for _, aud := range claims.Audience {
		if aud == config.Audience {
			validAudience = true
			break
		}
	}
	if !validAudience {
		return nil, fmt.Errorf("%w: expected %s", ErrInvalidAudience, config.Audience)
	}

	// Verify token_use is "id"
	if claims.TokenUse != "id" {
		return nil, fmt.Errorf("%w: expected 'id', got '%s'", ErrInvalidTokenUse, claims.TokenUse)
	}

	// Verify expiration (should be handled by jwt library, but double-check)
	if time.Now().After(claims.ExpiresAt.Time) {
		return nil, ErrTokenExpired
	}

	// Verify subject exists
	if claims.Subject == "" {
		return nil, ErrMissingSubject
	}

	return claims, nil
}

// ClaimsToUserVars converts Cognito claims to user variables for Nakama
func ClaimsToUserVars(claims *CognitoClaims) map[string]string {
	vars := make(map[string]string)

	if claims.Email != "" {
		vars["email"] = claims.Email
	}
	if claims.EmailVerified {
		vars["email_verified"] = "true"
	} else if claims.Email != "" {
		vars["email_verified"] = "false"
	}
	if claims.Name != "" {
		vars["name"] = claims.Name
	}
	if claims.Picture != "" {
		vars["picture"] = claims.Picture
	}

	return vars
}
