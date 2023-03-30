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

package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dop251/goja"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
)

var matchStoppedError = errors.New("match stopped")

type RuntimeJavaScriptMatchCore struct {
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

	vm            *goja.Runtime
	initFn        goja.Callable
	joinAttemptFn goja.Callable
	joinFn        goja.Callable
	leaveFn       goja.Callable
	loopFn        goja.Callable
	terminateFn   goja.Callable
	signalFn      goja.Callable
	ctx           *goja.Object
	dispatcher    goja.Value
	nakamaModule  goja.Value
	loggerModule  goja.Value
	program       *goja.Program

	ctxCancelFn context.CancelFunc
}

func NewRuntimeJavascriptMatchCore(logger *zap.Logger, module string, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, localCache *RuntimeJavascriptLocalCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry *StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, matchCreateFn RuntimeMatchCreateFunction, eventFn RuntimeEventCustomFunction, id uuid.UUID, node, version string, stopped *atomic.Bool, matchHandlers *jsMatchHandlers, modCache *RuntimeJSModuleCache) (RuntimeMatchCore, error) {
	runtime := goja.New()

	jsLoggerInst, err := NewJsLogger(runtime, logger)
	if err != nil {
		logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
	}

	nakamaModule := NewRuntimeJavascriptNakamaModule(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, rankCache, localCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, eventFn, matchCreateFn)
	nk, err := nakamaModule.Constructor(runtime)
	if err != nil {
		logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
	}
	goCtx, ctxCancelFn := context.WithCancel(context.Background())
	nakamaModule.ctx = goCtx

	runtime.RunProgram(modCache.Modules[modCache.Names[0]].Program)
	freezeGlobalObject(config, runtime)

	ctx := NewRuntimeJsInitContext(runtime, node, version, config.GetRuntime().Environment)
	ctx.Set(__RUNTIME_JAVASCRIPT_CTX_MODE, RuntimeExecutionModeMatch)
	ctx.Set(__RUNTIME_JAVASCRIPT_CTX_MATCH_ID, fmt.Sprintf("%v.%v", id.String(), node))
	ctx.Set(__RUNTIME_JAVASCRIPT_CTX_MATCH_NODE, node)

	// TODO: goja runtime does not currently support passing a context to the vm
	// goCtx, ctxCancelFn := context.WithCancel(context.Background())
	// vm.SetContext(goCtx)

	initFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.initFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchInit)), zap.String("key", matchHandlers.initFn))
	}
	joinAttemptFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.joinAttemptFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchJoinAttempt)), zap.String("key", matchHandlers.joinAttemptFn))
	}
	joinFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.joinFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchJoin)), zap.String("key", matchHandlers.joinFn))
	}
	leaveFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.leaveFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchLeave)), zap.String("key", matchHandlers.leaveFn))
	}
	loopFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.loopFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchLoop)), zap.String("key", matchHandlers.loopFn))
	}
	terminateFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.terminateFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchTerminate)), zap.String("key", matchHandlers.terminateFn))
	}
	signalFn, ok := goja.AssertFunction(runtime.Get(matchHandlers.signalFn))
	if !ok {
		ctxCancelFn()
		logger.Fatal("Failed to get JavaScript match loop function reference.", zap.String("fn", string(MatchSignal)), zap.String("key", matchHandlers.signalFn))
	}

	core := &RuntimeJavaScriptMatchCore{
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
		label:         atomic.NewString(""),
		vm:            runtime,
		initFn:        initFn,
		joinAttemptFn: joinAttemptFn,
		joinFn:        joinFn,
		leaveFn:       leaveFn,
		loopFn:        loopFn,
		terminateFn:   terminateFn,
		signalFn:      signalFn,
		ctx:           ctx,

		loggerModule: jsLoggerInst,
		nakamaModule: nk,
		ctxCancelFn:  ctxCancelFn,
	}

	dispatcher := runtime.ToValue(
		func(call goja.ConstructorCall) *goja.Object {
			call.This.Set("broadcastMessage", core.broadcastMessage(runtime))
			call.This.Set("broadcastMessageDeferred", core.broadcastMessageDeferred(runtime))
			call.This.Set("matchKick", core.matchKick(runtime))
			call.This.Set("matchLabelUpdate", core.matchLabelUpdate(runtime))

			freeze(call.This)

			return nil
		},
	)

	dispatcherInst, err := runtime.New(dispatcher)
	if err != nil {
		ctxCancelFn()
		logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
	}
	core.dispatcher = dispatcherInst

	return core, nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchInit(presenceList *MatchPresenceList, deferMessageFn RuntimeMatchDeferMessageFunction, params map[string]interface{}) (interface{}, int, error) {
	args := []goja.Value{rm.ctx, rm.loggerModule, rm.nakamaModule, rm.vm.ToValue(params)}

	retVal, err := rm.initFn(goja.Null(), args...)
	if err != nil {
		return nil, 0, err
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, 0, errors.New("matchInit is expected to return an object with 'state', 'tickRate' and 'label' properties")
	}
	tickRateRet, ok := retMap["tickRate"]
	if !ok {
		return nil, 0, errors.New("matchInit return value has no 'tickRate' property")
	}
	rate, ok := tickRateRet.(int64)
	if !ok {
		return nil, 0, errors.New("matchInit 'tickRate' must be a number between 1 and 60")
	}
	if rate < 1 || rate > 60 {
		return nil, 0, errors.New("matchInit 'tickRate' must be a number between 1 and 60")
	}
	rm.tickRate = int(rate)

	var label string
	labelRet, ok := retMap["label"]
	if ok {
		label, ok = labelRet.(string)
		if !ok {
			return nil, 0, errors.New("matchInit 'label' value must be a string")
		}
	}

	state, ok := retMap["state"]
	if !ok {
		return nil, 0, errors.New("matchInit is expected to return an object with a 'state' property")
	}
	if state == nil {
		return nil, 0, ErrMatchInitStateNil
	}

	if err := rm.matchRegistry.UpdateMatchLabel(rm.id, rm.tickRate, rm.module, label, rm.createTime); err != nil {
		return nil, 0, err
	}
	rm.label.Store(label)

	rm.ctx.Set(__RUNTIME_JAVASCRIPT_CTX_MATCH_LABEL, label)
	rm.ctx.Set(__RUNTIME_JAVASCRIPT_CTX_MATCH_TICK_RATE, rate)

	rm.deferMessageFn = deferMessageFn
	rm.presenceList = presenceList

	return state, int(rate), nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, node string, metadata map[string]string) (interface{}, bool, string, error) {
	// Setup presence
	presenceObj := rm.vm.NewObject()
	presenceObj.Set("userId", userID.String())
	presenceObj.Set("sessionId", sessionID.String())
	presenceObj.Set("username", username)
	presenceObj.Set("node", node)

	// Setup ctx
	ctxObj := rm.vm.NewObject()
	for _, key := range rm.ctx.Keys() {
		ctxObj.Set(key, rm.ctx.Get(key))
	}
	ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_USER_ID, userID.String())
	ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_USERNAME, username)
	if vars != nil {
		ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_VARS, vars)
	}
	ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_USER_SESSION_EXP, sessionExpiry)
	ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_SESSION_ID, sessionID.String())
	if clientIP != "" {
		ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_CLIENT_IP, clientIP)
	}
	if clientPort != "" {
		ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_CLIENT_PORT, clientPort)
	}

	pointerizeSlices(state)
	args := []goja.Value{ctxObj, rm.loggerModule, rm.nakamaModule, rm.dispatcher, rm.vm.ToValue(tick), rm.vm.ToValue(state), presenceObj, rm.vm.ToValue(metadata)}
	retVal, err := rm.joinAttemptFn(goja.Null(), args...)
	if err != nil {
		return nil, false, "", err
	}

	if goja.IsNull(retVal) || goja.IsUndefined(retVal) {
		return nil, false, "", nil
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, false, "", errors.New("matchJoinAttempt is expected to return an object with 'state' and 'accept' properties")
	}

	allowRet, ok := retMap["accept"]
	if !ok {
		return nil, false, "", errors.New("matchJoinAttempt return value has an 'accept' property")
	}
	allow, ok := allowRet.(bool)
	if !ok {
		return nil, false, "", errors.New("matchJoinAttempt 'accept' property must be a boolean")
	}

	var rejectMsg string
	if allow == false {
		rejectMsgRet, ok := retMap["rejectMessage"]
		if ok {
			rejectMsg, ok = rejectMsgRet.(string)
			if !ok {
				return nil, false, "", errors.New("matchJoinAttempt 'rejectMessage' property must be a string")
			}
		}
	}

	newState, ok := retMap["state"]
	if !ok {
		return nil, false, "", errors.New("matchJoinAttempt is expected to return an object with 'state' property")
	}

	return newState, allow, rejectMsg, nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchJoin(tick int64, state interface{}, joins []*MatchPresence) (interface{}, error) {
	presences := make([]interface{}, 0, len(joins))
	for _, p := range joins {
		presenceMap := make(map[string]interface{}, 5)
		presenceMap["userId"] = p.UserID.String()
		presenceMap["sessionId"] = p.SessionID.String()
		presenceMap["username"] = p.Username
		presenceMap["node"] = p.Node
		presenceMap["reason"] = p.Reason

		presences = append(presences, presenceMap)
	}

	pointerizeSlices(state)
	args := []goja.Value{rm.ctx, rm.loggerModule, rm.nakamaModule, rm.dispatcher, rm.vm.ToValue(tick), rm.vm.ToValue(state), rm.vm.ToValue(presences)}
	retVal, err := rm.joinFn(goja.Null(), args...)
	if err != nil {
		return nil, err
	}

	if goja.IsNull(retVal) || goja.IsUndefined(retVal) {
		return nil, nil
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, errors.New("matchJoin is expected to return an object with 'state' property")
	}

	newState, ok := retMap["state"]
	if !ok {
		return nil, errors.New("matchJoin is expected to return an object with 'state' property")
	}

	return newState, nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchLeave(tick int64, state interface{}, leaves []*MatchPresence) (interface{}, error) {
	presences := make([]interface{}, 0, len(leaves))
	for _, p := range leaves {
		presenceMap := make(map[string]interface{}, 5)
		presenceMap["userId"] = p.UserID.String()
		presenceMap["sessionId"] = p.SessionID.String()
		presenceMap["username"] = p.Username
		presenceMap["node"] = p.Node
		presenceMap["reason"] = p.Reason

		presences = append(presences, presenceMap)
	}

	pointerizeSlices(state)
	args := []goja.Value{rm.ctx, rm.loggerModule, rm.nakamaModule, rm.dispatcher, rm.vm.ToValue(tick), rm.vm.ToValue(state), rm.vm.ToValue(presences)}
	retVal, err := rm.leaveFn(goja.Null(), args...)
	if err != nil {
		return nil, err
	}

	if goja.IsNull(retVal) || goja.IsUndefined(retVal) {
		return nil, nil
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, errors.New("matchLeave is expected to return an object with 'state' property")
	}

	newState, ok := retMap["state"]
	if !ok {
		return nil, errors.New("matchLeave is expected to return an object with 'state' property")
	}

	return newState, nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchLoop(tick int64, state interface{}, inputCh <-chan *MatchDataMessage) (interface{}, error) {
	size := len(inputCh)
	inputs := make([]interface{}, 0, size)
	for i := 0; i < size; i++ {
		msg := <-inputCh

		presenceMap := make(map[string]interface{}, 5)
		presenceMap["userId"] = msg.UserID.String()
		presenceMap["sessionId"] = msg.SessionID.String()
		presenceMap["username"] = msg.Username
		presenceMap["node"] = msg.Node

		msgMap := make(map[string]interface{}, 5)
		msgMap["sender"] = presenceMap
		msgMap["opCode"] = msg.OpCode
		if msg.Data == nil {
			msgMap["data"] = goja.Null()
		} else {
			msgMap["data"] = rm.vm.NewArrayBuffer(msg.Data)
		}
		msgMap["reliable"] = msg.Reliable
		msgMap["receiveTimeMs"] = msg.ReceiveTime

		inputs = append(inputs, msgMap)
	}

	pointerizeSlices(state)
	args := []goja.Value{rm.ctx, rm.loggerModule, rm.nakamaModule, rm.dispatcher, rm.vm.ToValue(tick), rm.vm.ToValue(state), rm.vm.ToValue(inputs)}
	retVal, err := rm.loopFn(goja.Null(), args...)
	if err != nil {
		return nil, err
	}

	if goja.IsNull(retVal) || goja.IsUndefined(retVal) {
		return nil, nil
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, errors.New("matchLoop is expected to return an object with 'state' property")
	}

	newState, ok := retMap["state"]
	if !ok {
		return nil, errors.New("matchLoop is expected to return an object with 'state' property")
	}

	return newState, nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchTerminate(tick int64, state interface{}, graceSeconds int) (interface{}, error) {
	pointerizeSlices(state)
	args := []goja.Value{rm.ctx, rm.loggerModule, rm.nakamaModule, rm.dispatcher, rm.vm.ToValue(tick), rm.vm.ToValue(state), rm.vm.ToValue(graceSeconds)}
	retVal, err := rm.terminateFn(goja.Null(), args...)
	if err != nil {
		return nil, err
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, errors.New("matchTerminate is expected to return an object with 'state' property")
	}

	if goja.IsNull(retVal) || goja.IsUndefined(retVal) {
		return nil, nil
	}

	newState, ok := retMap["state"]
	if !ok {
		return nil, errors.New("matchTerminate is expected to return an object with 'state' property")
	}

	return newState, nil
}

func (rm *RuntimeJavaScriptMatchCore) MatchSignal(tick int64, state interface{}, data string) (interface{}, string, error) {
	pointerizeSlices(state)
	args := []goja.Value{rm.ctx, rm.loggerModule, rm.nakamaModule, rm.dispatcher, rm.vm.ToValue(tick), rm.vm.ToValue(state), rm.vm.ToValue(data)}
	retVal, err := rm.signalFn(goja.Null(), args...)
	if err != nil {
		return nil, "", err
	}

	retMap, ok := retVal.Export().(map[string]interface{})
	if !ok {
		return nil, "", errors.New("matchSignal is expected to return an object with 'state' property")
	}

	if goja.IsNull(retVal) || goja.IsUndefined(retVal) {
		return nil, "", nil
	}

	newState, ok := retMap["state"]
	if !ok {
		return nil, "", errors.New("matchSignal is expected to return an object with 'state' property")
	}

	responseDataRet, ok := retMap["data"]
	var responseData string
	if ok {
		responseData, ok = responseDataRet.(string)
		if !ok {
			return nil, "", errors.New("matchSignal 'data' property must be a string")
		}
	}

	return newState, responseData, nil
}

func (rm *RuntimeJavaScriptMatchCore) GetState(state interface{}) (string, error) {
	stateBytes, err := json.Marshal(RuntimeJsConvertJsValue(state))
	if err != nil {
		return "", err
	}
	return string(stateBytes), nil
}

func (rm *RuntimeJavaScriptMatchCore) Label() string {
	return rm.label.Load()
}

func (rm *RuntimeJavaScriptMatchCore) TickRate() int {
	return rm.tickRate
}

func (rm *RuntimeJavaScriptMatchCore) HandlerName() string {
	return rm.module
}

func (rm *RuntimeJavaScriptMatchCore) CreateTime() int64 {
	return rm.createTime
}

func (rm *RuntimeJavaScriptMatchCore) Cancel() {
	rm.ctxCancelFn()
}

func (rm *RuntimeJavaScriptMatchCore) Cleanup() {}

func (rm *RuntimeJavaScriptMatchCore) broadcastMessage(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if rm.stopped.Load() {
			panic(r.NewGoError(matchStoppedError))
		}

		presenceIDs, msg, reliable := rm.validateBroadcast(r, f)
		if len(presenceIDs) != 0 {
			rm.router.SendToPresenceIDs(rm.logger, presenceIDs, msg, reliable)
		}

		return goja.Undefined()
	}
}

func (rm *RuntimeJavaScriptMatchCore) broadcastMessageDeferred(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if rm.stopped.Load() {
			panic(r.NewGoError(matchStoppedError))
		}

		presenceIDs, msg, reliable := rm.validateBroadcast(r, f)
		if len(presenceIDs) != 0 {
			if err := rm.deferMessageFn(&DeferredMessage{
				PresenceIDs: presenceIDs,
				Envelope:    msg,
				Reliable:    reliable,
			}); err != nil {
				panic(r.NewGoError(fmt.Errorf("error deferring message broadcast: %v", err)))
			}
		}

		return goja.Undefined()
	}
}

func (rm *RuntimeJavaScriptMatchCore) validateBroadcast(r *goja.Runtime, f goja.FunctionCall) ([]*PresenceID, *rtapi.Envelope, bool) {
	opCode := getJsInt(r, f.Argument(0))

	var dataBytes []byte
	data := f.Argument(1)
	if !goja.IsUndefined(data) && !goja.IsNull(data) {
		dataExport := data.Export()
		switch dataExport.(type) {
		case string:
			dataBytes = []byte(dataExport.(string))
		case goja.ArrayBuffer:
			dataBytes = dataExport.(goja.ArrayBuffer).Bytes()
		default:
			panic(r.NewTypeError("expects data to be an ArrayBuffer, a string or nil"))
		}
	}

	filter := f.Argument(2)
	var presenceIDs []*PresenceID
	if !goja.IsUndefined(filter) && !goja.IsNull(filter) {
		filterSlice, ok := filter.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of presences or nil"))
		}

		presenceIDs = make([]*PresenceID, 0, len(filterSlice))
		for _, p := range filterSlice {
			pMap, ok := p.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects a valid set of presences"))
			}

			presenceID := &PresenceID{}

			sidVal, _ := pMap["sessionId"]
			if sidVal == nil {
				panic(r.NewTypeError("presence is expected to contain a 'sessionId'"))
			}
			sidStr, ok := sidVal.(string)
			if !ok {
				panic(r.NewTypeError("expects a 'sessionId' string"))
			}
			sid, err := uuid.FromString(sidStr)
			if err != nil {
				panic(r.NewTypeError("expects a valid 'sessionId'"))
			}

			nodeVal, _ := pMap["node"]
			if nodeVal == nil {
				panic(r.NewTypeError("expects presence to contain a 'node'"))
			}
			node, ok := nodeVal.(string)
			if !ok {
				panic(r.NewTypeError("expects a 'nodeId' string"))
			}

			presenceID.SessionID = sid
			presenceID.Node = node

			presenceIDs = append(presenceIDs, presenceID)
		}
	}

	if presenceIDs != nil && len(presenceIDs) == 0 {
		// Filter is empty, there are no requested message targets.
		return nil, nil, false
	}

	sender := f.Argument(3)
	var presence *rtapi.UserPresence

	if !goja.IsUndefined(sender) && !goja.IsNull(sender) {
		presence = &rtapi.UserPresence{}

		senderMap, ok := sender.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects sender to be an object"))
		}
		userIdVal, _ := senderMap["userId"]
		if userIdVal == nil {
			panic(r.NewTypeError("expects presence to contain 'userId'"))
		}
		userIDStr, ok := userIdVal.(string)
		if !ok {
			panic(r.NewTypeError("expects presence to contain 'userId' string"))
		}
		_, err := uuid.FromString(userIDStr)
		if err != nil {
			panic(r.NewTypeError("expects presence to contain valid userId"))
		}
		presence.UserId = userIDStr

		sidVal, _ := senderMap["sessionId"]
		if sidVal == nil {
			panic(r.NewTypeError("presence is expected to contain a 'sessionId'"))
		}
		sidStr, ok := sidVal.(string)
		if !ok {
			panic(r.NewTypeError("expects a 'sessionId' string"))
		}
		_, err = uuid.FromString(sidStr)
		if err != nil {
			panic(r.NewTypeError("expects a valid 'sessionId'"))
		}
		presence.SessionId = sidStr

		usernameVal, _ := senderMap["username"]
		if usernameVal == nil {
			panic(r.NewTypeError("presence is expected to contain a 'username'"))
		}
		username, ok := sidVal.(string)
		if !ok {
			panic(r.NewTypeError("expects a 'username' string"))
		}
		presence.Username = username
	}

	if presenceIDs != nil {
		// Ensure specific presences actually exist to prevent sending bogus messages to arbitrary users.
		if len(presenceIDs) == 1 && filter != nil {
			if !rm.presenceList.Contains(presenceIDs[0]) {
				return nil, nil, false
			}
		} else {
			presenceIDs = rm.presenceList.FilterPresenceIDs(presenceIDs)
			if len(presenceIDs) == 0 {
				// None of the target presenceIDs existed in the list of match members.
				return nil, nil, false
			}
		}
	}

	reliable := true
	reliableVal := f.Argument(4)
	if !goja.IsUndefined(reliableVal) && !goja.IsNull(reliableVal) {
		reliable = getJsBool(r, reliableVal)
	}

	msg := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId:  rm.idStr,
		Presence: presence,
		OpCode:   opCode,
		Data:     dataBytes,
		Reliable: reliable,
	}}}

	if presenceIDs == nil {
		presenceIDs = rm.presenceList.ListPresenceIDs()
	}

	return presenceIDs, msg, reliable
}

func (rm *RuntimeJavaScriptMatchCore) matchKick(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if rm.stopped.Load() {
			panic(r.NewGoError(matchStoppedError))
		}

		input := f.Argument(0)
		if goja.IsUndefined(input) || goja.IsNull(input) {
			return goja.Undefined()
		}

		presencesSlice, ok := input.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of presence objects"))
		}

		presences := make([]*MatchPresence, 0, len(presencesSlice))
		for _, p := range presencesSlice {
			pMap, ok := p.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects a valid set of presences"))
			}

			presence := &MatchPresence{}
			userIdVal, _ := pMap["userId"]
			if userIdVal == nil {
				panic(r.NewTypeError("expects presence to contain 'userId'"))
			}
			userIDStr, ok := userIdVal.(string)
			if !ok {
				panic(r.NewTypeError("expects presence to contain 'userId' string"))
			}
			uid, err := uuid.FromString(userIDStr)
			if err != nil {
				panic(r.NewTypeError("expects presence to contain valid userId"))
			}
			presence.UserID = uid

			sidVal, _ := pMap["sessionId"]
			if sidVal == nil {
				panic(r.NewTypeError("presence is expected to contain a 'sessionId'"))
			}
			sidStr, ok := sidVal.(string)
			if !ok {
				panic(r.NewTypeError("expects a 'sessionId' string"))
			}
			sid, err := uuid.FromString(sidStr)
			if err != nil {
				panic(r.NewTypeError("expects a valid 'sessionId'"))
			}
			presence.SessionID = sid

			nodeVal, _ := pMap["node"]
			if nodeVal == nil {
				panic(r.NewTypeError("expects presence to contain a 'node'"))
			}
			node, ok := nodeVal.(string)
			if !ok {
				panic(r.NewTypeError("expects a 'node' string"))
			}
			presence.Node = node

			presences = append(presences, presence)
		}

		rm.matchRegistry.Kick(rm.stream, presences)

		return goja.Undefined()
	}
}

func (rm *RuntimeJavaScriptMatchCore) matchLabelUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if rm.stopped.Load() {
			panic(r.NewGoError(matchStoppedError))
		}

		input := getJsString(r, f.Argument(0))

		if err := rm.matchRegistry.UpdateMatchLabel(rm.id, rm.tickRate, rm.module, input, rm.createTime); err != nil {
			panic(r.NewGoError(fmt.Errorf("error updating match label: %v", err.Error())))
		}
		rm.label.Store(input)

		// This must be executed from inside a match call so safe to update here.
		rm.ctx.Set(__RUNTIME_JAVASCRIPT_CTX_MATCH_LABEL, input)

		return goja.Undefined()
	}
}
