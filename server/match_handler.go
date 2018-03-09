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
	"fmt"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/social"
	"github.com/pkg/errors"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"sync"
	"time"
)

type MatchDataMessage struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Username  string
	Node      string
	OpCode    int64
	Data      []byte
}

type MatchHandler struct {
	logger        *zap.Logger
	matchRegistry MatchRegistry
	router        MessageRouter

	// Identification not (directly) controlled by match init.
	ID     uuid.UUID
	Node   string
	IDStr  string
	Stream PresenceStream

	// Internal state.
	tick          lua.LNumber
	vm            *lua.LState
	initFn        lua.LValue
	joinAttemptFn lua.LValue
	leaveFn       lua.LValue
	loopFn        lua.LValue
	ctx           *lua.LTable
	dispatcher    *lua.LTable

	// Control elements.
	inputCh chan *MatchDataMessage
	ticker  *time.Ticker
	callCh  chan func(*MatchHandler)
	stopCh  chan struct{}
	stopped bool

	// Immutable configuration set by match init.
	Label string
	Rate  int

	// Match state.
	state lua.LValue
}

func NewMatchHandler(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, once *sync.Once, id uuid.UUID, node string, name string, params interface{}) (*MatchHandler, error) {
	// Set up the Lua VM that will handle this match.
	vm := lua.NewState(lua.Options{
		CallStackSize:       1024,
		RegistrySize:        1024,
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}
	nakamaModule := NewNakamaModule(logger, db, config, socialClient, vm, sessionRegistry, matchRegistry, tracker, router, once, nil)
	vm.PreloadModule("nakama", nakamaModule.Loader)

	// Create the context to be used throughout this match.
	ctx := vm.CreateTable(6, 6)
	ctx.RawSetString(__CTX_ENV, ConvertMap(vm, config.GetRuntime().Environment))
	ctx.RawSetString(__CTX_MODE, lua.LString(Match.String()))
	ctx.RawSetString(__CTX_MATCH_ID, lua.LString(fmt.Sprintf("%v:%v", id.String(), node)))
	ctx.RawSetString(__CTX_MATCH_NODE, lua.LString(node))

	// Require the match module to load it (and its dependencies) and get its returned value.
	req := vm.GetGlobal("require").(*lua.LFunction)
	err := vm.GPCall(req.GFunction, lua.LString(name))
	if err != nil {
		return nil, fmt.Errorf("error loading match module: %v", err.Error())
	}

	// Extract the expected function references.
	tab := vm.CheckTable(1)
	initFn := tab.RawGet(lua.LString("match_init"))
	if initFn.Type() != lua.LTFunction {
		return nil, errors.New("match_init not found or not a function")
	}
	joinAttemptFn := tab.RawGet(lua.LString("match_join_attempt"))
	if joinAttemptFn.Type() != lua.LTFunction {
		return nil, errors.New("match_join_attempt not found or not a function")
	}
	leaveFn := tab.RawGet(lua.LString("match_leave"))
	if leaveFn.Type() != lua.LTFunction {
		return nil, errors.New("match_leave not found or not a function")
	}
	loopFn := tab.RawGet(lua.LString("match_loop"))
	if loopFn.Type() != lua.LTFunction {
		return nil, errors.New("match_loop not found or not a function")
	}

	// Run the match_init sequence.
	vm.Push(lua.LString(__nakamaReturnValue))
	vm.Push(initFn)
	vm.Push(ctx)
	if params == nil {
		vm.Push(lua.LNil)
	} else {
		vm.Push(convertValue(vm, params))
	}

	err = vm.PCall(2, lua.MultRet, nil)
	if err != nil {
		return nil, fmt.Errorf("error running match_init: %v", err.Error())
	}

	// Extract desired label.
	label := vm.Get(-1)
	if label.Type() == lua.LTString && lua.LVAsString(label) == __nakamaReturnValue {
		return nil, errors.New("match_init returned unexpected third value, must be a label string")
	} else if label.Type() != lua.LTString {
		return nil, errors.New("match_init returned unexpected third value, must be a label string")
	}
	vm.Pop(1)

	labelStr := label.String()
	if len(labelStr) > 256 {
		return nil, errors.New("match_init returned invalid label, must be 256 bytes or less")
	}

	// Extract desired tick rate.
	rate := vm.Get(-1)
	if rate.Type() == lua.LTString && lua.LVAsString(rate) == __nakamaReturnValue {
		return nil, errors.New("match_init returned unexpected second value, must be a tick rate number")
	} else if rate.Type() != lua.LTNumber {
		return nil, errors.New("match_init returned unexpected second value, must be a tick rate number")
	}
	vm.Pop(1)

	rateInt := int(rate.(lua.LNumber))
	if rateInt > 30 || rateInt < 1 {
		return nil, errors.New("match_init returned invalid tick rate, must be between 1 and 30")
	}

	// Extract initial state.
	state := vm.Get(-1)
	if state.Type() == lua.LTString && lua.LVAsString(state) == __nakamaReturnValue {
		return nil, errors.New("match_init returned unexpected first value, must be a state")
	}
	vm.Pop(1)

	// Drop the sentinel value from the stack.
	if sentinel := vm.Get(-1); sentinel.Type() != lua.LTString || lua.LVAsString(sentinel) != __nakamaReturnValue {
		return nil, errors.New("match_init returned too many arguments, must be: state, tick rate number, label string")
	}
	vm.Pop(1)

	// Add context values only available after match_init completes.
	ctx.RawSetString(__CTX_MATCH_LABEL, label)
	ctx.RawSetString(__CTX_MATCH_TICK_RATE, rate)

	// Construct the match.
	mh := &MatchHandler{
		logger:        logger.With(zap.String("mid", id.String())),
		matchRegistry: matchRegistry,
		router:        router,

		ID:    id,
		Node:  node,
		IDStr: fmt.Sprintf("%v:%v", id.String(), node),
		Stream: PresenceStream{
			Mode:    StreamModeMatchAuthoritative,
			Subject: id,
			Label:   node,
		},

		tick:          lua.LNumber(0),
		vm:            vm,
		initFn:        initFn,
		joinAttemptFn: joinAttemptFn,
		leaveFn:       leaveFn,
		loopFn:        loopFn,
		ctx:           ctx,
		// Dispatcher below.

		inputCh: make(chan *MatchDataMessage, 128),
		// Ticker below.
		callCh:  make(chan func(mh *MatchHandler), 128),
		stopCh:  make(chan struct{}),
		stopped: false,

		Label: labelStr,
		Rate:  rateInt,

		state: state,
	}

	// Set up the dispatcher that exposes control functions to the match loop.
	mh.dispatcher = vm.SetFuncs(vm.CreateTable(2, 2), map[string]lua.LGFunction{
		"broadcast_message": mh.broadcastMessage,
		"match_kick":        mh.matchKick,
	})

	// Set up the ticker that governs the match loop.
	mh.ticker = time.NewTicker(time.Second / time.Duration(mh.Rate))

	// Continuously run queued actions until the match stops.
	go func() {
		for {
			select {
			case <-mh.stopCh:
				// Match has been stopped.
				return
			case <-mh.ticker.C:
				// Tick, queue a match loop invocation.
				if !mh.QueueCall(loop) {
					return
				}
			case call := <-mh.callCh:
				// An invocation to one of the match functions.
				call(mh)
			}
		}
	}()

	return mh, nil
}

// Used when an internal match process (or error) requires it to stop.
func (mh *MatchHandler) Stop() {
	mh.Close()
	mh.matchRegistry.RemoveMatch(mh.ID, mh.Stream)
}

// Used when the match is closed externally.
func (mh *MatchHandler) Close() {
	if mh.stopped {
		return
	}
	mh.stopped = true
	close(mh.stopCh)
	mh.ticker.Stop()
}

func (mh *MatchHandler) QueueCall(f func(*MatchHandler)) bool {
	select {
	case mh.callCh <- f:
		return true
	default:
		// Match call queue is full, the handler isn't processing fast enough.
		mh.logger.Warn("Match handler call processing too slow, closing match")
		mh.Stop()
		return false
	}
}

func (mh *MatchHandler) QueueData(m *MatchDataMessage) {
	select {
	case mh.inputCh <- m:
		return
	default:
		// Match input queue is full, the handler isn't processing fast enough or there's too much incoming data.
		mh.logger.Warn("Match handler data processing too slow, dropping data message")
		return
	}
}

func loop(mh *MatchHandler) {
	if mh.stopped {
		return
	}

	// Drain the input queue into a Lua table.
	size := len(mh.inputCh)
	input := mh.vm.CreateTable(size, size)
	for i := 1; i <= size; i++ {
		msg := <-mh.inputCh

		presence := mh.vm.CreateTable(4, 4)
		presence.RawSetString("UserId", lua.LString(msg.UserID.String()))
		presence.RawSetString("SessionId", lua.LString(msg.SessionID.String()))
		presence.RawSetString("Username", lua.LString(msg.Username))
		presence.RawSetString("Node", lua.LString(msg.Node))

		in := mh.vm.CreateTable(3, 3)
		in.RawSetString("Sender", presence)
		in.RawSetString("OpCode", lua.LNumber(msg.OpCode))
		if msg.Data != nil {
			in.RawSetString("Data", lua.LString(msg.Data))
		} else {
			in.RawSetString("Data", lua.LNil)
		}

		input.RawSetInt(i, in)
	}

	// Execute the match_loop call.
	mh.vm.Push(lua.LString(__nakamaReturnValue))
	mh.vm.Push(mh.loopFn)
	mh.vm.Push(mh.ctx)
	mh.vm.Push(mh.dispatcher)
	mh.vm.Push(mh.tick)
	mh.vm.Push(mh.state)
	mh.vm.Push(input)

	err := mh.vm.PCall(5, lua.MultRet, nil)
	if err != nil {
		mh.Stop()
		mh.logger.Warn("Stopping match after error from match_loop execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
		return
	}

	// Extract the resulting state.
	state := mh.vm.Get(-1)
	if state.Type() == lua.LTNil || (state.Type() == lua.LTString && lua.LVAsString(state) == __nakamaReturnValue) {
		mh.logger.Debug("Match loop returned nil or no state, stopping match")
		mh.Stop()
		return
	}
	mh.vm.Pop(1)
	// Check for and remove the sentinel value, will fail if there are any extra return values.
	if sentinel := mh.vm.Get(-1); sentinel.Type() != lua.LTString || lua.LVAsString(sentinel) != __nakamaReturnValue {
		mh.logger.Warn("Match loop returned too many values, stopping match")
		mh.Stop()
		return
	}
	mh.vm.Pop(1)

	mh.state = state
	mh.tick++
}

func JoinAttempt(resultCh chan *MatchJoinResult, userID, sessionID uuid.UUID, username, node string) func(mh *MatchHandler) {
	return func(mh *MatchHandler) {
		if mh.stopped {
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		presence := mh.vm.CreateTable(4, 4)
		presence.RawSetString("UserId", lua.LString(userID.String()))
		presence.RawSetString("SessionId", lua.LString(sessionID.String()))
		presence.RawSetString("Username", lua.LString(username))
		presence.RawSetString("Node", lua.LString(node))

		// Execute the match_join_attempt call.
		mh.vm.Push(lua.LString(__nakamaReturnValue))
		mh.vm.Push(mh.joinAttemptFn)
		mh.vm.Push(mh.ctx)
		mh.vm.Push(mh.dispatcher)
		mh.vm.Push(mh.tick)
		mh.vm.Push(mh.state)
		mh.vm.Push(presence)

		err := mh.vm.PCall(5, lua.MultRet, nil)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_join_attempt execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		// Extract the join attempt response.
		allow := mh.vm.Get(-1)
		if allow.Type() == lua.LTString && lua.LVAsString(allow) == __nakamaReturnValue {
			mh.logger.Warn("Match join attempt returned too few values, stopping match - expected: state, join result boolean")
			mh.Stop()
			resultCh <- &MatchJoinResult{Allow: false}
			return
		} else if allow.Type() != lua.LTBool {
			mh.logger.Warn("Match join attempt returned non-boolean join result, stopping match")
			mh.Stop()
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}
		mh.vm.Pop(1)
		// Extract the resulting state.
		state := mh.vm.Get(-1)
		if state.Type() == lua.LTNil || (state.Type() == lua.LTString && lua.LVAsString(state) == __nakamaReturnValue) {
			mh.logger.Debug("Match join attempt returned nil or no state, stopping match")
			mh.Stop()
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}
		mh.vm.Pop(1)
		// Check for and remove the sentinel value, will fail if there are any extra return values.
		if sentinel := mh.vm.Get(-1); sentinel.Type() != lua.LTString || lua.LVAsString(sentinel) != __nakamaReturnValue {
			mh.logger.Warn("Match join attempt returned too many values, stopping match")
			mh.Stop()
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}
		mh.vm.Pop(1)

		mh.state = state
		resultCh <- &MatchJoinResult{Allow: lua.LVAsBool(allow), Label: mh.Label}
	}
}

func Leave(leaves []*MatchPresence) func(mh *MatchHandler) {
	return func(mh *MatchHandler) {
		if mh.stopped {
			return
		}

		size := len(leaves)
		presences := mh.vm.CreateTable(size, size)
		for i, p := range leaves {
			presence := mh.vm.CreateTable(4, 4)
			presence.RawSetString("UserId", lua.LString(p.UserID.String()))
			presence.RawSetString("SessionId", lua.LString(p.SessionID.String()))
			presence.RawSetString("Username", lua.LString(p.Username))
			presence.RawSetString("Node", lua.LString(p.Node))

			presences.RawSetInt(i+1, presence)
		}

		// Execute the match_leave call.
		mh.vm.Push(lua.LString(__nakamaReturnValue))
		mh.vm.Push(mh.leaveFn)
		mh.vm.Push(mh.ctx)
		mh.vm.Push(mh.dispatcher)
		mh.vm.Push(mh.tick)
		mh.vm.Push(mh.state)
		mh.vm.Push(presences)

		err := mh.vm.PCall(5, lua.MultRet, nil)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_leave execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
			return
		}

		// Extract the resulting state.
		state := mh.vm.Get(-1)
		if state.Type() == lua.LTNil || (state.Type() == lua.LTString && lua.LVAsString(state) == __nakamaReturnValue) {
			mh.logger.Debug("Match leave returned nil or no state, stopping match")
			mh.Stop()
			return
		}
		mh.vm.Pop(1)
		// Check for and remove the sentinel value, will fail if there are any extra return values.
		if sentinel := mh.vm.Get(-1); sentinel.Type() != lua.LTString || lua.LVAsString(sentinel) != __nakamaReturnValue {
			mh.logger.Warn("Match leave returned too many values, stopping match")
			mh.Stop()
			return
		}
		mh.vm.Pop(1)

		mh.state = state
	}
}

func (mh *MatchHandler) broadcastMessage(l *lua.LState) int {
	opCode := l.CheckInt64(1)
	data := l.OptString(2, "")
	var dataBytes []byte
	if data != "" {
		dataBytes = []byte(data)
	}

	filter := l.OptTable(3, nil)
	var presences []*Presence
	if filter != nil {
		fl := filter.Len()
		if fl == 0 {
			return 0
		}
		presences = make([]*Presence, 0, fl)
		conversionError := false
		filter.ForEach(func(_, p lua.LValue) {
			pt, ok := p.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(1, "expects a valid set of presences")
				return
			}

			presence := &Presence{ID: PresenceID{}}
			pt.ForEach(func(k, v lua.LValue) {
				switch k.String() {
				case "UserId":
					uid, err := uuid.FromString(v.String())
					if err != nil {
						conversionError = true
						l.ArgError(1, "expects each presence to have a valid UserId")
						return
					}
					presence.UserID = uid
				case "SessionId":
					sid, err := uuid.FromString(v.String())
					if err != nil {
						conversionError = true
						l.ArgError(1, "expects each presence to have a valid SessionId")
						return
					}
					presence.ID.SessionID = sid
				case "Node":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects Node to be string")
						return
					}
					presence.ID.Node = v.String()
				}
			})
			if presence.UserID == uuid.Nil || presence.ID.SessionID == uuid.Nil || presence.ID.Node == "" {
				conversionError = true
				l.ArgError(1, "expects each presence to have a valid UserId, SessionId, and Node")
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
	}

	sender := l.OptTable(4, nil)
	var presence *rtapi.StreamPresence
	if sender != nil {
		presence := &rtapi.StreamPresence{}
		conversionError := false
		sender.ForEach(func(k, v lua.LValue) {
			switch k.String() {
			case "UserId":
				s := v.String()
				_, err := uuid.FromString(s)
				if err != nil {
					conversionError = true
					l.ArgError(4, "expects presence to have a valid UserId")
					return
				}
				presence.UserId = s
			case "SessionId":
				s := v.String()
				_, err := uuid.FromString(s)
				if err != nil {
					conversionError = true
					l.ArgError(4, "expects presence to have a valid SessionId")
					return
				}
				presence.SessionId = s
			case "Username":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(4, "expects Username to be string")
					return
				}
				presence.Username = v.String()
			}
		})
		if presence.UserId == "" || presence.SessionId == "" || presence.Username == "" {
			l.ArgError(4, "expects presence to have a valid UserId, SessionId, and Username")
			return 0
		}
		if conversionError {
			return 0
		}
	}

	msg := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId:  mh.IDStr,
		Presence: presence,
		OpCode:   opCode,
		Data:     dataBytes,
	}}}

	if presences == nil {
		mh.router.SendToStream(mh.logger, mh.Stream, msg)
	} else {
		mh.router.SendToPresences(mh.logger, presences, msg)
	}

	return 0
}

func (mh *MatchHandler) matchKick(l *lua.LState) int {
	input := l.CheckTable(1)
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
			case "UserId":
				uid, err := uuid.FromString(v.String())
				if err != nil {
					conversionError = true
					l.ArgError(1, "expects each presence to have a valid UserId")
					return
				}
				presence.UserID = uid
			case "SessionId":
				sid, err := uuid.FromString(v.String())
				if err != nil {
					conversionError = true
					l.ArgError(1, "expects each presence to have a valid SessionId")
					return
				}
				presence.SessionID = sid
			case "Node":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects Node to be string")
					return
				}
				presence.Node = v.String()
			}
		})
		if presence.UserID == uuid.Nil || presence.SessionID == uuid.Nil || presence.Node == "" {
			conversionError = true
			l.ArgError(1, "expects each presence to have a valid UserId, SessionId, and Node")
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

	mh.matchRegistry.Kick(mh.Stream, presences)
	return 0
}
