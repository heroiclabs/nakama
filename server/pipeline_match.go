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
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type matchDataFilter struct {
	userID    uuid.UUID
	sessionID uuid.UUID
}

func (p *pipeline) matchCreate(logger *zap.Logger, session session, envelope *rtapi.Envelope) {
	matchID := uuid.NewV4()

	username := session.Username()

	p.tracker.Track(session.ID(), PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}, session.UserID(), PresenceMeta{
		Username: username,
		Format:   session.Format(),
	})

	self := &rtapi.StreamPresence{
		UserId:    session.UserID().String(),
		SessionId: session.ID().String(),
		Username:  username,
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Match{Match: &rtapi.Match{
		MatchId:   matchID.String(),
		Presences: []*rtapi.StreamPresence{self},
		Self:      self,
	}}})
}

func (p *pipeline) matchJoin(logger *zap.Logger, session session, envelope *rtapi.Envelope) {
	m := envelope.GetMatchJoin()
	var err error
	var matchID uuid.UUID
	var matchIDString string

	switch m.Id.(type) {
	case *rtapi.MatchJoin_MatchId:
		matchIDString = m.GetMatchId()
		matchID, err = uuid.FromString(matchIDString)
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match ID",
			}}})
			return
		}
	case *rtapi.MatchJoin_Token:
		// TODO restore when matchmaking is available
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

	stream := PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}

	if !p.tracker.StreamExists(stream) {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_MATCH_NOT_FOUND),
			Message: "Match not found",
		}}})
		return
	}

	username := session.Username()

	p.tracker.Track(session.ID(), stream, session.UserID(), PresenceMeta{
		Username: username,
		Format:   session.Format(),
	})

	ps := p.tracker.ListByStream(stream)
	presences := make([]*rtapi.StreamPresence, 0, len(ps))
	for _, p := range ps {
		presences = append(presences, &rtapi.StreamPresence{
			UserId:    p.UserID.String(),
			SessionId: p.ID.SessionID.String(),
			Username:  p.Meta.Username,
		})
	}
	self := &rtapi.StreamPresence{
		UserId:    session.UserID().String(),
		SessionId: session.ID().String(),
		Username:  username,
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Match{Match: &rtapi.Match{
		MatchId:   matchIDString,
		Presences: presences,
		Self:      self,
	}}})
}

func (p *pipeline) matchLeave(logger *zap.Logger, session session, envelope *rtapi.Envelope) {
	matchIDString := envelope.GetMatchLeave().MatchId
	matchID, err := uuid.FromString(matchIDString)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}})
		return
	}

	stream := PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}

	if p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), stream, session.UserID()) == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_MATCH_NOT_FOUND),
			Message: "Match not found",
		}}})
		return
	}

	p.tracker.Untrack(session.ID(), stream, session.UserID())

	session.Send(&rtapi.Envelope{Cid: envelope.Cid})
}

func (p *pipeline) matchDataSend(logger *zap.Logger, session session, envelope *rtapi.Envelope) {
	incoming := envelope.GetMatchDataSend()
	matchIDString := incoming.MatchId
	matchID, err := uuid.FromString(matchIDString)
	if err != nil {
		return
	}

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

	stream := PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}
	ps := p.tracker.ListByStream(stream)
	if len(ps) == 0 {
		return
	}

	senderFound := false
	for i := 0; i < len(ps); i++ {
		p := ps[i]
		if p.ID.SessionID == session.ID() && p.UserID == session.UserID() {
			// Don't echo back to sender.
			ps[i] = ps[len(ps)-1]
			ps = ps[:len(ps)-1]
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
				if filter := filters[j]; p.ID.SessionID == filter.sessionID && p.UserID == filter.userID {
					// If a filter matches, drop it.
					filters[j] = filters[len(filters)-1]
					filters = filters[:len(filters)-1]
					filterFound = true
					break
				}
			}
			if !filterFound {
				// If this presence wasn't in the filters, it's not needed.
				ps[i] = ps[len(ps)-1]
				ps = ps[:len(ps)-1]
				i--
			}
		}
	}

	// If sender wasn't in the presences for this match, they're not a member.
	if !senderFound {
		return
	}

	// Check if there are any recipients left.
	if len(ps) == 0 {
		return
	}

	outgoing := &rtapi.Envelope{Message: &rtapi.Envelope_MatchData{MatchData: &rtapi.MatchData{
		MatchId: matchIDString,
		Presence: &rtapi.StreamPresence{
			UserId:    session.UserID().String(),
			SessionId: session.ID().String(),
			Username:  session.Username(),
		},
		OpCode: incoming.OpCode,
		Data:   incoming.Data,
	}}}

	p.router.SendToPresences(logger, ps, outgoing)
}
