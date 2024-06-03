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

package server

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/stretchr/testify/assert"
)

func TestUpdateWalletSingleUser(t *testing.T) {
	values := []int64{
		34,
		7,
		70,
		35,
		2,
		5,
		32,
		48,
		12,
		6,
		6,
		3,
		2,
		3,
		2,
		17,
		20,
		1,
		2,
		3,
		14,
		17,
		10,
		19,
		9,
		7,
		33,
		13,
		306,
		4,
		5,
		19,
		10,
		25,
		3,
		13,
		4,
		4,
		135,
		22,
		2,
	}

	db := NewDB(t)
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
	if err != nil {
		t.Fatalf("error creating user: %v", err.Error())
	}

	for _, val := range values[:len(values)/2] {
		_, _, err := nk.WalletUpdate(context.Background(), userID, map[string]int64{"value": val}, nil, true)
		if err != nil {
			t.Fatalf("error updating wallet: %v", err.Error())
		}
	}

	var wg sync.WaitGroup
	for _, val := range values[len(values)/2:] {
		v := val
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := nk.WalletUpdate(context.Background(), userID, map[string]int64{"value": v}, nil, true)
			if err != nil {
				panic(fmt.Sprintf("error updating wallet: %v", err.Error()))
			}
		}()
	}
	wg.Wait()

	account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
	if err != nil {
		t.Fatalf("error getting user: %v", err.Error())
	}

	assert.NotNil(t, account, "account is nil")

	var wallet map[string]int64
	err = json.Unmarshal([]byte(account.Wallet), &wallet)
	if err != nil {
		t.Fatalf("json unmarshal error: %v", err.Error())
	}

	assert.Contains(t, wallet, "value", "wallet did not contain value")
	assert.IsType(t, int64(0), wallet["value"], "wallet value was not int64")
	assert.Equal(t, int64(984), wallet["value"], "wallet value did not match")
}

func TestUpdateWalletMultiUser(t *testing.T) {
	values := []int64{
		34,
		7,
		70,
		35,
		2,
		5,
		32,
		48,
		12,
		6,
		6,
		3,
		2,
		3,
		2,
		17,
		20,
		1,
		2,
		3,
		14,
		17,
		10,
		19,
		9,
		7,
		33,
		13,
		306,
		4,
		5,
		19,
		10,
		25,
		3,
		13,
		4,
		4,
		135,
		22,
		2,
	}

	db := NewDB(t)
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	for _, val := range values {
		for _, userID := range userIDs {
			_, _, err := nk.WalletUpdate(context.Background(), userID, map[string]int64{"value": val}, nil, true)
			if err != nil {
				t.Fatalf("error updating wallet: %v", err.Error())
			}
		}
	}

	for _, userID := range userIDs {
		account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]int64
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, int64(0), wallet["value"], "wallet value was not int64")
		assert.Equal(t, int64(984), wallet["value"], "wallet value did not match")
	}
}

func TestUpdateWalletsMultiUser(t *testing.T) {
	values := []int64{
		34,
		7,
		70,
		35,
		2,
		5,
		32,
		48,
		12,
		6,
		6,
		3,
		2,
		3,
		2,
		17,
		20,
		1,
		2,
		3,
		14,
		17,
		10,
		19,
		9,
		7,
		33,
		13,
		306,
		4,
		5,
		19,
		10,
		25,
		3,
		13,
		4,
		4,
		135,
		22,
		2,
	}

	db := NewDB(t)
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
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
				Changeset: map[string]int64{"value": val},
			})
		}
		_, err := nk.WalletsUpdate(context.Background(), updates, true)
		if err != nil {
			t.Fatalf("error updating wallets: %v", err.Error())
		}
	}

	for _, userID := range userIDs {
		account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]int64
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, int64(0), wallet["value"], "wallet value was not int64")
		assert.Equal(t, int64(984), wallet["value"], "wallet value did not match")
	}
}

func TestUpdateWalletsMultiUserSharedChangeset(t *testing.T) {
	values := []int64{
		34,
		7,
		70,
		35,
		2,
		5,
		32,
		48,
		12,
		6,
		6,
		3,
		2,
		3,
		2,
		17,
		20,
		1,
		2,
		3,
		14,
		17,
		10,
		19,
		9,
		7,
		33,
		13,
		306,
		4,
		5,
		19,
		10,
		25,
		3,
		13,
		4,
		4,
		135,
		22,
		2,
	}

	db := NewDB(t)
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	for _, val := range values {
		changeset := map[string]int64{"value": val}
		updates := make([]*runtime.WalletUpdate, 0, len(userIDs))
		for _, userID := range userIDs {
			updates = append(updates, &runtime.WalletUpdate{
				UserID:    userID,
				Changeset: changeset,
			})
		}
		_, err := nk.WalletsUpdate(context.Background(), updates, true)
		if err != nil {
			t.Fatalf("error updating wallets: %v", err.Error())
		}
	}

	for _, userID := range userIDs {
		account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]int64
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, int64(0), wallet["value"], "wallet value was not int64")
		assert.Equal(t, int64(984), wallet["value"], "wallet value did not match")
	}
}

func TestUpdateWalletsMultiUserSharedChangesetDeductions(t *testing.T) {
	values := []int64{
		34,
		-34,
		7,
		-7,
		70,
		-70,
		35,
		-35,
		2,
		5,
		33,
		-40,
		48,
		-48,
		12,
		-12,
		6,
		7,
		-13,
		3,
		2,
		3,
		2,
		19,
		-29,
		20,
		-20,
		1,
		2,
		3,
		15,
		19,
		-40,
		11,
		19,
		-30,
		9,
		7,
		34,
		-50,
		13,
		-13,
		306,
		-306,
	}

	db := NewDB(t)
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	count := 5

	userIDs := make([]string, 0, count)
	for i := 0; i < count; i++ {
		userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
		if err != nil {
			t.Fatalf("error creating user: %v", err.Error())
		}
		userIDs = append(userIDs, userID)
	}

	foo := int64(1)
	for _, val := range values {
		changeset := map[string]int64{"value": val, "foo": foo}
		updates := make([]*runtime.WalletUpdate, 0, len(userIDs))
		for _, userID := range userIDs {
			updates = append(updates, &runtime.WalletUpdate{
				UserID:    userID,
				Changeset: changeset,
			})
		}
		_, err := nk.WalletsUpdate(context.Background(), updates, true)
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
		account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
		if err != nil {
			t.Fatalf("error getting user: %v", err.Error())
		}

		assert.NotNil(t, account, "account is nil")

		var wallet map[string]int64
		err = json.Unmarshal([]byte(account.Wallet), &wallet)
		if err != nil {
			t.Fatalf("json unmarshal error: %v", err.Error())
		}

		assert.Contains(t, wallet, "value", "wallet did not contain value")
		assert.IsType(t, int64(0), wallet["value"], "wallet value was not int64")
		assert.Equal(t, int64(0), wallet["value"], "wallet value did not match")
	}
}

func TestUpdateWalletsSingleUser(t *testing.T) {
	db := NewDB(t)
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
	if err != nil {
		t.Fatalf("error creating user: %v", err.Error())
	}

	updates := []*runtime.WalletUpdate{
		{
			UserID:    userID,
			Changeset: map[string]int64{"value": 1},
		},
		{
			UserID:    userID,
			Changeset: map[string]int64{"value": 2},
		},
		{
			UserID:    userID,
			Changeset: map[string]int64{"value": 3},
		},
	}

	_, err = nk.WalletsUpdate(context.Background(), updates, true)
	if err != nil {
		t.Fatalf("error updating wallets: %v", err.Error())
	}

	account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
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
	nk := NewRuntimeGoNakamaModule(logger, db, nil, cfg, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	userID, _, _, err := AuthenticateCustom(context.Background(), logger, db, uuid.Must(uuid.NewV4()).String(), uuid.Must(uuid.NewV4()).String(), true)
	if err != nil {
		t.Fatalf("error creating user: %v", err.Error())
	}

	_, _, err = nk.WalletUpdate(context.Background(), userID, map[string]int64{"value": 1}, nil, false)
	if err != nil {
		t.Fatalf("error updating wallet: %v", err.Error())
	}
	_, _, err = nk.WalletUpdate(context.Background(), userID, map[string]int64{"value": 2}, nil, false)
	if err != nil {
		t.Fatalf("error updating wallet: %v", err.Error())
	}
	_, _, err = nk.WalletUpdate(context.Background(), userID, map[string]int64{"value": 3}, nil, false)
	if err != nil {
		t.Fatalf("error updating wallet: %v", err.Error())
	}

	account, err := GetAccount(context.Background(), logger, db, nil, uuid.FromStringOrNil(userID))
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
