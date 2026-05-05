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

func TestServer_GetFriendsStatus(t *testing.T) {
	ctx := context.Background()
	db := NewDB(t)

	uid := uuid.Must(uuid.NewV4())
	friendUID := uuid.Must(uuid.NewV4())     // mutual friend, state 0
	inviteSentUID := uuid.Must(uuid.NewV4()) // uid invited them, state 1
	inviteRecvUID := uuid.Must(uuid.NewV4()) // they invited uid, state 2
	blockedUID := uuid.Must(uuid.NewV4())    // uid blocked them, state 3
	strangerUID := uuid.Must(uuid.NewV4())   // no edge

	for _, u := range []uuid.UUID{uid, friendUID, inviteSentUID, inviteRecvUID, blockedUID, strangerUID} {
		InsertUser(t, db, u)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}

	// Mutual friend: addFriend both directions sets state 0.
	if _, err := addFriend(ctx, logger, tx, uid, friendUID.String(), ""); err != nil {
		t.Fatal(err)
	}
	if _, err := addFriend(ctx, logger, tx, friendUID, uid.String(), ""); err != nil {
		t.Fatal(err)
	}

	// uid invites inviteSentUID → uid→target state 1, target→uid state 2.
	if _, err := addFriend(ctx, logger, tx, uid, inviteSentUID.String(), ""); err != nil {
		t.Fatal(err)
	}

	// inviteRecvUID invites uid → inviteRecvUID→uid state 1, uid→inviteRecvUID state 2.
	if _, err := addFriend(ctx, logger, tx, inviteRecvUID, uid.String(), ""); err != nil {
		t.Fatal(err)
	}

	// uid blocks blockedUID → uid→blockedUID state 3.
	if err := blockFriend(ctx, logger, tx, &LocalTracker{}, uid, blockedUID.String()); err != nil {
		t.Fatal(err)
	}

	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}

	t.Run("returns empty map for empty input", func(t *testing.T) {
		out, err := GetFriendsStatus(ctx, logger, db, uid, nil)
		if err != nil {
			t.Fatal(err)
		}
		assert.Empty(t, out)
	})

	t.Run("returns -1 for stranger with no edge", func(t *testing.T) {
		out, err := GetFriendsStatus(ctx, logger, db, uid, []uuid.UUID{strangerUID})
		if err != nil {
			t.Fatal(err)
		}
		assert.Equal(t, map[string]int32{strangerUID.String(): -1}, out)
	})

	t.Run("returns mapped states and -1 for blocked / stranger", func(t *testing.T) {
		ids := []uuid.UUID{friendUID, inviteSentUID, inviteRecvUID, blockedUID, strangerUID}
		out, err := GetFriendsStatus(ctx, logger, db, uid, ids)
		if err != nil {
			t.Fatal(err)
		}

		assert.Equal(t, int32(api.Friend_FRIEND.Number()), out[friendUID.String()])
		assert.Equal(t, int32(api.Friend_INVITE_SENT.Number()), out[inviteSentUID.String()])
		assert.Equal(t, int32(api.Friend_INVITE_RECEIVED.Number()), out[inviteRecvUID.String()])
		// Blocker still sees -1 for blocked user (privacy: hides whether you blocked them
		// from being inferable via this API; matches the same answer a stranger would get).
		assert.Equal(t, int32(-1), out[blockedUID.String()])
		assert.Equal(t, int32(-1), out[strangerUID.String()])
		assert.Len(t, out, len(ids))
	})

	t.Run("response shape matches request shape", func(t *testing.T) {
		ids := []uuid.UUID{strangerUID, friendUID, strangerUID} // duplicates collapse via map keys
		out, err := GetFriendsStatus(ctx, logger, db, uid, ids)
		if err != nil {
			t.Fatal(err)
		}
		assert.Contains(t, out, strangerUID.String())
		assert.Contains(t, out, friendUID.String())
	})

	t.Run("returns -1 for valid UUID that has no user row", func(t *testing.T) {
		// UUID never inserted into users table. user_edge has no row either,
		// so it gets the same -1 as any stranger. GetFriendsStatus does not
		// distinguish "user doesn't exist" from "no edge" — the privacy model
		// matches the blocked-user case.
		ghostUID := uuid.Must(uuid.NewV4())
		out, err := GetFriendsStatus(ctx, logger, db, uid, []uuid.UUID{ghostUID})
		if err != nil {
			t.Fatal(err)
		}
		assert.Equal(t, map[string]int32{ghostUID.String(): -1}, out)
	})

	t.Run("runtime FriendsStatus rejects malformed id", func(t *testing.T) {
		nk := &RuntimeGoNakamaModule{logger: logger, db: db}
		_, err := nk.FriendsStatus(ctx, uid.String(), []string{"not-a-uuid"})
		assert.EqualError(t, err, "expects each id to be a valid user identifier")
	})

	t.Run("runtime FriendsStatus rejects malformed userID", func(t *testing.T) {
		nk := &RuntimeGoNakamaModule{logger: logger, db: db}
		_, err := nk.FriendsStatus(ctx, "garbage", []string{uuid.Must(uuid.NewV4()).String()})
		assert.EqualError(t, err, "expects user ID to be a valid identifier")
	})
}
