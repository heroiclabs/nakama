// Copyright 2019 The Nakama Authors
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

package tests

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v2/server"
	"github.com/stretchr/testify/assert"
)

func TestUpdateWalletSingleUser(t *testing.T) {
	values := []float64{
		34.01,
		7.41,
		70.86,
		35.11,
		2.68,
		5.55,
		32.05,
		48.07,
		12.07,
		6.62,
		6.86,
		3.94,
		2.05,
		3.87,
		2.38,
		17.42,
		20.79,
		1.58,
		2.5,
		3.7,
		14.88,
		17.51,
		10.91,
		19.6,
		9.98,
		7.86,
		33.11,
		13.58,
		306.74,
		4.9,
		5.11,
		19.15,
		10.28,
		25.51,
		3.69,
		13.21,
		4.93,
		4.4,
		135.13,
		22.83,
		2.17,
	}

	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
	if err != nil {
		t.Fatalf("error creating user: %v", err.Error())
	}

	for _, val := range values {
		err := nk.WalletUpdate(context.Background(), userID, map[string]interface{}{"value": val}, nil, true)
		if err != nil {
			t.Fatalf("error updating wallet: %v", err.Error())
		}
	}

	account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
	if err != nil {
		t.Fatalf("error getting user: %v", err.Error())
	}

	assert.NotNil(t, account, "account is nil")

	var wallet map[string]interface{}
	err = json.Unmarshal([]byte(account.Wallet), &wallet)
	if err != nil {
		t.Fatalf("json unmarshal error: %v", err.Error())
	}

	assert.Contains(t, wallet, "value", "wallet did not contain value")
	assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
	assert.Equal(t, float64(1005), wallet["value"].(float64), "wallet value did not match")
}

func TestUpdateWalletMultiUser(t *testing.T) {
	values := []float64{
		34.01,
		7.41,
		70.86,
		35.11,
		2.68,
		5.55,
		32.05,
		48.07,
		12.07,
		6.62,
		6.86,
		3.94,
		2.05,
		3.87,
		2.38,
		17.42,
		20.79,
		1.58,
		2.5,
		3.7,
		14.88,
		17.51,
		10.91,
		19.6,
		9.98,
		7.86,
		33.11,
		13.58,
		306.74,
		4.9,
		5.11,
		19.15,
		10.28,
		25.51,
		3.69,
		13.21,
		4.93,
		4.4,
		135.13,
		22.83,
		2.17,
	}

	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	for _, val := range values {
		for _, userID := range userIDs {
			err := nk.WalletUpdate(context.Background(), userID, map[string]interface{}{"value": val}, nil, true)
			if err != nil {
				t.Fatalf("error updating wallet: %v", err.Error())
			}
		}
	}

	for _, userID := range userIDs {
		account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]interface{}
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
		assert.Equal(t, float64(1005), wallet["value"].(float64), "wallet value did not match")
	}
}

func TestUpdateWalletsMultiUser(t *testing.T) {
	values := []float64{
		34.01,
		7.41,
		70.86,
		35.11,
		2.68,
		5.55,
		32.05,
		48.07,
		12.07,
		6.62,
		6.86,
		3.94,
		2.05,
		3.87,
		2.38,
		17.42,
		20.79,
		1.58,
		2.5,
		3.7,
		14.88,
		17.51,
		10.91,
		19.6,
		9.98,
		7.86,
		33.11,
		13.58,
		306.74,
		4.9,
		5.11,
		19.15,
		10.28,
		25.51,
		3.69,
		13.21,
		4.93,
		4.4,
		135.13,
		22.83,
		2.17,
	}

	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	for _, val := range values {
		updates := make([]*runtime.WalletUpdate, 0, len(userIDs))
		for _, userID := range userIDs {
			updates = append(updates, &runtime.WalletUpdate{
				UserID:    userID,
				Changeset: map[string]interface{}{"value": val},
			})
		}
		err := nk.WalletsUpdate(context.Background(), updates, true)
		if err != nil {
			t.Fatalf("error updating wallets: %v", err.Error())
		}
	}

	for _, userID := range userIDs {
		account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]interface{}
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
		assert.Equal(t, float64(1005), wallet["value"].(float64), "wallet value did not match")
	}
}

func TestUpdateWalletsMultiUserSharedChangeset(t *testing.T) {
	values := []float64{
		34.01,
		7.41,
		70.86,
		35.11,
		2.68,
		5.55,
		32.05,
		48.07,
		12.07,
		6.62,
		6.86,
		3.94,
		2.05,
		3.87,
		2.38,
		17.42,
		20.79,
		1.58,
		2.5,
		3.7,
		14.88,
		17.51,
		10.91,
		19.6,
		9.98,
		7.86,
		33.11,
		13.58,
		306.74,
		4.9,
		5.11,
		19.15,
		10.28,
		25.51,
		3.69,
		13.21,
		4.93,
		4.4,
		135.13,
		22.83,
		2.17,
	}

	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	for _, val := range values {
		changeset := map[string]interface{}{"value": val}
		updates := make([]*runtime.WalletUpdate, 0, len(userIDs))
		for _, userID := range userIDs {
			updates = append(updates, &runtime.WalletUpdate{
				UserID:    userID,
				Changeset: changeset,
			})
		}
		err := nk.WalletsUpdate(context.Background(), updates, true)
		if err != nil {
			t.Fatalf("error updating wallets: %v", err.Error())
		}
	}

	for _, userID := range userIDs {
		account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]interface{}
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
		assert.Equal(t, float64(1005), wallet["value"].(float64), "wallet value did not match")
	}
}

func TestUpdateWalletsMultiUserSharedChangesetDeductions(t *testing.T) {
	values := []float64{
		34.01,
		-34.01,
		7.41,
		-7.41,
		70.86,
		-70.86,
		35.11,
		-35.11,
		2.68,
		5.55,
		32.05,
		-40.28,
		48.07,
		-48.07,
		12.07,
		-12.07,
		6.62,
		6.86,
		-13.48,
		3.94,
		2.05,
		3.87,
		2.38,
		17.42,
		-29.66,
		20.79,
		-20.79,
		1.58,
		2.5,
		3.7,
		14.88,
		17.51,
		-40.17,
		10.91,
		19.6,
		-30.51,
		9.98,
		7.86,
		33.11,
		-50.95,
		13.58,
		-13.58,
		306.74,
		-306.74,
	}

	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	foo := float64(1)
	for _, val := range values {
		changeset := map[string]interface{}{"value": val, "foo": foo}
		updates := make([]*runtime.WalletUpdate, 0, len(userIDs))
		for _, userID := range userIDs {
			updates = append(updates, &runtime.WalletUpdate{
				UserID:    userID,
				Changeset: changeset,
			})
		}
		err := nk.WalletsUpdate(context.Background(), updates, true)
		if err != nil {
			t.Fatalf("error updating wallets: %v", err.Error())
		}
		if foo == 1 {
			foo = -1
		} else {
			foo = 1
		}
	}

	for _, userID := range userIDs {
		account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]interface{}
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
		assert.Equal(t, float64(0), wallet["value"].(float64), "wallet value did not match")
	}
}

func TestUpdateWalletsSingleUser(t *testing.T) {
	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
	if err != nil {
		t.Fatalf("error creating user: %v", err.Error())
	}

	updates := []*runtime.WalletUpdate{
		{
			UserID:    userID,
			Changeset: map[string]interface{}{"value": float64(1)},
		},
		{
			UserID:    userID,
			Changeset: map[string]interface{}{"value": float64(2)},
		},
		{
			UserID:    userID,
			Changeset: map[string]interface{}{"value": float64(3)},
		},
	}

	err = nk.WalletsUpdate(context.Background(), updates, true)
	if err != nil {
		t.Fatalf("error updating wallets: %v", err.Error())
	}

	account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
	if err != nil {
		t.Fatalf("error getting user: %v", err.Error())
	}

	assert.NotNil(t, account, "account is nil")

	var wallet map[string]interface{}
	err = json.Unmarshal([]byte(account.Wallet), &wallet)
	if err != nil {
		t.Fatalf("json unmarshal error: %v", err.Error())
	}

	assert.Contains(t, wallet, "value", "wallet did not contain value")
	assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
	assert.Equal(t, float64(6), wallet["value"].(float64), "wallet value did not match")
}

func TestUpdateWalletRepeatedSingleUser(t *testing.T) {
	db := NewDB(t)
	nk := server.NewRuntimeGoNakamaModule(logger, db, nil, config, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	userID, _, _, err := server.AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
	if err != nil {
		t.Fatalf("error creating user: %v", err.Error())
	}

	err = nk.WalletUpdate(context.Background(), userID, map[string]interface{}{"value": float64(1)}, nil, false)
	if err != nil {
		t.Fatalf("error updating wallet: %v", err.Error())
	}
	err = nk.WalletUpdate(context.Background(), userID, map[string]interface{}{"value": float64(2)}, nil, false)
	if err != nil {
		t.Fatalf("error updating wallet: %v", err.Error())
	}
	err = nk.WalletUpdate(context.Background(), userID, map[string]interface{}{"value": float64(3)}, nil, false)
	if err != nil {
		t.Fatalf("error updating wallet: %v", err.Error())
	}

	account, _, err := server.GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
	if err != nil {
		t.Fatalf("error getting user: %v", err.Error())
	}

	assert.NotNil(t, account, "account is nil")

	var wallet map[string]interface{}
	err = json.Unmarshal([]byte(account.Wallet), &wallet)
	if err != nil {
		t.Fatalf("json unmarshal error: %v", err.Error())
	}

	assert.Contains(t, wallet, "value", "wallet did not contain value")
	assert.IsType(t, float64(0), wallet["value"], "wallet value was not float64")
	assert.Equal(t, float64(6), wallet["value"].(float64), "wallet value did not match")
}
