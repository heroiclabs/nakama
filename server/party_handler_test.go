// Copyright 2022 The Nakama Authors
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
	"syscall"
	"testing"
	"time"

	"github.com/blugelabs/bluge"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

// should add and remove from PartyMatchmaker
func TestPartyMatchmakerAddAndRemove(t *testing.T) {
	consoleLogger := loggerForTest(t)
	presence := &rtapi.UserPresence{
		UserId:    uuid.Must(uuid.NewV4()).String(),
		SessionId: uuid.Must(uuid.NewV4()).String(),
		Username:  "username1",
	}
	partyHandler, cleanup := createTestPartyHandler(t, consoleLogger, presence)
	defer cleanup()

	sessionID := uuid.FromStringOrNil(presence.SessionId)
	userID := uuid.FromStringOrNil(presence.UserId)
	node := "node1"

	partyHandler.Join([]*Presence{&Presence{
		ID: PresenceID{
			Node:      node,
			SessionID: sessionID,
		},
		// Presence stream not needed.
		UserID: userID,
		Meta: PresenceMeta{
			Username: presence.Username,
			// Other meta fields not needed.
		},
	}})

	ticket, _, err := partyHandler.MatchmakerAdd(sessionID.String(), node, "", 1, 1, 1, nil, nil)
	if err != nil {
		t.Fatalf("MatchmakerAdd error %s", err)
	}

	err = partyHandler.MatchmakerRemove(sessionID.String(), node, ticket)
	if err != nil {
		t.Fatalf("MatchmakerRemove error %s", err)
	}
}

func createTestPartyHandler(t *testing.T, logger *zap.Logger, presence *rtapi.UserPresence) (*PartyHandler, func() error) {
	node := "node1"

	mm, cleanup, _ := createTestMatchmaker(t, logger, true, nil)
	tt := testTracker{}
	tsm := testStreamManager{}

	dmr := DummyMessageRouter{}

	pr := NewLocalPartyRegistry(context.Background(), logger, logger, cfg, node, metrics)
	pr.Init(mm, &tt, &tsm, &dmr)
	ph := NewPartyHandler(logger, pr, mm, &tt, &tsm, &dmr, uuid.UUID{}, node, true, 10, presence)
	return ph, cleanup
}

func TestPartyListCursorOpenParamMismatchWithoutNilDereference(t *testing.T) {
	consoleLogger := loggerForTest(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	localCfg := NewConfig(consoleLogger)
	localCfg.GetParty().LabelUpdateIntervalMs = int(time.Hour / time.Millisecond)

	mm, cleanup, _ := createTestMatchmaker(t, consoleLogger, true, nil)
	defer cleanup()

	pr := NewLocalPartyRegistry(ctx, consoleLogger, consoleLogger, localCfg, "node1", metrics).(*LocalPartyRegistry)
	pr.Init(mm, &testTracker{}, &testStreamManager{}, &DummyMessageRouter{})

	for i := range 2 {
		presence := &rtapi.UserPresence{
			UserId:    uuid.Must(uuid.NewV4()).String(),
			SessionId: uuid.Must(uuid.NewV4()).String(),
			Username:  "user",
		}
		_, err := pr.Create(i == 0, false, 4, presence, `{}`)
		require.NoError(t, err)
	}
	pr.processUpdates(bluge.NewBatch())

	openTrue := true
	openFalse := false

	// Cursor created with open=nil, reused with open=true -> must return mismatch error, not panic.
	_, cursorFromNil, err := pr.PartyList(ctx, 1, nil, false, "*", "")
	require.NoError(t, err)
	require.NotEmpty(t, cursorFromNil)

	_, _, err = pr.PartyList(ctx, 1, &openTrue, false, "*", cursorFromNil)
	require.ErrorContains(t, err, "invalid cursor: param open mismatch")

	// Cursor created with open=nil, reused with open=nil -> must succeed.
	nextParties, nextCursor, err := pr.PartyList(ctx, 1, nil, false, "*", cursorFromNil)
	require.NoError(t, err)
	require.Len(t, nextParties, 1)
	require.Empty(t, nextCursor)

	// Cursor created with open=true, reused with open=nil -> must return mismatch error, not panic.
	// Create a second open party so limit=1 yields a non-empty cursor when open=true.
	_, err = pr.Create(true, false, 4, &rtapi.UserPresence{
		UserId:    uuid.Must(uuid.NewV4()).String(),
		SessionId: uuid.Must(uuid.NewV4()).String(),
		Username:  "user3",
	}, `{}`)
	require.NoError(t, err)
	pr.processUpdates(bluge.NewBatch())

	_, cursorFromTrue, err := pr.PartyList(ctx, 1, &openTrue, false, "*", "")
	require.NoError(t, err)
	require.NotEmpty(t, cursorFromTrue)

	_, _, err = pr.PartyList(ctx, 1, nil, false, "*", cursorFromTrue)
	require.ErrorContains(t, err, "invalid cursor: param open mismatch")

	_, _, err = pr.PartyList(ctx, 1, &openFalse, false, "*", cursorFromTrue)
	require.ErrorContains(t, err, "invalid cursor: param open mismatch")

	nextOpenParties, _, err := pr.PartyList(ctx, 1, &openTrue, false, "*", cursorFromTrue)
	require.NoError(t, err)
	require.Len(t, nextOpenParties, 1)
}

func TestApiListPartiesCursorOpenParamMismatchE2E(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rt, _, err := runtimeWithModules(t, map[string]string{})
	require.NoError(t, err)

	db := NewDB(t)
	defer db.Close()

	localCfg := NewConfig(logger)
	localCfg.GetParty().LabelUpdateIntervalMs = int(time.Hour / time.Millisecond)

	router := &DummyMessageRouter{}
	sessionCache := NewLocalSessionCache(3_600, 7_200)
	sessionRegistry := NewLocalSessionRegistry(metrics)
	statusRegistry := NewLocalStatusRegistry(logger, localCfg, sessionRegistry, protojsonMarshaler)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	mm, mmCleanup, _ := createTestMatchmaker(t, logger, true, nil)
	defer mmCleanup()

	partyRegistry := NewLocalPartyRegistry(ctx, logger, logger, localCfg, localCfg.GetName(), metrics).(*LocalPartyRegistry)
	partyRegistry.Init(mm, tracker, &testStreamManager{}, router)

	for range 2 {
		_, err := partyRegistry.Create(true, false, 4, &rtapi.UserPresence{
			UserId:    uuid.Must(uuid.NewV4()).String(),
			SessionId: uuid.Must(uuid.NewV4()).String(),
			Username:  "leader",
		}, `{}`)
		require.NoError(t, err)
	}
	partyRegistry.processUpdates(bluge.NewBatch())

	pipeline := NewPipeline(logger, localCfg, db, protojsonMarshaler, protojsonUnmarshaler, sessionRegistry, statusRegistry, nil, partyRegistry, mm, tracker, router, rt, metrics)
	apiServer := StartApiServer(logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, localCfg, "3.0.0", nil, storageIdx, nil, nil, sessionRegistry, sessionCache, statusRegistry, nil, partyRegistry, mm, tracker, router, nil, metrics, pipeline, rt)
	WaitForSocket(nil, localCfg)
	defer func() {
		apiServer.Stop()
		WaitForSocket(syscall.ECONNREFUSED, localCfg)
	}()

	conn, client, _, rpcCtx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())
	defer conn.Close()

	page1, err := client.ListParties(rpcCtx, &api.ListPartiesRequest{
		Limit: wrapperspb.Int32(1),
	})
	require.NoError(t, err)
	require.Len(t, page1.Parties, 1)
	require.NotEmpty(t, page1.Cursor)

	// Reusing an unfiltered cursor with Open=true over gRPC must return an error instead of crashing/panicking the handler.
	_, err = client.ListParties(rpcCtx, &api.ListPartiesRequest{
		Limit:  wrapperspb.Int32(1),
		Open:   wrapperspb.Bool(true),
		Cursor: wrapperspb.String(page1.Cursor),
	})
	require.Error(t, err)
}
