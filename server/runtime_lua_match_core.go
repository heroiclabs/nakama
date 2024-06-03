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
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
)

type RuntimeLuaMatchCore struct {
	logger        *zap.Logger
	matchRegistry MatchRegistry
	router        MessageRouter

	deferMessageFn RuntimeMatchDeferMessageFunction
	presenceList   *MatchPresenceList

	id         uuid.UUID
	node       string
	module     string
	tickRate   int
	createTime int64
	stopped    *atomic.Bool
	idStr      string
	stream     PresenceStream
	label      *atomic.String

	vm            *lua.LState
	initFn        lua.LValue
	joinAttemptFn lua.LValue
	joinFn        lua.LValue
	leaveFn       lua.LValue
	loopFn        lua.LValue
	terminateFn   lua.LValue
	signalFn      lua.LValue
	ctx           *lua.LTable
	dispatcher    *lua.LTable

	ctxCancelFn context.CancelFunc
}

func NewRuntimeLuaMatchCore(logger *zap.Logger, module string, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, stdLibs map[string]lua.LGFunction, once *sync.Once, localCache *RuntimeLuaLocalCache, eventFn RuntimeEventCustomFunction, sharedReg, sharedGlobals *lua.LTable, id uuid.UUID, node string, stopped *atomic.Bool, name string, matchProvider *MatchProvider, storageIndex StorageIndex) (RuntimeMatchCore, error) {
	// Set up the Lua VM that will handle this match.
	vm := lua.NewState(lua.Options{
		CallStackSize:       config.GetRuntime().GetLuaCallStackSize(),
		RegistrySize:        config.GetRuntime().GetLuaRegistrySize(),
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	goCtx, ctxCancelFn := context.WithCancel(context.Background())
	vm.SetContext(goCtx)

	// Check if read-only globals are provided.
	if sharedReg != nil && sharedGlobals != nil {
		// Running with read-only globals.
		vm.Get(lua.GlobalsIndex).(*lua.LTable).Metatable = sharedGlobals

		stateRegistry := vm.Get(lua.RegistryIndex).(*lua.LTable)
		stateRegistry.Metatable = sharedReg

		loadedTable := vm.NewTable()
		loadedTable.Metatable = vm.GetField(stateRegistry, "_LOADED")
		vm.SetField(stateRegistry, "_LOADED", loadedTable)
	} else {
		// Creating a completely new VM with its own globals.
		for name, lib := range stdLibs {
			vm.Push(vm.NewFunction(lib))
			vm.Push(lua.LString(name))
			vm.Call(1, 0)
		}

		nakamaModule := NewRuntimeLuaNakamaModule(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, rankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, once, localCache, storageIndex, matchProvider.CreateMatch, eventFn, nil, nil)
		vm.PreloadModule("nakama", nakamaModule.Loader)
	}

	// Create the context to be used throughout this match.
	ctx := vm.CreateTable(0, 7)
	ctx.RawSetString(__RUNTIME_LUA_CTX_ENV, RuntimeLuaConvertMapString(vm, config.GetRuntime().Environment))
	ctx.RawSetString(__RUNTIME_LUA_CTX_MODE, lua.LString(RuntimeExecutionModeMatch.String()))
	ctx.RawSetString(__RUNTIME_LUA_CTX_NODE, lua.LString(node))
	ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_ID, lua.LString(fmt.Sprintf("%v.%v", id.String(), node)))
	ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_NODE, lua.LString(node))

	// Require the match module to load it (and its dependencies) and get its returned value.
	req := vm.GetGlobal("require").(*lua.LFunction)
	err := vm.GPCall(req.GFunction, lua.LString(name))
	if err != nil {
		if apiErr, ok := err.(*lua.ApiError); ok {
			if strings.Contains(apiErr.Error(), fmt.Sprintf("module %s not found", name)) {
				// Module not found
				ctxCancelFn()
				return nil, nil
			}
		}
		ctxCancelFn()
		return nil, fmt.Errorf("error loading match module: %v", err.Error())
	}

	// Extract the expected function references.
	t := vm.Get(-1)
	if t.Type() != lua.LTTable {
		ctxCancelFn()
		return nil, errors.New("match module must return a table containing the match callback functions")
	}
	tab := t.(*lua.LTable)
	initFn := tab.RawGet(lua.LString("match_init"))
	if initFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_init not found or not a function")
	}
	joinAttemptFn := tab.RawGet(lua.LString("match_join_attempt"))
	if joinAttemptFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_join_attempt not found or not a function")
	}
	joinFn := tab.RawGet(lua.LString("match_join"))
	if joinFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_join not found or not a function")
	}
	leaveFn := tab.RawGet(lua.LString("match_leave"))
	if leaveFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_leave not found or not a function")
	}
	loopFn := tab.RawGet(lua.LString("match_loop"))
	if loopFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_loop not found or not a function")
	}
	terminateFn := tab.RawGet(lua.LString("match_terminate"))
	if terminateFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_terminate not found or not a function")
	}
	signalFn := tab.RawGet(lua.LString("match_signal"))
	if signalFn.Type() != lua.LTFunction {
		ctxCancelFn()
		return nil, errors.New("match_signal not found or not a function")
	}

	core := &RuntimeLuaMatchCore{
		logger:        logger,
		matchRegistry: matchRegistry,
		router:        router,

		// deferMessageFn set in MatchInit.
		// presenceList set in MatchInit.
		// tickRate set in MatchInit.

		id:         id,
		node:       node,
		stopped:    stopped,
		idStr:      fmt.Sprintf("%v.%v", id.String(), node),
		module:     module,
		createTime: time.Now().UTC().UnixNano() / int64(time.Millisecond),
		stream: PresenceStream{
			Mode:    StreamModeMatchAuthoritative,
			Subject: id,
			Label:   node,
		},
		label: atomic.NewString(""),

		vm:            vm,
		initFn:        initFn,
		joinAttemptFn: joinAttemptFn,
		joinFn:        joinFn,
		leaveFn:       leaveFn,
		loopFn:        loopFn,
		terminateFn:   terminateFn,
		signalFn:      signalFn,
		ctx:           ctx,
		// dispatcher set below.

		ctxCancelFn: ctxCancelFn,
	}

	core.dispatcher = vm.SetFuncs(vm.CreateTable(0, 4), map[string]lua.LGFunction{
		"broadcast_message":          core.broadcastMessage,
		"broadcast_message_deferred": core.broadcastMessageDeferred,
		"match_kick":                 core.matchKick,
		"match_label_update":         core.matchLabelUpdate,
	})

	return core, nil
}

func (r *RuntimeLuaMatchCore) MatchInit(presenceList *MatchPresenceList, deferMessageFn RuntimeMatchDeferMessageFunction, params map[string]interface{}) (interface{}, int, error) {
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
		return nil, 0, err
	}

	// Extract desired label.
	label := r.vm.Get(-1)
	if label.Type() == LTSentinel {
		return nil, 0, errors.New("match_init returned unexpected third value, must be a label string")
	} else if label.Type() != lua.LTString {
		return nil, 0, errors.New("match_init returned unexpected third value, must be a label string")
	}
	r.vm.Pop(1)

	labelStr := label.String()
	if len(labelStr) > MatchLabelMaxBytes {
		return nil, 0, fmt.Errorf("match_init returned invalid label, must be %v bytes or less", MatchLabelMaxBytes)
	}

	// Extract desired tick rate.
	rate := r.vm.Get(-1)
	if rate.Type() == LTSentinel {
		return nil, 0, errors.New("match_init returned unexpected second value, must be a tick rate number")
	} else if rate.Type() != lua.LTNumber {
		return nil, 0, errors.New("match_init returned unexpected second value, must be a tick rate number")
	}
	r.vm.Pop(1)

	rateInt := int(rate.(lua.LNumber))
	if rateInt > 60 || rateInt < 1 {
		return nil, 0, errors.New("match_init returned invalid tick rate, must be between 1 and 60")
	}
	r.tickRate = rateInt

	// Extract initial state.
	state := r.vm.Get(-1)
	if state.Type() == LTSentinel {
		return nil, 0, errors.New("match_init returned unexpected first value, must be a state")
	}
	if state.Type() == lua.LTNil {
		return nil, 0, ErrMatchInitStateNil
	}
	r.vm.Pop(1)

	// Drop the sentinel value from the stack.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, 0, errors.New("match_init returned too many arguments, must be: state, tick rate number, label string")
	}
	r.vm.Pop(1)

	if err := r.matchRegistry.UpdateMatchLabel(r.id, r.tickRate, r.module, labelStr, r.createTime); err != nil {
		return nil, 0, err
	}
	r.label.Store(labelStr)

	// Add context values only available after match_init completes.
	r.ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_LABEL, label)
	r.ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_TICK_RATE, rate)

	r.deferMessageFn = deferMessageFn
	r.presenceList = presenceList

	return state, rateInt, nil
}

func (r *RuntimeLuaMatchCore) MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, node string, metadata map[string]string) (interface{}, bool, string, error) {
	presence := r.vm.CreateTable(0, 4)
	presence.RawSetString("user_id", lua.LString(userID.String()))
	presence.RawSetString("session_id", lua.LString(sessionID.String()))
	presence.RawSetString("username", lua.LString(username))
	presence.RawSetString("node", lua.LString(node))

	metadataTable := r.vm.CreateTable(0, len(metadata))
	for k, v := range metadata {
		metadataTable.RawSetString(k, lua.LString(v))
	}

	// Prepare a temporary context that includes the user's session info on top of the base match context.
	ctx := r.vm.CreateTable(0, 13)
	r.ctx.ForEach(func(k lua.LValue, v lua.LValue) {
		ctx.RawSetH(k, v)
	})
	ctx.RawSetString(__RUNTIME_LUA_CTX_USER_ID, lua.LString(userID.String()))
	ctx.RawSetString(__RUNTIME_LUA_CTX_USERNAME, lua.LString(username))
	if vars != nil {
		vt := r.vm.CreateTable(0, len(vars))
		for k, v := range vars {
			vt.RawSetString(k, lua.LString(v))
		}
		ctx.RawSetString(__RUNTIME_LUA_CTX_VARS, vt)
	}
	ctx.RawSetString(__RUNTIME_LUA_CTX_USER_SESSION_EXP, lua.LNumber(sessionExpiry))
	ctx.RawSetString(__RUNTIME_LUA_CTX_SESSION_ID, lua.LString(sessionID.String()))
	if clientIP != "" {
		ctx.RawSetString(__RUNTIME_LUA_CTX_CLIENT_IP, lua.LString(clientIP))
	}
	if clientPort != "" {
		ctx.RawSetString(__RUNTIME_LUA_CTX_CLIENT_PORT, lua.LString(clientPort))
	}

	// Execute the match_join_attempt call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.joinAttemptFn)
	r.vm.Push(ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(presence)
	r.vm.Push(metadataTable)

	err := r.vm.PCall(6, lua.MultRet, nil)
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
		presence := r.vm.CreateTable(0, 5)
		presence.RawSetString("user_id", lua.LString(p.UserID.String()))
		presence.RawSetString("session_id", lua.LString(p.SessionID.String()))
		presence.RawSetString("username", lua.LString(p.Username))
		presence.RawSetString("node", lua.LString(p.Node))
		presence.RawSetString("reason", lua.LNumber(p.Reason))

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
		presence := r.vm.CreateTable(0, 5)
		presence.RawSetString("user_id", lua.LString(p.UserID.String()))
		presence.RawSetString("session_id", lua.LString(p.SessionID.String()))
		presence.RawSetString("username", lua.LString(p.Username))
		presence.RawSetString("node", lua.LString(p.Node))
		presence.RawSetString("reason", lua.LNumber(p.Reason))

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

func (r *RuntimeLuaMatchCore) MatchLoop(tick int64, state interface{}, inputCh <-chan *MatchDataMessage) (interface{}, error) {
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

		in := r.vm.CreateTable(0, 5)
		in.RawSetString("sender", presence)
		in.RawSetString("op_code", lua.LNumber(msg.OpCode))
		if msg.Data != nil {
			in.RawSetString("data", lua.LString(msg.Data))
		} else {
			in.RawSetString("data", lua.LNil)
		}
		in.RawSetString("reliable", lua.LBool(msg.Reliable))
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

func (r *RuntimeLuaMatchCore) MatchTerminate(tick int64, state interface{}, graceSeconds int) (interface{}, error) {
	// Execute the match_terminate call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.terminateFn)
	r.vm.Push(r.ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(lua.LNumber(graceSeconds))

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
		return nil, errors.New("Match terminate returned too many values, stopping match")
	}
	r.vm.Pop(1)

	return newState, nil
}

func (r *RuntimeLuaMatchCore) MatchSignal(tick int64, state interface{}, data string) (interface{}, string, error) {
	// Execute the match_terminate call.
	r.vm.Push(LSentinel)
	r.vm.Push(r.signalFn)
	r.vm.Push(r.ctx)
	r.vm.Push(r.dispatcher)
	r.vm.Push(lua.LNumber(tick))
	r.vm.Push(state.(lua.LValue))
	r.vm.Push(lua.LString(data))

	err := r.vm.PCall(5, lua.MultRet, nil)
	if err != nil {
		return nil, "", err
	}

	// Extract the resulting response data.
	responseData := r.vm.Get(-1)
	var responseDataString string
	if responseData.Type() == lua.LTString {
		responseDataString = responseData.String()
	} else if responseData.Type() != lua.LTNil {
		return nil, "", errors.New("Match signal returned non-string result, stopping match")
	}
	r.vm.Pop(1)
	// Extract the resulting state.
	newState := r.vm.Get(-1)
	if newState.Type() == lua.LTNil || newState.Type() == LTSentinel {
		return nil, "", nil
	}
	r.vm.Pop(1)
	// Check for and remove the sentinel value, will fail if there are any extra return values.
	if sentinel := r.vm.Get(-1); sentinel.Type() != LTSentinel {
		return nil, "", errors.New("Match signal returned too many values, stopping match")
	}
	r.vm.Pop(1)

	return newState, responseDataString, nil
}

func (r *RuntimeLuaMatchCore) GetState(state interface{}) (string, error) {
	stateBytes, err := json.Marshal(RuntimeLuaConvertLuaValue(state.(lua.LValue)))
	if err != nil {
		return "", err
	}
	return string(stateBytes), nil
}

func (r *RuntimeLuaMatchCore) Label() string {
	return r.label.Load()
}

func (r *RuntimeLuaMatchCore) TickRate() int {
	return r.tickRate
}

func (r *RuntimeLuaMatchCore) HandlerName() string {
	return r.module
}

func (r *RuntimeLuaMatchCore) CreateTime() int64 {
	return r.createTime
}

func (r *RuntimeLuaMatchCore) Cancel() {
	r.ctxCancelFn()
}

func (r *RuntimeLuaMatchCore) Cleanup() {
	r.vm.Close()
}

func (r *RuntimeLuaMatchCore) broadcastMessage(l *lua.LState) int {
	if r.stopped.Load() {
		l.RaiseError("match stopped")
		return 0
	}

	presenceIDs, msg, reliable := r.validateBroadcast(l)
	if len(presenceIDs) != 0 {
		r.router.SendToPresenceIDs(r.logger, presenceIDs, msg, reliable)
	}

	return 0
}

func (r *RuntimeLuaMatchCore) broadcastMessageDeferred(l *lua.LState) int {
	if r.stopped.Load() {
		l.RaiseError("match stopped")
		return 0
	}

	presenceIDs, msg, reliable := r.validateBroadcast(l)
	if len(presenceIDs) != 0 {
		if err := r.deferMessageFn(&DeferredMessage{
			PresenceIDs: presenceIDs,
			Envelope:    msg,
			Reliable:    reliable,
		}); err != nil {
			l.RaiseError("error deferring message broadcast: %v", err)
		}
	}

	return 0
}

func (r *RuntimeLuaMatchCore) validateBroadcast(l *lua.LState) ([]*PresenceID, *rtapi.Envelope, bool) {
	opCode := l.CheckInt64(1)

	var dataBytes []byte
	if data := l.Get(2); data.Type() != lua.LTNil {
		if data.Type() != lua.LTString {
			l.ArgError(2, "expects data to be a string or nil")
			return nil, nil, false
		}
		dataBytes = []byte(data.(lua.LString))
	}

	filter := l.OptTable(3, nil)
	var presenceIDs []*PresenceID
	if filter != nil {
		fl := filter.Len()
		if fl == 0 {
			return nil, nil, false
		}
		presenceIDs = make([]*PresenceID, 0, fl)
		conversionError := false
		filter.ForEach(func(_, p lua.LValue) {
			pt, ok := p.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(3, "expects a valid set of presences")
				return
			}

			presenceID := &PresenceID{}
			pt.ForEach(func(k, v lua.LValue) {
				switch k.String() {
				case "session_id":
					sid, err := uuid.FromString(v.String())
					if err != nil {
						conversionError = true
						l.ArgError(3, "expects each presence to have a valid session_id")
						return
					}
					presenceID.SessionID = sid
				case "node":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(3, "expects node to be string")
						return
					}
					presenceID.Node = v.String()
				}
			})
			if presenceID.SessionID == uuid.Nil || presenceID.Node == "" {
				conversionError = true
				l.ArgError(3, "expects each presence to have a valid session_id and node")
				return
			}
			if conversionError {
				return
			}
			presenceIDs = append(presenceIDs, presenceID)
		})
		if conversionError {
			return nil, nil, false
		}
	}

	if presenceIDs != nil && len(presenceIDs) == 0 {
		// Filter is empty, there are no requested message targets.
		return nil, nil, false
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
			return nil, nil, false
		}
		if conversionError {
			return nil, nil, false
		}
	}

	if presenceIDs != nil {
		// Ensure specific presences actually exist to prevent sending bogus messages to arbitrary users.
		if len(presenceIDs) == 1 && filter != nil {
			// Shorter validation cycle if there is only one intended recipient.
			presenceValue := filter.RawGetInt(1)
			if presenceValue == lua.LNil {
				l.ArgError(3, "expects each presence to be non-nil")
				return nil, nil, false
			}
			presenceTable, ok := presenceValue.(*lua.LTable)
			if !ok {
				l.ArgError(3, "expects each presence to be a table")
				return nil, nil, false
			}
			userIDValue := presenceTable.RawGetString("user_id")
			if userIDValue == nil {
				l.ArgError(3, "expects each presence to have a valid user_id")
				return nil, nil, false
			}
			if userIDValue.Type() != lua.LTString {
				l.ArgError(3, "expects each presence to have a valid user_id")
				return nil, nil, false
			}
			_, err := uuid.FromString(userIDValue.String())
			if err != nil {
				l.ArgError(3, "expects each presence to have a valid user_id")
				return nil, nil, false
			}
			if !r.presenceList.Contains(presenceIDs[0]) {
				return nil, nil, false
			}
		} else {
			presenceIDs = r.presenceList.FilterPresenceIDs(presenceIDs)
			if len(presenceIDs) == 0 {
				// None of the target presenceIDs existed in the list of match members.
				return nil, nil, false
			}
		}
	}

	reliable := l.OptBool(5, true)

	msg := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId:  r.idStr,
		Presence: presence,
		OpCode:   opCode,
		Data:     dataBytes,
		Reliable: reliable,
	}}}

	if presenceIDs == nil {
		presenceIDs = r.presenceList.ListPresenceIDs()
	}

	return presenceIDs, msg, reliable
}

func (r *RuntimeLuaMatchCore) matchKick(l *lua.LState) int {
	if r.stopped.Load() {
		l.RaiseError("match stopped")
		return 0
	}

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
	if r.stopped.Load() {
		l.RaiseError("match stopped")
		return 0
	}

	input := l.OptString(1, "")

	if err := r.matchRegistry.UpdateMatchLabel(r.id, r.tickRate, r.module, input, r.createTime); err != nil {
		l.RaiseError("error updating match label: %v", err.Error())
		return 0
	}
	r.label.Store(input)

	// This must be executed from inside a match call so safe to update here.
	r.ctx.RawSetString(__RUNTIME_LUA_CTX_MATCH_LABEL, lua.LString(input))
	return 0
}
