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
	"fmt"
	"sync"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

type PartyJoinRequest struct {
	Presence     *Presence
	UserPresence *rtapi.UserPresence
}

type PartyLeader struct {
	PresenceID   *PresenceID
	UserPresence *rtapi.UserPresence
}

type PartyHandler struct {
	sync.RWMutex
	logger        *zap.Logger
	partyRegistry PartyRegistry
	matchmaker    Matchmaker
	tracker       Tracker
	streamManager StreamManager
	router        MessageRouter

	ID      uuid.UUID
	Node    string
	IDStr   string
	Open    bool
	MaxSize int
	Stream  PresenceStream

	stopped               bool
	ctx                   context.Context
	ctxCancelFn           context.CancelFunc
	expectedInitialLeader *rtapi.UserPresence
	leader                *PartyLeader
	joinRequests          []*PartyJoinRequest

	members *PartyPresenceList
}

func NewPartyHandler(logger *zap.Logger, partyRegistry PartyRegistry, matchmaker Matchmaker, tracker Tracker, streamManager StreamManager, router MessageRouter, id uuid.UUID, node string, open bool, maxSize int, presence *rtapi.UserPresence) *PartyHandler {
	idStr := fmt.Sprintf("%v.%v", id.String(), node)
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	return &PartyHandler{
		logger:        logger.With(zap.String("party_id", idStr)),
		partyRegistry: partyRegistry,
		matchmaker:    matchmaker,
		tracker:       tracker,
		streamManager: streamManager,
		router:        router,

		ID:      id,
		Node:    node,
		IDStr:   idStr,
		Open:    open,
		MaxSize: maxSize,
		Stream:  PresenceStream{Mode: StreamModeParty, Subject: id, Label: node},

		stopped:               false,
		ctx:                   ctx,
		ctxCancelFn:           ctxCancelFn,
		expectedInitialLeader: presence,
		leader:                nil,
		joinRequests:          make([]*PartyJoinRequest, 0, maxSize),

		members: NewPartyPresenceList(maxSize),
	}
}

func (p *PartyHandler) stop() {
	p.ctxCancelFn()
	p.partyRegistry.Delete(p.ID)
	p.tracker.UntrackByStream(p.Stream)
	_ = p.matchmaker.RemovePartyAll(p.IDStr)
}

func (p *PartyHandler) JoinRequest(presence *Presence) (bool, error) {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return false, runtime.ErrPartyClosed
	}

	// Check if party is full.
	if p.members.Size() >= p.MaxSize {
		p.Unlock()
		return false, runtime.ErrPartyFull
	}
	// Check if party is open, and therefore automatically accepts join requests.
	if p.Open {
		_, err := p.members.Join([]*Presence{presence})
		p.Unlock()
		if err != nil {
			return false, err
		}
		// The party membership has changed, stop any ongoing matchmaking processes.
		_ = p.matchmaker.RemovePartyAll(p.IDStr)
		return true, nil
	}
	// Check if party has room for more join requests.
	if len(p.joinRequests) >= p.MaxSize {
		p.Unlock()
		return false, runtime.ErrPartyJoinRequestsFull
	}
	// Check if party has already received join request from this user.
	for _, joinRequest := range p.joinRequests {
		if joinRequest.Presence.UserID == presence.UserID {
			p.Unlock()
			return false, runtime.ErrPartyJoinRequestDuplicate
		}
	}
	// Check if party already has this user.
	if _, ok := p.members.presenceMap[presence.UserID]; ok {
		p.Unlock()
		return false, runtime.ErrPartyJoinRequestAlreadyMember
	}

	joinRequest := &PartyJoinRequest{
		Presence: presence,
		UserPresence: &rtapi.UserPresence{
			UserId:    presence.GetUserId(),
			SessionId: presence.GetSessionId(),
			Username:  presence.GetUsername(),
		},
	}
	p.joinRequests = append(p.joinRequests, joinRequest)
	leader := p.leader
	p.Unlock()

	// Send message to party leader.
	if leader != nil {
		envelope := &rtapi.Envelope{
			Message: &rtapi.Envelope_PartyJoinRequest{
				PartyJoinRequest: &rtapi.PartyJoinRequest{
					PartyId:   p.IDStr,
					Presences: []*rtapi.UserPresence{joinRequest.UserPresence},
				},
			},
		}
		p.router.SendToPresenceIDs(p.logger, []*PresenceID{leader.PresenceID}, envelope, true)
	}

	return false, nil
}

func (p *PartyHandler) Join(presences []*Presence) {
	if len(presences) == 0 {
		return
	}

	p.Lock()
	if p.stopped {
		p.Unlock()
		return
	}

	// Assign the party leader if this is the first join.
	var initialLeader *Presence
	if p.leader == nil {
		if p.expectedInitialLeader != nil {
			expectedInitialLeader := p.expectedInitialLeader
			p.expectedInitialLeader = nil
			for _, presence := range presences {
				if presence.GetUserId() == expectedInitialLeader.UserId && presence.GetSessionId() == expectedInitialLeader.SessionId {
					// The initial leader is joining the party at creation time.
					initialLeader = presence
					p.leader = &PartyLeader{
						PresenceID: &presence.ID,
						UserPresence: &rtapi.UserPresence{
							UserId:    presence.GetUserId(),
							SessionId: presence.GetSessionId(),
							Username:  presence.GetUsername(),
						},
					}
					break
				}
			}
		}
		if initialLeader == nil {
			// If the expected initial leader was not assigned, select the first joiner. Also
			// covers the party leader leaving at some point during the lifecycle of the party.
			p.leader = &PartyLeader{
				PresenceID: &presences[0].ID,
				UserPresence: &rtapi.UserPresence{
					UserId:    presences[0].GetUserId(),
					SessionId: presences[0].GetSessionId(),
					Username:  presences[0].GetUsername(),
				},
			}
		}
	}

	_, err := p.members.Join(presences)
	if err != nil {
		p.Unlock()
		// Should not happen, this process is just a confirmation.
		p.logger.Error("error in party join", zap.Error(err))
		return
	}

	presenceIDs := make(map[*PresenceID]*rtapi.Envelope, len(presences))
	for _, presence := range presences {
		currentPresence := presence
		memberUserPresence := &rtapi.UserPresence{
			UserId:    presence.GetUserId(),
			SessionId: presence.GetSessionId(),
			Username:  presence.GetUsername(),
		}

		// Prepare message to be sent to the new presences.
		if initialLeader != nil && presence == initialLeader {
			// The party creator has already received this message in the pipeline, do not send it to them again.
			continue
		}
		presenceIDs[&currentPresence.ID] = &rtapi.Envelope{
			Message: &rtapi.Envelope_Party{
				Party: &rtapi.Party{
					PartyId: p.IDStr,
					Open:    p.Open,
					MaxSize: int32(p.MaxSize),
					Self:    memberUserPresence,
					Leader:  p.leader.UserPresence,
					// Presences assigned below.
				},
			},
		}
	}

	members := p.members.List()

	p.Unlock()

	memberUserPresences := make([]*rtapi.UserPresence, 0, len(members))
	for _, member := range members {
		memberUserPresences = append(memberUserPresences, member.UserPresence)
	}

	// Send party info to the new joiners.
	for presenceID, envelope := range presenceIDs {
		envelope.GetParty().Presences = memberUserPresences
		p.router.SendToPresenceIDs(p.logger, []*PresenceID{presenceID}, envelope, true)
	}
}

func (p *PartyHandler) Leave(presences []*Presence) {
	if len(presences) == 0 {
		return
	}

	p.Lock()
	if p.stopped {
		p.Unlock()
		return
	}

	presences, _ = p.members.Leave(presences)
	if len(presences) == 0 {
		p.Unlock()
		return
	}

	// Remove the leader if they've left.
	for _, presence := range presences {
		if p.leader != nil && p.leader.PresenceID.SessionID == presence.ID.SessionID && p.leader.PresenceID.Node == presence.ID.Node {
			// Check is only meaningful if a leader exists. Leader may temporarily be nil here until a new
			// one is assigned below, when multiple presences leave concurrently and one was just the leader.
			p.leader = nil

			oldestPresenceID, oldestUserPresence := p.members.Oldest()
			if oldestPresenceID == nil || oldestUserPresence == nil {
				// Party is now empty, close it.
				p.stopped = true
				p.Unlock()
				p.stop()
				return
			}

			// Leader has left, but there are other party members. Promote the oldest presence as the new party leader.
			p.leader = &PartyLeader{
				PresenceID:   oldestPresenceID,
				UserPresence: oldestUserPresence,
			}

			// Send any new leader promotion message to party members.
			p.router.SendToStream(p.logger, p.Stream, &rtapi.Envelope{
				Message: &rtapi.Envelope_PartyLeader{
					PartyLeader: &rtapi.PartyLeader{
						PartyId:  p.IDStr,
						Presence: p.leader.UserPresence,
					},
				},
			}, true)

			break
		}
	}
	p.Unlock()

	// The party membership has changed, stop any ongoing matchmaking processes.
	_ = p.matchmaker.RemovePartyAll(p.IDStr)
}

func (p *PartyHandler) Promote(sessionID, node string, presence *rtapi.UserPresence) error {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may promote.
	if p.leader == nil || p.leader.PresenceID.SessionID.String() != sessionID || p.leader.PresenceID.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	members := p.members.List()

	var envelope *rtapi.Envelope
	for _, member := range members {
		if member.UserPresence.SessionId == presence.SessionId && member.UserPresence.UserId == presence.UserId && member.UserPresence.Username == presence.Username {
			// Found the party member being promoted.
			p.leader = &PartyLeader{
				PresenceID:   member.PresenceID,
				UserPresence: member.UserPresence,
			}

			envelope = &rtapi.Envelope{
				Message: &rtapi.Envelope_PartyLeader{
					PartyLeader: &rtapi.PartyLeader{
						PartyId:  p.IDStr,
						Presence: p.leader.UserPresence,
					},
				},
			}

			break
		}
	}

	p.Unlock()

	// Attempted to promote a party member that did not exist.
	if envelope == nil {
		return runtime.ErrPartyNotMember
	}

	p.router.SendToStream(p.logger, p.Stream, envelope, true)

	return nil
}

func (p *PartyHandler) Accept(sessionID, node string, presence *rtapi.UserPresence, singleParty bool) error {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may promote.
	if p.leader == nil || p.leader.PresenceID.SessionID.String() != sessionID || p.leader.PresenceID.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	// Check if there's room to accept the new party member.
	if p.members.Size() >= p.MaxSize {
		p.Unlock()
		return runtime.ErrPartyFull
	}

	// Check if the presence has actually requested to join.
	var idx int
	var joinRequestPresence *Presence
	for i, joinRequest := range p.joinRequests {
		if joinRequest.UserPresence.SessionId == presence.SessionId && joinRequest.UserPresence.UserId == presence.UserId && joinRequest.UserPresence.Username == presence.Username {
			idx = i
			joinRequestPresence = joinRequest.Presence
			break
		}
	}
	if joinRequestPresence == nil {
		p.Unlock()
		return runtime.ErrPartyNotRequest
	}

	if err := p.members.Reserve(joinRequestPresence); err != nil {
		p.Unlock()
		return err
	}

	copy(p.joinRequests[idx:], p.joinRequests[idx+1:])
	p.joinRequests[len(p.joinRequests)-1] = nil
	p.joinRequests = p.joinRequests[:len(p.joinRequests)-1]

	p.Unlock()

	// Add the presence to the party stream, which will trigger the Join() hook above.
	success, _, err := p.streamManager.UserJoin(p.Stream, joinRequestPresence.UserID, joinRequestPresence.ID.SessionID, false, false, "")
	if err != nil || !success {
		p.members.Release(joinRequestPresence)
		return runtime.ErrPartyAcceptRequest
	}
	if _, err = p.members.Join([]*Presence{joinRequestPresence}); err != nil {
		return err
	}

	if singleParty {
		// Kick the user from any other parties they may be part of.
		p.tracker.UntrackLocalByModes(joinRequestPresence.ID.SessionID, partyStreamMode, p.Stream)
	}

	// The party membership has changed, stop any ongoing matchmaking processes.
	_ = p.matchmaker.RemovePartyAll(p.IDStr)

	return nil
}

func (p *PartyHandler) Remove(sessionID, node string, presence *rtapi.UserPresence) error {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may remove.
	if p.leader == nil || p.leader.PresenceID.SessionID.String() != sessionID || p.leader.PresenceID.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	// Check if the leader is attempting to remove its own presence.
	if p.leader.UserPresence.SessionId == presence.SessionId && p.leader.UserPresence.UserId == presence.UserId && p.leader.UserPresence.Username == presence.Username {
		p.Unlock()
		return runtime.ErrPartyRemoveSelf
	}

	presences := p.members.List()

	// Remove the party member, if found.
	var removeMember *PartyPresenceListItem
	for _, item := range presences {
		if item.UserPresence.SessionId == presence.SessionId && item.UserPresence.UserId == presence.UserId && item.UserPresence.Username == presence.Username {
			removeMember = item
			break
		}
	}
	if removeMember == nil {
		// Wasn't a party member, check if it's actually a rejected join request.
		for i, joinRequest := range p.joinRequests {
			if joinRequest.UserPresence.SessionId == presence.SessionId && joinRequest.UserPresence.UserId == presence.UserId && joinRequest.UserPresence.Username == presence.Username {
				// Rejected join requests do not require stream removal, they were never part of the stream to begin with.
				copy(p.joinRequests[i:], p.joinRequests[i+1:])
				p.joinRequests[len(p.joinRequests)-1] = nil
				p.joinRequests = p.joinRequests[:len(p.joinRequests)-1]

				p.Unlock()
				return nil
			}
		}
	}

	p.Unlock()

	if removeMember == nil {
		return runtime.ErrPartyNotMember
	}

	// The party membership has changed, stop any ongoing matchmaking processes.
	_ = p.matchmaker.RemovePartyAll(p.IDStr)

	p.members.Leave([]*Presence{removeMember.Presence})

	// Remove the presence from the party stream, which will trigger the Leave() hook above.
	err := p.streamManager.UserLeave(p.Stream, removeMember.Presence.UserID, removeMember.PresenceID.SessionID)
	if err != nil {
		return runtime.ErrPartyRemove
	}

	p.router.SendToPresenceIDs(p.logger, []*PresenceID{removeMember.PresenceID}, &rtapi.Envelope{Message: &rtapi.Envelope_PartyClose{PartyClose: &rtapi.PartyClose{
		PartyId: p.IDStr,
	}}}, true)

	return nil
}

func (p *PartyHandler) Close(sessionID, node string) error {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may close the party.
	if p.leader == nil || p.leader.UserPresence.SessionId != sessionID || p.leader.PresenceID.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	p.stopped = true
	p.Unlock()

	p.router.SendToStream(p.logger, p.Stream, &rtapi.Envelope{Message: &rtapi.Envelope_PartyClose{PartyClose: &rtapi.PartyClose{
		PartyId: p.IDStr,
	}}}, true)

	p.stop()
	return nil
}

func (p *PartyHandler) JoinRequestList(sessionID, node string) ([]*rtapi.UserPresence, error) {
	p.RLock()
	if p.stopped {
		p.RUnlock()
		return nil, runtime.ErrPartyClosed
	}

	// Only the party leader may request a list of pending join requests.
	if p.leader == nil || p.leader.UserPresence.SessionId != sessionID || p.leader.PresenceID.Node != node {
		p.RUnlock()
		return nil, runtime.ErrPartyNotLeader
	}

	joinRequestUserPresences := make([]*rtapi.UserPresence, 0, len(p.joinRequests))
	for _, joinRequest := range p.joinRequests {
		joinRequestUserPresences = append(joinRequestUserPresences, joinRequest.UserPresence)
	}

	p.RUnlock()

	return joinRequestUserPresences, nil
}

func (p *PartyHandler) MatchmakerAdd(sessionID, node, query string, minCount, maxCount, countMultiple int, stringProperties map[string]string, numericProperties map[string]float64) (string, []*PresenceID, error) {
	p.RLock()
	if p.stopped {
		p.RUnlock()
		return "", nil, runtime.ErrPartyClosed
	}

	// Only the party leader may start a matchmaking process.
	if p.leader == nil || p.leader.UserPresence.SessionId != sessionID || p.leader.PresenceID.Node != node {
		p.RUnlock()
		return "", nil, runtime.ErrPartyNotLeader
	}

	members := p.members.List()

	// Prepare the list of presences that will go into the matchmaker as part of the party.
	presences := make([]*MatchmakerPresence, 0, len(members))
	memberPresenceIDs := make([]*PresenceID, 0, len(members)-1)
	for _, member := range members {
		memberUserPresence := member.UserPresence
		presences = append(presences, &MatchmakerPresence{
			UserId:    memberUserPresence.UserId,
			SessionId: memberUserPresence.SessionId,
			Username:  memberUserPresence.Username,
			Node:      member.PresenceID.Node,
			SessionID: member.PresenceID.SessionID,
		})
		if member.PresenceID.SessionID == p.leader.PresenceID.SessionID && member.PresenceID.Node == p.leader.PresenceID.Node {
			continue
		}
		memberPresenceIDs = append(memberPresenceIDs, member.PresenceID)
	}

	p.RUnlock()

	ticket, _, err := p.matchmaker.Add(p.ctx, presences, "", p.IDStr, query, minCount, maxCount, countMultiple, stringProperties, numericProperties)
	if err != nil {
		return "", nil, err
	}
	return ticket, memberPresenceIDs, nil
}

func (p *PartyHandler) MatchmakerRemove(sessionID, node, ticket string) error {
	p.RLock()
	if p.stopped {
		p.RUnlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may stop a matchmaking process.
	if p.leader == nil || p.leader.UserPresence.SessionId != sessionID || p.leader.PresenceID.Node != node {
		p.RUnlock()
		return runtime.ErrPartyNotLeader
	}

	p.RUnlock()

	return p.matchmaker.RemoveParty(p.IDStr, ticket)
}

func (p *PartyHandler) DataSend(sessionID, node string, opCode int64, data []byte) error {
	p.RLock()
	if p.stopped {
		p.RUnlock()
		return runtime.ErrPartyClosed
	}

	members := p.members.List()

	// Check if the sender is a party member.
	var sender *rtapi.UserPresence
	for _, member := range members {
		if member.UserPresence.SessionId == sessionID && member.PresenceID.Node == node {
			sender = member.UserPresence
			break
		}
	}
	var recipients []*PresenceID
	if sender != nil && len(members) > 0 {
		recipients = make([]*PresenceID, 0, len(members)-1)
		for _, member := range members {
			if member.UserPresence.SessionId == sessionID && member.PresenceID.Node == node {
				continue
			}
			recipients = append(recipients, member.PresenceID)
		}
	}

	p.RUnlock()

	if sender == nil {
		return runtime.ErrPartyNotMember
	}
	if len(recipients) == 0 {
		return nil
	}

	// Sender was a party member, construct and send the correct envelope.
	envelope := &rtapi.Envelope{
		Message: &rtapi.Envelope_PartyData{
			PartyData: &rtapi.PartyData{
				PartyId:  p.IDStr,
				Presence: sender,
				OpCode:   opCode,
				Data:     data,
			},
		},
	}
	p.router.SendToPresenceIDs(p.logger, recipients, envelope, true)

	return nil
}
