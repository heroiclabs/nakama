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
	"sync"
	syncAtomic "sync/atomic"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

const (
	StreamModeNotifications uint8 = iota
	StreamModeStatus
	StreamModeChannel
	StreamModeGroup
	StreamModeDM
	StreamModeMatchRelayed
	StreamModeMatchAuthoritative
	StreamModeParty
)

type PresenceID struct {
	Node      string
	SessionID uuid.UUID
}

type PresenceStream struct {
	Mode       uint8
	Subject    uuid.UUID
	Subcontext uuid.UUID
	Label      string
}

type PresenceMeta struct {
	Format      SessionFormat
	Hidden      bool
	Persistence bool
	Username    string
	Status      string
	Reason      uint32
}

func (pm *PresenceMeta) GetHidden() bool {
	return pm.Hidden
}
func (pm *PresenceMeta) GetPersistence() bool {
	return pm.Persistence
}
func (pm *PresenceMeta) GetUsername() string {
	return pm.Username
}
func (pm *PresenceMeta) GetStatus() string {
	return pm.Status
}
func (pm *PresenceMeta) GetReason() runtime.PresenceReason {
	return runtime.PresenceReason(syncAtomic.LoadUint32(&pm.Reason))
}

type Presence struct {
	ID     PresenceID
	Stream PresenceStream
	UserID uuid.UUID
	Meta   PresenceMeta
}

func (p *Presence) GetUserId() string {
	return p.UserID.String()
}
func (p *Presence) GetSessionId() string {
	return p.ID.SessionID.String()
}
func (p *Presence) GetNodeId() string {
	return p.ID.Node
}
func (p *Presence) GetHidden() bool {
	return p.Meta.Hidden
}
func (p *Presence) GetPersistence() bool {
	return p.Meta.Persistence
}
func (p *Presence) GetUsername() string {
	return p.Meta.Username
}
func (p *Presence) GetStatus() string {
	return p.Meta.Status
}
func (p *Presence) GetReason() runtime.PresenceReason {
	return runtime.PresenceReason(syncAtomic.LoadUint32(&p.Meta.Reason))
}

type PresenceEvent struct {
	Joins  []*Presence
	Leaves []*Presence

	QueueTime time.Time
}

type TrackerOp struct {
	Stream PresenceStream
	Meta   PresenceMeta
}

type Tracker interface {
	SetMatchJoinListener(func(id uuid.UUID, joins []*MatchPresence))
	SetMatchLeaveListener(func(id uuid.UUID, leaves []*MatchPresence))
	SetPartyJoinListener(func(id uuid.UUID, joins []*Presence))
	SetPartyLeaveListener(func(id uuid.UUID, leaves []*Presence))
	Stop()

	// Track returns success true/false, and new presence true/false.
	Track(ctx context.Context, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) (bool, bool)
	TrackMulti(ctx context.Context, sessionID uuid.UUID, ops []*TrackerOp, userID uuid.UUID) bool
	Untrack(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID)
	UntrackMulti(sessionID uuid.UUID, streams []*PresenceStream, userID uuid.UUID)
	UntrackAll(sessionID uuid.UUID, reason runtime.PresenceReason)
	// Update returns success true/false - will only fail if the user has no presence, otherwise is an upsert.
	Update(ctx context.Context, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool

	// Remove all presences on a stream, effectively closing it.
	UntrackByStream(stream PresenceStream)
	// Remove all presences on a stream from the local node.
	UntrackLocalByStream(stream PresenceStream)
	// Remove the given session from any streams matching the given mode, except the specified stream.
	UntrackLocalByModes(sessionID uuid.UUID, modes map[uint8]struct{}, skipStream PresenceStream)

	// List the nodes that have at least one presence for the given stream.
	ListNodesForStream(stream PresenceStream) map[string]struct{}

	// Check if a stream exists (has any presences) or not.
	StreamExists(stream PresenceStream) bool
	// Get current total number of presences.
	Count() int
	// Get the number of presences in the given stream.
	CountByStream(stream PresenceStream) int
	// Get a snapshot of current presence counts for streams with one of the given stream modes.
	CountByStreamModeFilter(modes map[uint8]*uint8) map[*PresenceStream]int32
	// Check if a single presence on the current node exists.
	GetLocalBySessionIDStreamUserID(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta
	// List presences by stream, optionally include hidden ones and not hidden ones.
	ListByStream(stream PresenceStream, includeHidden bool, includeNotHidden bool) []*Presence

	// Fast lookup of local session IDs to use for message delivery.
	ListLocalSessionIDByStream(stream PresenceStream) []uuid.UUID
	// Fast lookup of node + session IDs to use for message delivery.
	ListPresenceIDByStream(stream PresenceStream) []*PresenceID
	// Fast lookup of presences for a set of user IDs + stream mode.
	ListPresenceIDByStreams(fill map[PresenceStream][]*PresenceID)
}

type presenceCompact struct {
	ID     PresenceID
	Stream PresenceStream
	UserID uuid.UUID
}

type LocalTracker struct {
	sync.RWMutex
	logger             *zap.Logger
	matchJoinListener  func(id uuid.UUID, joins []*MatchPresence)
	matchLeaveListener func(id uuid.UUID, leaves []*MatchPresence)
	partyJoinListener  func(id uuid.UUID, joins []*Presence)
	partyLeaveListener func(id uuid.UUID, leaves []*Presence)
	sessionRegistry    SessionRegistry
	statusRegistry     StatusRegistry
	metrics            Metrics
	protojsonMarshaler *protojson.MarshalOptions
	name               string
	eventsCh           chan *PresenceEvent
	presencesByStream  map[uint8]map[PresenceStream]map[presenceCompact]*Presence
	presencesBySession map[uuid.UUID]map[presenceCompact]*Presence
	count              *atomic.Int64

	ctx         context.Context
	ctxCancelFn context.CancelFunc
}

func StartLocalTracker(logger *zap.Logger, config Config, sessionRegistry SessionRegistry, statusRegistry StatusRegistry, metrics Metrics, protojsonMarshaler *protojson.MarshalOptions) Tracker {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	t := &LocalTracker{
		logger:             logger,
		sessionRegistry:    sessionRegistry,
		statusRegistry:     statusRegistry,
		metrics:            metrics,
		protojsonMarshaler: protojsonMarshaler,
		name:               config.GetName(),
		eventsCh:           make(chan *PresenceEvent, config.GetTracker().EventQueueSize),
		presencesByStream:  make(map[uint8]map[PresenceStream]map[presenceCompact]*Presence),
		presencesBySession: make(map[uuid.UUID]map[presenceCompact]*Presence),
		count:              atomic.NewInt64(0),

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}

	go func() {
		// Asynchronously process and dispatch presence events.
		ticker := time.NewTicker(15 * time.Second)
		for {
			select {
			case <-t.ctx.Done():
				return
			case e := <-t.eventsCh:
				t.processEvent(e)
			case <-ticker.C:
				t.metrics.GaugePresences(float64(t.count.Load()))
			}
		}
	}()

	return t
}

func (t *LocalTracker) SetMatchJoinListener(f func(id uuid.UUID, joins []*MatchPresence)) {
	t.matchJoinListener = f
}

func (t *LocalTracker) SetMatchLeaveListener(f func(id uuid.UUID, leaves []*MatchPresence)) {
	t.matchLeaveListener = f
}

func (t *LocalTracker) SetPartyJoinListener(f func(id uuid.UUID, joins []*Presence)) {
	t.partyJoinListener = f
}

func (t *LocalTracker) SetPartyLeaveListener(f func(id uuid.UUID, leaves []*Presence)) {
	t.partyLeaveListener = f
}

func (t *LocalTracker) Stop() {
	// No need to explicitly clean up the events channel, just let the application exit.
	t.ctxCancelFn()
}

func (t *LocalTracker) Track(ctx context.Context, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) (bool, bool) {
	if session := t.getSession(sessionID); session == nil {
		return false, false
	} else {
		defer session.CloseUnlock()
	}

	syncAtomic.StoreUint32(&meta.Reason, uint32(runtime.PresenceReasonJoin))
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	p := &Presence{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID, Meta: meta}
	t.Lock()

	select {
	case <-ctx.Done():
		t.Unlock()
		return false, false
	default:
	}

	// See if this session has any presences tracked at all.
	if bySession, anyTracked := t.presencesBySession[sessionID]; anyTracked {
		// Then see if the exact presence we need is tracked.
		if _, alreadyTracked := bySession[pc]; !alreadyTracked {
			// If the current session had others tracked, but not this presence.
			bySession[pc] = p
		} else {
			t.Unlock()
			return true, false
		}
	} else {
		// If nothing at all was tracked for the current session, begin tracking.
		bySession = make(map[presenceCompact]*Presence)
		bySession[pc] = p
		t.presencesBySession[sessionID] = bySession
	}
	t.count.Inc()

	// Update tracking for stream.
	byStreamMode, ok := t.presencesByStream[stream.Mode]
	if !ok {
		byStreamMode = make(map[PresenceStream]map[presenceCompact]*Presence)
		t.presencesByStream[stream.Mode] = byStreamMode
	}

	if byStream, ok := byStreamMode[stream]; !ok {
		byStream = make(map[presenceCompact]*Presence)
		byStream[pc] = p
		byStreamMode[stream] = byStream
	} else {
		byStream[pc] = p
	}

	t.Unlock()
	if !meta.Hidden {
		t.queueEvent([]*Presence{p}, nil)
	}
	return true, true
}

func (t *LocalTracker) TrackMulti(ctx context.Context, sessionID uuid.UUID, ops []*TrackerOp, userID uuid.UUID) bool {
	if session := t.getSession(sessionID); session == nil {
		return false
	} else {
		defer session.CloseUnlock()
	}

	joins := make([]*Presence, 0, len(ops))
	t.Lock()

	select {
	case <-ctx.Done():
		t.Unlock()
		return false
	default:
	}

	for _, op := range ops {
		syncAtomic.StoreUint32(&op.Meta.Reason, uint32(runtime.PresenceReasonJoin))
		pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: op.Stream, UserID: userID}
		p := &Presence{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: op.Stream, UserID: userID, Meta: op.Meta}

		// See if this session has any presences tracked at all.
		if bySession, anyTracked := t.presencesBySession[sessionID]; anyTracked {
			// Then see if the exact presence we need is tracked.
			if _, alreadyTracked := bySession[pc]; !alreadyTracked {
				// If the current session had others tracked, but not this presence.
				bySession[pc] = p
			} else {
				continue
			}
		} else {
			// If nothing at all was tracked for the current session, begin tracking.
			bySession = make(map[presenceCompact]*Presence)
			bySession[pc] = p
			t.presencesBySession[sessionID] = bySession
		}
		t.count.Inc()

		// Update tracking for stream.
		byStreamMode, ok := t.presencesByStream[op.Stream.Mode]
		if !ok {
			byStreamMode = make(map[PresenceStream]map[presenceCompact]*Presence)
			t.presencesByStream[op.Stream.Mode] = byStreamMode
		}

		if byStream, ok := byStreamMode[op.Stream]; !ok {
			byStream = make(map[presenceCompact]*Presence)
			byStream[pc] = p
			byStreamMode[op.Stream] = byStream
		} else {
			byStream[pc] = p
		}

		if !op.Meta.Hidden {
			joins = append(joins, p)
		}
	}
	t.Unlock()

	if len(joins) != 0 {
		t.queueEvent(joins, nil)
	}
	return true
}

func (t *LocalTracker) Untrack(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.Lock()

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.Unlock()
		return
	}
	p, found := bySession[pc]
	if !found {
		// The session had other presences, but not for this stream.
		t.Unlock()
		return
	}

	// Update the tracking for session.
	if len(bySession) == 1 {
		// This was the only presence for the session, discard the whole list.
		delete(t.presencesBySession, sessionID)
	} else {
		// There were other presences for the session, drop just this one.
		delete(bySession, pc)
	}
	t.count.Dec()

	// Update the tracking for stream.
	if byStreamMode := t.presencesByStream[stream.Mode]; len(byStreamMode) == 1 {
		// This is the only stream for this stream mode.
		if byStream := byStreamMode[stream]; len(byStream) == 1 {
			// This was the only presence in the only stream for this stream mode, discard the whole list.
			delete(t.presencesByStream, stream.Mode)
		} else {
			// There were other presences for the stream, drop just this one.
			delete(byStream, pc)
		}
	} else {
		// There are other streams for this stream mode.
		if byStream := byStreamMode[stream]; len(byStream) == 1 {
			// This was the only presence for the stream, discard the whole list.
			delete(byStreamMode, stream)
		} else {
			// There were other presences for the stream, drop just this one.
			delete(byStream, pc)
		}
	}

	t.Unlock()
	if !p.Meta.Hidden {
		syncAtomic.StoreUint32(&p.Meta.Reason, uint32(runtime.PresenceReasonLeave))
		t.queueEvent(nil, []*Presence{p})
	}
}

func (t *LocalTracker) UntrackMulti(sessionID uuid.UUID, streams []*PresenceStream, userID uuid.UUID) {
	leaves := make([]*Presence, 0, len(streams))
	t.Lock()

	for _, stream := range streams {
		pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: *stream, UserID: userID}

		bySession, anyTracked := t.presencesBySession[sessionID]
		if !anyTracked {
			// Nothing tracked for the session.
			t.Unlock()
			return
		}
		p, found := bySession[pc]
		if !found {
			// The session had other presences, but not for this stream.
			continue
		}

		// Update the tracking for session.
		if len(bySession) == 1 {
			// This was the only presence for the session, discard the whole list.
			delete(t.presencesBySession, sessionID)
		} else {
			// There were other presences for the session, drop just this one.
			delete(bySession, pc)
		}
		t.count.Dec()

		// Update the tracking for stream.
		if byStreamMode := t.presencesByStream[stream.Mode]; len(byStreamMode) == 1 {
			// This is the only stream for this stream mode.
			if byStream := byStreamMode[*stream]; len(byStream) == 1 {
				// This was the only presence in the only stream for this stream mode, discard the whole list.
				delete(t.presencesByStream, stream.Mode)
			} else {
				// There were other presences for the stream, drop just this one.
				delete(byStream, pc)
			}
		} else {
			// There are other streams for this stream mode.
			if byStream := byStreamMode[*stream]; len(byStream) == 1 {
				// This was the only presence for the stream, discard the whole list.
				delete(byStreamMode, *stream)
			} else {
				// There were other presences for the stream, drop just this one.
				delete(byStream, pc)
			}
		}

		if !p.Meta.Hidden {
			syncAtomic.StoreUint32(&p.Meta.Reason, uint32(runtime.PresenceReasonLeave))
			leaves = append(leaves, p)
		}
	}
	t.Unlock()

	if len(leaves) != 0 {
		t.queueEvent(nil, leaves)
	}
}

func (t *LocalTracker) UntrackAll(sessionID uuid.UUID, reason runtime.PresenceReason) {
	t.Lock()

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.Unlock()
		return
	}

	leaves := make([]*Presence, 0, len(bySession))
	for pc, p := range bySession {
		// Update the tracking for stream.
		if byStreamMode := t.presencesByStream[pc.Stream.Mode]; len(byStreamMode) == 1 {
			// This is the only stream for this stream mode.
			if byStream := byStreamMode[pc.Stream]; len(byStream) == 1 {
				// This was the only presence in the only stream for this stream mode, discard the whole list.
				delete(t.presencesByStream, pc.Stream.Mode)
			} else {
				// There were other presences for the stream, drop just this one.
				delete(byStream, pc)
			}
		} else {
			// There are other streams for this stream mode.
			if byStream := byStreamMode[pc.Stream]; len(byStream) == 1 {
				// This was the only presence for the stream, discard the whole list.
				delete(byStreamMode, pc.Stream)
			} else {
				// There were other presences for the stream, drop just this one.
				delete(byStream, pc)
			}
		}

		// Check if there should be an event for this presence.
		if !p.Meta.Hidden {
			syncAtomic.StoreUint32(&p.Meta.Reason, uint32(reason))
			leaves = append(leaves, p)
		}

		t.count.Dec()
	}
	// Discard the tracking for session.
	delete(t.presencesBySession, sessionID)

	t.Unlock()
	if len(leaves) != 0 {
		t.queueEvent(nil, leaves)
	}
}

func (t *LocalTracker) Update(ctx context.Context, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool {
	if session := t.getSession(sessionID); session == nil {
		return false
	} else {
		defer session.CloseUnlock()
	}

	syncAtomic.StoreUint32(&meta.Reason, uint32(runtime.PresenceReasonUpdate))
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	p := &Presence{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID, Meta: meta}
	t.Lock()

	select {
	case <-ctx.Done():
		t.Unlock()
		return false
	default:
	}

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		bySession = make(map[presenceCompact]*Presence)
		t.presencesBySession[sessionID] = bySession
	}

	// Update tracking for session, but capture any previous meta in case a leave event is required.
	previousP, alreadyTracked := bySession[pc]
	bySession[pc] = p
	if !alreadyTracked {
		t.count.Inc()
	}

	// Update tracking for stream.
	byStreamMode, ok := t.presencesByStream[stream.Mode]
	if !ok {
		byStreamMode = make(map[PresenceStream]map[presenceCompact]*Presence)
		t.presencesByStream[stream.Mode] = byStreamMode
	}

	if byStream, ok := byStreamMode[stream]; !ok {
		byStream = make(map[presenceCompact]*Presence)
		byStream[pc] = p
		byStreamMode[stream] = byStream
	} else {
		byStream[pc] = p
	}

	t.Unlock()

	if !meta.Hidden || (alreadyTracked && !previousP.Meta.Hidden) {
		var joins []*Presence
		if !meta.Hidden {
			joins = []*Presence{p}
		}
		var leaves []*Presence
		if alreadyTracked && !previousP.Meta.Hidden {
			syncAtomic.StoreUint32(&previousP.Meta.Reason, uint32(runtime.PresenceReasonUpdate))
			leaves = []*Presence{previousP}
		}
		// Guaranteed joins and/or leaves are not empty or we wouldn't be inside this block.
		t.queueEvent(joins, leaves)
	}
	return true
}

func (t *LocalTracker) UntrackLocalByStream(stream PresenceStream) {
	// NOTE: Generates no presence notifications as everyone on the stream is going away all at once.
	t.Lock()

	byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
	if !anyTracked {
		// Nothing tracked for the stream.
		t.Unlock()
		return
	}

	// Drop the presences from tracking for each session.
	for pc := range byStream {
		if bySession := t.presencesBySession[pc.ID.SessionID]; len(bySession) == 1 {
			// This is the only presence for that session, discard the whole list.
			delete(t.presencesBySession, pc.ID.SessionID)
		} else {
			// There were other presences for the session, drop just this one.
			delete(bySession, pc)
		}
		t.count.Dec()
	}

	// Discard the tracking for stream.
	if byStreamMode := t.presencesByStream[stream.Mode]; len(byStreamMode) == 1 {
		// This is the only stream for this stream mode.
		delete(t.presencesByStream, stream.Mode)
	} else {
		// There are other streams for this stream mode.
		delete(byStreamMode, stream)
	}

	t.Unlock()
}

func (t *LocalTracker) UntrackByStream(stream PresenceStream) {
	// NOTE: Generates no presence notifications as everyone on the stream is going away all at once.
	t.Lock()

	byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
	if !anyTracked {
		// Nothing tracked for the stream.
		t.Unlock()
		return
	}

	// Drop the presences from tracking for each session.
	for pc := range byStream {
		if bySession := t.presencesBySession[pc.ID.SessionID]; len(bySession) == 1 {
			// This is the only presence for that session, discard the whole list.
			delete(t.presencesBySession, pc.ID.SessionID)
		} else {
			// There were other presences for the session, drop just this one.
			delete(bySession, pc)
		}
		t.count.Dec()
	}

	// Discard the tracking for stream.
	if byStreamMode := t.presencesByStream[stream.Mode]; len(byStreamMode) == 1 {
		// This is the only stream for this stream mode.
		delete(t.presencesByStream, stream.Mode)
	} else {
		// There are other streams for this stream mode.
		delete(byStreamMode, stream)
	}

	t.Unlock()
}

func (t *LocalTracker) UntrackLocalByModes(sessionID uuid.UUID, modes map[uint8]struct{}, skipStream PresenceStream) {
	leaves := make([]*Presence, 0, 1)

	t.Lock()
	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		t.Unlock()
		return
	}

	for pc, p := range bySession {
		if _, found := modes[pc.Stream.Mode]; !found {
			// Not a stream mode we need to check.
			continue
		}
		if pc.Stream == skipStream {
			// Skip this stream based on input.
			continue
		}

		// Update the tracking for session.
		if len(bySession) == 1 {
			// This was the only presence for the session, discard the whole list.
			delete(t.presencesBySession, sessionID)
		} else {
			// There were other presences for the session, drop just this one.
			delete(bySession, pc)
		}
		t.count.Dec()

		// Update the tracking for stream.
		if byStreamMode := t.presencesByStream[pc.Stream.Mode]; len(byStreamMode) == 1 {
			// This is the only stream for this stream mode.
			if byStream := byStreamMode[pc.Stream]; len(byStream) == 1 {
				// This was the only presence in the only stream for this stream mode, discard the whole list.
				delete(t.presencesByStream, pc.Stream.Mode)
			} else {
				// There were other presences for the stream, drop just this one.
				delete(byStream, pc)
			}
		} else {
			// There are other streams for this stream mode.
			if byStream := byStreamMode[pc.Stream]; len(byStream) == 1 {
				// This was the only presence for the stream, discard the whole list.
				delete(byStreamMode, pc.Stream)
			} else {
				// There were other presences for the stream, drop just this one.
				delete(byStream, pc)
			}
		}

		if !p.Meta.Hidden {
			syncAtomic.StoreUint32(&p.Meta.Reason, uint32(runtime.PresenceReasonLeave))
			leaves = append(leaves, p)
		}
	}
	t.Unlock()

	if len(leaves) > 0 {
		t.queueEvent(nil, leaves)
	}
}

func (t *LocalTracker) ListNodesForStream(stream PresenceStream) map[string]struct{} {
	t.RLock()
	_, anyTracked := t.presencesByStream[stream.Mode][stream]
	t.RUnlock()
	if anyTracked {
		// For the local tracker having any presences for this stream is enough.
		return map[string]struct{}{t.name: {}}
	}
	return map[string]struct{}{}
}

func (t *LocalTracker) StreamExists(stream PresenceStream) bool {
	var exists bool
	t.RLock()
	exists = t.presencesByStream[stream.Mode][stream] != nil
	t.RUnlock()
	return exists
}

func (t *LocalTracker) Count() int {
	return int(t.count.Load())
}

func (t *LocalTracker) CountByStream(stream PresenceStream) int {
	var count int
	t.RLock()
	// If the stream exists use its presence count, otherwise 0.
	if byStream, anyTracked := t.presencesByStream[stream.Mode][stream]; anyTracked {
		count = len(byStream)
	}
	t.RUnlock()
	return count
}

func (t *LocalTracker) CountByStreamModeFilter(modes map[uint8]*uint8) map[*PresenceStream]int32 {
	counts := make(map[*PresenceStream]int32)
	t.RLock()
	for mode, byStreamMode := range t.presencesByStream {
		if modes[mode] == nil {
			continue
		}
		for s, ps := range byStreamMode {
			cs := s
			counts[&cs] = int32(len(ps))
		}
	}
	t.RUnlock()
	return counts
}

func (t *LocalTracker) GetLocalBySessionIDStreamUserID(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.RLock()
	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.RUnlock()
		return nil
	}
	p, found := bySession[pc]
	t.RUnlock()
	if !found {
		return nil
	}
	return &p.Meta
}

func (t *LocalTracker) ListByStream(stream PresenceStream, includeHidden bool, includeNotHidden bool) []*Presence {
	if !includeHidden && !includeNotHidden {
		return []*Presence{}
	}

	t.RLock()
	byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
	if !anyTracked {
		t.RUnlock()
		return []*Presence{}
	}
	ps := make([]*Presence, 0, len(byStream))
	for _, p := range byStream {
		if (p.Meta.Hidden && includeHidden) || (!p.Meta.Hidden && includeNotHidden) {
			ps = append(ps, p)
		}
	}
	t.RUnlock()
	return ps
}

func (t *LocalTracker) ListLocalSessionIDByStream(stream PresenceStream) []uuid.UUID {
	t.RLock()
	byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
	if !anyTracked {
		t.RUnlock()
		return []uuid.UUID{}
	}
	ps := make([]uuid.UUID, 0, len(byStream))
	for pc := range byStream {
		ps = append(ps, pc.ID.SessionID)
	}
	t.RUnlock()
	return ps
}

func (t *LocalTracker) ListPresenceIDByStream(stream PresenceStream) []*PresenceID {
	t.RLock()
	byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
	if !anyTracked {
		t.RUnlock()
		return []*PresenceID{}
	}
	ps := make([]*PresenceID, 0, len(byStream))
	for pc := range byStream {
		pid := pc.ID
		ps = append(ps, &pid)
	}
	t.RUnlock()
	return ps
}

func (t *LocalTracker) ListPresenceIDByStreams(fill map[PresenceStream][]*PresenceID) {
	if len(fill) == 0 {
		return
	}

	t.RLock()
	for stream, presences := range fill {
		byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
		if !anyTracked {
			continue
		}
		for pc := range byStream {
			pid := pc.ID
			presences = append(presences, &pid)
		}
		fill[stream] = presences
	}
	t.RUnlock()
}

func (t *LocalTracker) queueEvent(joins, leaves []*Presence) {
	select {
	case t.eventsCh <- &PresenceEvent{Joins: joins, Leaves: leaves, QueueTime: time.Now()}:
		// Event queued for asynchronous dispatch.
	default:
		// Event queue is full, log an error and completely drain the queue.
		t.logger.Error("Presence event dispatch queue is full, presence events may be lost")
		for {
			select {
			case <-t.eventsCh:
				// Discard the event.
			default:
				// Queue is now empty.
				return
			}
		}
	}
}

func (t *LocalTracker) processEvent(e *PresenceEvent) {
	dequeueTime := time.Now()
	defer func() {
		t.metrics.PresenceEvent(dequeueTime.Sub(e.QueueTime), time.Since(dequeueTime))
	}()

	t.logger.Debug("Processing presence event", zap.Int("joins", len(e.Joins)), zap.Int("leaves", len(e.Leaves)))

	// Group joins/leaves by stream to allow batching.
	// Convert to wire representation at the same time.
	streamJoins := make(map[PresenceStream][]*rtapi.UserPresence, 0)
	streamLeaves := make(map[PresenceStream][]*rtapi.UserPresence, 0)

	// Track grouped authoritative match joins and leaves separately from client-bound events.
	matchJoins := make(map[uuid.UUID][]*MatchPresence, 0)
	matchLeaves := make(map[uuid.UUID][]*MatchPresence, 0)

	// Track grouped party joins and leaves separately from client-bound events.
	partyJoins := make(map[uuid.UUID][]*Presence, 0)
	partyLeaves := make(map[uuid.UUID][]*Presence, 0)

	for _, p := range e.Joins {
		pWire := &rtapi.UserPresence{
			UserId:      p.UserID.String(),
			SessionId:   p.ID.SessionID.String(),
			Username:    p.Meta.Username,
			Persistence: p.Meta.Persistence,
		}
		if p.Stream.Mode == StreamModeStatus {
			// Status field is only populated for status stream presences.
			pWire.Status = &wrapperspb.StringValue{Value: p.Meta.Status}
		}
		if j, ok := streamJoins[p.Stream]; ok {
			streamJoins[p.Stream] = append(j, pWire)
		} else {
			streamJoins[p.Stream] = []*rtapi.UserPresence{pWire}
		}

		// We only care about authoritative match joins where the match host is the current node.
		if p.Stream.Mode == StreamModeMatchAuthoritative && p.Stream.Label == t.name {
			mp := &MatchPresence{
				Node:      p.ID.Node,
				UserID:    p.UserID,
				SessionID: p.ID.SessionID,
				Username:  p.Meta.Username,
				Reason:    runtime.PresenceReason(syncAtomic.LoadUint32(&p.Meta.Reason)),
			}
			if j, ok := matchJoins[p.Stream.Subject]; ok {
				matchJoins[p.Stream.Subject] = append(j, mp)
			} else {
				matchJoins[p.Stream.Subject] = []*MatchPresence{mp}
			}
		}

		// We only care about party joins where the host is the current node.
		if p.Stream.Mode == StreamModeParty && p.Stream.Label == t.name {
			c := p
			if j, ok := partyJoins[p.Stream.Subject]; ok {
				partyJoins[p.Stream.Subject] = append(j, c)
			} else {
				partyJoins[p.Stream.Subject] = []*Presence{c}
			}
		}
	}
	for _, p := range e.Leaves {
		pWire := &rtapi.UserPresence{
			UserId:      p.UserID.String(),
			SessionId:   p.ID.SessionID.String(),
			Username:    p.Meta.Username,
			Persistence: p.Meta.Persistence,
		}
		if p.Stream.Mode == StreamModeStatus {
			// Status field is only populated for status stream presences.
			pWire.Status = &wrapperspb.StringValue{Value: p.Meta.Status}
		}
		if l, ok := streamLeaves[p.Stream]; ok {
			streamLeaves[p.Stream] = append(l, pWire)
		} else {
			streamLeaves[p.Stream] = []*rtapi.UserPresence{pWire}
		}

		// We only care about authoritative match leaves where the match host is the current node.
		if p.Stream.Mode == StreamModeMatchAuthoritative && p.Stream.Label == t.name {
			mp := &MatchPresence{
				Node:      p.ID.Node,
				UserID:    p.UserID,
				SessionID: p.ID.SessionID,
				Username:  p.Meta.Username,
				Reason:    runtime.PresenceReason(syncAtomic.LoadUint32(&p.Meta.Reason)),
			}
			if l, ok := matchLeaves[p.Stream.Subject]; ok {
				matchLeaves[p.Stream.Subject] = append(l, mp)
			} else {
				matchLeaves[p.Stream.Subject] = []*MatchPresence{mp}
			}
		}

		// We only care about party leaves where the host is the current node.
		if p.Stream.Mode == StreamModeParty && p.Stream.Label == t.name {
			c := p
			if l, ok := partyLeaves[p.Stream.Subject]; ok {
				partyLeaves[p.Stream.Subject] = append(l, c)
			} else {
				partyLeaves[p.Stream.Subject] = []*Presence{c}
			}
		}
	}

	// Notify locally hosted authoritative matches of join and leave events.
	for matchID, joins := range matchJoins {
		t.matchJoinListener(matchID, joins)
	}
	for matchID, leaves := range matchLeaves {
		t.matchLeaveListener(matchID, leaves)
	}

	// Notify locally managed parties of join and leave events.
	for partyID, joins := range partyJoins {
		t.partyJoinListener(partyID, joins)
	}
	for partyID, leaves := range partyLeaves {
		t.partyLeaveListener(partyID, leaves)
	}

	// Send joins, together with any leaves for the same stream.
	for stream, joins := range streamJoins {
		leaves, ok := streamLeaves[stream]
		if ok {
			delete(streamLeaves, stream)
		}

		if stream.Mode == StreamModeStatus {
			t.statusRegistry.Queue(stream.Subject, joins, leaves)
			continue
		}

		// Construct the wire representation of the stream.
		streamWire := &rtapi.Stream{
			Mode:  int32(stream.Mode),
			Label: stream.Label,
		}
		if stream.Subject != uuid.Nil {
			streamWire.Subject = stream.Subject.String()
		}
		if stream.Subcontext != uuid.Nil {
			streamWire.Subcontext = stream.Subcontext.String()
		}

		// Find the list of event recipients first so we can skip event encoding work if it's not necessary.
		sessionIDs := t.ListLocalSessionIDByStream(stream)
		if len(sessionIDs) == 0 {
			continue
		}

		// Construct the wire representation of the event based on the stream mode.
		var envelope *rtapi.Envelope
		switch stream.Mode {
		case StreamModeChannel:
			channelID, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelID,
				Joins:     joins,
				Leaves:    leaves,
				RoomName:  streamWire.Label,
			}}}
		case StreamModeGroup:
			channelID, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelID,
				Joins:     joins,
				Leaves:    leaves,
				GroupId:   streamWire.Subject,
			}}}
		case StreamModeDM:
			channelID, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelID,
				Joins:     joins,
				Leaves:    leaves,
				UserIdOne: streamWire.Subject,
				UserIdTwo: streamWire.Subcontext,
			}}}
		case StreamModeMatchRelayed:
			fallthrough
		case StreamModeMatchAuthoritative:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_MatchPresenceEvent{MatchPresenceEvent: &rtapi.MatchPresenceEvent{
				MatchId: fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
				Joins:   joins,
				Leaves:  leaves,
			}}}
		case StreamModeParty:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_PartyPresenceEvent{PartyPresenceEvent: &rtapi.PartyPresenceEvent{
				PartyId: fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
				Joins:   joins,
				Leaves:  leaves,
			}}}
		default:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_StreamPresenceEvent{StreamPresenceEvent: &rtapi.StreamPresenceEvent{
				Stream: streamWire,
				Joins:  joins,
				Leaves: leaves,
			}}}
		}

		// Prepare payload variables but do not initialize until we hit a session that needs them to avoid unnecessary work.
		var payloadProtobuf []byte
		var payloadJSON []byte

		// Deliver event.
		for _, sessionID := range sessionIDs {
			session := t.sessionRegistry.Get(sessionID)
			if session == nil {
				t.logger.Debug("Could not deliver presence event, no session", zap.String("sid", sessionID.String()))
				continue
			}

			var err error
			switch session.Format() {
			case SessionFormatProtobuf:
				if payloadProtobuf == nil {
					// Marshal the payload now that we know this format is needed.
					payloadProtobuf, err = proto.Marshal(envelope)
					if err != nil {
						t.logger.Error("Could not marshal presence event", zap.Error(err))
						return
					}
				}
				err = session.SendBytes(payloadProtobuf, true)
			case SessionFormatJson:
				fallthrough
			default:
				if payloadJSON == nil {
					// Marshal the payload now that we know this format is needed.
					if buf, err := t.protojsonMarshaler.Marshal(envelope); err == nil {
						payloadJSON = buf
					} else {
						t.logger.Error("Could not marshal presence event", zap.Error(err))
						return
					}
				}
				err = session.SendBytes(payloadJSON, true)
			}
			if err != nil {
				t.logger.Error("Failed to deliver presence event", zap.String("sid", sessionID.String()), zap.Error(err))
			}
		}
	}

	// If there are leaves without corresponding joins.
	for stream, leaves := range streamLeaves {
		if stream.Mode == StreamModeStatus {
			t.statusRegistry.Queue(stream.Subject, nil, leaves)
			continue
		}

		// Construct the wire representation of the stream.
		streamWire := &rtapi.Stream{
			Mode:  int32(stream.Mode),
			Label: stream.Label,
		}
		if stream.Subject != uuid.Nil {
			streamWire.Subject = stream.Subject.String()
		}
		if stream.Subcontext != uuid.Nil {
			streamWire.Subcontext = stream.Subcontext.String()
		}

		// Find the list of event recipients first so we can skip event encoding work if it's not necessary.
		sessionIDs := t.ListLocalSessionIDByStream(stream)
		if len(sessionIDs) == 0 {
			continue
		}

		// Construct the wire representation of the event based on the stream mode.
		var envelope *rtapi.Envelope
		switch stream.Mode {
		case StreamModeChannel:
			channelID, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelID,
				// No joins.
				Leaves:   leaves,
				RoomName: streamWire.Label,
			}}}
		case StreamModeGroup:
			channelID, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelID,
				// No joins.
				Leaves:  leaves,
				GroupId: streamWire.Subject,
			}}}
		case StreamModeDM:
			channelID, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelID,
				// No joins.
				Leaves:    leaves,
				UserIdOne: streamWire.Subject,
				UserIdTwo: streamWire.Subcontext,
			}}}
		case StreamModeMatchRelayed:
			fallthrough
		case StreamModeMatchAuthoritative:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_MatchPresenceEvent{MatchPresenceEvent: &rtapi.MatchPresenceEvent{
				MatchId: fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
				// No joins.
				Leaves: leaves,
			}}}
		case StreamModeParty:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_PartyPresenceEvent{PartyPresenceEvent: &rtapi.PartyPresenceEvent{
				PartyId: fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
				// No joins.
				Leaves: leaves,
			}}}
		default:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_StreamPresenceEvent{StreamPresenceEvent: &rtapi.StreamPresenceEvent{
				Stream: streamWire,
				// No joins.
				Leaves: leaves,
			}}}
		}

		// Prepare payload variables but do not initialize until we hit a session that needs them to avoid unnecessary work.
		var payloadProtobuf []byte
		var payloadJSON []byte

		// Deliver event.
		for _, sessionID := range sessionIDs {
			session := t.sessionRegistry.Get(sessionID)
			if session == nil {
				t.logger.Debug("Could not deliver presence event, no session", zap.String("sid", sessionID.String()))
				continue
			}

			var err error
			switch session.Format() {
			case SessionFormatProtobuf:
				if payloadProtobuf == nil {
					// Marshal the payload now that we know this format is needed.
					payloadProtobuf, err = proto.Marshal(envelope)
					if err != nil {
						t.logger.Error("Could not marshal presence event", zap.Error(err))
						return
					}
				}
				err = session.SendBytes(payloadProtobuf, true)
			case SessionFormatJson:
				fallthrough
			default:
				if payloadJSON == nil {
					// Marshal the payload now that we know this format is needed.
					if buf, err := t.protojsonMarshaler.Marshal(envelope); err == nil {
						payloadJSON = buf
					} else {
						t.logger.Error("Could not marshal presence event", zap.Error(err))
						return
					}
				}
				err = session.SendBytes(payloadJSON, true)
			}
			if err != nil {
				t.logger.Error("Failed to deliver presence event", zap.String("sid", sessionID.String()), zap.Error(err))
			}
		}
	}
}

func (t *LocalTracker) getSession(id uuid.UUID) Session {
	session := t.sessionRegistry.Get(id)
	if session == nil {
		return nil
	}

	session.CloseLock()

	// Session is invalid
	if session.Context().Err() != nil {
		session.CloseUnlock()
		return nil
	}

	return session
}
