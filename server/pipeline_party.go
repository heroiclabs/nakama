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
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"strings"
)

func (p *Pipeline) partyCreate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyCreate()

	// Validate party creation parameters.
	if incoming.MaxSize < 0 || incoming.MaxSize > 256 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party max size, must be 1-256",
		}}}, true)
		return
	}

	// Handle through the party registry.
	ph := p.partyRegistry.Create(incoming.Open, int(incoming.MaxSize))
	if ph == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Failed to create party",
		}}}, true)
		return
	}

	// If successful, the creator becomes the first user to join the party.
	success, _ := p.tracker.Track(session.ID(), ph.Stream, session.UserID(), PresenceMeta{
		Format:   session.Format(),
		Username: session.Username(),
		Status:   "",
	}, false)
	if !success {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error tracking party creation",
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyJoin(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyJoin()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	autoJoin, err := p.partyRegistry.PartyJoinRequest(session.Context(), partyID, node, &Presence{
		ID: PresenceID{
			Node:      p.node,
			SessionID: session.ID(),
		},
		// Presence stream not needed.
		UserID: session.UserID(),
		Meta: PresenceMeta{
			Username: session.Username(),
			// Other meta fields not needed.
		},
	})
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error joining party: %s", err.Error()),
		}}}, true)
		return
	}

	// If the party was open and the join was successful, track the new member immediately.
	if autoJoin {
		success, _ := p.tracker.Track(session.ID(), PresenceStream{Mode: StreamModeParty, Subject: partyID, Label: node}, session.UserID(), PresenceMeta{
			Format:   session.Format(),
			Username: session.Username(),
			Status:   "",
		}, false)
		if !success {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Error tracking party join",
			}}}, true)
			return
		}
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyLeave(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyLeave()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeParty, Subject: partyID, Label: node}, session.UserID())

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyPromote(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyPromote()

	// Validate presence info.
	if incoming.Presence == nil || incoming.Presence.UserId == "" || incoming.Presence.SessionId == "" || incoming.Presence.Username == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid presence",
		}}}, true)
		return
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyPromote(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Presence)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error promoting new party leader: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyAccept(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyAccept()

	// Validate presence info.
	if incoming.Presence == nil || incoming.Presence.UserId == "" || incoming.Presence.SessionId == "" || incoming.Presence.Username == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid presence",
		}}}, true)
		return
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyAccept(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Presence)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error accepting party join request: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyRemove()

	// Validate presence info.
	if incoming.Presence == nil || incoming.Presence.UserId == "" || incoming.Presence.SessionId == "" || incoming.Presence.Username == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid presence",
		}}}, true)
		return
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyRemove(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Presence)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error removing party member or join request: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyClose(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyClose()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyClose(session.Context(), partyID, node, session.ID().String(), p.node)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error closing party: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyJoinRequestList(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyJoinRequestList()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	presences, err := p.partyRegistry.PartyJoinRequestList(session.Context(), partyID, node, session.ID().String(), p.node)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error listing party join requests: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_PartyJoinRequest{PartyJoinRequest: &rtapi.PartyJoinRequest{
		PartyId:   incoming.PartyId,
		Presences: presences,
	}}}, true)
}

func (p *Pipeline) partyMatchmakerAdd(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyMatchmakerAdd()

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

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	ticket, err := p.partyRegistry.PartyMatchmakerAdd(session.Context(), partyID, node, session.ID().String(), p.node, query, minCount, maxCount, incoming.StringProperties, incoming.NumericProperties)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error adding party to matchmaker: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)

	// Return the ticket.
	outgoing := &rtapi.Envelope{
		Message: &rtapi.Envelope_PartyMatchmakerTicket{
			PartyMatchmakerTicket: &rtapi.PartyMatchmakerTicket{
				PartyId: incoming.PartyId,
				Ticket:  ticket,
			},
		},
	}
	p.router.SendToStream(p.logger, PresenceStream{Mode: StreamModeParty, Subject: partyID, Label: node}, outgoing, true)
}

func (p *Pipeline) partyMatchmakerRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyMatchmakerRemove()

	// Ticket is required.
	if incoming.Ticket == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid matchmaker ticket",
		}}}, true)
		return
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyMatchmakerRemove(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Ticket)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error closing party: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) partyDataSend(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetPartyDataSend()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyDataSend(session.Context(), partyID, node, session.ID().String(), p.node, incoming.OpCode, incoming.Data)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error sending party data: %s", err.Error()),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}
