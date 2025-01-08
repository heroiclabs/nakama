// Copyright 2020 The Nakama Authors
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

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
)

func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	// Register RPCs
	rpcEndpoints := map[string]runtime.RpcFunction{
		"go_echo_sample": rpcEcho,
		"rpc_create_match": rpcCreateMatch,
	}

	for name, fn := range rpcEndpoints {
		if err := initializer.RegisterRpc(name, fn); err != nil {
			return logError(logger, "Failed to register RPC", err, map[string]interface{}{"rpc": name})
		}
	}

	// Register Before/After Hooks
	hooks := []struct {
		name  string
		hook  runtime.BeforeRtFunction
		isBefore bool
	}{
		{"ChannelJoin", beforeChannelJoin, true},
	}
	for _, hook := range hooks {
		if hook.isBefore {
			if err := initializer.RegisterBeforeRt(hook.name, hook.hook); err != nil {
				return logError(logger, "Failed to register BeforeRt hook", err, map[string]interface{}{"hook": hook.name})
			}
		}
	}

	// Register Events
	events := map[string]runtime.EventFunction{
		"SessionStart": eventSessionStart,
		"SessionEnd":   eventSessionEnd,
	}

	for eventName, eventHandler := range events {
		if err := initializer.RegisterEvent(eventHandler); err != nil {
			return logError(logger, "Failed to register event", err, map[string]interface{}{"event": eventName})
		}
	}

	// Register HTTP Routes
	httpRoutes := map[string]http.HandlerFunc{
		"/test": func(w http.ResponseWriter, r *http.Request) {
			response := map[string]string{"message": "Endpoint working !"}
			json.NewEncoder(w).Encode(response)
		},
	}

	for route, handler := range httpRoutes {
		if err := initializer.RegisterHttp(route, handler); err != nil {
			return logError(logger, "Failed register HTTP Routes")
		}
	}
}
//
