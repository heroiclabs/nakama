// Copyright 2021 The Nakama Authors
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
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// loggerForTest allows for easily adjusting log output produced by tests in one place
func loggerForTest(t *testing.T) *zap.Logger {
	return NewJSONLogger(os.Stdout, zapcore.ErrorLevel, JSONFormat)
}

// loggerForBenchmark allows for easily adjusting log output produced by tests in one place
func loggerForBenchmark(b *testing.B) *zap.Logger {
	return NewJSONLogger(os.Stdout, zapcore.WarnLevel, JSONFormat)
}

type fatalable interface {
	Fatal(args ...interface{})
	Fatalf(format string, args ...interface{})
}

// createTestMatchRegistry creates a LocalMatchRegistry minimally configured for testing purposes
// In addition to the MatchRegistry, a RuntimeMatchCreateFunction paired to work with it is returned.
// This RuntimeMatchCreateFunction may be needed for later operations (such as CreateMatch)
func createTestMatchRegistry(t fatalable, logger *zap.Logger) (*LocalMatchRegistry, RuntimeMatchCreateFunction, error) {
	cfg := NewConfig(logger)
	cfg.GetMatch().LabelUpdateIntervalMs = int(time.Hour / time.Millisecond)
	messageRouter := &testMessageRouter{}
	matchRegistry := NewLocalMatchRegistry(logger, logger, cfg, &testSessionRegistry{}, &testTracker{},
		messageRouter, &testMetrics{}, "node")
	mp := NewMatchProvider()

	mp.RegisterCreateFn("go",
		func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
			match, err := newTestMatch(context.Background(), NewRuntimeGoLogger(logger), nil, nil)
			if err != nil {
				return nil, err
			}

			rmc, err := NewRuntimeGoMatchCore(logger, "module", matchRegistry, messageRouter, id, "node", "",
				stopped, nil, map[string]string{}, nil, match)
			if err != nil {
				return nil, err
			}
			return rmc, nil
		})

	return matchRegistry.(*LocalMatchRegistry), mp.CreateMatch, nil
}

type testMatchState struct {
	presences map[string]runtime.Presence
}

// testMatch is a minimal implementation of runtime.Match for testing purposes
type testMatch struct{}

func newTestMatch(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (m runtime.Match, err error) {
	return &testMatch{}, nil
}

func (m *testMatch) MatchInit(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, params map[string]interface{}) (interface{}, int, string) {
	state := &testMatchState{
		presences: make(map[string]runtime.Presence),
	}
	tickRate := 1
	label := ""
	if params != nil {
		if paramLabel, ok := params["label"]; ok {
			if paramLabelStr, ok := paramLabel.(string); ok {
				label = paramLabelStr
			}
		}
	}
	return state, tickRate, label
}

func (m *testMatch) MatchJoinAttempt(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presence runtime.Presence, metadata map[string]string) (interface{}, bool, string) {
	acceptUser := true
	return state, acceptUser, ""
}

func (m *testMatch) MatchJoin(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	mState, _ := state.(*testMatchState)
	for _, p := range presences {
		mState.presences[p.GetUserId()] = p
	}
	return mState
}

func (m *testMatch) MatchLeave(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, presences []runtime.Presence) interface{} {
	mState, _ := state.(*testMatchState)
	for _, p := range presences {
		delete(mState.presences, p.GetUserId())
	}
	return mState
}

func (m *testMatch) MatchLoop(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, messages []runtime.MatchData) interface{} {
	mState, _ := state.(*testMatchState)
	for _, presence := range mState.presences {
		logger.Info("Presence %v named %v", presence.GetUserId(), presence.GetUsername())
	}
	for _, message := range messages {
		logger.Info("Received %v from %v", string(message.GetData()), message.GetUserId())
		reliable := true
		if err := dispatcher.BroadcastMessage(1, message.GetData(), []runtime.Presence{message}, nil, reliable); err != nil {
			logger.Error("Failed to broadcast message: %w", err)
		}
	}
	return mState
}

func (m *testMatch) MatchTerminate(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, graceSeconds int) interface{} {
	message := "Server shutting down in " + strconv.Itoa(graceSeconds) + " seconds."
	reliable := true
	if err := dispatcher.BroadcastMessage(2, []byte(message), []runtime.Presence{}, nil, reliable); err != nil {
		logger.Error("Failed to broadcast message: %w", err)
	}
	return state
}

func (m *testMatch) MatchSignal(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, dispatcher runtime.MatchDispatcher, tick int64, state interface{}, data string) (interface{}, string) {
	return state, "signal received: " + data
}

// testMetrics implements the Metrics interface and does nothing
type testMetrics struct{}

func (s *testMetrics) Stop(logger *zap.Logger)    {}
func (s *testMetrics) SnapshotLatencyMs() float64 { return 0 }
func (s *testMetrics) SnapshotRateSec() float64   { return 0 }
func (s *testMetrics) SnapshotRecvKbSec() float64 { return 0 }
func (s *testMetrics) SnapshotSentKbSec() float64 { return 0 }
func (s *testMetrics) Api(name string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool) {
}

func (s *testMetrics) ApiRpc(id string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool) {
}
func (s *testMetrics) ApiBefore(name string, elapsed time.Duration, isErr bool)             {}
func (s *testMetrics) ApiAfter(name string, elapsed time.Duration, isErr bool)              {}
func (s *testMetrics) Message(recvBytes int64, isErr bool)                                  {}
func (s *testMetrics) MessageBytesSent(sentBytes int64)                                     {}
func (s *testMetrics) GaugeRuntimes(value float64)                                          {}
func (s *testMetrics) GaugeLuaRuntimes(value float64)                                       {}
func (s *testMetrics) GaugeJsRuntimes(value float64)                                        {}
func (s *testMetrics) GaugeAuthoritativeMatches(value float64)                              {}
func (s *testMetrics) GaugeStorageIndexEntries(indexName string, value float64)             {}
func (s *testMetrics) CountDroppedEvents(delta int64)                                       {}
func (s *testMetrics) CountWebsocketOpened(delta int64)                                     {}
func (s *testMetrics) CountWebsocketClosed(delta int64)                                     {}
func (m *testMetrics) CountUntaggedGrpcStatsCalls(delta int64)                              {}
func (s *testMetrics) GaugeSessions(value float64)                                          {}
func (s *testMetrics) GaugePresences(value float64)                                         {}
func (s *testMetrics) Matchmaker(tickets, activeTickets float64, processTime time.Duration) {}
func (s *testMetrics) PresenceEvent(dequeueElapsed, processElapsed time.Duration)           {}
func (s *testMetrics) StorageWriteRejectCount(tags map[string]string, delta int64)          {}
func (s *testMetrics) CustomCounter(name string, tags map[string]string, delta int64)       {}
func (s *testMetrics) CustomGauge(name string, tags map[string]string, value float64)       {}
func (s *testMetrics) CustomTimer(name string, tags map[string]string, value time.Duration) {}

// testMessageRouter is used for testing, and can fire a callback
// when the SendToPresenceIDs method is invoked
type testMessageRouter struct {
	sendToPresence func(presences []*PresenceID, envelope *rtapi.Envelope)
}

func (s *testMessageRouter) SendToPresenceIDs(_ *zap.Logger, presences []*PresenceID, envelope *rtapi.Envelope, _ bool) {
	if s.sendToPresence != nil {
		s.sendToPresence(presences, envelope)
	}
}
func (s *testMessageRouter) SendToStream(*zap.Logger, PresenceStream, *rtapi.Envelope, bool) {}
func (s *testMessageRouter) SendDeferred(*zap.Logger, []*DeferredMessage)                    {}
func (s *testMessageRouter) SendToAll(*zap.Logger, *rtapi.Envelope, bool)                    {}

// testTracker implements the Tracker interface and does nothing
type testTracker struct{}

func (s *testTracker) SetMatchJoinListener(func(id uuid.UUID, joins []*MatchPresence))   {}
func (s *testTracker) SetMatchLeaveListener(func(id uuid.UUID, leaves []*MatchPresence)) {}
func (s *testTracker) SetPartyJoinListener(func(id uuid.UUID, joins []*Presence))        {}
func (s *testTracker) SetPartyLeaveListener(func(id uuid.UUID, leaves []*Presence))      {}
func (s *testTracker) Stop()                                                             {}

// Track returns success true/false, and new presence true/false.
func (s *testTracker) Track(ctx context.Context, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) (bool, bool) {
	return true, true
}

func (s *testTracker) TrackMulti(ctx context.Context, sessionID uuid.UUID, ops []*TrackerOp, userID uuid.UUID) bool {
	return true
}
func (s *testTracker) Untrack(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) {}
func (s *testTracker) UntrackMulti(sessionID uuid.UUID, streams []*PresenceStream, userID uuid.UUID) {
}
func (s *testTracker) UntrackAll(sessionID uuid.UUID, reason runtime.PresenceReason) {}

// Update returns success true/false - will only fail if the user has no presence and allowIfFirstForSession is false,
// otherwise is an upsert.
func (s *testTracker) Update(ctx context.Context, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool {
	return true
}

// Remove all presences on a stream, effectively closing it.
func (s *testTracker) UntrackByStream(stream PresenceStream) {}

// Remove all presences on a stream from the local node.
func (s *testTracker) UntrackLocalByStream(stream PresenceStream) {}

// Remove the given session from any streams matching the given mode, except the specified stream.
func (s *testTracker) UntrackLocalByModes(sessionID uuid.UUID, modes map[uint8]struct{}, skipStream PresenceStream) {
}

// List the nodes that have at least one presence for the given stream.
func (s *testTracker) ListNodesForStream(stream PresenceStream) map[string]struct{} {
	return nil
}

// Check if a stream exists (has any presences) or not.
func (s *testTracker) StreamExists(stream PresenceStream) bool {
	return true
}

// Get current total number of presences.
func (s *testTracker) Count() int {
	return 0
}

// Get the number of presences in the given stream.
func (s *testTracker) CountByStream(stream PresenceStream) int {
	return 0
}

// Get a snapshot of current presence counts for streams with one of the given stream modes.
func (s *testTracker) CountByStreamModeFilter(modes map[uint8]*uint8) map[*PresenceStream]int32 {
	return nil
}

// Check if a single presence on the current node exists.
func (s *testTracker) GetLocalBySessionIDStreamUserID(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta {
	return nil
}

// Check if a single presence on any node exists.
func (s *testTracker) GetBySessionIDStreamUserID(node string, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta {
	return nil
}

// List presences by stream, optionally include hidden ones and not hidden ones.
func (s *testTracker) ListByStream(stream PresenceStream, includeHidden bool, includeNotHidden bool) []*Presence {
	return nil
}

// Fast lookup of local session IDs to use for message delivery.
func (s *testTracker) ListLocalSessionIDByStream(stream PresenceStream) []uuid.UUID {
	return nil
}

// Fast lookup of node + session IDs to use for message delivery.
func (s *testTracker) ListPresenceIDByStream(stream PresenceStream) []*PresenceID {
	return nil
}

func (s *testTracker) ListPresenceIDByStreams(fill map[PresenceStream][]*PresenceID) {}

// testSessionRegistry implements SessionRegistry interface and does nothing
type testSessionRegistry struct{}

func (s *testSessionRegistry) Stop() {}

func (s *testSessionRegistry) Count() int {
	return 0
}

func (s *testSessionRegistry) Get(sessionID uuid.UUID) Session {
	return nil
}

func (s *testSessionRegistry) Add(session Session) {}

func (s *testSessionRegistry) Remove(sessionID uuid.UUID) {}

func (s *testSessionRegistry) Disconnect(ctx context.Context, sessionID uuid.UUID, ban bool, reason ...runtime.PresenceReason) error {
	return nil
}

func (s *testSessionRegistry) SingleSession(ctx context.Context, tracker Tracker, userID, sessionID uuid.UUID) {
}

func (s *testSessionRegistry) Range(fn func(session Session) bool) {
}
