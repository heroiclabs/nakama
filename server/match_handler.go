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
	"fmt"
	"time"

	"github.com/gofrs/uuid"
	"github.com/pkg/errors"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type MatchDataMessage struct {
	UserID      uuid.UUID
	SessionID   uuid.UUID
	Username    string
	Node        string
	OpCode      int64
	Data        []byte
	ReceiveTime int64
}

func (m *MatchDataMessage) GetUserId() string {
	return m.UserID.String()
}
func (m *MatchDataMessage) GetSessionId() string {
	return m.SessionID.String()
}
func (m *MatchDataMessage) GetNodeId() string {
	return m.Node
}
func (m *MatchDataMessage) GetHidden() bool {
	return false
}
func (m *MatchDataMessage) GetPersistence() bool {
	return false
}
func (m *MatchDataMessage) GetUsername() string {
	return m.Username
}
func (m *MatchDataMessage) GetStatus() string {
	return ""
}
func (m *MatchDataMessage) GetOpCode() int64 {
	return m.OpCode
}
func (m *MatchDataMessage) GetData() []byte {
	return m.Data
}
func (m *MatchDataMessage) GetReceiveTime() int64 {
	return m.ReceiveTime
}

type MatchHandler struct {
	logger        *zap.Logger
	matchRegistry MatchRegistry
	tracker       Tracker
	router        MessageRouter

	core RuntimeMatchCore

	// Identification not (directly) controlled by match init.
	ID     uuid.UUID
	Node   string
	IDStr  string
	Stream PresenceStream

	// Internal state.
	tick int64

	// Control elements.
	inputCh chan *MatchDataMessage
	ticker  *time.Ticker
	callCh  chan func(*MatchHandler)
	stopCh  chan struct{}
	stopped *atomic.Bool

	// Configuration set by match init.
	Label *atomic.String
	Rate  int

	// Match state.
	state interface{}
}

func NewMatchHandler(logger *zap.Logger, config Config, matchRegistry MatchRegistry, core RuntimeMatchCore, label *atomic.String, id uuid.UUID, node string, params map[string]interface{}) (*MatchHandler, error) {
	state, rateInt, labelStr, err := core.MatchInit(params)
	if err != nil {
		core.Cancel()
		return nil, err
	}
	if state == nil {
		core.Cancel()
		return nil, errors.New("Match initial state must not be nil")
	}
	err = matchRegistry.UpdateMatchLabel(id, labelStr, 0)
	if err != nil {
		return nil, err
	}
	label.Store(labelStr)

	// Construct the match.
	mh := &MatchHandler{
		logger:        logger,
		matchRegistry: matchRegistry,

		core: core,

		ID:    id,
		Node:  node,
		IDStr: fmt.Sprintf("%v.%v", id.String(), node),
		Stream: PresenceStream{
			Mode:    StreamModeMatchAuthoritative,
			Subject: id,
			Label:   node,
		},

		tick: 0,

		inputCh: make(chan *MatchDataMessage, config.GetMatch().InputQueueSize),
		// Ticker below.
		callCh:  make(chan func(mh *MatchHandler), config.GetMatch().CallQueueSize),
		stopCh:  make(chan struct{}),
		stopped: atomic.NewBool(false),

		Label: label,
		Rate:  rateInt,

		state: state,
	}

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

	mh.logger.Info("Match started")

	return mh, nil
}

// Used when an internal match process (or error) requires it to stop.
func (mh *MatchHandler) Stop() {
	mh.Close()
	mh.matchRegistry.RemoveMatch(mh.ID, mh.Stream)
}

// Used when the match is closed externally.
func (mh *MatchHandler) Close() {
	if !mh.stopped.CAS(false, true) {
		return
	}
	mh.core.Cancel()
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
	if mh.stopped.Load() {
		return
	}

	state, err := mh.core.MatchLoop(mh.tick, mh.state, mh.inputCh)
	if err != nil {
		mh.Stop()
		mh.logger.Warn("Stopping match after error from match_loop execution", zap.Int64("tick", mh.tick), zap.Error(err))
		return
	}
	if state == nil {
		mh.Stop()
		mh.logger.Info("Match loop returned nil or no state, stopping match")
		return
	}

	mh.state = state
	mh.tick++
}

func JoinAttempt(resultCh chan *MatchJoinResult, userID, sessionID uuid.UUID, username, node string) func(mh *MatchHandler) {
	return func(mh *MatchHandler) {
		if mh.stopped.Load() {
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		state, allow, reason, err := mh.core.MatchJoinAttempt(mh.tick, mh.state, userID, sessionID, username, node)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_join_attempt execution", zap.Int64("tick", mh.tick), zap.Error(err))
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}
		if state == nil {
			mh.Stop()
			mh.logger.Info("Match join attempt returned nil or no state, stopping match")
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		mh.state = state
		resultCh <- &MatchJoinResult{Allow: allow, Reason: reason, Label: mh.Label.Load()}
	}
}

func Join(joins []*MatchPresence) func(mh *MatchHandler) {
	return func(mh *MatchHandler) {
		if mh.stopped.Load() {
			return
		}

		state, err := mh.core.MatchJoin(mh.tick, mh.state, joins)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_join execution", zap.Int64("tick", mh.tick), zap.Error(err))
			return
		}
		if state == nil {
			mh.Stop()
			mh.logger.Info("Match join returned nil or no state, stopping match")
			return
		}

		mh.state = state
	}
}

func Leave(leaves []*MatchPresence) func(mh *MatchHandler) {
	return func(mh *MatchHandler) {
		if mh.stopped.Load() {
			return
		}

		state, err := mh.core.MatchLeave(mh.tick, mh.state, leaves)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_leave execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
			return
		}
		if state == nil {
			mh.Stop()
			mh.logger.Info("Match leave returned nil or no state, stopping match")
			return
		}

		mh.state = state
	}
}

func Terminate(graceSeconds int) func(mh *MatchHandler) {
	return func(mh *MatchHandler) {
		if mh.stopped.Load() {
			return
		}

		state, err := mh.core.MatchTerminate(mh.tick, mh.state, graceSeconds)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_terminate execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
			return
		}
		if state == nil {
			mh.Stop()
			mh.logger.Info("Match terminate returned nil or no state, stopping match")
			return
		}

		mh.state = state

		// If grace period is 0 end the match immediately after the callback returns.
		if graceSeconds == 0 {
			mh.Stop()
		}
	}
}
