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
	"fmt"
	"unicode/utf8"

	"github.com/dgrijalva/jwt-go"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type matchDataFilter struct {
	userID    uuid.UUID
	sessionID uuid.UUID
}

func (p *pipeline) matchCreate(logger *zap.Logger, session session, envelope *Envelope) {
	matchID := uuid.NewV4()

	handle := session.Handle()

	p.tracker.Track(session.ID(), "match:"+matchID.String(), session.UserID(), PresenceMeta{
		Handle: handle,
	})

	self := &UserPresence{
		UserId:    session.UserID().Bytes(),
		SessionId: session.ID().Bytes(),
		Handle:    handle,
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Match{Match: &TMatch{Match: &Match{
		MatchId:   matchID.Bytes(),
		Presences: []*UserPresence{self},
		Self:      self,
	}}}}, true)
}

func (p *pipeline) matchJoin(logger *zap.Logger, session session, envelope *Envelope) {
	e := envelope.GetMatchesJoin()

	if len(e.Matches) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"), true)
		return
	} else if len(e.Matches) > 1 {
		logger.Warn("There are more than one item passed to the request - only processing the first item.")
	}

	m := e.Matches[0]

	var matchID uuid.UUID
	var err error
	allowEmpty := false

	switch m.Id.(type) {
	case *TMatchesJoin_MatchJoin_MatchId:
		matchID, err = uuid.FromBytes(m.GetMatchId())
		if err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid match ID"), true)
			return
		}
	case *TMatchesJoin_MatchJoin_Token:
		tokenBytes := m.GetToken()
		if controlCharsRegex.Match(tokenBytes) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Match token cannot contain control chars"), true)
			return
		}
		if !utf8.Valid(tokenBytes) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Match token must only contain valid UTF-8 bytes"), true)
			return
		}
		token, err := jwt.Parse(string(tokenBytes), func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("Unexpected signing method: %v", token.Header["alg"])
			}
			return p.hmacSecretByte, nil
		})
		if err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Match token is invalid"), true)
			return
		}
		if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
			matchID, err = uuid.FromString(claims["mid"].(string))
			if err != nil {
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Match token is invalid"), true)
				return
			}
		} else {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Match token is invalid"), true)
			return
		}
		allowEmpty = true
	case nil:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No match ID or token found"), true)
		return
	default:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Unrecognized match ID or token"), true)
		return
	}

	topic := "match:" + matchID.String()

	ps := p.tracker.ListByTopic(topic)
	if !allowEmpty && len(ps) == 0 {
		session.Send(ErrorMessage(envelope.CollationId, MATCH_NOT_FOUND, "Match not found"), true)
		return
	}

	handle := session.Handle()

	p.tracker.Track(session.ID(), topic, session.UserID(), PresenceMeta{
		Handle: handle,
	})

	userPresences := make([]*UserPresence, len(ps)+1)
	for i := 0; i < len(ps); i++ {
		p := ps[i]
		userPresences[i] = &UserPresence{
			UserId:    p.UserID.Bytes(),
			SessionId: p.ID.SessionID.Bytes(),
			Handle:    p.Meta.Handle,
		}
	}
	self := &UserPresence{
		UserId:    session.UserID().Bytes(),
		SessionId: session.ID().Bytes(),
		Handle:    handle,
	}
	userPresences[len(ps)] = self

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Matches{Matches: &TMatches{
		Matches: []*Match{
			&Match{
				MatchId:   matchID.Bytes(),
				Presences: userPresences,
				Self:      self,
			},
		},
	}}}, true)
}

func (p *pipeline) matchLeave(logger *zap.Logger, session session, envelope *Envelope) {
	e := envelope.GetMatchesLeave()

	if len(e.MatchIds) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"), true)
		return
	} else if len(e.MatchIds) > 1 {
		logger.Warn("There are more than one item passed to the request - only processing the first item.")
	}

	m := e.MatchIds[0]
	matchID, err := uuid.FromBytes(m)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid match ID"), true)
		return
	}
	topic := "match:" + matchID.String()

	ps := p.tracker.ListByTopic(topic)
	if len(ps) == 0 {
		session.Send(ErrorMessage(envelope.CollationId, MATCH_NOT_FOUND, "Match not found"), true)
		return
	}

	found := false
	for _, p := range ps {
		if p.ID.SessionID == session.ID() && p.UserID == session.UserID() {
			found = true
			break
		}
	}

	// If sender wasn't part of the match.
	if !found {
		session.Send(ErrorMessage(envelope.CollationId, MATCH_NOT_FOUND, "Match not found"), true)
		return
	}

	p.tracker.Untrack(session.ID(), topic, session.UserID())

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) matchDataSend(logger *zap.Logger, session session, envelope *Envelope, reliable bool) {
	incoming := envelope.GetMatchDataSend()
	matchIDBytes := incoming.MatchId
	matchID, err := uuid.FromBytes(matchIDBytes)
	if err != nil {
		return
	}
	topic := "match:" + matchID.String()
	filterPresences := false
	var filters []*matchDataFilter
	if len(incoming.Presences) != 0 {
		filterPresences = true
		filters = make([]*matchDataFilter, len(incoming.Presences))
		for i := 0; i < len(incoming.Presences); i++ {
			userID, err := uuid.FromBytes(incoming.Presences[i].UserId)
			if err != nil {
				return
			}
			sessionID, err := uuid.FromBytes(incoming.Presences[i].SessionId)
			if err != nil {
				return
			}
			filters[i] = &matchDataFilter{userID: userID, sessionID: sessionID}
		}
	}

	// TODO check membership before looking up all members.

	ps := p.tracker.ListByTopic(topic)
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
			if !filterPresences {
				break
			} else {
				i--
			}
		} else if filterPresences {
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

	outgoing := &Envelope{
		Payload: &Envelope_MatchData{
			MatchData: &MatchData{
				MatchId: matchIDBytes,
				Presence: &UserPresence{
					UserId:    session.UserID().Bytes(),
					SessionId: session.ID().Bytes(),
					Handle:    session.Handle(),
				},
				OpCode: incoming.OpCode,
				Data:   incoming.Data,
			},
		},
	}

	p.messageRouter.Send(logger, ps, outgoing, reliable)
}
