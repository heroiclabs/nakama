// Copyright 2018 The Nakama Authors
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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestJsObjectFreeze(t *testing.T) {
	t.Run("after freeze new global vars cannot be created", func(t *testing.T) {
		observer, _ := observer.New(zap.InfoLevel)
		logger := zap.New(observer)
		config := NewConfig(logger)
		config.Runtime.JsReadOnlyGlobals = true

		r := goja.New()
		freezeGlobalObject(config, r)

		p, _ := goja.Compile("test", `
var k = 'new string';
`, true)

		_, err := r.RunProgram(p)
		if err == nil {
			t.Errorf("should've thrown an error")
		}
		if !strings.Contains(err.Error(), "TypeError: Cannot define global variable 'k', global object is not extensible at test:1:1(0)") {
			t.Errorf("should've thrown an error")
		}
	})

	t.Run("after freeze global vars become immutable", func(t *testing.T) {
		observer, _ := observer.New(zap.InfoLevel)
		logger := zap.New(observer)
		config := NewConfig(logger)
		config.Runtime.JsReadOnlyGlobals = true

		r := goja.New()

		p, _ := goja.Compile("test", `
var m = {foo: 'bar'};
`, true)

		_, err := r.RunProgram(p)
		if err != nil {
			t.Errorf("failed to run script: %s", err.Error())
		}

		freezeGlobalObject(config, r)

		p, _ = goja.Compile("test", `
m.foo = 'baz';
`, true)

		_, err = r.RunProgram(p)
		if err == nil {
			t.Errorf("should've thrown an error")
		}
		if !strings.Contains(err.Error(), "TypeError: Cannot assign to read only property 'foo'") {
			t.Errorf("should've thrown an error")
		}
	})

	t.Run("after freeze newly instanced objects are mutable", func(t *testing.T) {
		observer, _ := observer.New(zap.InfoLevel)
		logger := zap.New(observer)
		config := NewConfig(logger)
		config.Runtime.JsReadOnlyGlobals = true

		r := goja.New()

		p, _ := goja.Compile("test", `
var m = new Map();
`, true)

		_, err := r.RunProgram(p)
		if err != nil {
			t.Error("Failed to run JS script")
		}

		freezeGlobalObject(config, r)

		p, _ = goja.Compile("test", `
m.set('a', 1);
m.get('a');
`, true)

		v, err := r.RunProgram(p)
		if err != nil {
			t.Errorf("failed to run script: %s", err.Error())
		}

		if v.String() != "1" {
			t.Errorf("expected returned value to be '1'")
		}
	})
}

type captureDeferredMessageRouter struct {
	mu        sync.Mutex
	envelopes []*rtapi.Envelope
}

func (r *captureDeferredMessageRouter) SendToPresenceIDs(_ *zap.Logger, _ []*PresenceID, envelope *rtapi.Envelope, _ bool) {
	r.mu.Lock()
	r.envelopes = append(r.envelopes, envelope)
	r.mu.Unlock()
}

func (r *captureDeferredMessageRouter) SendToStream(*zap.Logger, PresenceStream, *rtapi.Envelope, bool) {
}

func (r *captureDeferredMessageRouter) SendDeferred(_ *zap.Logger, messages []*DeferredMessage) {
	r.mu.Lock()
	for _, msg := range messages {
		r.envelopes = append(r.envelopes, msg.Envelope)
	}
	r.mu.Unlock()
}

func (r *captureDeferredMessageRouter) SendToAll(*zap.Logger, *rtapi.Envelope, bool) {}

func (r *captureDeferredMessageRouter) Snapshot() []*rtapi.Envelope {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*rtapi.Envelope, len(r.envelopes))
	copy(out, r.envelopes)
	return out
}

func TestJsMatchBroadcastSenderUsernamePreservedAndValidated(t *testing.T) {
	jsModule := `
function matchInit(ctx, logger, nk, params) {
	return { state: {}, tickRate: 10, label: "test" };
}
function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
	return { state: state, accept: true };
}
function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
	return { state: state };
}
function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
	return { state: state };
}
function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
	for (var i = 0; i < messages.length; i++) {
		var m = messages[i];
		dispatcher.broadcastMessage(m.opCode, m.data, null, m.sender, true);
		dispatcher.broadcastMessageDeferred(m.opCode + 1, m.data, [m.sender], m.sender, true);
	}
	return { state: state };
}
function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
	return { state: state };
}
function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
	if (data === "bad_username") {
		dispatcher.broadcastMessage(99, "x", null, {
			userId: "11111111-1111-1111-1111-111111111111",
			sessionId: "22222222-2222-2222-2222-222222222222",
			username: 12345
		}, true);
	}
	return { state: state, data: "ok" };
}
var InitModule = function(ctx, logger, nk, initializer) {
	initializer.registerMatch("echo", {
		matchInit: matchInit,
		matchJoinAttempt: matchJoinAttempt,
		matchJoin: matchJoin,
		matchLeave: matchLeave,
		matchLoop: matchLoop,
		matchTerminate: matchTerminate,
		matchSignal: matchSignal
	});
};
`
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, JsEntrypointFilename), []byte(jsModule), 0o600))

	testLogger := loggerForTest(t)
	localCfg := NewConfig(testLogger)
	localCfg.Runtime.Path = dir
	localCfg.Runtime.JsEntrypoint = JsEntrypointFilename
	localCfg.Match.LabelUpdateIntervalMs = int(time.Hour / time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db := NewDB(t)
	defer db.Close()

	router := &captureDeferredMessageRouter{}
	sessionRegistry := NewLocalSessionRegistry(metrics)
	tracker := StartLocalTracker(testLogger, localCfg, sessionRegistry, NewLocalStatusRegistry(testLogger, localCfg, sessionRegistry, protojsonMarshaler), metrics, protojsonMarshaler)
	defer tracker.Stop()

	matchRegistry := NewLocalMatchRegistry(testLogger, testLogger, localCfg, sessionRegistry, tracker, router, metrics, "node")
	defer matchRegistry.Stop(0)
	tracker.SetMatchJoinListener(matchRegistry.Join)
	tracker.SetMatchLeaveListener(matchRegistry.Leave)

	lbCache := NewLocalLeaderboardCache(ctx, testLogger, testLogger, db)
	lbRankCache := NewLocalLeaderboardRankCache(ctx, testLogger, db, localCfg.Leaderboard, lbCache)
	lbSched := NewLocalLeaderboardScheduler(testLogger, db, localCfg, lbCache, lbRankCache)

	rt, _, err := NewRuntime(ctx, testLogger, testLogger, db, protojsonMarshaler, protojsonUnmarshaler, localCfg, "", nil, lbCache, lbRankCache, lbSched, sessionRegistry, nil, nil, matchRegistry, nil, tracker, metrics, nil, router, storageIdx, nil)
	require.NoError(t, err)

	createFn := rt.MatchCreateFunction()
	matchIDStr, err := matchRegistry.CreateMatch(ctx, createFn, "echo", nil)
	require.NoError(t, err)
	matchID, err := matchUUIDFromString(matchIDStr)
	require.NoError(t, err)

	userID := uuid.Must(uuid.NewV4())
	sessionID := uuid.Must(uuid.NewV4())
	username := "player_alice"

	found, allow, _, _, _, _ := matchRegistry.JoinAttempt(ctx, matchID, "node", userID, sessionID, username, 0, nil, "", "", "node", nil)
	require.True(t, found)
	require.True(t, allow)
	matchRegistry.Join(matchID, []*MatchPresence{{
		Node:      "node",
		UserID:    userID,
		SessionID: sessionID,
		Username:  username,
	}})

	require.Eventually(t, func() bool {
		m, _, getErr := matchRegistry.GetMatch(ctx, matchIDStr)
		return getErr == nil && m != nil && m.Size == 1
	}, 2*time.Second, 20*time.Millisecond)

	matchRegistry.SendData(matchID, "node", userID, sessionID, username, "node", 7, []byte("hello"), true, time.Now().UnixMilli())

	require.Eventually(t, func() bool {
		return len(router.Snapshot()) >= 2
	}, 2*time.Second, 20*time.Millisecond)

	envelopes := router.Snapshot()
	for i, env := range envelopes[:2] {
		md := env.GetMatchData()
		require.NotNil(t, md, "envelope %d missing MatchData", i)
		require.NotNil(t, md.Presence, "envelope %d missing sender Presence", i)
		require.Equal(t, userID.String(), md.Presence.UserId)
		require.Equal(t, sessionID.String(), md.Presence.SessionId)
		require.Equal(t, username, md.Presence.Username)
	}

	// Non-string sender.username must trigger a TypeError and stop the match via signal error.
	_, err = matchRegistry.Signal(ctx, matchIDStr, "bad_username")
	require.Error(t, err)
}
