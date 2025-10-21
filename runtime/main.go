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
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

var (
	cognitoConfig CognitoConfig
	jwksCache     *JWKSCache
)

// InitModule initializes the runtime module and registers RPCs
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	logger.Info("Initializing Cognito Auth + Wallet module")

	// Load environment variables
	issuer := os.Getenv("NAKAMA_COGNITO_ISS")
	if issuer == "" {
		return fmt.Errorf("NAKAMA_COGNITO_ISS environment variable is required")
	}

	audience := os.Getenv("NAKAMA_COGNITO_AUDIENCE")
	if audience == "" {
		return fmt.Errorf("NAKAMA_COGNITO_AUDIENCE environment variable is required")
	}

	cacheTTLStr := os.Getenv("NAKAMA_JWKS_CACHE_TTL")
	if cacheTTLStr == "" {
		cacheTTLStr = "3600" // default 1 hour
	}

	cacheTTLSeconds, err := strconv.Atoi(cacheTTLStr)
	if err != nil {
		return fmt.Errorf("invalid NAKAMA_JWKS_CACHE_TTL: %v", err)
	}

	// Initialize Cognito config
	cognitoConfig = CognitoConfig{
		Issuer:      issuer,
		Audience:    audience,
		JWKSCacheTTL: time.Duration(cacheTTLSeconds) * time.Second,
	}

	logger.Info("Cognito config: issuer=%s, audience=%s, cache_ttl=%ds", issuer, audience, cacheTTLSeconds)

	// Initialize JWKS cache
	cache, err := InitJWKSCache(ctx, issuer, cognitoConfig.JWKSCacheTTL)
	if err != nil {
		return fmt.Errorf("failed to initialize JWKS cache: %w", err)
	}
	jwksCache = cache

	logger.Info("JWKS cache initialized successfully")

	// Register RPCs
	if err := initializer.RegisterRpc("rpc_cognito_login", rpcCognitoLogin); err != nil {
		return fmt.Errorf("failed to register rpc_cognito_login: %w", err)
	}
	logger.Info("Registered RPC: rpc_cognito_login")

	if err := initializer.RegisterRpc("rpc_link_cognito", rpcLinkCognito); err != nil {
		return fmt.Errorf("failed to register rpc_link_cognito: %w", err)
	}
	logger.Info("Registered RPC: rpc_link_cognito")

	if err := initializer.RegisterRpc("rpc_wallet_get", rpcWalletGet); err != nil {
		return fmt.Errorf("failed to register rpc_wallet_get: %w", err)
	}
	logger.Info("Registered RPC: rpc_wallet_get")

	if err := initializer.RegisterRpc("rpc_wallet_update", rpcWalletUpdate); err != nil {
		return fmt.Errorf("failed to register rpc_wallet_update: %w", err)
	}
	logger.Info("Registered RPC: rpc_wallet_update")

	if err := initializer.RegisterRpc("rpc_wallet_ledger", rpcWalletLedger); err != nil {
		return fmt.Errorf("failed to register rpc_wallet_ledger: %w", err)
	}
	logger.Info("Registered RPC: rpc_wallet_ledger")

	logger.Info("Cognito Auth + Wallet module initialized successfully")
	return nil
}

// rpcCognitoLogin authenticates a user with a Cognito ID token
func rpcCognitoLogin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Parse request
	var req LoginRequest
	if err := FromJSON(payload, &req); err != nil {
		logger.Error("Failed to parse login request: %v", err)
		return "", WrapError(err, "invalid request")
	}

	if req.IDToken == "" {
		return "", ErrMissingIDToken
	}

	// Verify the Cognito ID token
	claims, err := VerifyCognitoIDToken(ctx, req.IDToken, cognitoConfig, jwksCache)
	if err != nil {
		logger.Error("Token verification failed: %v", err)
		return "", WrapError(err, "token verification failed")
	}

	// Build external ID from Cognito subject
	externalID := fmt.Sprintf("cognito:%s", claims.Subject)

	// Convert claims to user variables
	vars := ClaimsToUserVars(claims)

	// Authenticate with Nakama
	userID, username, created, err := nk.AuthenticateCustom(ctx, externalID, req.Username, req.Create)
	if err != nil {
		logger.Error("Authentication failed for externalID=%s: %v", externalID, err)
		return "", WrapError(err, "authentication failed")
	}

	if created {
		logger.Info("Created new user: userID=%s, username=%s, externalID=%s", userID, username, externalID)
	} else {
		logger.Info("Authenticated existing user: userID=%s, username=%s, externalID=%s", userID, username, externalID)
	}

	// Update user metadata with claims if needed
	if len(vars) > 0 {
		// Convert vars to metadata format
		metadata := make(map[string]interface{})
		for k, v := range vars {
			metadata[k] = v
		}
		if err := nk.AccountUpdateId(ctx, userID, "", metadata, "", "", "", "", ""); err != nil {
			logger.Warn("Failed to update user metadata: %v", err)
			// Don't fail the login if metadata update fails
		}
	}

	// Generate session token
	token, _, err := nk.AuthenticateTokenGenerate(userID, username, 0, nil)
	if err != nil {
		logger.Error("Failed to generate token for userID=%s: %v", userID, err)
		return "", WrapError(err, "failed to generate session token")
	}

	// Build response
	response := LoginResponse{
		Token: token,
	}

	return ToJSON(response)
}

// rpcLinkCognito links a Cognito ID to an existing Nakama account
func rpcLinkCognito(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get user ID from context
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", ErrUnauthorized
	}

	// Parse request
	var req LinkRequest
	if err := FromJSON(payload, &req); err != nil {
		logger.Error("Failed to parse link request: %v", err)
		return "", WrapError(err, "invalid request")
	}

	if req.IDToken == "" {
		return "", ErrMissingIDToken
	}

	// Verify the Cognito ID token
	claims, err := VerifyCognitoIDToken(ctx, req.IDToken, cognitoConfig, jwksCache)
	if err != nil {
		logger.Error("Token verification failed: %v", err)
		return "", WrapError(err, "token verification failed")
	}

	// Build external ID from Cognito subject
	externalID := fmt.Sprintf("cognito:%s", claims.Subject)

	// Link custom ID
	if err := nk.LinkCustom(ctx, userID, externalID); err != nil {
		logger.Error("Link failed for userID=%s, externalID=%s: %v", userID, externalID, err)
		return "", WrapError(err, "link failed")
	}

	logger.Info("Linked Cognito ID to user: userID=%s, externalID=%s", userID, externalID)

	// Update user metadata with claims if needed
	vars := ClaimsToUserVars(claims)
	if len(vars) > 0 {
		metadata := make(map[string]interface{})
		for k, v := range vars {
			metadata[k] = v
		}
		if err := nk.AccountUpdateId(ctx, userID, "", metadata, "", "", "", "", ""); err != nil {
			logger.Warn("Failed to update user metadata: %v", err)
			// Don't fail the link if metadata update fails
		}
	}

	// Build response
	response := LinkResponse{
		Linked: true,
	}

	return ToJSON(response)
}
