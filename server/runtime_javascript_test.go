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
	"github.com/heroiclabs/nakama-common/runtime"
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

type disconnectTrackingSessionRegistry struct {
	testSessionRegistry
	mu           sync.Mutex
	disconnected []uuid.UUID
}

func (s *disconnectTrackingSessionRegistry) Disconnect(_ context.Context, sessionID uuid.UUID, _ bool, _ ...runtime.PresenceReason) error {
	s.mu.Lock()
	s.disconnected = append(s.disconnected, sessionID)
	s.mu.Unlock()
	return nil
}

func (s *disconnectTrackingSessionRegistry) DisconnectedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.disconnected)
}

func TestJsMatchTerminateAndSignalHandleNullOrUndefinedReturnGracefully(t *testing.T) {
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
	return { state: state };
}
function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
	if (graceSeconds === 1) {
		return null;
	}
	return undefined;
}
function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
	if (data === "close_null") {
		return null;
	}
	if (data === "close_undef") {
		return undefined;
	}
	return { state: state, data: "alive" };
}
var InitModule = function(ctx, logger, nk, initializer) {
	initializer.registerMatch("stop_test", {
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

	obsCore, recordedLogs := observer.New(zap.WarnLevel)
	testLogger := zap.New(obsCore)

	localCfg := NewConfig(testLogger)
	localCfg.Runtime.Path = dir
	localCfg.Runtime.JsEntrypoint = JsEntrypointFilename
	localCfg.Match.LabelUpdateIntervalMs = int(time.Hour / time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db := NewDB(t)
	defer db.Close()

	setupEnv := func() (MatchRegistry, RuntimeMatchCreateFunction, *disconnectTrackingSessionRegistry) {
		sr := &disconnectTrackingSessionRegistry{}
		router := &DummyMessageRouter{}
		tracker := &testTracker{}
		mr := NewLocalMatchRegistry(testLogger, testLogger, localCfg, sr, tracker, router, metrics, "node")

		lbCache := NewLocalLeaderboardCache(ctx, testLogger, testLogger, db)
		lbRankCache := NewLocalLeaderboardRankCache(ctx, testLogger, db, localCfg.Leaderboard, lbCache)
		lbSched := NewLocalLeaderboardScheduler(testLogger, db, localCfg, lbCache, lbRankCache)

		rt, _, err := NewRuntime(ctx, testLogger, testLogger, db, protojsonMarshaler, protojsonUnmarshaler, localCfg, "", nil, lbCache, lbRankCache, lbSched, sr, nil, nil, mr, nil, tracker, metrics, nil, router, storageIdx, nil)
		require.NoError(t, err)
		return mr, rt.MatchCreateFunction(), sr
	}

	addParticipant := func(mr MatchRegistry, matchIDStr string) uuid.UUID {
		matchID, err := matchUUIDFromString(matchIDStr)
		require.NoError(t, err)
		uid := uuid.Must(uuid.NewV4())
		sid := uuid.Must(uuid.NewV4())
		found, allow, _, _, _, _ := mr.JoinAttempt(ctx, matchID, "node", uid, sid, "user", 0, nil, "", "", "node", nil)
		require.True(t, found)
		require.True(t, allow)
		mr.Join(matchID, []*MatchPresence{{Node: "node", UserID: uid, SessionID: sid, Username: "user"}})
		require.Eventually(t, func() bool {
			m, _, err := mr.GetMatch(ctx, matchIDStr)
			return err == nil && m != nil && m.Size == 1
		}, 2*time.Second, 20*time.Millisecond)
		return sid
	}

	// 1. matchSignal returning null or undefined stops the match cleanly without disconnecting clients.
	mrSig, createSig, srSig := setupEnv()
	defer mrSig.Stop(0)

	for _, sigPayload := range []string{"close_null", "close_undef"} {
		matchIDStr, err := mrSig.CreateMatch(ctx, createSig, "stop_test", nil)
		require.NoError(t, err)
		addParticipant(mrSig, matchIDStr)

		_, _ = mrSig.Signal(ctx, matchIDStr, sigPayload)

		require.Eventually(t, func() bool {
			m, _, err := mrSig.GetMatch(ctx, matchIDStr)
			return err == nil && m == nil
		}, 2*time.Second, 20*time.Millisecond)
		require.Equal(t, 0, srSig.DisconnectedCount(), "graceful null/undefined signal return must not disconnect client sessions")
	}

	// 2. matchTerminate returning null or undefined stops the match cleanly without disconnecting clients.
	for _, graceSec := range []int{1, 2} {
		mrTerm, createTerm, srTerm := setupEnv()
		matchIDStr, err := mrTerm.CreateMatch(ctx, createTerm, "stop_test", nil)
		require.NoError(t, err)
		addParticipant(mrTerm, matchIDStr)

		select {
		case <-mrTerm.Stop(graceSec):
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for graceful match termination (grace=%d)", graceSec)
		}
		require.Equal(t, 0, srTerm.DisconnectedCount(), "graceful null/undefined terminate return must not disconnect client sessions")
	}

	for _, entry := range recordedLogs.All() {
		require.NotContains(t, entry.Message, "Stopping match after error from match_terminate execution")
		require.NotContains(t, entry.Message, "Stopping match after error from match_signal execution")
	}
}
