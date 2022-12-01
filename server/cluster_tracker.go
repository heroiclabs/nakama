package server

import (
	"context"
	syncAtomic "sync/atomic"

	ncapi "github.com/doublemo/nakama-cluster/api"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

func (s *ClusterServer) NotifyTrack(presences ...*Presence) error {
	track := ncapi.Track{Presences: make([]*ncapi.Presence, len(presences))}

	for i, presence := range presences {
		track.Presences[i] = &ncapi.Presence{
			Id: &ncapi.PresenceID{
				Node:      presence.GetNodeId(),
				SessionID: presence.GetSessionId(),
			},
			Stream: &ncapi.PresenceStream{
				Mode:       int32(presence.Stream.Mode),
				Subject:    presence.Stream.Subject.String(),
				Subcontext: presence.Stream.Subcontext.String(),
				Label:      presence.Stream.Label,
			},

			UserID: presence.GetUserId(),
			Meta: &ncapi.PresenceMeta{
				SessionFormat: int32(presence.Meta.Format),
				Hidden:        presence.Meta.Hidden,
				Persistence:   presence.Meta.Persistence,
				Username:      presence.Meta.Username,
				Status:        presence.Meta.Status,
				Reason:        int32(presence.Meta.Reason),
			},
		}
	}

	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_Track{Track: &track}})
}

func (s *ClusterServer) NotifyUntrack(presences ...*Presence) error {
	untrack := ncapi.Untrack{Presences: make([]*ncapi.Presence, len(presences))}

	for i, presence := range presences {
		untrack.Presences[i] = &ncapi.Presence{
			Id: &ncapi.PresenceID{
				Node:      presence.GetNodeId(),
				SessionID: presence.GetSessionId(),
			},
			Stream: &ncapi.PresenceStream{
				Mode:       int32(presence.Stream.Mode),
				Subject:    presence.Stream.Subject.String(),
				Subcontext: presence.Stream.Subcontext.String(),
				Label:      presence.Stream.Label,
			},

			UserID: presence.GetUserId(),
			Meta: &ncapi.PresenceMeta{
				SessionFormat: int32(presence.Meta.Format),
				Hidden:        presence.Meta.Hidden,
				Persistence:   presence.Meta.Persistence,
				Username:      presence.Meta.Username,
				Status:        presence.Meta.Status,
				Reason:        int32(presence.Meta.Reason),
			},
		}
	}

	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_Untrack{Untrack: &untrack}})
}

func (s *ClusterServer) NotifyUntrackAll(sessionID uuid.UUID, reason runtime.PresenceReason) error {
	untrackAll := ncapi.UntrackAll{SessionID: sessionID.String(), Reason: int32(reason)}

	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_UntrackAll{UntrackAll: &untrackAll}})
}

func (s *ClusterServer) NotifyUntrackByMode(sessionID uuid.UUID, modes map[uint8]struct{}, skipStream PresenceStream) error {
	untrack := ncapi.UntrackByMode{
		SessionID: sessionID.String(),
		Modes:     make([]int32, len(modes)),
		SkipStream: &ncapi.PresenceStream{
			Mode:       int32(skipStream.Mode),
			Subject:    skipStream.Subject.String(),
			Subcontext: skipStream.Subcontext.String(),
			Label:      skipStream.Label,
		},
	}

	i := 0
	for m := range modes {
		untrack.Modes[i] = int32(m)
		i++
	}

	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_UntrackByMode{UntrackByMode: &untrack}})
}

func (s *ClusterServer) NotifyUntrackByStream(streams ...PresenceStream) error {
	untrack := ncapi.UntrackByStream{Streams: make([]*ncapi.PresenceStream, len(streams))}

	for i, stream := range streams {
		untrack.Streams[i] = &ncapi.PresenceStream{
			Mode:       int32(stream.Mode),
			Subject:    stream.Subject.String(),
			Subcontext: stream.Subcontext.String(),
			Label:      stream.Label,
		}
	}

	return s.Broadcast(&ncapi.Envelope{Payload: &ncapi.Envelope_UntrackByStream{UntrackByStream: &untrack}})
}

func (s *ClusterServer) onTrack(node string, msg *ncapi.Envelope) {
	s.logger.Debug("onTrack", zap.String("node", node))
	message := msg.GetTrack()
	for _, presence := range message.Presences {
		if presence.Meta.Reason == int32(runtime.PresenceReasonUpdate) {
			s.tracker.UpdateFromNode(s.ctx,
				presence.Id.Node,
				uuid.FromStringOrNil(presence.Id.SessionID),
				PresenceStream{
					Mode:       uint8(presence.Stream.Mode),
					Subject:    uuid.FromStringOrNil(presence.Stream.Subject),
					Subcontext: uuid.FromStringOrNil(presence.Stream.Subcontext),
					Label:      presence.Stream.Label,
				},
				uuid.FromStringOrNil(presence.UserID),
				PresenceMeta{
					Format:      SessionFormat(presence.Meta.SessionFormat),
					Hidden:      presence.Meta.Hidden,
					Persistence: presence.Meta.Persistence,
					Username:    presence.Meta.Username,
					Status:      presence.Meta.Status,
					Reason:      uint32(presence.Meta.Reason),
				}, true)
			continue
		}

		s.tracker.TrackFromNode(s.ctx,
			presence.Id.Node,
			uuid.FromStringOrNil(presence.Id.SessionID),
			PresenceStream{
				Mode:       uint8(presence.Stream.Mode),
				Subject:    uuid.FromStringOrNil(presence.Stream.Subject),
				Subcontext: uuid.FromStringOrNil(presence.Stream.Subcontext),
				Label:      presence.Stream.Label,
			},
			uuid.FromStringOrNil(presence.UserID),
			PresenceMeta{
				Format:      SessionFormat(presence.Meta.SessionFormat),
				Hidden:      presence.Meta.Hidden,
				Persistence: presence.Meta.Persistence,
				Username:    presence.Meta.Username,
				Status:      presence.Meta.Status,
				Reason:      uint32(presence.Meta.Reason),
			}, true)
	}
}

func (s *ClusterServer) onUntrack(node string, msg *ncapi.Envelope) {
	s.logger.Debug("onUntrack", zap.String("node", node))
	message := msg.GetUntrack()
	for _, presence := range message.Presences {
		s.tracker.UntrackFromNode(presence.Id.Node, uuid.FromStringOrNil(presence.Id.SessionID),
			PresenceStream{
				Mode:       uint8(presence.Stream.Mode),
				Subject:    uuid.FromStringOrNil(presence.Stream.Subject),
				Subcontext: uuid.FromStringOrNil(presence.Stream.Subcontext),
				Label:      presence.Stream.Label,
			},
			uuid.FromStringOrNil(presence.UserID))
	}
}

func (s *ClusterServer) onUntrackAll(node string, msg *ncapi.Envelope) {
	s.logger.Debug("onUntrackAll", zap.String("node", node))
	message := msg.GetUntrackAll()
	s.tracker.UntrackAllFromNode(node, uuid.FromStringOrNil(message.SessionID), runtime.PresenceReason(message.Reason))
}

func (s *ClusterServer) onUntrackByMode(node string, msg *ncapi.Envelope) {
	s.logger.Debug("onUntrackByMode", zap.String("node", node))
	message := msg.GetUntrackByMode()
	modes := make(map[uint8]struct{})
	for _, mode := range message.Modes {
		modes[uint8(mode)] = struct{}{}
	}

	s.tracker.UntrackLocalByModesFromNode(node, uuid.FromStringOrNil(message.SessionID), modes, PresenceStream{
		Mode:       uint8(message.SkipStream.Mode),
		Subject:    uuid.FromStringOrNil(message.SkipStream.Subject),
		Subcontext: uuid.FromStringOrNil(message.SkipStream.Subcontext),
		Label:      message.SkipStream.Label,
	})
}

func (s *ClusterServer) onUntrackByStream(node string, msg *ncapi.Envelope) {
	s.logger.Debug("onUntrackByStream", zap.String("node", node))
	message := msg.GetUntrackByStream()
	for _, stream := range message.Streams {
		s.tracker.UntrackByStreamFromNode(node, PresenceStream{
			Mode:       uint8(stream.Mode),
			Subject:    uuid.FromStringOrNil(stream.Subject),
			Subcontext: uuid.FromStringOrNil(stream.Subcontext),
			Label:      stream.Label,
		})
	}
}

func (t *LocalTracker) TrackFromNode(ctx context.Context, node string, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta, allowIfFirstForSession bool) (bool, bool) {
	syncAtomic.StoreUint32(&meta.Reason, uint32(runtime.PresenceReasonJoin))
	pc := presenceCompact{ID: PresenceID{Node: node, SessionID: sessionID}, Stream: stream, UserID: userID}
	p := &Presence{ID: PresenceID{Node: node, SessionID: sessionID}, Stream: stream, UserID: userID, Meta: meta}
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
		if !allowIfFirstForSession {
			// If it's the first presence for this session, only allow it if explicitly permitted to.
			t.Unlock()
			return false, false
		}
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

func (t *LocalTracker) UntrackFromNode(node string, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID) {
	pc := presenceCompact{ID: PresenceID{Node: node, SessionID: sessionID}, Stream: stream, UserID: userID}
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

func (t *LocalTracker) UpdateFromNode(ctx context.Context, node string, sessionID uuid.UUID, stream PresenceStream, userID uuid.UUID, meta PresenceMeta, allowIfFirstForSession bool) bool {
	syncAtomic.StoreUint32(&meta.Reason, uint32(runtime.PresenceReasonUpdate))
	pc := presenceCompact{ID: PresenceID{Node: node, SessionID: sessionID}, Stream: stream, UserID: userID}
	p := &Presence{ID: PresenceID{Node: node, SessionID: sessionID}, Stream: stream, UserID: userID, Meta: meta}
	t.Lock()

	select {
	case <-ctx.Done():
		t.Unlock()
		return false
	default:
	}

	bySession, anyTracked := t.presencesBySession[sessionID]
	if !anyTracked {
		if !allowIfFirstForSession {
			// Nothing tracked for the session and not allowed to track as first presence.
			t.Unlock()
			return false
		}

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

func (t *LocalTracker) UntrackAllFromNode(node string, sessionID uuid.UUID, reason runtime.PresenceReason) {
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

func (t *LocalTracker) UntrackByStreamFromNode(node string, stream PresenceStream) {
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

func (t *LocalTracker) UntrackLocalByModesFromNode(node string, sessionID uuid.UUID, modes map[uint8]struct{}, skipStream PresenceStream) {
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
