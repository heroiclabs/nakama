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
	"database/sql"
	"errors"
	"fmt"
	"sync"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/social"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
)

type RuntimeLuaMatchCore struct {
	logger        *zap.Logger
	matchRegistry MatchRegistry
	tracker       Tracker
	router        MessageRouter

	labelUpdateFn func(string)

	id     uuid.UUID
	node   string
	idStr  string
	stream PresenceStream

	vm            *lua.LState
	initFn        lua.LValue
	joinAttemptFn lua.LValue
	joinFn        lua.LValue
	leaveFn       lua.LValue
	loopFn        lua.LValue
	ctx           *lua.LTable
	dispatcher    *lua.LTable
}

func NewRuntimeLuaMatchCore(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler *LeaderboardScheduler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, once *sync.Once, localCache *RuntimeLuaLocalCache, goMatchCreateFn RuntimeMatchCreateFunction, id uuid.UUID, node string, name string, labelUpdateFn func(string)) (RuntimeMatchCore, error) {
	// Set up the Lua VM that will handle this match.
	vm := lua.NewState(lua.Options{
		CallStackSize:       config.GetRuntime().CallStackSize,
		RegistrySize:        config.GetRuntime().RegistrySize,
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}

	allMatchCreateFn := func(logger *zap.Logger, id uuid.UUID, node string, name string, labelUpdateFn func(string)) (RuntimeMatchCore, error) {
		core, err := goMatchCreateFn(logger, id, node, name, labelUpdateFn)
		if err != nil {
			return nil, err
		}
		if core != nil {
			return core, nil
		}
		return NewRuntimeLuaMatchCore(logger, db, config, socialClient, leaderboardCache, rankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, router, stdLibs, once, localCache, goMatchCreateFn, id, node, name, labelUpdateFn)
	}

	nakamaModule := NewRuntimeLuaNakamaModule(logger, db, config, socialClient, leaderboardCache, rankCache, leaderboardScheduler, vm, sessionRegistry, matchRegistry, tracker, router, once, localCache, allMatchCreateFn, nil)
	vm.PreloadModule("nakama", nakamaModule.Loader)

	// Create the context to be used throughout this match.
	ctx := vm.CreateTable(0, 6)
	ctx.RawSetString(__RUNTIME_LUA_CTX_ENV, RuntimeLuaConvertMapString(vm, config.GetRuntime().Environment))
	ctx.RawSetString(__RUNTIME_LUA_CTX_MODE, lua.LString(RuntimeExecutionModeMatch.String()))
	ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_ID, lua.LString(fmt.Sprintf("%v.%v", id.String(), node)))
	ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_NODE, lua.LString(node))

	// Require the match module to load it (and its dependencies) and get its returned value.
	req := vm.GetGlobal("require").(*lua.LFunction)
	err := vm.GPCall(req.GFunction, lua.LString(name))
	if err != nil {
		return nil, fmt.Errorf("error loading match module: %v", err.Error())
	}

	// Extract the expected function references.
	var tab *lua.LTable
	if t := vm.Get(-1); t.Type() != lua.LTTable {
		return nil, errors.New("match module must return a table containing the match callback functions")
	} else {
		tab = t.(*lua.LTable)
	}
	initFn := tab.RawGet(lua.LString("match_init"))
	if initFn.Type() != lua.LTFunction {
		return nil, errors.New("match_init not found or not a function")
	}
	joinAttemptFn := tab.RawGet(lua.LString("match_join_attempt"))
	if joinAttemptFn.Type() != lua.LTFunction {
		return nil, errors.New("match_join_attempt not found or not a function")
	}
	joinFn := tab.RawGet(lua.LString("match_join"))
	if joinFn == nil || joinFn.Type() != lua.LTFunction {
		joinFn = nil
	}
	leaveFn := tab.RawGet(lua.LString("match_leave"))
	if leaveFn.Type() != lua.LTFunction {
		return nil, errors.New("match_leave not found or not a function")
	}
	loopFn := tab.RawGet(lua.LString("match_loop"))
	if loopFn.Type() != lua.LTFunction {
		return nil, errors.New("match_loop not found or not a function")
	}

	core := &RuntimeLuaMatchCore{
		logger:        logger,
		matchRegistry: matchRegistry,
		tracker:       tracker,
		router:        router,

		labelUpdateFn: labelUpdateFn,

		id:    id,
		node:  node,
		idStr: fmt.Sprintf("%v.%v", id.String(), node),
		stream: PresenceStream{
			Mode:    StreamModeMatchAuthoritative,
			Subject: id,
			Label:   node,
		},

		vm:            vm,
		initFn:        initFn,
		joinAttemptFn: joinAttemptFn,
		joinFn:        joinFn,
		leaveFn:       leaveFn,
		loopFn:        loopFn,
		ctx:           ctx,
		// dispatcher set below.
	}

	core.dispatcher = vm.SetFuncs(vm.CreateTable(0, 3), map[string]lua.LGFunction{
		"broadcast_message":  core.broadcastMessage,
		"match_kick":         core.matchKick,
		"match_label_update": core.matchLabelUpdate,
	})

	return core, nil
}

func (r *RuntimeLuaMatchCore) MatchInit(params map[string]interface{}) (interface{}, int, string, error) {
	// Run the match_init sequence.
	r.vm.Push(LSentinel)
	r.vm.Push(r.initFn)
	r.vm.Push(r.ctx)
	if params == nil {
		r.vm.Push(lua.LNil)
	} else {
		r.vm.Push(RuntimeLuaConvertMap(r.vm, params))
	}

	err := r.vm.PCall(2, lua.MultRet, nil)
	if err != nil {
		return nil, 0, "", err
	}

	// Extract desired label.
	label := r.vm.Get(-1)
	if label.Type() == LTSentinel {
		return nil, 0, "", errors.New("match_init returned unexpected third value, must be a label string")
	} else if label.Type() != lua.LTString {
		return nil, 0, "", errors.New("match_init returned unexpected third value, must be a label string")
	}
	r.vm.Pop(1)

	labelStr := label.String()
	if len(labelStr) > 256 {
		return nil, 0, "", errors.New("match_init returned invalid label, must be 256 bytes or less")
	}

	// Extract desired tick rate.
	rate := r.vm.Get(-1)
	if rate.Type() == LTSentinel {
		return nil, 0, "", errors.New("match_init returned unexpected second value, must be a tick rate number")
	} else if rate.Type() != lua.LTNumber {
		return nil, 0, "", errors.New("match_init returned unexpected second value, must be a tick rate number")
	}
	r.vm.Pop(1)

	rateInt := int(rate.(lua.LNumber))
	if rateInt > 30 || rateInt < 1 {
		return nil, 0, "", errors.New("match_init returned invalid tick rate, must be between 1 and 30")
	}

	// Extract initial state.
	state := r.vm.Get(-1)
	if state.Type() == LTSentinel {
		return nil, 0, "", errors.New("match_init returned unexpected first value, must be a state")
	}
	r.vm.Pop(1)

	// Drop the sentinel value from the stack.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, 0, "", errors.New("match_init returned too many arguments, must be: state, tick rate number, label string")
	}
	r.vm.Pop(1)

	// Add context values only available after match_init completes.
	r.ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_LABEL, label)
	r.ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_TICK_RATE, rate)

	return state, rateInt, labelStr, nil
}

func (r *RuntimeLuaMatchCore) MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username, node string) (interface{}, bool, string, error) {
	presence := r.vm.CreateTable(0, 4)
	presence.RawSetString("user_id", lua.LString(userID.String()))
	presence.RawSetString("session_id", lua.LString(sessionID.String()))
	presence.RawSetString("username", lua.LString(username))
	presence.RawSetString("node", lua.LString(node))

	// Execute the match_join_attempt call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.joinAttemptFn)
	r.vm.Push(r.ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(presence)

	err := r.vm.PCall(5, lua.MultRet, nil)
	if err != nil {
		return nil, false, "", err
	}

	allowFound := false
	var allow bool
	var reason string

	// Extract the join attempt response.
	allowOrReason := r.vm.Get(-1)
	if allowOrReason.Type() == LTSentinel {
		return nil, false, "", errors.New("Match join attempt returned too few values, stopping match - expected: state, join result boolean, optional reject reason string")
	} else if allowOrReason.Type() == lua.LTString {
		// This was the optional reject reason string.
		reason = allowOrReason.String()
	} else if allowOrReason.Type() == lua.LTBool {
		// This was the required join result boolean, expect no reason as it was skipped.
		allowFound = true
		allow = lua.LVAsBool(allowOrReason)
	} else {
		return nil, false, "", errors.New("Match join attempt returned non-boolean join result or non-string reject reason, stopping match")
	}
	r.vm.Pop(1)

	if !allowFound {
		// The previous parameter was the optional reject reason string, now look for the required join result boolean.
		allowRequired := r.vm.Get(-1)
		if allowRequired.Type() == LTSentinel {
			return nil, false, "", errors.New("Match join attempt returned incorrect or too few values, stopping match - expected: state, join result boolean, optional reject reason string")
		} else if allowRequired.Type() != lua.LTBool {
			return nil, false, "", errors.New("Match join attempt returned non-boolean join result, stopping match")
		}
		allow = lua.LVAsBool(allowRequired)
		r.vm.Pop(1)
	}

	// Extract the resulting state.
	newState := r.vm.Get(-1)
	if newState.Type() == lua.LTNil || newState.Type() == LTSentinel {
		return nil, false, "", nil
	}
	r.vm.Pop(1)
	// Check for and remove the sentinel value, will fail if there are any extra return values.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, false, "", errors.New("Match join attempt returned too many values, stopping match")
	}
	r.vm.Pop(1)

	return newState, allow, reason, nil
}

func (r *RuntimeLuaMatchCore) MatchJoin(tick int64, state interface{}, joins []*MatchPresence) (interface{}, error) {
	if r.joinFn == nil {
		return state, nil
	}

	presences := r.vm.CreateTable(len(joins), 0)
	for i, p := range joins {
		presence := r.vm.CreateTable(0, 4)
		presence.RawSetString("user_id", lua.LString(p.UserID.String()))
		presence.RawSetString("session_id", lua.LString(p.SessionID.String()))
		presence.RawSetString("username", lua.LString(p.Username))
		presence.RawSetString("node", lua.LString(p.Node))

		presences.RawSetInt(i+1, presence)
	}

	// Execute the match_leave call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.joinFn)
	r.vm.Push(r.ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(presences)

	err := r.vm.PCall(5, lua.MultRet, nil)
	if err != nil {
		return nil, err
	}

	// Extract the resulting state.
	newState := r.vm.Get(-1)
	if newState.Type() == lua.LTNil || newState.Type() == LTSentinel {
		return nil, nil
	}
	r.vm.Pop(1)
	// Check for and remove the sentinel value, will fail if there are any extra return values.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, errors.New("Match join returned too many values, stopping match")
	}
	r.vm.Pop(1)

	return newState, nil
}

func (r *RuntimeLuaMatchCore) MatchLeave(tick int64, state interface{}, leaves []*MatchPresence) (interface{}, error) {
	presences := r.vm.CreateTable(len(leaves), 0)
	for i, p := range leaves {
		presence := r.vm.CreateTable(0, 4)
		presence.RawSetString("user_id", lua.LString(p.UserID.String()))
		presence.RawSetString("session_id", lua.LString(p.SessionID.String()))
		presence.RawSetString("username", lua.LString(p.Username))
		presence.RawSetString("node", lua.LString(p.Node))

		presences.RawSetInt(i+1, presence)
	}

	// Execute the match_leave call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.leaveFn)
	r.vm.Push(r.ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(presences)

	err := r.vm.PCall(5, lua.MultRet, nil)
	if err != nil {
		return nil, err
	}

	// Extract the resulting state.
	newState := r.vm.Get(-1)
	if newState.Type() == lua.LTNil || newState.Type() == LTSentinel {
		return nil, nil
	}
	r.vm.Pop(1)
	// Check for and remove the sentinel value, will fail if there are any extra return values.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, errors.New("Match leave returned too many values, stopping match")
	}
	r.vm.Pop(1)

	return newState, nil
}

func (r *RuntimeLuaMatchCore) MatchLoop(tick int64, state interface{}, inputCh chan *MatchDataMessage) (interface{}, error) {
	// Drain the input queue into a Lua table.
	size := len(inputCh)
	input := r.vm.CreateTable(size, 0)
	for i := 1; i <= size; i++ {
		msg := <-inputCh

		presence := r.vm.CreateTable(0, 4)
		presence.RawSetString("user_id", lua.LString(msg.UserID.String()))
		presence.RawSetString("session_id", lua.LString(msg.SessionID.String()))
		presence.RawSetString("username", lua.LString(msg.Username))
		presence.RawSetString("node", lua.LString(msg.Node))

		in := r.vm.CreateTable(0, 4)
		in.RawSetString("sender", presence)
		in.RawSetString("op_code", lua.LNumber(msg.OpCode))
		if msg.Data != nil {
			in.RawSetString("data", lua.LString(msg.Data))
		} else {
			in.RawSetString("data", lua.LNil)
		}
		in.RawSetString("receive_time_ms", lua.LNumber(msg.ReceiveTime))

		input.RawSetInt(i, in)
	}

	// Execute the match_loop call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.loopFn)
	r.vm.Push(r.ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(input)

	err := r.vm.PCall(5, lua.MultRet, nil)
	if err != nil {
		return nil, err
	}

	// Extract the resulting state.
	newState := r.vm.Get(-1)
	if newState.Type() == lua.LTNil || newState.Type() == LTSentinel {
		return nil, nil
	}
	r.vm.Pop(1)
	// Check for and remove the sentinel value, will fail if there are any extra return values.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, errors.New("Match loop returned too many values, stopping match")
	}
	r.vm.Pop(1)

	return newState, nil
}

func (r *RuntimeLuaMatchCore) broadcastMessage(l *lua.LState) int {
	opCode := l.CheckInt64(1)

	var dataBytes []byte
	if data := l.Get(2); data.Type() != lua.LTNil {
		if data.Type() != lua.LTString {
			l.ArgError(2, "expects data to be a string or nil")
			return 0
		}
		dataBytes = []byte(data.(lua.LString))
	}

	filter := l.OptTable(3, nil)
	var presenceIDs []*PresenceID
	if filter != nil {
		fl := filter.Len()
		if fl == 0 {
			return 0
		}
		presenceIDs = make([]*PresenceID, 0, fl)
		conversionError := false
		filter.ForEach(func(_, p lua.LValue) {
			pt, ok := p.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(1, "expects a valid set of presences")
				return
			}

			presenceID := &PresenceID{}
			pt.ForEach(func(k, v lua.LValue) {
				switch k.String() {
				case "session_id":
					sid, err := uuid.FromString(v.String())
					if err != nil {
						conversionError = true
						l.ArgError(1, "expects each presence to have a valid session_id")
						return
					}
					presenceID.SessionID = sid
				case "node":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects node to be string")
						return
					}
					presenceID.Node = v.String()
				}
			})
			if presenceID.SessionID == uuid.Nil || presenceID.Node == "" {
				conversionError = true
				l.ArgError(1, "expects each presence to have a valid session_id and node")
				return
			}
			if conversionError {
				return
			}
			presenceIDs = append(presenceIDs, presenceID)
		})
		if conversionError {
			return 0
		}
	}

	if presenceIDs != nil && len(presenceIDs) == 0 {
		// Filter is empty, there are no requested message targets.
		return 0
	}

	sender := l.OptTable(4, nil)
	var presence *rtapi.UserPresence
	if sender != nil {
		presence = &rtapi.UserPresence{}
		conversionError := false
		sender.ForEach(func(k, v lua.LValue) {
			switch k.String() {
			case "user_id":
				s := v.String()
				_, err := uuid.FromString(s)
				if err != nil {
					conversionError = true
					l.ArgError(4, "expects presence to have a valid user_id")
					return
				}
				presence.UserId = s
			case "session_id":
				s := v.String()
				_, err := uuid.FromString(s)
				if err != nil {
					conversionError = true
					l.ArgError(4, "expects presence to have a valid session_id")
					return
				}
				presence.SessionId = s
			case "username":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(4, "expects username to be string")
					return
				}
				presence.Username = v.String()
			}
		})
		if presence.UserId == "" || presence.SessionId == "" || presence.Username == "" {
			l.ArgError(4, "expects presence to have a valid user_id, session_id, and username")
			return 0
		}
		if conversionError {
			return 0
		}
	}

	if presenceIDs != nil {
		// Ensure specific presences actually exist to prevent sending bogus messages to arbitrary users.
		actualPresenceIDs := r.tracker.ListPresenceIDByStream(r.stream)
		for i := 0; i < len(presenceIDs); i++ {
			found := false
			presenceID := presenceIDs[i]
			for j := 0; j < len(actualPresenceIDs); j++ {
				if actual := actualPresenceIDs[j]; presenceID.SessionID == actual.SessionID && presenceID.Node == actual.Node {
					// If it matches, drop it.
					actualPresenceIDs[j] = actualPresenceIDs[len(actualPresenceIDs)-1]
					actualPresenceIDs = actualPresenceIDs[:len(actualPresenceIDs)-1]
					found = true
					break
				}
			}
			if !found {
				// If this presence wasn't in the filters, it's not needed.
				presenceIDs[i] = presenceIDs[len(presenceIDs)-1]
				presenceIDs = presenceIDs[:len(presenceIDs)-1]
				i--
			}
		}
		if len(presenceIDs) == 0 {
			// None of the target presenceIDs existed in the list of match members.
			return 0
		}
	}

	msg := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId:  r.idStr,
		Presence: presence,
		OpCode:   opCode,
		Data:     dataBytes,
	}}}

	if presenceIDs == nil {
		r.router.SendToStream(r.logger, r.stream, msg)
	} else {
		r.router.SendToPresenceIDs(r.logger, presenceIDs, true, StreamModeMatchAuthoritative, msg)
	}

	return 0
}

func (r *RuntimeLuaMatchCore) matchKick(l *lua.LState) int {
	input := l.OptTable(1, nil)
	if input == nil {
		return 0
	}
	size := input.Len()
	if size == 0 {
		return 0
	}

	presences := make([]*MatchPresence, 0, size)
	conversionError := false
	input.ForEach(func(_, p lua.LValue) {
		pt, ok := p.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of presences")
			return
		}

		presence := &MatchPresence{}
		pt.ForEach(func(k, v lua.LValue) {
			switch k.String() {
			case "user_id":
				uid, err := uuid.FromString(v.String())
				if err != nil {
					conversionError = true
					l.ArgError(1, "expects each presence to have a valid user_id")
					return
				}
				presence.UserID = uid
			case "session_id":
				sid, err := uuid.FromString(v.String())
				if err != nil {
					conversionError = true
					l.ArgError(1, "expects each presence to have a valid session_id")
					return
				}
				presence.SessionID = sid
			case "node":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects node to be string")
					return
				}
				presence.Node = v.String()
			}
		})
		if presence.UserID == uuid.Nil || presence.SessionID == uuid.Nil || presence.Node == "" {
			conversionError = true
			l.ArgError(1, "expects each presence to have a valid user_id, session_id, and node")
			return
		}
		if conversionError {
			return
		}
		presences = append(presences, presence)
	})
	if conversionError {
		return 0
	}

	r.matchRegistry.Kick(r.stream, presences)
	return 0
}

func (r *RuntimeLuaMatchCore) matchLabelUpdate(l *lua.LState) int {
	input := l.OptString(1, "")

	r.labelUpdateFn(input)
	// This must be executed from inside a match call so safe to update here.
	r.ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_LABEL, lua.LString(input))
	return 0
}
