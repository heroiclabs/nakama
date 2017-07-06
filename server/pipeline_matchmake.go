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
	"github.com/dgrijalva/jwt-go"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"time"
)

func (p *pipeline) matchmakeAdd(logger *zap.Logger, session *session, envelope *Envelope) {
	requiredCount := envelope.GetMatchmakeAdd().RequiredCount
	if requiredCount < 2 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Required count must be >= 2"))
		return
	}

	ticket, selected := p.matchmaker.Add(session.id, session.userID, PresenceMeta{Handle: session.handle.Load()}, requiredCount)

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_MatchmakeTicket{MatchmakeTicket: &TMatchmakeTicket{
		Ticket: ticket.Bytes(),
	}}})

	if selected == nil {
		return
	}

	matchID := uuid.NewV4()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"mid": matchID.String(),
		"exp": time.Now().UTC().Add(15 * time.Second).Unix(),
	})
	signedToken, _ := token.SignedString(p.hmacSecretByte)

	idx := 0
	ps := make([]*UserPresence, len(selected))
	for mk, mp := range selected {
		ps[idx] = &UserPresence{
			UserId:    mk.UserID.Bytes(),
			SessionId: mk.ID.SessionID.Bytes(),
			Handle:    mp.Meta.Handle,
		}
		idx++
	}
	outgoing := &Envelope{Payload: &Envelope_MatchmakeMatched{MatchmakeMatched: &MatchmakeMatched{
		// Ticket: ..., // Set individually below for each recipient.
		Token:     []byte(signedToken),
		Presences: ps,
		// Self:   ..., // Set individually below for each recipient.
	}}}
	for mk, mp := range selected {
		to := []Presence{
			Presence{
				ID:     mk.ID,
				UserID: mk.UserID, // Not strictly needed here.
				Topic:  "",        // Not strictly needed here.
				Meta:   mp.Meta,   // Not strictly needed here.
			},
		}
		outgoing.GetMatchmakeMatched().Ticket = mk.Ticket.Bytes()
		outgoing.GetMatchmakeMatched().Self = &UserPresence{
			UserId:    mk.UserID.Bytes(),
			SessionId: mk.ID.SessionID.Bytes(),
			Handle:    mp.Meta.Handle,
		}
		p.messageRouter.Send(logger, to, outgoing)
	}
}

func (p *pipeline) matchmakeRemove(logger *zap.Logger, session *session, envelope *Envelope) {
	ticketBytes := envelope.GetMatchmakeRemove().Ticket
	ticket, err := uuid.FromBytes(ticketBytes)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid ticket"))
		return
	}

	err = p.matchmaker.Remove(session.id, session.userID, ticket)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Ticket not found, matchmaking may already be done"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}
