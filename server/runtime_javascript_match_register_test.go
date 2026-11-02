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

	"github.com/dop251/goja"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestJsRegisterMatchResolvesQuotedAndUnquotedKeysAlike(t *testing.T) {
	handlerFns := `
function matchInit() {}
function matchJoinAttempt() {}
function matchJoin() {}
function matchLeave() {}
function matchLoop() {}
function matchTerminate() {}
function matchSignal() {}
`
	expected := &jsMatchHandlers{
		initFn:        "matchInit",
		joinAttemptFn: "matchJoinAttempt",
		joinFn:        "matchJoin",
		leaveFn:       "matchLeave",
		loopFn:        "matchLoop",
		terminateFn:   "matchTerminate",
		signalFn:      "matchSignal",
	}

	cases := []struct {
		name       string
		initModule string
	}{
		{
			name: "unquoted keys",
			initModule: `
				var InitModule = function(ctx, logger, nk, initializer) {
					initializer.registerMatch("lobby", {
						matchInit: matchInit,
						matchJoinAttempt: matchJoinAttempt,
						matchJoin: matchJoin,
						matchLeave: matchLeave,
						matchLoop: matchLoop,
						matchTerminate: matchTerminate,
						matchSignal: matchSignal
					});
				};`,
		},
		{
			name: "double-quoted keys",
			initModule: `
				var InitModule = function(ctx, logger, nk, initializer) {
					initializer.registerMatch("lobby", {
						"matchInit": matchInit,
						"matchJoinAttempt": matchJoinAttempt,
						"matchJoin": matchJoin,
						"matchLeave": matchLeave,
						"matchLoop": matchLoop,
						"matchTerminate": matchTerminate,
						"matchSignal": matchSignal
					});
				};`,
		},
		{
			name: "single-quoted keys",
			initModule: `
				var InitModule = function(ctx, logger, nk, initializer) {
					initializer.registerMatch("lobby", {
						'matchInit': matchInit,
						'matchJoinAttempt': matchJoinAttempt,
						'matchJoin': matchJoin,
						'matchLeave': matchLeave,
						'matchLoop': matchLoop,
						'matchTerminate': matchTerminate,
						'matchSignal': matchSignal
					});
				};`,
		},
		{
			name: "handlers object declared separately with quoted keys",
			initModule: `
				var handlers = {
					"matchInit": matchInit,
					"matchJoinAttempt": matchJoinAttempt,
					"matchJoin": matchJoin,
					"matchLeave": matchLeave,
					"matchLoop": matchLoop,
					"matchTerminate": matchTerminate,
					"matchSignal": matchSignal
				};
				var InitModule = function(ctx, logger, nk, initializer) {
					initializer.registerMatch("lobby", handlers);
				};`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			entrypoint := filepath.Join(dir, JsEntrypointFilename)
			err := os.WriteFile(entrypoint, []byte(handlerFns+tc.initModule), 0o600) // only the owner can read and write
			require.NoError(t, err)

			logger := zap.NewNop()
			modCache, err := cacheJavascriptModules(logger, dir, "")
			require.NoError(t, err)
			mod := modCache.Modules[modCache.Names[0]]

			matchHandlers := &RuntimeJavascriptMatchHandlers{mapping: make(map[string]*jsMatchHandlers)}
			callbacks := &RuntimeJavascriptCallbacks{}
			initializer := NewRuntimeJavascriptInitModule(logger, NewConfig(logger), mod.Ast, nil, callbacks, matchHandlers, nil)

			r := goja.New()
			init, err := initializer.Constructor(r)
			require.NoError(t, err)
			_, err = r.RunProgram(mod.Program)
			require.NoError(t, err)
			initModFn, ok := goja.AssertFunction(r.Get(INIT_MODULE_FN_NAME))
			require.True(t, ok)

			_, err = initModFn(goja.Null(), goja.Null(), goja.Null(), goja.Null(), init)
			require.NoError(t, err)
			require.Equal(t, expected, matchHandlers.Get("lobby"))
		})
	}
}
