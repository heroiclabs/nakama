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
	"strings"

	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type matchDataFilter struct {
	userID    uuid.UUID
	sessionID uuid.UUID
}

func (p *Pipeline) matchCreate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	matchID := uuid.Must(uuid.NewV4())

	username := session.Username()

	if success, _ := p.tracker.Track(session.ID(), PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}, session.UserID(), PresenceMeta{
		Username: username,
		Format:   session.Format(),
	}, false); !success {
		// Presence creation was rejected due to `allowIfFirstForSession` flag, session is gone so no need to reply.
		return
	}

	self := &rtapi.UserPresence{
		UserId:    session.UserID().String(),
		SessionId: session.ID().String(),
		Username:  username,
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Match{Match: &rtapi.Match{
		MatchId:       fmt.Sprintf("%v:", matchID.String()),
		Authoritative: false,
		// No label.
		Size:      1,
		Presences: []*rtapi.UserPresence{self},
		Self:      self,
	}}})
}

func (p *Pipeline) matchJoin(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	m := envelope.GetMatchJoin()
	var err error
	var matchID uuid.UUID
	var node string
	var matchIDString string

	switch m.Id.(type) {
	case *rtapi.MatchJoin_MatchId:
		matchIDString = m.GetMatchId()
		// Validate the match ID.
		matchIDComponents := strings.SplitN(matchIDString, ":", 2)
		if len(matchIDComponents) != 2 {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match ID",
			}}})
			return
		}
		matchID, err = uuid.FromString(matchIDComponents[0])
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match ID",
			}}})
			return
		}
		node = matchIDComponents[1]
	case *rtapi.MatchJoin_Token:
		// TODO Restore token-based join behaviour when matchmaking is available.
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Token-based match join not available",
		}}})
		return
	case nil:
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "No match ID or token found",
		}}})
		return
	default:
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Unrecognized match ID or token",
		}}})
		return
	}

	// Decide if it's an authoritative or relayed match.
	mode := StreamModeMatchRelayed
	if node != "" {
		mode = StreamModeMatchAuthoritative
	}

	stream := PresenceStream{Mode: mode, Subject: matchID, Label: node}

	if mode == StreamModeMatchRelayed && !p.tracker.StreamExists(stream) {
		// Relayed matches must 'exist' by already having some members.
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_MATCH_NOT_FOUND),
			Message: "Match not found",
		}}})
		return
	}

	var label *wrappers.StringValue
	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), stream, session.UserID())
	if meta == nil {
		username := session.Username()
		found := true
		allow := true
		var l string
		// The user is not yet part of the match, attempt to join.
		if mode == StreamModeMatchAuthoritative {
			// If it's an authoritative match, ask the match handler if it will allow the join.
			found, allow, l = p.matchRegistry.Join(matchID, node, session.UserID(), session.ID(), username, p.node)
		}
		if !found {
			// Match did not exist.
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_MATCH_NOT_FOUND),
				Message: "Match join rejected",
			}}})
			return
		}
		if !allow {
			// Match exists, but rejected the join.
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_MATCH_JOIN_REJECTED),
				Message: "Match join rejected",
			}}})
			return
		}
		if mode == StreamModeMatchAuthoritative {
			// If we've reached here, it was an accepted authoritative join.
			label = &wrappers.StringValue{Value: l}
		}
		m := PresenceMeta{
			Username: username,
			Format:   session.Format(),
		}
		if success, _ := p.tracker.Track(session.ID(), stream, session.UserID(), m, false); !success {
			// Presence creation was rejected due to `allowIfFirstForSession` flag, session is gone so no need to reply.
			return
		}
		meta = &m
	}

	// Whether the user has just (successfully) joined the match or was already a member, return the match info anyway.
	ps := p.tracker.ListByStream(stream, true)
	presences := make([]*rtapi.UserPresence, 0, len(ps))
	for _, p := range ps {
		presences = append(presences, &rtapi.UserPresence{
			UserId:    p.UserID.String(),
			SessionId: p.ID.SessionID.String(),
			Username:  p.Meta.Username,
		})
	}
	self := &rtapi.UserPresence{
		UserId:    session.UserID().String(),
		SessionId: session.ID().String(),
		Username:  meta.Username,
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Match{Match: &rtapi.Match{
		MatchId:       matchIDString,
		Authoritative: mode == StreamModeMatchAuthoritative,
		Label:         label,
		Size:          int32(len(presences)),
		Presences:     presences,
		Self:          self,
	}}})
}

func (p *Pipeline) matchLeave(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	// Validate the match ID.
	matchIDComponents := strings.SplitN(envelope.GetMatchLeave().MatchId, ":", 2)
	if len(matchIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}})
		return
	}
	matchID, err := uuid.FromString(matchIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}})
		return
	}

	// Decide if it's an authoritative or relayed match.
	mode := StreamModeMatchRelayed
	if matchIDComponents[1] != "" {
		mode = StreamModeMatchAuthoritative
	}

	// Check and drop the presence if possible, will always succeed.
	stream := PresenceStream{Mode: mode, Subject: matchID, Label: matchIDComponents[1]}

	p.tracker.Untrack(session.ID(), stream, session.UserID())

	session.Send(&rtapi.Envelope{Cid: envelope.Cid})
}

func (p *Pipeline) matchDataSend(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetMatchDataSend()

	// Validate the match ID.
	matchIDComponents := strings.SplitN(incoming.MatchId, ":", 2)
	if len(matchIDComponents) != 2 {
		return
	}
	matchID, err := uuid.FromString(matchIDComponents[0])
	if err != nil {
		return
	}

	// If it's an authoritative match pass the data to the match handler.
	if matchIDComponents[1] != "" {
		if p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), PresenceStream{Mode: StreamModeMatchAuthoritative, Subject: matchID, Label: matchIDComponents[1]}, session.UserID()) == nil {
			// User is not part of the match.
			return
		}

		p.matchRegistry.SendData(matchID, matchIDComponents[1], session.UserID(), session.ID(), session.Username(), p.node, incoming.OpCode, incoming.Data)
		return
	}

	// Parse any filters.
	var filters []*matchDataFilter
	if len(incoming.Presences) != 0 {
		filters = make([]*matchDataFilter, len(incoming.Presences))
		for i := 0; i < len(incoming.Presences); i++ {
			userID, err := uuid.FromString(incoming.Presences[i].UserId)
			if err != nil {
				return
			}
			sessionID, err := uuid.FromString(incoming.Presences[i].SessionId)
			if err != nil {
				return
			}
			filters[i] = &matchDataFilter{userID: userID, sessionID: sessionID}
		}
	}

	// If it was a relayed match, proceed with filter and data routing logic.
	stream := PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}
	presenceIDs := p.tracker.ListPresenceIDByStream(stream)
	if len(presenceIDs) == 0 {
		return
	}

	senderFound := false
	for i := 0; i < len(presenceIDs); i++ {
		presenceID := presenceIDs[i]
		if presenceID.SessionID == session.ID() {
			// Don't echo back to sender.
			presenceIDs[i] = presenceIDs[len(presenceIDs)-1]
			presenceIDs = presenceIDs[:len(presenceIDs)-1]
			senderFound = true
			if filters == nil {
				break
			} else {
				i--
			}
		} else if filters != nil {
			// Check if this presence is specified in the filters.
			filterFound := false
			for j := 0; j < len(filters); j++ {
				if filter := filters[j]; presenceID.SessionID == filter.sessionID {
					// If a filter matches, drop it.
					filters[j] = filters[len(filters)-1]
					filters = filters[:len(filters)-1]
					filterFound = true
					break
				}
			}
			if !filterFound {
				// If this presence wasn't in the filters, it's not needed.
				presenceIDs[i] = presenceIDs[len(presenceIDs)-1]
				presenceIDs = presenceIDs[:len(presenceIDs)-1]
				i--
			}
		}
	}

	// If sender wasn't in the presences for this match, they're not a member.
	if !senderFound {
		return
	}

	// Check if there are any recipients left.
	if len(presenceIDs) == 0 {
		return
	}

	outgoing := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId: incoming.MatchId,
		Presence: &rtapi.UserPresence{
			UserId:    session.UserID().String(),
			SessionId: session.ID().String(),
			Username:  session.Username(),
		},
		OpCode: incoming.OpCode,
		Data:   incoming.Data,
	}}}

	p.router.SendToPresenceIDs(logger, presenceIDs, outgoing)
}
