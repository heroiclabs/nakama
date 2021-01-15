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

	presences := []*MatchmakerPresence{{
		UserId:    session.UserID().String(),
		SessionId: session.ID().String(),
		Username:  session.Username(),
		Node:      p.node,
		SessionID: session.ID(),
	}}

	// Run matchmaker add.
	ticket, err := p.matchmaker.Add(presences, session.ID().String(), "", query, minCount, maxCount, incoming.StringProperties, incoming.NumericProperties)
	if err != nil {
		logger.Error("Error adding to matchmaker", zap.Error(err))
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error adding to matchmaker",
		}}}, true)
		return
	}

	// Return the ticket.
	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_MatchmakerTicket{MatchmakerTicket: &rtapi.MatchmakerTicket{
		Ticket: ticket,
	}}}, true)
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
	if err := p.matchmaker.RemoveSession(session.ID().String(), incoming.Ticket); err != nil {
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
