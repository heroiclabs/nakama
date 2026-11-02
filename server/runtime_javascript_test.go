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
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	rt "github.com/heroiclabs/nakama-common/runtime"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func TestJsNestedProviderCallsOnSingleVmPool(t *testing.T) {
	testCases := []struct {
		name       string
		modules    map[string]string
		beforeHook bool
	}{
		{
			name: "rpc authenticates through a provider",
			modules: map[string]string{"index.js": `
function provider(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function rpc(ctx, logger, nk, payload) {
	return nk.authenticate("vmreuse_js_rpc", { id: "vm-reuse-js-rpc" }).userId;
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_rpc", provider);
	initializer.registerRpc("authenticate", rpc);
}`},
		},
		{
			name: "before hook authenticates through a provider",
			modules: map[string]string{"index.js": `
function provider(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function before(ctx, logger, nk) {
	nk.authenticate("vmreuse_js_before", { id: "vm-reuse-js-before" });
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_before", provider);
	initializer.registerBeforeGetAccount(before);
}`},
			beforeHook: true,
		},
		{
			name: "rpc authenticates through a provider twice",
			modules: map[string]string{"index.js": `
function provider(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function rpc(ctx, logger, nk, payload) {
	nk.authenticate("vmreuse_js_twice", { id: "vm-reuse-js-twice-1" });
	return nk.authenticate("vmreuse_js_twice", { id: "vm-reuse-js-twice-2" }).userId;
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_twice", provider);
	initializer.registerRpc("authenticate", rpc);
}`},
		},
		{
			name: "provider authenticates through another provider",
			modules: map[string]string{"index.js": `
function inner(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function outer(ctx, logger, nk, payload) {
	nk.authenticate("vmreuse_js_depth_inner", { id: payload.id + "-inner" });
	return { providerUserId: payload.id };
}
function rpc(ctx, logger, nk, payload) {
	return nk.authenticate("vmreuse_js_depth_outer", { id: "vm-reuse-js-depth" }).userId;
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_depth_inner", inner);
	initializer.registerAuthenticateProvider("vmreuse_js_depth_outer", outer);
	initializer.registerRpc("authenticate", rpc);
}`},
		},
		{
			name: "provider recovers from a failing nested provider and authenticates again",
			modules: map[string]string{"index.js": `
function failing(ctx, logger, nk, payload) {
	throw new Error("vm-reuse-js-failing-provider");
}
function inner(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function outer(ctx, logger, nk, payload) {
	let failed = false;
	try {
		nk.authenticate("vmreuse_js_error_failing", { id: payload.id + "-failing" });
	} catch (e) {
		failed = true;
	}
	if (!failed) {
		throw new Error("expected the failing provider to throw");
	}
	nk.authenticate("vmreuse_js_error_inner", { id: payload.id + "-inner" });
	return { providerUserId: payload.id };
}
function rpc(ctx, logger, nk, payload) {
	return nk.authenticate("vmreuse_js_error_outer", { id: "vm-reuse-js-error" }).userId;
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_error_failing", failing);
	initializer.registerAuthenticateProvider("vmreuse_js_error_inner", inner);
	initializer.registerAuthenticateProvider("vmreuse_js_error_outer", outer);
	initializer.registerRpc("authenticate", rpc);
}`},
		},
		{
			name: "provider called from a Lua rpc authenticates through another provider",
			modules: map[string]string{
				"mod": `
local nk = require("nakama")
local function rpc(context, payload)
	local user_id = nk.authenticate("vmreuse_js_cross_outer", {id = "vm-reuse-js-cross"})
	return user_id
end
nk.register_rpc(rpc, "authenticate")`,
				"index.js": `
function inner(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function outer(ctx, logger, nk, payload) {
	nk.authenticate("vmreuse_js_cross_inner", { id: payload.id + "-inner" });
	return { providerUserId: payload.id };
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_cross_inner", inner);
	initializer.registerAuthenticateProvider("vmreuse_js_cross_outer", outer);
}`,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			runtime, _, _, err := runtimeWithModulesWithData(t, tc.modules, func(c *RuntimeConfig) {
				c.LuaMinCount, c.LuaMaxCount = 1, 1
				c.JsMinCount, c.JsMaxCount = 1, 1
			})
			require.NoError(t, err)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			type result struct {
				payload string
				err     error
			}
			for range 2 {
				done := make(chan result, 1)
				go func() {
					if tc.beforeHook {
						err, _ := runtime.BeforeGetAccount()(ctx, logger, "", "", "", nil, 0, "", "")
						done <- result{err: err}
						return
					}
					payload, err, _ := runtime.Rpc("authenticate")(ctx, nil, nil, "", "", "", nil, 0, "", "", "", "", "")
					done <- result{payload: payload, err: err}
				}()

				var res result
				select {
				case res = <-done:
				case <-time.After(time.Second):
					t.Fatal("nested provider call stalled on the single-VM pool")
				}
				require.NoError(t, res.err)
				if !tc.beforeHook {
					require.False(t, uuid.FromStringOrNil(res.payload).IsNil(), "expected a user id, got %q", res.payload)
				}
			}
		})
	}
}

func TestJsNestedProviderCallsFromServerHooksOnSingleVmPool(t *testing.T) {
	testCases := []struct {
		name     string
		register string
		call     func(ctx context.Context, runtime *Runtime) error
	}{
		{
			name:     "matchmaker matched hook authenticates through a provider",
			register: "registerMatchmakerMatched",
			call: func(ctx context.Context, runtime *Runtime) error {
				_, _, err := runtime.MatchmakerMatched()(ctx, []*MatchmakerEntry{})
				return err
			},
		},
		{
			name:     "tournament end hook authenticates through a provider",
			register: "registerTournamentEnd",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.TournamentEnd()(ctx, &api.Tournament{Metadata: "{}", CreateTime: timestamppb.Now(), StartTime: timestamppb.Now()}, 0, 0)
			},
		},
		{
			name:     "tournament reset hook authenticates through a provider",
			register: "registerTournamentReset",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.TournamentReset()(ctx, &api.Tournament{Metadata: "{}", CreateTime: timestamppb.Now(), StartTime: timestamppb.Now()}, 0, 0)
			},
		},
		{
			name:     "leaderboard reset hook authenticates through a provider",
			register: "registerLeaderboardReset",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.LeaderboardReset()(ctx, &api.Leaderboard{Metadata: "{}", CreateTime: timestamppb.Now()}, 0)
			},
		},
		{
			name:     "shutdown hook authenticates through a provider",
			register: "registerShutdown",
			call: func(ctx context.Context, runtime *Runtime) error {
				runtime.Shutdown()(ctx)
				return nil
			},
		},
		{
			name:     "apple purchase notification hook authenticates through a provider",
			register: "registerPurchaseNotificationApple",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.PurchaseNotificationApple()(ctx, rt.IAPNotificationRefunded, &api.ValidatedPurchase{ProductId: "product", PurchaseTime: timestamppb.Now()}, &rt.AppleNotificationData{})
			},
		},
		{
			name:     "apple subscription notification hook authenticates through a provider",
			register: "registerSubscriptionNotificationApple",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.SubscriptionNotificationApple()(ctx, rt.IAPNotificationCancelled, &api.ValidatedSubscription{ProductId: "product", PurchaseTime: timestamppb.Now(), ExpiryTime: timestamppb.Now()}, &rt.AppleNotificationData{})
			},
		},
		{
			name:     "google purchase notification hook authenticates through a provider",
			register: "registerPurchaseNotificationGoogle",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.PurchaseNotificationGoogle()(ctx, rt.IAPNotificationRefunded, &api.ValidatedPurchase{ProductId: "product", PurchaseTime: timestamppb.Now()}, &rt.PurchaseV2GoogleResponse{})
			},
		},
		{
			name:     "google subscription notification hook authenticates through a provider",
			register: "registerSubscriptionNotificationGoogle",
			call: func(ctx context.Context, runtime *Runtime) error {
				return runtime.SubscriptionNotificationGoogle()(ctx, rt.IAPNotificationCancelled, &api.ValidatedSubscription{ProductId: "product", PurchaseTime: timestamppb.Now(), ExpiryTime: timestamppb.Now()}, &rt.SubscriptionV2GoogleResponse{})
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			modules := map[string]string{"index.js": fmt.Sprintf(`
function provider(ctx, logger, nk, payload) {
	return { providerUserId: payload.id };
}
function hook(ctx, logger, nk) {
	nk.authenticate("vmreuse_js_hook", { id: "vm-reuse-js-%s" });
}
function InitModule(ctx, logger, nk, initializer) {
	initializer.registerAuthenticateProvider("vmreuse_js_hook", provider);
	initializer.%s(hook);
}`, tc.register, tc.register)}
			runtime, _, _, err := runtimeWithModulesWithData(t, modules, func(c *RuntimeConfig) {
				c.JsMinCount, c.JsMaxCount = 1, 1
			})
			require.NoError(t, err)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			for range 2 {
				done := make(chan error, 1)
				go func() {
					done <- tc.call(ctx, runtime)
				}()

				select {
				case err = <-done:
				case <-time.After(time.Second):
					t.Fatal("nested provider call stalled on the single-VM pool")
				}
				require.NoError(t, err)
			}
		})
	}
}
