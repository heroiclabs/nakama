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

package main

import (
	"context"
	"database/sql"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/runtime"
	"log"
)

func InitModule(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) {
	initializer.RegisterRpc("go_echo_sample", rpcEcho)
	initializer.RegisterBeforeRt("ChannelJoin", beforeChannelJoin)
	initializer.RegisterMatch("match", func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error) {
		return &Match{}, nil
	})
}

func rpcEcho(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error, int) {
	logger.Print("RUNNING IN GO")
	return payload, nil, 0
}

func beforeChannelJoin(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
	logger.Printf("Intercepted request to join channel '%v'", envelope.GetChannelJoin().Target)
	return envelope, nil
}

type MatchState struct {
	debug bool
}

type Match struct{}

func (m *Match) MatchInit(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	var debug bool
	if d, ok := params["debug"]; ok {
		if dv, ok := d.(bool); ok {
			debug = dv
		}
	}
	state := &MatchState{
		debug: debug,
	}

	if state.debug {
		logger.Printf("match init, starting with debug: %v", state.debug)
	}
	tickRate := 1
	label := "skill=100-150"

	return state, tickRate, label
}

func (m *Match) MatchJoinAttempt(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence) (interface{}, bool, string) {
	if state.(*MatchState).debug {
		logger.Printf("match join attempt username %v user_id %v session_id %v node %v", presence.GetUsername(), presence.GetUserId(), presence.GetSessionId(), presence.GetNodeId())
	}

	return state, true, ""
}

func (m *Match) MatchJoin(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	if state.(*MatchState).debug {
		for _, presence := range presences {
			logger.Printf("match join username %v user_id %v session_id %v node %v", presence.GetUsername(), presence.GetUserId(), presence.GetSessionId(), presence.GetNodeId())
		}
	}

	return state
}

func (m *Match) MatchLeave(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	if state.(*MatchState).debug {
		for _, presence := range presences {
			logger.Printf("match leave username %v user_id %v session_id %v node %v", presence.GetUsername(), presence.GetUserId(), presence.GetSessionId(), presence.GetNodeId())
		}
	}

	return state
}

func (m *Match) MatchLoop(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	if state.(*MatchState).debug {
		logger.Printf("match loop match_id %v tick %v", ctx.Value(runtime.RUNTIME_CTX_MATCH_ID), tick)
		logger.Printf("match loop match_id %v message count %v", ctx.Value(runtime.RUNTIME_CTX_MATCH_ID), len(messages))
	}

	if tick >= 10 {
		return nil
	}
	return state
}

func (m *Match) MatchTerminate(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
	if state.(*MatchState).debug {
		logger.Printf("match terminate match_id %v tick %v", ctx.Value(runtime.RUNTIME_CTX_MATCH_ID), tick)
		logger.Printf("match terminate match_id %v grace seconds %v", ctx.Value(runtime.RUNTIME_CTX_MATCH_ID), graceSeconds)
	}

	return state
}
