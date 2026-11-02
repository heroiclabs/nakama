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
	"os"
	"path/filepath"
	"testing"

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
