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
	"github.com/satori/go.uuid"
	"sync"
	"go.uber.org/zap"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/golang/protobuf/jsonpb"
)

const (
	StreamModeNotifications uint8 = iota
	StreamModeStatus
	StreamModeChannel
	StreamModeGroup
	StreamModeDM
)

type PresenceID struct {
	Node      string
	SessionID uuid.UUID
}

type PresenceStream struct {
	Mode       uint8
	Subject    uuid.UUID
	Descriptor uuid.UUID
	Label      string
}

type PresenceMeta struct {
	Format      SessionFormat
	Hidden      bool
	Persistence bool
	Username    string
	Status      string
}

type Presence struct {
	ID     PresenceID
	Stream PresenceStream
	UserID uuid.UUID
	Meta   PresenceMeta
}

type PresenceEvent struct {
	joins  []Presence
	leaves []Presence
}

type Tracker interface {
	Stop()

	// Individual presence and user operations.
	Track(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool
	Untrack(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID)
	UntrackAll(sessionID uuid.UUID)
	Update(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool

	// Remove all presences on a stream, effectively closing it.
	UntrackByStream(stream PresenceStream)
	// Remove all presences on a stream from the local node.
	UntrackLocalByStream(stream PresenceStream)

	// List the nodes that have at least one presence for the given stream.
	ListNodesForStream(stream PresenceStream) []string

	// Get current total number of presences.
	Count() int
	// Get the number of presences in the given stream.
	CountByStream(stream PresenceStream) int
	// Check if a single presence on the current node exists.
	GetLocalBySessionIDStreamUserID(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) *PresenceMeta
	// List presences by stream.
	ListByStream(stream PresenceStream) []Presence
	// List presences on the current node by stream.
	ListLocalByStream(stream PresenceStream) []Presence
}

type presenceCompact struct {
	ID     PresenceID
	Stream PresenceStream
	UserID uuid.UUID
}

type LocalTracker struct {
	sync.RWMutex
	logger             *zap.Logger
	registry           *SessionRegistry
	jsonpbMarshaler    *jsonpb.Marshaler
	name               string
	eventsCh           chan *PresenceEvent
	stopCh             chan struct{}
	presencesByStream  map[PresenceStream]map[presenceCompact]PresenceMeta
	presencesBySession map[uuid.UUID]map[presenceCompact]PresenceMeta
}

func StartLocalTracker(logger *zap.Logger, registry *SessionRegistry, jsonpbMarshaler *jsonpb.Marshaler, name string) Tracker {
	t := &LocalTracker{
		logger:             logger,
		registry:           registry,
		jsonpbMarshaler:    jsonpbMarshaler,
		name:               name,
		eventsCh:           make(chan *PresenceEvent, 128),
		stopCh:             make(chan struct{}),
		presencesByStream:  make(map[PresenceStream]map[presenceCompact]PresenceMeta),
		presencesBySession: make(map[uuid.UUID]map[presenceCompact]PresenceMeta),
	}
	go func() {
		// Asynchronously process and dispatch presence events.
		for {
			select {
			case <-t.stopCh:
				return
			case e := <-t.eventsCh:
				t.processEvent(e)
			}
		}
	}()
	return t
}

func (t *LocalTracker) Stop() {
	// No need to explicitly clean up the events channel, just let the application exit.
	close(t.stopCh)
}

func (t *LocalTracker) Track(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	alreadyTracked := false
	t.Lock()

	// See if this session has any presences tracked at all.
	bySession, anyTracked := t.presencesBySession[sessionID]
	if anyTracked {
		// Then see if the exact presence we need is tracked.
		_, alreadyTracked = bySession[pc]
	}

	// Maybe update tracking for session.
	if !anyTracked {
		// If nothing at all was tracked for the current session, begin tracking.
		bySession = make(map[presenceCompact]PresenceMeta)
		bySession[pc] = meta
		t.presencesBySession[sessionID] = bySession
	} else if !alreadyTracked {
		// If the current session had others tracked, but not this presence.
		bySession[pc] = meta
	}

	// Maybe update tracking for stream.
	if !alreadyTracked {
		if byStream, ok := t.presencesByStream[stream]; !ok {
			byStream = make(map[presenceCompact]PresenceMeta)
			byStream[pc] = meta
			t.presencesByStream[stream] = byStream
		} else {
			byStream[pc] = meta
		}
	}

	t.Unlock()
	if !alreadyTracked && !meta.Hidden {
		t.queueEvent(
			[]Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: meta},
			},
			nil,
		)
	}
	return !alreadyTracked
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
	if byStream := t.presencesByStream[stream]; len(byStream) == 1 {
		// This was the only presence for the stream, discard the whole list.
		delete(t.presencesByStream, stream)
	} else {
		// There were other presences for the stream, drop just this one.
		delete(byStream, pc)
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
		if byStream := t.presencesByStream[pc.Stream]; len(byStream) == 1 {
			// This was the only presence for the stream, discard the whole list.
			delete(t.presencesByStream, pc.Stream)
		} else {
			// There were other presences for the stream, drop just this one.
			delete(byStream, pc)
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

func (t *LocalTracker) Update(sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta) bool {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Stream: stream, UserID: userID}
	t.Lock()

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		// Nothing tracked for the session.
		t.Unlock()
		return false
	}
	previousMeta, found := bySession[pc]
	if !found {
		// The session had other presences, but not for this stream.
		t.Unlock()
		return false
	}

	// Update the tracking for session.
	bySession[pc] = meta
	// Update the tracking for stream.
	t.presencesByStream[stream][pc] = meta

	t.Unlock()
	if !meta.Hidden || !previousMeta.Hidden {
		var joins []Presence
		if !meta.Hidden {
			joins = []Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: meta},
			}
		}
		var leaves []Presence
		if !previousMeta.Hidden {
			leaves = []Presence{
				Presence{ID: pc.ID, Stream: stream, UserID: userID, Meta: previousMeta},
			}
		}
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

	byStream, anyTracked := t.presencesByStream[stream]
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
	delete(t.presencesByStream, stream)

	t.Unlock()
}

func (t *LocalTracker) UntrackByStream(stream PresenceStream) {
	// NOTE: Generates no presence notifications as everyone on the stream is going away all at once.
	t.Lock()

	byStream, anyTracked := t.presencesByStream[stream]
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
	delete(t.presencesByStream, stream)

	t.Unlock()
}

func (t *LocalTracker) ListNodesForStream(stream PresenceStream) []string {
	t.RLock()
	_, anyTracked := t.presencesByStream[stream]
	t.RUnlock()
	if anyTracked {
		// For the local tracker having any presences for this stream is enough.
		return []string{t.name}
	}
	return []string{}
}

func (t *LocalTracker) Count() int {
	var count int
	t.RLock()
	// For each stream add together their presence count.
	for _, byStream := range t.presencesByStream {
		count += len(byStream)
	}
	t.RUnlock()
	return count
}

func (t *LocalTracker) CountByStream(stream PresenceStream) int {
	var count int
	t.RLock()
	// If the stream exists use its presence count, otherwise 0.
	byStream, anyTracked := t.presencesByStream[stream]
	if anyTracked {
		count = len(byStream)
	}
	t.RUnlock()
	return count
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

func (t *LocalTracker) ListByStream(stream PresenceStream) []Presence {
	t.RLock()
	byStream, anyTracked := t.presencesByStream[stream]
	if !anyTracked {
		t.RUnlock()
		return []Presence{}
	}
	ps := make([]Presence, 0, len(byStream))
	for pc, meta := range byStream {
		ps = append(ps, Presence{ID: pc.ID, Stream: stream, UserID: pc.UserID, Meta: meta})
	}
	t.RUnlock()
	return ps
}

func (t *LocalTracker) ListLocalByStream(stream PresenceStream) []Presence {
	t.RLock()
	byStream, anyTracked := t.presencesByStream[stream]
	if !anyTracked {
		t.RUnlock()
		return []Presence{}
	}
	ps := make([]Presence, 0, len(byStream))
	for pc, meta := range byStream {
		ps = append(ps, Presence{ID: pc.ID, Stream: stream, UserID: pc.UserID, Meta: meta})
	}
	t.RUnlock()
	return ps
}

func (t *LocalTracker) queueEvent(joins, leaves []Presence) {
	select {
	case t.eventsCh <- &PresenceEvent{joins: joins, leaves: leaves}:
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
	t.logger.Debug("Processing presence event", zap.Int("joins", len(e.joins)), zap.Int("leaves", len(e.leaves)))

	// Group joins/leaves by stream to allow batching.
	// Convert to wire representation at the same time.
	streamJoins := make(map[PresenceStream][]*rtapi.StreamPresence, 0)
	streamLeaves := make(map[PresenceStream][]*rtapi.StreamPresence, 0)
	for _, p := range e.joins {
		pWire := &rtapi.StreamPresence{
			UserId: p.UserID.String(),
			SessionId: p.ID.SessionID.String(),
			Username: p.Meta.Username,
			Persistence: p.Meta.Persistence,
			Status: p.Meta.Status,
		}
		if j, ok := streamJoins[p.Stream]; ok {
			streamJoins[p.Stream] = append(j, pWire)
		} else {
			streamJoins[p.Stream] = []*rtapi.StreamPresence{pWire}
		}
	}
	for _, p := range e.leaves {
		pWire := &rtapi.StreamPresence{
			UserId: p.UserID.String(),
			SessionId: p.ID.SessionID.String(),
			Username: p.Meta.Username,
			Persistence: p.Meta.Persistence,
			Status: p.Meta.Status,
		}
		if j, ok := streamLeaves[p.Stream]; ok {
			streamLeaves[p.Stream] = append(j, pWire)
		} else {
			streamLeaves[p.Stream] = []*rtapi.StreamPresence{pWire}
		}
	}

	// Send joins, together with any leaves for the same topic.
	for stream, joins := range streamJoins {
		leaves, ok := streamLeaves[stream]
		if ok {
			delete(streamLeaves, stream)
		}

		// Construct the wire representation of the stream.
		streamWire := &rtapi.Stream{
			Mode: int32(stream.Mode),
			Label: stream.Label,
		}
		if stream.Subject != uuid.Nil {
			streamWire.Subject = stream.Subject.String()
		}
		if stream.Descriptor != uuid.Nil {
			streamWire.Descriptor_ = stream.Descriptor.String()
		}

		// Construct the wire representation of the event.
		envelope := &rtapi.Envelope{Message: &rtapi.Envelope_StreamPresenceEvent{StreamPresenceEvent: &rtapi.StreamPresenceEvent{
				Stream: streamWire,
				Joins: joins,
				Leaves: leaves,
			},
		}}
		payload, err := t.jsonpbMarshaler.MarshalToString(envelope)
		if err != nil {
			t.logger.Warn("Could not marshal presence event to json", zap.Error(err))
			continue
		}
		payloadByte := []byte(payload)

		// Find the list of event recipients.
		presences := t.ListLocalByStream(stream)
		for _, p := range presences {
			// Deliver event.
			if s := t.registry.Get(p.ID.SessionID); s != nil {
				s.SendBytes(payloadByte)
			} else {
				t.logger.Warn("Could not deliver presence event, no session", zap.String("sid", p.ID.SessionID.String()))
			}
		}
	}

	// If there are leaves without corresponding joins.
	for stream, leaves := range streamLeaves {
		// Construct the wire representation of the stream.
		streamWire := &rtapi.Stream{
			Mode: int32(stream.Mode),
			Label: stream.Label,
		}
		if stream.Subject != uuid.Nil {
			streamWire.Subject = stream.Subject.String()
		}
		if stream.Descriptor != uuid.Nil {
			streamWire.Descriptor_ = stream.Descriptor.String()
		}

		// Construct the wire representation of the event.
		envelope := &rtapi.Envelope{Message: &rtapi.Envelope_StreamPresenceEvent{StreamPresenceEvent: &rtapi.StreamPresenceEvent{
				Stream: streamWire,
				// No joins.
				Leaves: leaves,
			},
		}}
		payload, err := t.jsonpbMarshaler.MarshalToString(envelope)
		if err != nil {
			t.logger.Warn("Could not marshal presence event to json", zap.Error(err))
			continue
		}
		payloadByte := []byte(payload)

		// Find the list of event recipients.
		presences := t.ListLocalByStream(stream)
		for _, p := range presences {
			// Deliver event.
			if s := t.registry.Get(p.ID.SessionID); s != nil {
				s.SendBytes(payloadByte)
			} else {
				t.logger.Warn("Could not deliver presence event, no session", zap.String("sid", p.ID.SessionID.String()))
			}
		}
	}
}
