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
	"errors"
	"fmt"
)

var (
	// Auth errors
	ErrInvalidToken       = errors.New("invalid token")
	ErrTokenExpired       = errors.New("token expired")
	ErrInvalidIssuer      = errors.New("invalid token issuer")
	ErrInvalidAudience    = errors.New("invalid token audience")
	ErrInvalidTokenUse    = errors.New("invalid token use")
	ErrMissingSubject     = errors.New("missing subject in token")
	ErrJWKSFetch          = errors.New("failed to fetch JWKS")
	ErrAuthFailed         = errors.New("authentication failed")
	ErrLinkFailed         = errors.New("link failed")

	// Wallet errors
	ErrInsufficientBalance = errors.New("insufficient balance")
	ErrInvalidCurrency     = errors.New("invalid currency")
	ErrWalletUpdateFailed  = errors.New("wallet update failed")
	ErrWalletGetFailed     = errors.New("failed to get wallet")
	ErrLedgerListFailed    = errors.New("failed to list ledger")

	// Request errors
	ErrInvalidInput        = errors.New("invalid input")
	ErrMissingIDToken      = errors.New("missing id_token")
	ErrUnauthorized        = errors.New("unauthorized")
)

// WrapError wraps an error with additional context
func WrapError(err error, msg string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", msg, err)
}
