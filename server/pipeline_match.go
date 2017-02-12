// Copyright 2017 The Nakama Authors
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
	"github.com/uber-go/zap"
)

func (p *pipeline) matchCreate(logger zap.Logger, session *session, envelope *Envelope) {
	matchID := uuid.NewV4()

	p.tracker.Track(session.id, "match:"+matchID.String(), session.userID, PresenceMeta{})

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Match{Match: &TMatch{Id: matchID.Bytes()}}})
}

func (p *pipeline) matchJoin(logger zap.Logger, session *session, envelope *Envelope) {
	matchIDBytes := envelope.GetMatchJoin().MatchId
	matchID, err := uuid.FromBytes(matchIDBytes)
	if err != nil {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Invalid match ID"}}})
		return
	}
	topic := "match:" + matchID.String()

	ps := p.tracker.ListByTopic(topic)
	if len(ps) == 0 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Match not found"}}})
		return
	}

	p.tracker.Track(session.id, topic, session.userID, PresenceMeta{})

	users := make([]*UserPresence, len(ps))
	for i := 0; i < len(ps); i++ {
		p := ps[i]
		users[i] = &UserPresence{
			UserId:    p.UserID.Bytes(),
			SessionId: p.ID.SessionID.Bytes(),
		}
	}
	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_MatchUsers{MatchUsers: &TMatchUsers{Users: users}}})
}

func (p *pipeline) matchLeave(logger zap.Logger, session *session, envelope *Envelope) {
	matchIDBytes := envelope.GetMatchLeave().MatchId
	matchID, err := uuid.FromBytes(matchIDBytes)
	if err != nil {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Invalid match ID"}}})
		return
	}
	topic := "match:" + matchID.String()

	ps := p.tracker.ListByTopic(topic)
	if len(ps) == 0 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Match not found"}}})
		return
	}

	found := false
	for _, p := range ps {
		if p.ID.SessionID == session.id && p.UserID == session.userID {
			found = true
			break
		}
	}

	// If sender wasn't part of the match.
	if !found {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Match not found"}}})
		return
	}

	p.tracker.Untrack(session.id, topic, session.userID)

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) matchDataSend(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetMatchDataSend()
	matchIDBytes := incoming.MatchId
	matchID, err := uuid.FromBytes(matchIDBytes)
	if err != nil {
		// TODO send an error to the client?
		return
	}
	topic := "match:" + matchID.String()

	// TODO check membership before looking up all members.

	ps := p.tracker.ListByTopic(topic)
	if len(ps) == 0 {
		// TODO send an error to the client?
		return
	}

	// Don't echo back to sender.
	found := false
	for i := 0; i < len(ps); i++ {
		if p := ps[i]; p.ID.SessionID == session.id && p.UserID == session.userID {
			ps[i] = ps[len(ps)-1]
			ps = ps[:len(ps)-1]
			found = true
			break
		}
	}

	// If sender wasn't in the presences for this match, they're not a member.
	if !found {
		// TODO send an error to the client?
		return
	}

	// Check if sender was the only one in the match.
	if len(ps) == 0 {
		return
	}

	outgoing := &Envelope{
		Payload: &Envelope_MatchData{
			MatchData: &MatchData{
				MatchId: matchIDBytes,
				User: &UserPresence{
					UserId:    session.userID.Bytes(),
					SessionId: session.id.Bytes(),
				},
				OpCode: incoming.OpCode,
				Data:   incoming.Data,
			},
		},
	}

	p.messageRouter.Send(logger, ps, outgoing)
}
