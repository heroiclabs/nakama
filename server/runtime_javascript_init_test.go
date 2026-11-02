// Copyright 2026 The Nakama Authors
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
	"testing"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestJavascriptModuleLoadsInitModuleDeclaredAfterAnotherBinding(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.js"), []byte(`
var other = 1, InitModule = function(ctx, logger, nk, initializer) {
  initializer.registerRpc('ping', rpcPing);
};

function rpcPing(ctx, logger, nk, payload) {
  return payload;
}
`), 0o644))

	config := NewConfig(zap.NewNop())
	modCache, err := cacheJavascriptModules(zap.NewNop(), dir, "")
	require.NoError(t, err)
	matchHandlers := &RuntimeJavascriptMatchHandlers{mapping: make(map[string]*jsMatchHandlers)}

	callbacks, err := evalRuntimeModules(&RuntimeProviderJS{logger: zap.NewNop(), config: config}, modCache, matchHandlers, nil, nil, nil, nil, func(RuntimeExecutionMode, string) {}, false)

	require.NoError(t, err)
	require.Equal(t, "rpcPing", callbacks.Rpc["ping"])
}

func TestJavascriptModuleRegistersMatchHandlerDeclaredAfterAnotherBinding(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.js"), []byte(`
var other = 1, handler = {
  matchInit: matchInit,
  matchJoinAttempt: matchJoinAttempt,
  matchJoin: matchJoin,
  matchLeave: matchLeave,
  matchLoop: matchLoop,
  matchTerminate: matchTerminate,
  matchSignal: matchSignal
};

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerMatch('lobby', handler);
}

function matchInit(ctx, logger, nk, params) { return { state: {}, tickRate: 1, label: '' }; }
function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) { return { state: state, accept: true }; }
function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) { return { state: state }; }
function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) { return { state: state }; }
function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) { return { state: state }; }
function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) { return { state: state }; }
function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) { return { state: state, data: data }; }
`), 0o644))

	config := NewConfig(zap.NewNop())
	modCache, err := cacheJavascriptModules(zap.NewNop(), dir, "")
	require.NoError(t, err)
	matchHandlers := &RuntimeJavascriptMatchHandlers{mapping: make(map[string]*jsMatchHandlers)}

	_, err = evalRuntimeModules(&RuntimeProviderJS{logger: zap.NewNop(), config: config}, modCache, matchHandlers, nil, nil, nil, nil, func(RuntimeExecutionMode, string) {}, false)

	require.NoError(t, err)
	require.NotNil(t, matchHandlers.Get("lobby"))
	require.Equal(t, "matchInit", matchHandlers.Get("lobby").initFn)
	require.Equal(t, "matchSignal", matchHandlers.Get("lobby").signalFn)
}

func TestRuntimeJavascriptRequestHooksRun(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name   string
		module string
		invoke func(t *testing.T, r *Runtime) error
	}{
		{
			name: "before ListFriendsOfFriends",
			module: `function hook(ctx, logger, nk, data) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerBeforeListFriendsOfFriends(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.BeforeListFriendsOfFriends()
				require.NotNil(t, fn)
				_, err, _ := fn(ctx, logger, "", "", "", nil, 0, "", "", &api.ListFriendsOfFriendsRequest{})
				return err
			},
		},
		{
			name: "after ListFriendsOfFriends",
			module: `function hook(ctx, logger, nk, data, request) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerAfterListFriendsOfFriends(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.AfterListFriendsOfFriends()
				require.NotNil(t, fn)
				return fn(ctx, logger, "", "", "", nil, 0, "", "", &api.FriendsOfFriendsList{})
			},
		},
		{
			name: "before GetMatchmakerStats",
			module: `function hook(ctx, logger, nk, data) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerBeforeGetMatchmakerStats(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.BeforeGetMatchmakerStats()
				require.NotNil(t, fn)
				err, _ := fn(ctx, logger, "", "", "", nil, 0, "", "")
				return err
			},
		},
		{
			name: "after GetMatchmakerStats",
			module: `function hook(ctx, logger, nk, data, request) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerAfterGetMatchmakerStats(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.AfterGetMatchmakerStats()
				require.NotNil(t, fn)
				return fn(ctx, logger, "", "", "", nil, 0, "", "", &api.MatchmakerStats{})
			},
		},
		{
			name: "before ImportSteamFriends",
			module: `function hook(ctx, logger, nk, data) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerBeforeImportSteamFriends(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.BeforeImportSteamFriends()
				require.NotNil(t, fn)
				_, err, _ := fn(ctx, logger, "", "", "", nil, 0, "", "", &api.ImportSteamFriendsRequest{})
				return err
			},
		},
		{
			name: "after ImportSteamFriends",
			module: `function hook(ctx, logger, nk, data, request) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerAfterImportSteamFriends(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.AfterImportSteamFriends()
				require.NotNil(t, fn)
				return fn(ctx, logger, "", "", "", nil, 0, "", "", &api.ImportSteamFriendsRequest{})
			},
		},
		{
			name: "before DeleteTournamentRecord",
			module: `function hook(ctx, logger, nk, data) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerBeforeDeleteTournamentRecord(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.BeforeDeleteTournamentRecord()
				require.NotNil(t, fn)
				_, err, _ := fn(ctx, logger, "", "", "", nil, 0, "", "", &api.DeleteTournamentRecordRequest{})
				return err
			},
		},
		{
			name: "after DeleteTournamentRecord",
			module: `function hook(ctx, logger, nk, data, request) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerAfterDeleteTournamentRecord(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.AfterDeleteTournamentRecord()
				require.NotNil(t, fn)
				return fn(ctx, logger, "", "", "", nil, 0, "", "", &api.DeleteTournamentRecordRequest{})
			},
		},
		{
			name: "before ListParties",
			module: `function hook(ctx, logger, nk, data) {
  throw new Error("hook ran");
}

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerBeforeListParties(hook);
}`,
			invoke: func(t *testing.T, r *Runtime) error {
				fn := r.BeforeListParties()
				require.NotNil(t, fn)
				_, err, _ := fn(ctx, logger, "", "", "", nil, 0, "", "", &api.ListPartiesRequest{})
				return err
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, _, err := runtimeWithModules(t, map[string]string{"index.js": tc.module})
			require.NoError(t, err)

			err = tc.invoke(t, r)
			require.ErrorContains(t, err, "hook ran", "failed to call hook")
		})
	}
}
