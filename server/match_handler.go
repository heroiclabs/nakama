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
	Reliable    bool
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
func (m *MatchDataMessage) GetReliable() bool {
	return m.Reliable
}
func (m *MatchDataMessage) GetReceiveTime() int64 {
	return m.ReceiveTime
}

type MatchHandler struct {
	logger        *zap.Logger
	matchRegistry MatchRegistry
	router        MessageRouter

	JoinMarkerList *MatchJoinMarkerList
	PresenceList   *MatchPresenceList
	core           RuntimeMatchCore

	// Identification not (directly) controlled by match init.
	ID     uuid.UUID
	Node   string
	IDStr  string
	Stream PresenceStream

	// Internal state.
	tick int64

	// Control elements.
	inputCh       chan *MatchDataMessage
	ticker        *time.Ticker
	callCh        chan func(*MatchHandler)
	joinAttemptCh chan func(*MatchHandler)
	stopCh        chan struct{}
	stopped       *atomic.Bool

	deferredCh chan *DeferredMessage

	// Configuration set by match init.
	Rate int64

	// Match state.
	state interface{}
}

func NewMatchHandler(logger *zap.Logger, config Config, matchRegistry MatchRegistry, router MessageRouter, core RuntimeMatchCore, id uuid.UUID, node string, stopped *atomic.Bool, params map[string]interface{}) (*MatchHandler, error) {
	presenceList := NewMatchPresenceList()

	deferredCh := make(chan *DeferredMessage, config.GetMatch().DeferredQueueSize)
	deferMessageFn := func(msg *DeferredMessage) error {
		select {
		case deferredCh <- msg:
			return nil
		default:
			return ErrDeferredBroadcastFull
		}
	}

	state, rateInt, err := core.MatchInit(presenceList, deferMessageFn, params)
	if err != nil {
		core.Cancel()
		return nil, err
	}
	if state == nil {
		core.Cancel()
		return nil, errors.New("Match initial state must not be nil")
	}

	// Construct the match.
	mh := &MatchHandler{
		logger:        logger,
		matchRegistry: matchRegistry,
		router:        router,

		JoinMarkerList: NewMatchJoinMarkerList(config, int64(rateInt)),
		PresenceList:   presenceList,
		core:           core,

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
		callCh:        make(chan func(mh *MatchHandler), config.GetMatch().CallQueueSize),
		joinAttemptCh: make(chan func(mh *MatchHandler), config.GetMatch().JoinAttemptQueueSize),
		deferredCh:    deferredCh,
		stopCh:        make(chan struct{}),
		stopped:       stopped,

		Rate: int64(rateInt),

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
				if !mh.queueCall(loop) {
					return
				}
			case call := <-mh.callCh:
				// An invocation to one of the match functions, not including join attempts.
				call(mh)
			case joinAttempt := <-mh.joinAttemptCh:
				// An invocation to the join attempt match function.
				joinAttempt(mh)
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

	// Ensure any remaining deferred broadcasts are sent.
	mh.processDeferred()

	mh.core.Cancel()
	close(mh.stopCh)
	mh.ticker.Stop()
}

func (mh *MatchHandler) Label() string {
	return mh.core.Label()
}

func (mh *MatchHandler) queueCall(f func(*MatchHandler)) bool {
	if mh.stopped.Load() {
		return false
	}

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
	if mh.stopped.Load() {
		return
	}

	select {
	case mh.inputCh <- m:
		return
	default:
		// Match input queue is full, the handler isn't processing fast enough or there's too much incoming data.
		mh.logger.Warn("Match handler data processing too slow, dropping data message", zap.Any("m", m))
		return
	}
}

func loop(mh *MatchHandler) {
	if mh.stopped.Load() {
		return
	}

	// Execute the loop.
	state, err := mh.core.MatchLoop(mh.tick, mh.state, mh.inputCh)
	if err != nil {
		mh.Stop()
		mh.logger.Warn("Stopping match after error from match_loop execution", zap.Int64("tick", mh.tick), zap.Error(err))
		return
	}

	// Check if we need to stop the match.
	if state != nil {
		// Broadcast any deferred messages. If match will be stopped broadcasting will be handled as part of the match end cycle.
		mh.processDeferred()
	} else {
		mh.Stop()
		mh.logger.Info("Match loop returned nil or no state, stopping match")
		return
	}

	// Every 30 seconds clear expired join markers.
	if mh.tick%(mh.Rate*30) == 0 {
		presences := mh.JoinMarkerList.ClearExpired(mh.tick)
		if len(presences) != 0 {
			// Doesn't matter if the call queue was full here. If the match is being closed then leaves don't matter anyway.
			mh.QueueLeave(presences)
		}
	}

	mh.state = state
	mh.tick++
}

func (mh *MatchHandler) processDeferred() {
	deferredCount := len(mh.deferredCh)
	if deferredCount != 0 {
		deferredMessages := make([]*DeferredMessage, deferredCount)
		for i := 0; i < deferredCount; i++ {
			msg := <-mh.deferredCh
			deferredMessages[i] = msg
		}

		mh.router.SendDeferred(mh.logger, deferredMessages)
	}
}

func (mh *MatchHandler) QueueJoinAttempt(ctx context.Context, resultCh chan<- *MatchJoinResult, userID, sessionID uuid.UUID, username, node string, metadata map[string]string) bool {
	if mh.stopped.Load() {
		return false
	}

	joinAttempt := func(mh *MatchHandler) {
		select {
		case <-ctx.Done():
			// Do not process the match join attempt through the match handler if the client has gone away between
			// when this call was inserted into the match call queue and when it's due for processing.
			resultCh <- &MatchJoinResult{Allow: false}
			return
		default:
		}

		if mh.stopped.Load() {
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		state, allow, reason, err := mh.core.MatchJoinAttempt(mh.tick, mh.state, userID, sessionID, username, node, metadata)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_join_attempt execution", zap.Int64("tick", mh.tick), zap.Error(err))
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		if state != nil {
			// Broadcast any deferred messages. If match will be stopped broadcasting will be handled as part of the match end cycle.
			mh.processDeferred()
		} else {
			mh.Stop()
			mh.logger.Info("Match join attempt returned nil or no state, stopping match")
			resultCh <- &MatchJoinResult{Allow: false}
			return
		}

		mh.state = state
		if allow {
			presence := &MatchPresence{Node: node, UserID: userID, SessionID: sessionID, Username: username}
			mh.JoinMarkerList.Add(presence, mh.tick)
			mh.QueueJoin([]*MatchPresence{presence}, false)
		}
		// Signal client.
		resultCh <- &MatchJoinResult{Allow: allow, Reason: reason, Label: mh.core.Label()}
	}

	select {
	case mh.joinAttemptCh <- joinAttempt:
		return true
	default:
		// Match join queue is full, the handler isn't processing these fast enough or there are just too many.
		// Not necessarily a match processing speed problem, so the match is not closed for these.
		mh.logger.Warn("Match handler join attempt queue full")
		return false
	}
}

func (mh *MatchHandler) QueueJoin(joins []*MatchPresence, mark bool) bool {
	if mh.stopped.Load() {
		return false
	}

	join := func(mh *MatchHandler) {
		if mh.stopped.Load() {
			return
		}

		// Just marking joins.
		if mark {
			for _, join := range joins {
				mh.JoinMarkerList.Mark(join.SessionID)
			}
			return
		}

		processed := mh.PresenceList.Join(joins)
		if len(processed) != 0 {
			state, err := mh.core.MatchJoin(mh.tick, mh.state, processed)
			if err != nil {
				mh.Stop()
				mh.logger.Warn("Stopping match after error from match_join execution", zap.Int64("tick", mh.tick), zap.Error(err))
				return
			}
			if state != nil {
				// Broadcast any deferred messages. If match will be stopped broadcasting will be handled as part of the match end cycle.
				mh.processDeferred()
			} else {
				mh.Stop()
				mh.logger.Info("Match join returned nil or no state, stopping match")
				return
			}

			mh.state = state
		}
	}

	return mh.queueCall(join)
}

func (mh *MatchHandler) QueueLeave(leaves []*MatchPresence) bool {
	if mh.stopped.Load() {
		return false
	}

	leave := func(mh *MatchHandler) {
		if mh.stopped.Load() {
			return
		}

		processed := mh.PresenceList.Leave(leaves)
		if len(processed) != 0 {
			for _, leave := range processed {
				mh.JoinMarkerList.Mark(leave.SessionID)
			}

			state, err := mh.core.MatchLeave(mh.tick, mh.state, leaves)
			if err != nil {
				mh.Stop()
				mh.logger.Warn("Stopping match after error from match_leave execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
				return
			}
			if state != nil {
				// Broadcast any deferred messages. If match will be stopped broadcasting will be handled as part of the match end cycle.
				mh.processDeferred()
			} else {
				mh.Stop()
				mh.logger.Info("Match leave returned nil or no state, stopping match")
				return
			}

			mh.state = state
		}
	}

	return mh.queueCall(leave)
}

func (mh *MatchHandler) QueueTerminate(graceSeconds int) bool {
	if mh.stopped.Load() {
		return false
	}

	terminate := func(mh *MatchHandler) {
		if mh.stopped.Load() {
			return
		}

		state, err := mh.core.MatchTerminate(mh.tick, mh.state, graceSeconds)
		if err != nil {
			mh.Stop()
			mh.logger.Warn("Stopping match after error from match_terminate execution", zap.Int("tick", int(mh.tick)), zap.Error(err))
			return
		}
		if state != nil {
			// Broadcast any deferred messages. If match will be stopped broadcasting will be handled as part of the match end cycle.
			mh.processDeferred()
		} else {
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

	return mh.queueCall(terminate)
}
