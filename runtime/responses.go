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
	"encoding/json"
)

// LoginRequest represents the input for rpc_cognito_login
type LoginRequest struct {
	IDToken  string `json:"id_token"`
	Create   bool   `json:"create"`
	Username string `json:"username,omitempty"`
}

// LoginResponse represents the output for rpc_cognito_login
type LoginResponse struct {
	Token string `json:"token"`
}

// LinkRequest represents the input for rpc_link_cognito
type LinkRequest struct {
	IDToken string `json:"id_token"`
}

// LinkResponse represents the output for rpc_link_cognito
type LinkResponse struct {
	Linked bool `json:"linked"`
}

// WalletGetResponse represents the output for rpc_wallet_get
type WalletGetResponse struct {
	Wallet    map[string]int64 `json:"wallet"`
	UpdatedAt int64            `json:"updated_at"`
}

// WalletUpdateRequest represents the input for rpc_wallet_update
type WalletUpdateRequest struct {
	Changes  map[string]int64       `json:"changes"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// WalletUpdateResponse represents the output for rpc_wallet_update
type WalletUpdateResponse struct {
	Wallet    map[string]int64 `json:"wallet"`
	UpdatedAt int64            `json:"updated_at"`
}

// WalletLedgerRequest represents the input for rpc_wallet_ledger
type WalletLedgerRequest struct {
	Limit  int    `json:"limit"`
	Cursor string `json:"cursor"`
}

// WalletLedgerItem represents a single ledger entry
type WalletLedgerItem struct {
	Changes    map[string]int64       `json:"changes"`
	Metadata   map[string]interface{} `json:"metadata"`
	CreateTime int64                  `json:"create_time"`
}

// WalletLedgerResponse represents the output for rpc_wallet_ledger
type WalletLedgerResponse struct {
	Items  []WalletLedgerItem `json:"items"`
	Cursor string             `json:"cursor"`
}

// ToJSON converts a struct to JSON string
func ToJSON(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// FromJSON parses JSON string into a struct
func FromJSON(data string, v interface{}) error {
	return json.Unmarshal([]byte(data), v)
}
