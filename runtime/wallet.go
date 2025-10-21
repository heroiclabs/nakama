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
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

// rpcWalletGet returns the current wallet balances for the authenticated user
func rpcWalletGet(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get user ID from context
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", ErrUnauthorized
	}

	// Get account info
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		logger.Error("Failed to get account: %v", err)
		return "", WrapError(err, "failed to get account")
	}

	// Build response
	response := WalletGetResponse{
		Wallet:    make(map[string]int64),
		UpdatedAt: account.User.UpdateTime.Seconds,
	}

	// Parse wallet JSON
	if account.Wallet != "" {
		var wallet map[string]int64
		if err := FromJSON(account.Wallet, &wallet); err != nil {
			logger.Error("Failed to parse wallet JSON: %v", err)
			return "", WrapError(err, "failed to parse wallet")
		}
		response.Wallet = wallet
	}

	return ToJSON(response)
}

// rpcWalletUpdate performs an atomic wallet update with the given changes
func rpcWalletUpdate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get user ID from context
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", ErrUnauthorized
	}

	// Parse request
	var req WalletUpdateRequest
	if err := FromJSON(payload, &req); err != nil {
		logger.Error("Failed to parse wallet update request: %v", err)
		return "", WrapError(err, "invalid request")
	}

	// Validate changes
	if len(req.Changes) == 0 {
		return "", ErrInvalidInput
	}

	// For security, we should validate currency keys and limits here
	// For now, we'll allow any currency but you could add allowlists

	// Check if any decrement would cause negative balance
	// Get current wallet first
	account, err := nk.AccountGetId(ctx, userID)
	if err != nil {
		logger.Error("Failed to get account for validation: %v", err)
		return "", WrapError(err, "failed to get account")
	}

	currentWallet := make(map[string]int64)
	if account.Wallet != "" {
		if err := FromJSON(account.Wallet, &currentWallet); err != nil {
			logger.Error("Failed to parse current wallet: %v", err)
			return "", WrapError(err, "failed to parse wallet")
		}
	}

	// Validate that decrements won't cause negative balances
	for currency, change := range req.Changes {
		if change < 0 {
			currentBalance := currentWallet[currency]
			if currentBalance+change < 0 {
				logger.Warn("Insufficient balance for %s: current=%d, change=%d", currency, currentBalance, change)
				return "", ErrInsufficientBalance
			}
		}
	}

	// Perform the wallet update
	updatedWallet, _, err := nk.WalletUpdate(ctx, userID, req.Changes, req.Metadata, true)
	if err != nil {
		logger.Error("Failed to update wallet: %v", err)
		return "", WrapError(err, "wallet update failed")
	}

	// Build response
	response := WalletUpdateResponse{
		Wallet:    updatedWallet,
		UpdatedAt: time.Now().Unix(),
	}

	return ToJSON(response)
}

// rpcWalletLedger lists wallet ledger entries with pagination
func rpcWalletLedger(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	// Get user ID from context
	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok || userID == "" {
		return "", ErrUnauthorized
	}

	// Parse request
	var req WalletLedgerRequest
	if err := FromJSON(payload, &req); err != nil {
		logger.Error("Failed to parse wallet ledger request: %v", err)
		return "", WrapError(err, "invalid request")
	}

	// Set default limit if not provided
	if req.Limit <= 0 {
		req.Limit = 25
	}

	// Cap limit at 100
	if req.Limit > 100 {
		req.Limit = 100
	}

	// Get ledger items
	items, cursor, err := nk.WalletLedgerList(ctx, userID, req.Limit, req.Cursor)
	if err != nil {
		logger.Error("Failed to list wallet ledger: %v", err)
		return "", WrapError(err, "failed to list ledger")
	}

	// Convert to response format
	responseItems := make([]WalletLedgerItem, len(items))
	for i, item := range items {
		responseItems[i] = WalletLedgerItem{
			Changes:    item.GetChangeset(),
			Metadata:   item.GetMetadata(),
			CreateTime: item.GetCreateTime(),
		}
	}

	response := WalletLedgerResponse{
		Items:  responseItems,
		Cursor: cursor,
	}

	return ToJSON(response)
}
