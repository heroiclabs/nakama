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
	"strings"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

var partyStreamMode = map[uint8]struct{}{StreamModeParty: {}}

func (p *Pipeline) partyCreate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyCreate()

	// Validate party creation parameters.
	if incoming.MaxSize < 0 || incoming.MaxSize > 256 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party max size, must be 1-256",
		}}}, true)
		return false, nil
	}

	presence := &rtapi.UserPresence{
		UserId:    session.UserID().String(),
		SessionId: session.ID().String(),
		Username:  session.Username(),
	}

	// Handle through the party registry.
	ph := p.partyRegistry.Create(incoming.Open, int(incoming.MaxSize), presence)
	if ph == nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Failed to create party",
		}}}, true)
		return false, nil
	}

	// If successful, the creator becomes the first user to join the party.
	success, _ := p.tracker.Track(session.Context(), session.ID(), ph.Stream, session.UserID(), PresenceMeta{
		Format:   session.Format(),
		Username: session.Username(),
		Status:   "",
	})
	if !success {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error tracking party creation",
		}}}, true)
		return false, nil
	}

	if p.config.GetSession().SingleParty {
		// Kick the user from any other parties they may be part of.
		p.tracker.UntrackLocalByModes(session.ID(), partyStreamMode, ph.Stream)
	}

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Party{Party: &rtapi.Party{
		PartyId:   ph.IDStr,
		Open:      incoming.Open,
		MaxSize:   incoming.MaxSize,
		Self:      presence,
		Leader:    presence,
		Presences: []*rtapi.UserPresence{presence},
	}}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyJoin(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyJoin()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
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
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error joining party: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	// If the party was open and the join was successful, track the new member immediately.
	if autoJoin {
		stream := PresenceStream{Mode: StreamModeParty, Subject: partyID, Label: node}
		success, _ := p.tracker.Track(session.Context(), session.ID(), stream, session.UserID(), PresenceMeta{
			Format:   session.Format(),
			Username: session.Username(),
			Status:   "",
		})
		if !success {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Error tracking party join",
			}}}, true)
			return false, nil
		}

		if p.config.GetSession().SingleParty {
			// Kick the user from any other parties they may be part of.
			p.tracker.UntrackLocalByModes(session.ID(), partyStreamMode, stream)
		}
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyLeave(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyLeave()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeParty, Subject: partyID, Label: node}, session.UserID())

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, nil
}

func (p *Pipeline) partyPromote(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyPromote()

	// Validate presence info.
	if incoming.Presence == nil || incoming.Presence.UserId == "" || incoming.Presence.SessionId == "" || incoming.Presence.Username == "" {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid presence",
		}}}, true)
		return false, nil
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyPromote(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Presence)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error promoting new party leader: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyAccept(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyAccept()

	// Validate presence info.
	if incoming.Presence == nil || incoming.Presence.UserId == "" || incoming.Presence.SessionId == "" || incoming.Presence.Username == "" {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid presence",
		}}}, true)
		return false, nil
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyAccept(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Presence)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error accepting party join request: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyRemove()

	// Validate presence info.
	if incoming.Presence == nil || incoming.Presence.UserId == "" || incoming.Presence.SessionId == "" || incoming.Presence.Username == "" {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid presence",
		}}}, true)
		return false, nil
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyRemove(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Presence)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error removing party member or join request: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyClose(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyClose()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyClose(session.Context(), partyID, node, session.ID().String(), p.node)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error closing party: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyJoinRequestList(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyJoinRequestList()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	presences, err := p.partyRegistry.PartyJoinRequestList(session.Context(), partyID, node, session.ID().String(), p.node)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error listing party join requests: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_PartyJoinRequest{PartyJoinRequest: &rtapi.PartyJoinRequest{
		PartyId:   incoming.PartyId,
		Presences: presences,
	}}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyMatchmakerAdd(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyMatchmakerAdd()

	// Minimum count.
	minCount := int(incoming.MinCount)
	if minCount < 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid minimum count, must be >= 2",
		}}}, true)
		return false, nil
	}

	// Maximum count, must be at least minimum count.
	maxCount := int(incoming.MaxCount)
	if maxCount < minCount {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid maximum count, must be >= minimum count",
		}}}, true)
		return false, nil
	}

	// Count multiple if supplied, otherwise defaults to 1.
	countMultiple := 1
	if incoming.CountMultiple != nil {
		countMultiple = int(incoming.CountMultiple.GetValue())
		if countMultiple < 1 {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid count multiple, must be >= 1",
			}}}, true)
			return false, nil
		}
		if minCount%countMultiple != 0 {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid count multiple for minimum count, must divide",
			}}}, true)
			return false, nil
		}
		if maxCount%countMultiple != 0 {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid count multiple for maximum count, must divide",
			}}}, true)
			return false, nil
		}
	}

	query := incoming.Query
	if query == "" {
		query = "*"
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	ticket, memberPresenceIDs, err := p.partyRegistry.PartyMatchmakerAdd(session.Context(), partyID, node, session.ID().String(), p.node, query, minCount, maxCount, countMultiple, incoming.StringProperties, incoming.NumericProperties)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error adding party to matchmaker: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	// Return the ticket to the party leader.
	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_PartyMatchmakerTicket{PartyMatchmakerTicket: &rtapi.PartyMatchmakerTicket{
		PartyId: incoming.PartyId,
		Ticket:  ticket,
	}}}
	_ = session.Send(out, true)

	if len(memberPresenceIDs) != 0 {
		// Notify all other party members.
		outgoing := &rtapi.Envelope{
			Message: &rtapi.Envelope_PartyMatchmakerTicket{
				PartyMatchmakerTicket: &rtapi.PartyMatchmakerTicket{
					PartyId: incoming.PartyId,
					Ticket:  ticket,
				},
			},
		}
		p.router.SendToPresenceIDs(p.logger, memberPresenceIDs, outgoing, true)
	}

	return true, out
}

func (p *Pipeline) partyMatchmakerRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyMatchmakerRemove()

	// Ticket is required.
	if incoming.Ticket == "" {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid matchmaker ticket",
		}}}, true)
		return false, nil
	}

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyMatchmakerRemove(session.Context(), partyID, node, session.ID().String(), p.node, incoming.Ticket)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error closing party: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) partyDataSend(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetPartyDataSend()

	// Validate the party ID.
	partyIDComponents := strings.SplitN(incoming.PartyId, ".", 2)
	if len(partyIDComponents) != 2 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	partyID, err := uuid.FromString(partyIDComponents[0])
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid party ID",
		}}}, true)
		return false, nil
	}
	node := partyIDComponents[1]

	// Handle through the party registry.
	err = p.partyRegistry.PartyDataSend(session.Context(), partyID, node, session.ID().String(), p.node, incoming.OpCode, incoming.Data)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: fmt.Sprintf("Error sending party data: %s", err.Error()),
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}
