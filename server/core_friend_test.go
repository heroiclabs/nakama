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
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/stretchr/testify/assert"
)

func TestServer_ListFriendsOfFriends(t *testing.T) {
	ctx := context.Background()

	db := NewDB(t)

	sessionRegistry := NewLocalSessionRegistry(metrics)
	statusRegistry := NewLocalStatusRegistry(logger, cfg, sessionRegistry, protojsonMarshaler)

	// user
	uid := uuid.Must(uuid.NewV4())

	uidA1 := uuid.Must(uuid.NewV4()) // friend of uid
	uidA2 := uuid.Must(uuid.NewV4()) // friend of A1
	uidA3 := uuid.Must(uuid.NewV4()) // friend of A1

	uidB1 := uuid.Must(uuid.NewV4()) // friend of uid
	uidB2 := uuid.Must(uuid.NewV4()) // friend of B1
	uidB3 := uuid.Must(uuid.NewV4()) // friend of uid, B1

	InsertUser(t, db, uid)

	t.Run("returns empty list if the user has no friends", func(t *testing.T) {
		fof, err := ListFriendsOfFriends(ctx, logger, db, statusRegistry, uid, 100, "")
		if err != nil {
			t.Fatal(err)
		}

		assert.Empty(t, fof.FriendsOfFriends)
	})

	InsertUser(t, db, uidA1)
	InsertUser(t, db, uidA2)
	InsertUser(t, db, uidA3)
	InsertUser(t, db, uidB1)
	InsertUser(t, db, uidB2)
	InsertUser(t, db, uidB3)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := addFriend(ctx, logger, tx, uid, uidA1.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidA1, uid.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidA1, uidA2.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidA2, uidA1.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidA1, uidA3.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidA3, uidA1.String(), ""); err != nil {
		t.Fatal(err)
	}

	if _, err := addFriend(ctx, logger, tx, uid, uidB1.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidB1, uid.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidB1, uidB2.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidB2, uidB1.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidB1, uidB3.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidB3, uidB1.String(), ""); err != nil {
		t.Fatal(err)
	}

	if _, err := addFriend(ctx, logger, tx, uid, uidB3.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, uidB3, uid.String(), ""); err != nil {
		t.Fatal(err)
	}

	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}

	t.Run("returns friends of friends, excluding friends in common", func(t *testing.T) {
		fof, err := ListFriendsOfFriends(ctx, logger, db, statusRegistry, uid, 100, "")
		if err != nil {
			t.Fatal(err)
		}

		resultMap := make(map[string]*api.FriendsOfFriendsList_FriendOfFriend, len(fof.FriendsOfFriends))
		for _, u := range fof.FriendsOfFriends {
			resultMap[u.User.Id] = u
		}

		assert.Len(t, fof.FriendsOfFriends, 3)
		assert.Equal(t, resultMap[uidA2.String()].Referrer, uidA1.String())
		assert.Equal(t, resultMap[uidA3.String()].Referrer, uidA1.String())
		assert.Equal(t, resultMap[uidB2.String()].Referrer, uidB1.String())
	})

	t.Run("returns a cursor if there's more pages to fetch", func(t *testing.T) {
		limit := 1
		fof, err := ListFriendsOfFriends(ctx, logger, db, statusRegistry, uid, limit, "")
		if err != nil {
			t.Fatal(err)
		}

		assert.Len(t, fof.FriendsOfFriends, limit)
		assert.NotEmpty(t, fof.Cursor)
	})

	t.Run("returns the following page if a cursor is provided", func(t *testing.T) {
		limit := 2
		fof, err := ListFriendsOfFriends(ctx, logger, db, statusRegistry, uid, limit, "")
		if err != nil {
			t.Fatal(err)
		}

		assert.Len(t, fof.FriendsOfFriends, limit)

		fof, err = ListFriendsOfFriends(ctx, logger, db, statusRegistry, uid, limit, fof.Cursor)
		if err != nil {
			t.Fatal(err)
		}

		assert.Len(t, fof.FriendsOfFriends, 1)
		assert.Empty(t, fof.Cursor)
	})
}
