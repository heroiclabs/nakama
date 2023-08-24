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
	"errors"
	"fmt"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

var ErrMatchStopped = errors.New("match stopped")

type RuntimeGoMatchCore struct {
	logger        *zap.Logger
	matchRegistry MatchRegistry
	router        MessageRouter

	deferMessageFn RuntimeMatchDeferMessageFunction
	presenceList   *MatchPresenceList

	match runtime.Match

	id         uuid.UUID
	node       string
	module     string
	tickRate   int
	createTime int64
	stopped    *atomic.Bool
	idStr      string
	stream     PresenceStream
	label      *atomic.String

	runtimeLogger runtime.Logger
	db            *sql.DB
	nk            runtime.NakamaModule
	ctx           context.Context

	ctxCancelFn context.CancelFunc
}

func NewRuntimeGoMatchCore(logger *zap.Logger, module string, matchRegistry MatchRegistry, router MessageRouter, id uuid.UUID, node, version string, stopped *atomic.Bool, db *sql.DB, env map[string]string, nk runtime.NakamaModule, match runtime.Match) (RuntimeMatchCore, error) {
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	ctx = NewRuntimeGoContext(ctx, node, version, env, RuntimeExecutionModeMatch, nil, nil, 0, "", "", nil, "", "", "", "")
	ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_MATCH_ID, fmt.Sprintf("%v.%v", id.String(), node)) //nolint:staticcheck
	ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_MATCH_NODE, node)                                  //nolint:staticcheck

	return &RuntimeGoMatchCore{
		logger:        logger,
		matchRegistry: matchRegistry,
		router:        router,

		// deferMessageFn set in MatchInit.
		// presenceList set in MatchInit.
		// tickRate set in MatchInit.

		match: match,

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

		runtimeLogger: NewRuntimeGoLogger(logger),
		db:            db,
		nk:            nk,
		ctx:           ctx,

		ctxCancelFn: ctxCancelFn,
	}, nil
}

func (r *RuntimeGoMatchCore) MatchInit(presenceList *MatchPresenceList, deferMessageFn RuntimeMatchDeferMessageFunction, params map[string]interface{}) (interface{}, int, error) {
	state, tickRate, label := r.match.MatchInit(r.ctx, r.runtimeLogger, r.db, r.nk, params)

	if len(label) > MatchLabelMaxBytes {
		return nil, 0, fmt.Errorf("MatchInit returned invalid label, must be %v bytes or less", MatchLabelMaxBytes)
	}
	if tickRate > 60 || tickRate < 1 {
		return nil, 0, errors.New("MatchInit returned invalid tick rate, must be between 1 and 60")
	}
	r.tickRate = tickRate
	if state == nil {
		return nil, 0, ErrMatchInitStateNil
	}

	if err := r.matchRegistry.UpdateMatchLabel(r.id, r.tickRate, r.module, label, r.createTime); err != nil {
		return nil, 0, err
	}
	r.label.Store(label)

	r.ctx = context.WithValue(r.ctx, runtime.RUNTIME_CTX_MATCH_TICK_RATE, tickRate) //nolint:staticcheck
	r.ctx = context.WithValue(r.ctx, runtime.RUNTIME_CTX_MATCH_LABEL, label)        //nolint:staticcheck

	r.deferMessageFn = deferMessageFn
	r.presenceList = presenceList

	return state, tickRate, nil
}

//nolint:staticcheck
func (r *RuntimeGoMatchCore) MatchJoinAttempt(tick int64, state interface{}, userID, sessionID uuid.UUID, username string, sessionExpiry int64, vars map[string]string, clientIP, clientPort, node string, metadata map[string]string) (interface{}, bool, string, error) {
	presence := &MatchPresence{
		Node:      node,
		UserID:    userID,
		SessionID: sessionID,
		Username:  username,
	}

	// Prepare a temporary context that includes the user's session info on top of the base match context.
	ctx := context.WithValue(r.ctx, runtime.RUNTIME_CTX_USER_ID, userID.String())
	ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_USERNAME, username)
	if vars != nil {
		ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_VARS, vars)
	}
	ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_USER_SESSION_EXP, sessionExpiry)
	ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_SESSION_ID, sessionID.String())
	if clientIP != "" {
		ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_CLIENT_IP, clientIP)
	}
	if clientPort != "" {
		ctx = context.WithValue(ctx, runtime.RUNTIME_CTX_CLIENT_PORT, clientPort)
	}

	newState, allow, reason := r.match.MatchJoinAttempt(ctx, r.runtimeLogger, r.db, r.nk, r, tick, state, presence, metadata)
	return newState, allow, reason, nil
}

func (r *RuntimeGoMatchCore) MatchJoin(tick int64, state interface{}, joins []*MatchPresence) (interface{}, error) {
	presences := make([]runtime.Presence, len(joins))
	for i, join := range joins {
		presences[i] = runtime.Presence(join)
	}

	newState := r.match.MatchJoin(r.ctx, r.runtimeLogger, r.db, r.nk, r, tick, state, presences)
	return newState, nil
}

func (r *RuntimeGoMatchCore) MatchLeave(tick int64, state interface{}, leaves []*MatchPresence) (interface{}, error) {
	presences := make([]runtime.Presence, len(leaves))
	for i, leave := range leaves {
		presences[i] = runtime.Presence(leave)
	}

	newState := r.match.MatchLeave(r.ctx, r.runtimeLogger, r.db, r.nk, r, tick, state, presences)
	return newState, nil
}

func (r *RuntimeGoMatchCore) MatchLoop(tick int64, state interface{}, inputCh <-chan *MatchDataMessage) (interface{}, error) {
	// Drain the input queue into a slice.
	size := len(inputCh)
	messages := make([]runtime.MatchData, size)
	for i := 0; i < size; i++ {
		msg := <-inputCh
		messages[i] = runtime.MatchData(msg)
	}

	newState := r.match.MatchLoop(r.ctx, r.runtimeLogger, r.db, r.nk, r, tick, state, messages)
	return newState, nil
}

func (r *RuntimeGoMatchCore) MatchTerminate(tick int64, state interface{}, graceSeconds int) (interface{}, error) {
	newState := r.match.MatchTerminate(r.ctx, r.runtimeLogger, r.db, r.nk, r, tick, state, graceSeconds)
	return newState, nil
}

func (r *RuntimeGoMatchCore) MatchSignal(tick int64, state interface{}, data string) (interface{}, string, error) {
	newState, responseData := r.match.MatchSignal(r.ctx, r.runtimeLogger, r.db, r.nk, r, tick, state, data)
	return newState, responseData, nil
}

func (r *RuntimeGoMatchCore) GetState(state interface{}) (string, error) {
	return fmt.Sprintf("%+v", state), nil
}

func (r *RuntimeGoMatchCore) Label() string {
	return r.label.Load()
}

func (r *RuntimeGoMatchCore) TickRate() int {
	return r.tickRate
}

func (r *RuntimeGoMatchCore) HandlerName() string {
	return r.module
}

func (r *RuntimeGoMatchCore) CreateTime() int64 {
	return r.createTime
}

func (r *RuntimeGoMatchCore) Cancel() {
	r.ctxCancelFn()
}

func (r *RuntimeGoMatchCore) Cleanup() {}

func (r *RuntimeGoMatchCore) BroadcastMessage(opCode int64, data []byte, presences []runtime.Presence, sender runtime.Presence, reliable bool) error {
	if r.stopped.Load() {
		return ErrMatchStopped
	}

	presenceIDs, msg, err := r.validateBroadcast(opCode, data, presences, sender, reliable)
	if err != nil {
		return err
	}
	if len(presenceIDs) == 0 {
		return nil
	}

	r.router.SendToPresenceIDs(r.logger, presenceIDs, msg, reliable)

	return nil
}

func (r *RuntimeGoMatchCore) BroadcastMessageDeferred(opCode int64, data []byte, presences []runtime.Presence, sender runtime.Presence, reliable bool) error {
	if r.stopped.Load() {
		return ErrMatchStopped
	}

	presenceIDs, msg, err := r.validateBroadcast(opCode, data, presences, sender, reliable)
	if err != nil {
		return err
	}
	if len(presenceIDs) == 0 {
		return nil
	}

	return r.deferMessageFn(&DeferredMessage{
		PresenceIDs: presenceIDs,
		Envelope:    msg,
		Reliable:    reliable,
	})
}

func (r *RuntimeGoMatchCore) validateBroadcast(opCode int64, data []byte, presences []runtime.Presence, sender runtime.Presence, reliable bool) ([]*PresenceID, *rtapi.Envelope, error) {
	var presenceIDs []*PresenceID
	if presences != nil {
		size := len(presences)
		if size == 0 {
			return nil, nil, nil
		}

		presenceIDs = make([]*PresenceID, size)
		for i, presence := range presences {
			if presence == nil {
				return nil, nil, errors.New("Presence was nil")
			}

			sessionID, err := uuid.FromString(presence.GetSessionId())
			if err != nil {
				return nil, nil, errors.New("Presence contains an invalid Session ID")
			}

			presenceIDs[i] = &PresenceID{
				Node:      presence.GetNodeId(),
				SessionID: sessionID,
			}
		}
	}

	var presence *rtapi.UserPresence
	if sender != nil {
		uid := sender.GetUserId()
		_, err := uuid.FromString(uid)
		if err != nil {
			return nil, nil, errors.New("Sender contains an invalid User ID")
		}

		sid := sender.GetSessionId()
		_, err = uuid.FromString(sid)
		if err != nil {
			return nil, nil, errors.New("Sender contains an invalid Session ID")
		}

		presence = &rtapi.UserPresence{
			UserId:    uid,
			SessionId: sid,
			Username:  sender.GetUsername(),
		}
	}

	if presenceIDs != nil {
		// Ensure specific presences actually exist to prevent sending bogus messages to arbitrary users.
		if len(presenceIDs) == 1 {
			if presences == nil {
				// Should not happen.
				return nil, nil, nil
			}
			// Shorter validation cycle if there is only one intended recipient.
			_, err := uuid.FromString(presences[0].GetUserId())
			if err != nil {
				return nil, nil, errors.New("Presence contains an invalid User ID")
			}
			if !r.presenceList.Contains(presenceIDs[0]) {
				// The one intended recipient is not a match member.
				return nil, nil, nil
			}
		} else {
			// Validate multiple filtered recipients.
			presenceIDs = r.presenceList.FilterPresenceIDs(presenceIDs)
			if len(presenceIDs) == 0 {
				// None of the target presenceIDs existed in the list of match members.
				return nil, nil, nil
			}
		}
	}

	msg := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId:  r.idStr,
		Presence: presence,
		OpCode:   opCode,
		Data:     data,
		Reliable: reliable,
	}}}

	if presenceIDs == nil {
		presenceIDs = r.presenceList.ListPresenceIDs()
	}

	return presenceIDs, msg, nil
}

func (r *RuntimeGoMatchCore) MatchKick(presences []runtime.Presence) error {
	if r.stopped.Load() {
		return ErrMatchStopped
	}

	size := len(presences)
	if size == 0 {
		return nil
	}

	matchPresences := make([]*MatchPresence, size)
	for i, presence := range presences {
		userID, err := uuid.FromString(presence.GetUserId())
		if err != nil {
			return errors.New("Presence contains an invalid User ID")
		}

		sessionID, err := uuid.FromString(presence.GetSessionId())
		if err != nil {
			return errors.New("Presence contains an invalid Session ID")
		}

		matchPresences[i] = &MatchPresence{
			Node:      presence.GetNodeId(),
			UserID:    userID,
			SessionID: sessionID,
			Username:  presence.GetUsername(),
		}
	}

	r.matchRegistry.Kick(r.stream, matchPresences)
	return nil
}

func (r *RuntimeGoMatchCore) MatchLabelUpdate(label string) error {
	if r.stopped.Load() {
		return ErrMatchStopped
	}
	if err := r.matchRegistry.UpdateMatchLabel(r.id, r.tickRate, r.module, label, r.createTime); err != nil {
		return fmt.Errorf("error updating match label: %v", err.Error())
	}
	r.label.Store(label)

	// This must be executed from inside a match call so safe to update here.
	r.ctx = context.WithValue(r.ctx, runtime.RUNTIME_CTX_MATCH_LABEL, label) //nolint:staticcheck
	return nil
}
