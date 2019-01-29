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
	"bytes"
	"context"
	"github.com/golang/protobuf/proto"
	"sync"

	"fmt"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/zap"
)

const (
	StreamModeNotifications uint8 = iota
	StreamModeStatus
	StreamModeChannel
	StreamModeGroup
	StreamModeDM
	StreamModeMatchRelayed
	StreamModeMatchAuthoritative
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

type PresenceEvent struct {
	Joins  []Presence
	Leaves []Presence
}

type Tracker interface {
	SetMatchJoinListener(func(id uuid.UUID, joins []*MatchPresence))
	SetMatchLeaveListener(func(id uuid.UUID, leaves []*MatchPresence))
	Stop()

	// Track returns success true/false, and new presence true/false.
	Track(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, node string, meta PresenceMeta, allowIfFirstForSession bool) (bool, bool)
	Untrack(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, node string)
	UntrackAll(sessionID uuid.UUID)
	// Update returns success true/false - will only fail if the user has no presence and allowIfFirstForSession is false, otherwise is an upsert.
	Update(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, node string, meta PresenceMeta, allowIfFirstForSession bool) bool

	// Remove all presences on a stream, effectively closing it.
	UntrackByStream(stream PresenceStream)
	// Remove all presences on a stream from the local node.
	UntrackLocalByStream(stream PresenceStream)

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
	// Check if a single presence on any node exists.
	GetBySessionIDStreamUserID(node string, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta
	// List presences by stream, optionally include hidden ones and not hidden ones.
	ListByStream(stream PresenceStream, includeHidden bool, includeNotHidden bool) []*Presence

	// Fast lookup of local session IDs to use for message delivery.
	ListLocalSessionIDByStream(stream PresenceStream) []uuid.UUID
	// Fast lookup of node + session IDs to use for message delivery.
	ListPresenceIDByStream(stream PresenceStream) []*PresenceID
}

type presenceCompact struct {
	ID     PresenceID
	Stream PresenceStream
	UserID uuid.UUID
}

type LocalTracker struct {
	sync.RWMutex
	logger             *zap.Logger
	matchJoinListener  func(id uuid.UUID, leaves []*MatchPresence)
	matchLeaveListener func(id uuid.UUID, leaves []*MatchPresence)
	sessionRegistry    SessionRegistry
	jsonpbMarshaler    *jsonpb.Marshaler
	name               string
	eventsCh           chan *PresenceEvent
	presencesByStream  map[uint8]map[PresenceStream]map[presenceCompact]PresenceMeta
	presencesBySession map[uuid.UUID]map[presenceCompact]PresenceMeta

	ctx         context.Context
	ctxCancelFn context.CancelFunc
}

func StartLocalTracker(logger *zap.Logger, config Config, sessionRegistry SessionRegistry, jsonpbMarshaler *jsonpb.Marshaler) Tracker {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	t := &LocalTracker{
		logger:             logger,
		sessionRegistry:    sessionRegistry,
		jsonpbMarshaler:    jsonpbMarshaler,
		name:               config.GetName(),
		eventsCh:           make(chan *PresenceEvent, config.GetTracker().EventQueueSize),
		presencesByStream:  make(map[uint8]map[PresenceStream]map[presenceCompact]PresenceMeta),
		presencesBySession: make(map[uuid.UUID]map[presenceCompact]PresenceMeta),

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}

	go func() {
		// Asynchronously process and dispatch presence events.
		for {
			select {
			case <-t.ctx.Done():
				return
			case e := <-t.eventsCh:
				t.processEvent(e)
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

func (t *LocalTracker) Stop() {
	// No need to explicitly clean up the events channel, just let the application exit.
	t.ctxCancelFn()
}

func (t *LocalTracker) Track(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, node string, meta PresenceMeta, allowIfFirstForSession bool) (bool, bool) {
	if node != t.name {
		return false, false
	}

	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.Lock()

	// See if this session has any presences tracked at all.
	if bySession, anyTracked := t.presencesBySession[sessionID]; anyTracked {
		// Then see if the exact presence we need is tracked.
		if _, alreadyTracked := bySession[pc]; !alreadyTracked {
			// If the current session had others tracked, but not this presence.
			bySession[pc] = meta
		} else {
			t.Unlock()
			return true, false
		}
	} else {
		if !allowIfFirstForSession {
			// If it's the first presence for this session, only allow it if explicitly permitted to.
			t.Unlock()
			return false, false
		}
		// If nothing at all was tracked for the current session, begin tracking.
		bySession = make(map[presenceCompact]PresenceMeta)
		bySession[pc] = meta
		t.presencesBySession[sessionID] = bySession
	}

	// Update tracking for stream.
	byStreamMode, ok := t.presencesByStream[stream.Mode]
	if !ok {
		byStreamMode = make(map[PresenceStream]map[presenceCompact]PresenceMeta)
		t.presencesByStream[stream.Mode] = byStreamMode
	}

	if byStream, ok := byStreamMode[stream]; !ok {
		byStream = make(map[presenceCompact]PresenceMeta)
		byStream[pc] = meta
		byStreamMode[stream] = byStream
	} else {
		byStream[pc] = meta
	}

	t.Unlock()
	if !meta.Hidden {
		t.queueEvent(
			[]Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: meta},
			},
			nil,
		)
	}
	return true, true
}

func (t *LocalTracker) Untrack(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, node string) {
	if node != t.name {
		return
	}

	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.Lock()

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.Unlock()
		return
	}
	meta, found := bySession[pc]
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
	if !meta.Hidden {
		t.queueEvent(
			nil,
			[]Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: meta},
			},
		)
	}
}

func (t *LocalTracker) UntrackAll(sessionID uuid.UUID) {
	t.Lock()

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.Unlock()
		return
	}

	leaves := make([]Presence, 0, len(bySession))
	for pc, meta := range bySession {
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
		if !meta.Hidden {
			leaves = append(leaves, Presence{ID: pc.ID, Stream: pc.Stream, UserID: pc.UserID, Meta: meta})
		}
	}
	// Discard the tracking for session.
	delete(t.presencesBySession, sessionID)

	t.Unlock()
	if len(leaves) != 0 {
		t.queueEvent(
			nil,
			leaves,
		)
	}
}

func (t *LocalTracker) Update(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, node string, meta PresenceMeta, allowIfFirstForSession bool) bool {
	if node != t.name {
		return false
	}

	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.Lock()

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		if !allowIfFirstForSession {
			// Nothing tracked for the session and not allowed to track as first presence.
			t.Unlock()
			return false
		}

		bySession = make(map[presenceCompact]PresenceMeta)
		t.presencesBySession[sessionID] = bySession
	}

	// Update tracking for session, but capture any previous meta in case a leave event is required.
	previousMeta, alreadyTracked := bySession[pc]
	bySession[pc] = meta

	// Update tracking for stream.
	byStreamMode, ok := t.presencesByStream[stream.Mode]
	if !ok {
		byStreamMode = make(map[PresenceStream]map[presenceCompact]PresenceMeta)
		t.presencesByStream[stream.Mode] = byStreamMode
	}

	if byStream, ok := byStreamMode[stream]; !ok {
		byStream = make(map[presenceCompact]PresenceMeta)
		byStream[pc] = meta
		byStreamMode[stream] = byStream
	} else {
		byStream[pc] = meta
	}

	t.Unlock()

	if !meta.Hidden || (alreadyTracked && !previousMeta.Hidden) {
		var joins []Presence
		if !meta.Hidden {
			joins = []Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: meta},
			}
		}
		var leaves []Presence
		if alreadyTracked && !previousMeta.Hidden {
			leaves = []Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: previousMeta},
			}
		}
		// Guaranteed joins and/or leaves are not empty or we wouldn't be inside this block.
		t.queueEvent(
			joins,
			leaves,
		)
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
	for pc, _ := range byStream {
		if bySession := t.presencesBySession[pc.ID.SessionID]; len(bySession) == 1 {
			// This is the only presence for that session, discard the whole list.
			delete(t.presencesBySession, pc.ID.SessionID)
		} else {
			// There were other presences for the session, drop just this one.
			delete(bySession, pc)
		}
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
	for pc, _ := range byStream {
		if bySession := t.presencesBySession[pc.ID.SessionID]; len(bySession) == 1 {
			// This is the only presence for that session, discard the whole list.
			delete(t.presencesBySession, pc.ID.SessionID)
		} else {
			// There were other presences for the session, drop just this one.
			delete(bySession, pc)
		}
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

func (t *LocalTracker) ListNodesForStream(stream PresenceStream) map[string]struct{} {
	t.RLock()
	_, anyTracked := t.presencesByStream[stream.Mode][stream]
	t.RUnlock()
	if anyTracked {
		// For the local tracker having any presences for this stream is enough.
		return map[string]struct{}{t.name: struct{}{}}
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
	var count int
	t.RLock()
	// For each session add together their presence count.
	for _, bySession := range t.presencesBySession {
		count += len(bySession)
	}
	t.RUnlock()
	return count
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
	meta, found := bySession[pc]
	t.RUnlock()
	if !found {
		return nil
	}
	return &meta
}

func (t *LocalTracker) GetBySessionIDStreamUserID(node string, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta {
	pc := presenceCompact{ID: PresenceID{Node: node, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.RLock()
	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.RUnlock()
		return nil
	}
	meta, found := bySession[pc]
	t.RUnlock()
	if !found {
		return nil
	}
	return &meta
}

func (t *LocalTracker) ListByStream(stream PresenceStream, includeHidden bool, includeNotHidden bool) []*Presence {
	t.RLock()
	byStream, anyTracked := t.presencesByStream[stream.Mode][stream]
	if !anyTracked {
		t.RUnlock()
		return []*Presence{}
	}
	ps := make([]*Presence, 0, len(byStream))
	for pc, meta := range byStream {
		if (meta.Hidden && includeHidden) || (!meta.Hidden && includeNotHidden) {
			ps = append(ps, &Presence{ID: pc.ID, Stream: stream, UserID: pc.UserID, Meta: meta})
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
	for pc, _ := range byStream {
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
	for pc, _ := range byStream {
		pid := pc.ID
		ps = append(ps, &pid)
	}
	t.RUnlock()
	return ps
}

func (t *LocalTracker) queueEvent(joins, leaves []Presence) {
	select {
	case t.eventsCh <- &PresenceEvent{Joins: joins, Leaves: leaves}:
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
	t.logger.Debug("Processing presence event", zap.Int("joins", len(e.Joins)), zap.Int("leaves", len(e.Leaves)))

	// Group joins/leaves by stream to allow batching.
	// Convert to wire representation at the same time.
	streamJoins := make(map[PresenceStream][]*rtapi.UserPresence, 0)
	streamLeaves := make(map[PresenceStream][]*rtapi.UserPresence, 0)

	// Track grouped authoritative match joins and leaves separately from client-bound events.
	matchJoins := make(map[uuid.UUID][]*MatchPresence, 0)
	matchLeaves := make(map[uuid.UUID][]*MatchPresence, 0)

	for _, p := range e.Joins {
		pWire := &rtapi.UserPresence{
			UserId:      p.UserID.String(),
			SessionId:   p.ID.SessionID.String(),
			Username:    p.Meta.Username,
			Persistence: p.Meta.Persistence,
		}
		if p.Stream.Mode == StreamModeStatus {
			// Status field is only populated for status stream presences.
			pWire.Status = &wrappers.StringValue{Value: p.Meta.Status}
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
			}
			if j, ok := matchJoins[p.Stream.Subject]; ok {
				matchJoins[p.Stream.Subject] = append(j, mp)
			} else {
				matchJoins[p.Stream.Subject] = []*MatchPresence{mp}
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
			pWire.Status = &wrappers.StringValue{Value: p.Meta.Status}
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
			}
			if l, ok := matchLeaves[p.Stream.Subject]; ok {
				matchLeaves[p.Stream.Subject] = append(l, mp)
			} else {
				matchLeaves[p.Stream.Subject] = []*MatchPresence{mp}
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

	// Send joins, together with any leaves for the same stream.
	for stream, joins := range streamJoins {
		leaves, ok := streamLeaves[stream]
		if ok {
			delete(streamLeaves, stream)
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
		case StreamModeStatus:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_StatusPresenceEvent{StatusPresenceEvent: &rtapi.StatusPresenceEvent{
				Joins:  joins,
				Leaves: leaves,
			}}}
		case StreamModeChannel:
			fallthrough
		case StreamModeGroup:
			fallthrough
		case StreamModeDM:
			channelId, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelId,
				Joins:     joins,
				Leaves:    leaves,
			}}}
		case StreamModeMatchRelayed:
			fallthrough
		case StreamModeMatchAuthoritative:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_MatchPresenceEvent{MatchPresenceEvent: &rtapi.MatchPresenceEvent{
				MatchId: fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
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
		var payloadJson []byte

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
				err = session.SendBytes(true, stream.Mode, payloadProtobuf)
			case SessionFormatJson:
				fallthrough
			default:
				if payloadJson == nil {
					// Marshal the payload now that we know this format is needed.
					var buf bytes.Buffer
					if err = t.jsonpbMarshaler.Marshal(&buf, envelope); err == nil {
						payloadJson = buf.Bytes()
					} else {
						t.logger.Error("Could not marshal presence event", zap.Error(err))
						return
					}
				}
				err = session.SendBytes(true, stream.Mode, payloadJson)
			}
			if err != nil {
				t.logger.Error("Failed to deliver presence event", zap.String("sid", sessionID.String()), zap.Error(err))
			}
		}
	}

	// If there are leaves without corresponding joins.
	for stream, leaves := range streamLeaves {
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
		case StreamModeStatus:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_StatusPresenceEvent{StatusPresenceEvent: &rtapi.StatusPresenceEvent{
				// No joins.
				Leaves: leaves,
			}}}
		case StreamModeChannel:
			fallthrough
		case StreamModeGroup:
			fallthrough
		case StreamModeDM:
			channelId, err := StreamToChannelId(stream)
			if err != nil {
				// Should not happen thanks to previous validation, but guard just in case.
				t.logger.Error("Error converting stream to channel identifier in presence event", zap.Error(err), zap.Any("stream", stream))
				continue
			}
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_ChannelPresenceEvent{ChannelPresenceEvent: &rtapi.ChannelPresenceEvent{
				ChannelId: channelId,
				// No joins.
				Leaves: leaves,
			}}}
		case StreamModeMatchRelayed:
			fallthrough
		case StreamModeMatchAuthoritative:
			envelope = &rtapi.Envelope{Message: &rtapi.Envelope_MatchPresenceEvent{MatchPresenceEvent: &rtapi.MatchPresenceEvent{
				MatchId: fmt.Sprintf("%v.%v", stream.Subject.String(), stream.Label),
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
		var payloadJson []byte

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
				err = session.SendBytes(true, stream.Mode, payloadProtobuf)
			case SessionFormatJson:
				fallthrough
			default:
				if payloadJson == nil {
					// Marshal the payload now that we know this format is needed.
					var buf bytes.Buffer
					if err = t.jsonpbMarshaler.Marshal(&buf, envelope); err == nil {
						payloadJson = buf.Bytes()
					} else {
						t.logger.Error("Could not marshal presence event", zap.Error(err))
						return
					}
				}
				err = session.SendBytes(true, stream.Mode, payloadJson)
			}
			if err != nil {
				t.logger.Error("Failed to deliver presence event", zap.String("sid", sessionID.String()), zap.Error(err))
			}
		}
	}
}
