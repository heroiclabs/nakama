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
	"context"
	"fmt"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

func (p *Pipeline) matchmakerAdd(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetMatchmakerAdd()

	// Minimum count.
	minCount := int(incoming.MinCount)
	if minCount < 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid minimum count, must be >= 2",
		}}}, true)
		return
	}

	// Maximum count, must be at least minimum count.
	maxCount := int(incoming.MaxCount)
	if maxCount < minCount {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid maximum count, must be >= minimum count",
		}}}, true)
		return
	}

	query := incoming.Query
	if query == "" {
		query = "*"
	}

	// Run matchmaker add.
	ticket, entries, err := p.matchmaker.Add(session, query, minCount, maxCount, incoming.StringProperties, incoming.NumericProperties)
	if err != nil {
		logger.Error("Error adding to matchmaker", zap.Error(err))
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error adding to matchmaker",
		}}}, true)
		return
	}

	// Return the ticket first whether or not matchmaking was successful.
	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_MatchmakerTicket{MatchmakerTicket: &rtapi.MatchmakerTicket{
		Ticket: ticket,
	}}}, true)

	if entries == nil {
		// Matchmaking was unsuccessful, no further messages to send out.
		return
	}

	var tokenOrMatchID string
	var isMatchID bool

	// Check if there's a matchmaker matched runtime callback, call it, and see if it returns a match ID.
	fn := p.runtime.MatchmakerMatched()
	if fn != nil {
		tokenOrMatchID, isMatchID, err = fn(context.Background(), entries)
		if err != nil {
			p.logger.Error("Error running Matchmaker Matched hook.", zap.Error(err))
		}
	}

	if !isMatchID {
		// If there was no callback or it didn't return a valid match ID always return at least a token.
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"mid": fmt.Sprintf("%v.", uuid.Must(uuid.NewV4()).String()),
			"exp": time.Now().UTC().Add(30 * time.Second).Unix(),
		})
		tokenOrMatchID, _ = token.SignedString([]byte(p.config.GetSession().EncryptionKey))
	}

	users := make([]*rtapi.MatchmakerMatched_MatchmakerUser, 0, len(entries))
	for _, entry := range entries {
		users = append(users, &rtapi.MatchmakerMatched_MatchmakerUser{
			Presence: &rtapi.UserPresence{
				UserId:    entry.Presence.UserId,
				SessionId: entry.Presence.SessionId,
				Username:  entry.Presence.Username,
			},
			StringProperties:  entry.StringProperties,
			NumericProperties: entry.NumericProperties,
		})
	}
	outgoing := &rtapi.Envelope{Message: &rtapi.Envelope_MatchmakerMatched{MatchmakerMatched: &rtapi.MatchmakerMatched{
		// Ticket is set individually below for each recipient.
		// Id set below to account for token or match ID case.
		Users: users,
		// Self is set individually below for each recipient.
	}}}
	if isMatchID {
		outgoing.GetMatchmakerMatched().Id = &rtapi.MatchmakerMatched_MatchId{MatchId: tokenOrMatchID}
	} else {
		outgoing.GetMatchmakerMatched().Id = &rtapi.MatchmakerMatched_Token{Token: tokenOrMatchID}
	}

	for i, entry := range entries {
		// Set per-recipient fields.
		outgoing.GetMatchmakerMatched().Self = users[i]
		outgoing.GetMatchmakerMatched().Ticket = entry.Ticket

		// Route outgoing message.
		p.router.SendToPresenceIDs(logger, []*PresenceID{{Node: entry.Presence.Node, SessionID: entry.SessionID}}, outgoing, true)
	}
}

func (p *Pipeline) matchmakerRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetMatchmakerRemove()

	// Ticket is required.
	if incoming.Ticket == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid matchmaker ticket",
		}}}, true)
		return
	}

	// Run matchmaker remove.
	if err := p.matchmaker.Remove(session.ID(), incoming.Ticket); err != nil {
		if err == ErrMatchmakerTicketNotFound {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Matchmaker ticket not found",
			}}}, true)
			return
		}

		logger.Error("Error removing matchmaker ticket", zap.Error(err))
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error removing matchmaker ticket",
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}
