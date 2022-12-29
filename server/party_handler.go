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

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

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

	stopped                  bool
	ctx                      context.Context
	ctxCancelFn              context.CancelFunc
	expectedInitialLeader    *rtapi.UserPresence
	leader                   *PresenceID
	leaderUserPresence       *rtapi.UserPresence
	members                  []*PresenceID
	memberUserPresences      []*rtapi.UserPresence
	joinsInProgress          []*PresenceID
	joinRequests             []*Presence
	joinRequestUserPresences []*rtapi.UserPresence
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

		stopped:                  false,
		ctx:                      ctx,
		ctxCancelFn:              ctxCancelFn,
		expectedInitialLeader:    presence,
		leader:                   nil,
		leaderUserPresence:       nil,
		members:                  make([]*PresenceID, 0, maxSize),
		memberUserPresences:      make([]*rtapi.UserPresence, 0, maxSize),
		joinsInProgress:          make([]*PresenceID, 0, maxSize),
		joinRequests:             make([]*Presence, 0, maxSize),
		joinRequestUserPresences: make([]*rtapi.UserPresence, 0, maxSize),
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
	if len(p.members)+len(p.joinsInProgress) >= p.MaxSize {
		p.Unlock()
		return false, runtime.ErrPartyFull
	}
	// Check if party is open, and therefore automatically accepts join requests.
	if p.Open {
		p.joinsInProgress = append(p.joinsInProgress, &presence.ID)
		p.Unlock()
		return true, nil
	}
	// Check if party has room for more join requests.
	if len(p.joinRequests) >= p.MaxSize {
		p.Unlock()
		return false, runtime.ErrPartyJoinRequestsFull
	}

	p.joinRequests = append(p.joinRequests, presence)
	joinRequestUserPresence := &rtapi.UserPresence{
		UserId:    presence.GetUserId(),
		SessionId: presence.GetSessionId(),
		Username:  presence.GetUsername(),
	}
	p.joinRequestUserPresences = append(p.joinRequestUserPresences, joinRequestUserPresence)
	leader := p.leader
	p.Unlock()

	// Send message to party leader.
	if leader != nil {
		envelope := &rtapi.Envelope{
			Message: &rtapi.Envelope_PartyJoinRequest{
				PartyJoinRequest: &rtapi.PartyJoinRequest{
					PartyId:   p.IDStr,
					Presences: []*rtapi.UserPresence{joinRequestUserPresence},
				},
			},
		}
		p.router.SendToPresenceIDs(p.logger, []*PresenceID{leader}, envelope, true)
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
					p.leader = &presence.ID
					p.leaderUserPresence = &rtapi.UserPresence{
						UserId:    presence.GetUserId(),
						SessionId: presence.GetSessionId(),
						Username:  presence.GetUsername(),
					}
					break
				}
			}
		}
		if initialLeader == nil {
			// If the expected initial leader was not assigned, select the first joiner. Also
			// covers the party leader leaving at some point during the lifecycle of the party.
			p.leader = &presences[0].ID
			p.leaderUserPresence = &rtapi.UserPresence{
				UserId:    presences[0].GetUserId(),
				SessionId: presences[0].GetSessionId(),
				Username:  presences[0].GetUsername(),
			}
		}
	}

	memberUserPresences := make([]*rtapi.UserPresence, len(p.memberUserPresences), len(p.memberUserPresences)+len(presences))
	copy(memberUserPresences, p.memberUserPresences)

	presenceIDs := make(map[*PresenceID]*rtapi.Envelope, len(presences))
	for _, presence := range presences {
		currentPresence := presence
		memberUserPresence := &rtapi.UserPresence{
			UserId:    presence.GetUserId(),
			SessionId: presence.GetSessionId(),
			Username:  presence.GetUsername(),
		}
		p.members = append(p.members, &currentPresence.ID)
		p.memberUserPresences = append(p.memberUserPresences, memberUserPresence)
		memberUserPresences = append(memberUserPresences, memberUserPresence)

		for i := 0; i < len(p.joinsInProgress); i++ {
			if p.joinsInProgress[i].SessionID == presence.ID.SessionID && p.joinsInProgress[i].Node == presence.ID.Node {
				copy(p.joinsInProgress[i:], p.joinsInProgress[i+1:])
				p.joinsInProgress[len(p.joinsInProgress)-1] = nil
				p.joinsInProgress = p.joinsInProgress[:len(p.joinsInProgress)-1]
				break
			}
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
					Leader:  p.leaderUserPresence,
					// Presences assigned below.
				},
			},
		}
	}

	p.Unlock()

	// Send party info to the new joiners.
	for presenceID, envelope := range presenceIDs {
		envelope.GetParty().Presences = memberUserPresences
		p.router.SendToPresenceIDs(p.logger, []*PresenceID{presenceID}, envelope, true)
	}
	// The party membership has changed, stop any ongoing matchmaking processes.
	_ = p.matchmaker.RemovePartyAll(p.IDStr)
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

	// Drop each presence from the party list, and remove the leader if they've left.
	for _, presence := range presences {
		if p.leader != nil && p.leader.SessionID == presence.ID.SessionID && p.leader.Node == presence.ID.Node {
			// Check is only meaningful if a leader exists. Leader may temporarily be nil here until a new
			// one is assigned below, when multiple presences leave concurrently and one was just the leader.
			p.leader = nil
			p.leaderUserPresence = nil
		}
		for i := 0; i < len(p.members); i++ {
			if p.members[i].SessionID == presence.ID.SessionID && p.members[i].Node == presence.ID.Node {
				copy(p.members[i:], p.members[i+1:])
				p.members[len(p.members)-1] = nil
				p.members = p.members[:len(p.members)-1]

				copy(p.memberUserPresences[i:], p.memberUserPresences[i+1:])
				p.memberUserPresences[len(p.memberUserPresences)-1] = nil
				p.memberUserPresences = p.memberUserPresences[:len(p.memberUserPresences)-1]

				break
			}
		}
	}

	// If the leader has left try to assign a new one from the remaining presences.
	var envelope *rtapi.Envelope
	if p.leader == nil {
		// Party is now empty, close it.
		if len(p.members) == 0 {
			p.stopped = true
			p.Unlock()
			p.stop()
			return
		}

		// Leader has left, but there are other party members. Promote the oldest presence as the new party leader.
		p.leader = p.members[0]
		p.leaderUserPresence = p.memberUserPresences[0]

		envelope = &rtapi.Envelope{
			Message: &rtapi.Envelope_PartyLeader{
				PartyLeader: &rtapi.PartyLeader{
					PartyId:  p.IDStr,
					Presence: p.leaderUserPresence,
				},
			},
		}
	}
	p.Unlock()

	// Send any new leader promotion message to party members.
	if envelope != nil {
		p.router.SendToStream(p.logger, p.Stream, envelope, true)
	}
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
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	var envelope *rtapi.Envelope
	for i, memberUserPresence := range p.memberUserPresences {
		if memberUserPresence.SessionId == presence.SessionId && memberUserPresence.UserId == presence.UserId && memberUserPresence.Username == presence.Username {
			// Found the party member being promoted.
			p.leader = p.members[i]
			p.leaderUserPresence = memberUserPresence

			envelope = &rtapi.Envelope{
				Message: &rtapi.Envelope_PartyLeader{
					PartyLeader: &rtapi.PartyLeader{
						PartyId:  p.IDStr,
						Presence: p.leaderUserPresence,
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

func (p *PartyHandler) Accept(sessionID, node string, presence *rtapi.UserPresence) error {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may promote.
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	// Check if there's room to accept the new party member.
	if len(p.members)+len(p.joinsInProgress) >= p.MaxSize {
		p.Unlock()
		return runtime.ErrPartyFull
	}

	// Check if the presence has actually requested to join.
	var joinRequestPresence *Presence
	for i, joinRequest := range p.joinRequests {
		if joinRequest.ID.SessionID.String() == presence.SessionId && joinRequest.UserID.String() == presence.UserId && joinRequest.GetUsername() == presence.Username {
			joinRequestPresence = joinRequest

			copy(p.joinRequests[i:], p.joinRequests[i+1:])
			p.joinRequests[len(p.joinRequests)-1] = nil
			p.joinRequests = p.joinRequests[:len(p.joinRequests)-1]

			copy(p.joinRequestUserPresences[i:], p.joinRequestUserPresences[i+1:])
			p.joinRequestUserPresences[len(p.joinRequestUserPresences)-1] = nil
			p.joinRequestUserPresences = p.joinRequestUserPresences[:len(p.joinRequestUserPresences)-1]

			break
		}
	}
	if joinRequestPresence == nil {
		p.Unlock()
		return runtime.ErrPartyNotRequest
	}

	p.joinsInProgress = append(p.joinsInProgress, &joinRequestPresence.ID)
	p.Unlock()

	// Add the presence to the party stream, which will trigger the Join() hook above.
	success, _, err := p.streamManager.UserJoin(p.Stream, joinRequestPresence.UserID, joinRequestPresence.ID.SessionID, false, false, "")
	if err != nil || !success {
		p.Lock()
		for i := 0; i < len(p.joinsInProgress); i++ {
			if p.joinsInProgress[i].SessionID == joinRequestPresence.ID.SessionID && p.joinsInProgress[i].Node == joinRequestPresence.ID.Node {
				copy(p.joinsInProgress[i:], p.joinsInProgress[i+1:])
				p.joinsInProgress[len(p.joinsInProgress)-1] = nil
				p.joinsInProgress = p.joinsInProgress[:len(p.joinsInProgress)-1]
				break
			}
		}
		p.Unlock()
		return runtime.ErrPartyAcceptRequest
	}

	return nil
}

func (p *PartyHandler) Remove(sessionID, node string, presence *rtapi.UserPresence) error {
	p.Lock()
	if p.stopped {
		p.Unlock()
		return runtime.ErrPartyClosed
	}

	// Only the party leader may remove.
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
		p.Unlock()
		return runtime.ErrPartyNotLeader
	}

	// Check if the leader is attempting to remove its own presence.
	if p.leader.SessionID.String() == presence.SessionId && p.leaderUserPresence.GetUserId() == presence.UserId && p.leaderUserPresence.GetUsername() == presence.Username {
		p.Unlock()
		return runtime.ErrPartyRemoveSelf
	}

	// Remove the party member, if found.
	var removeMember *rtapi.UserPresence
	var removePresenceID *PresenceID
	for i, memberUserPresence := range p.memberUserPresences {
		if memberUserPresence.SessionId == presence.SessionId && memberUserPresence.UserId == presence.UserId && memberUserPresence.Username == presence.Username {
			removeMember = memberUserPresence
			removePresenceID = p.members[i]

			copy(p.memberUserPresences[i:], p.memberUserPresences[i+1:])
			p.memberUserPresences[len(p.memberUserPresences)-1] = nil
			p.memberUserPresences = p.memberUserPresences[:len(p.memberUserPresences)-1]

			copy(p.members[i:], p.members[i+1:])
			p.members[len(p.members)-1] = nil
			p.members = p.members[:len(p.members)-1]

			break
		}
	}
	if removeMember == nil {
		// Wasn't a party member, check if it's actually a rejected join request.
		for i, joinRequest := range p.joinRequests {
			if joinRequest.ID.SessionID.String() == presence.SessionId && joinRequest.UserID.String() == presence.UserId && joinRequest.GetUsername() == presence.Username {
				// Rejected join requests do not require stream removal, they were never part of the stream to begin with.
				copy(p.joinRequests[i:], p.joinRequests[i+1:])
				p.joinRequests[len(p.joinRequests)-1] = nil
				p.joinRequests = p.joinRequests[:len(p.joinRequests)-1]

				copy(p.joinRequestUserPresences[i:], p.joinRequestUserPresences[i+1:])
				p.joinRequestUserPresences[len(p.joinRequestUserPresences)-1] = nil
				p.joinRequestUserPresences = p.joinRequestUserPresences[:len(p.joinRequestUserPresences)-1]

				p.Unlock()
				return nil
			}
		}
	}

	p.Unlock()

	if removeMember == nil {
		return runtime.ErrPartyNotMember
	}

	// Remove the presence from the party stream, which will trigger the Leave() hook above.
	err := p.streamManager.UserLeave(p.Stream, uuid.FromStringOrNil(removeMember.UserId), uuid.FromStringOrNil(removeMember.SessionId))
	if err != nil {
		return runtime.ErrPartyRemove
	}

	p.router.SendToPresenceIDs(p.logger, []*PresenceID{removePresenceID}, &rtapi.Envelope{Message: &rtapi.Envelope_PartyClose{PartyClose: &rtapi.PartyClose{
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
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
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
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
		p.RUnlock()
		return nil, runtime.ErrPartyNotLeader
	}

	joinRequestUserPresences := make([]*rtapi.UserPresence, len(p.joinRequestUserPresences))
	copy(joinRequestUserPresences, p.joinRequestUserPresences)

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
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
		p.RUnlock()
		return "", nil, runtime.ErrPartyNotLeader
	}

	// Prepare the list of presences that will go into the matchmaker as part of the party.
	presences := make([]*MatchmakerPresence, 0, len(p.members))
	memberPresenceIDs := make([]*PresenceID, 0, len(p.members)-1)
	for i, member := range p.members {
		memberUserPresence := p.memberUserPresences[i]
		presences = append(presences, &MatchmakerPresence{
			UserId:    memberUserPresence.UserId,
			SessionId: memberUserPresence.SessionId,
			Username:  memberUserPresence.Username,
			Node:      member.Node,
			SessionID: member.SessionID,
		})
		if member.SessionID == p.leader.SessionID && member.Node == p.leader.Node {
			continue
		}
		memberPresenceIDs = append(memberPresenceIDs, member)
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
	if p.leader == nil || p.leader.SessionID.String() != sessionID || p.leader.Node != node {
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

	// Check if the sender is a party member.
	var sender *rtapi.UserPresence
	for i, member := range p.members {
		if member.SessionID.String() == sessionID && member.Node == node {
			sender = p.memberUserPresences[i]
			break
		}
	}
	var recipients []*PresenceID
	if sender != nil && len(p.members) > 0 {
		recipients = make([]*PresenceID, 0, len(p.members)-1)
		for _, member := range p.members {
			if member.SessionID.String() == sessionID && member.Node == node {
				continue
			}
			recipients = append(recipients, member)
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
