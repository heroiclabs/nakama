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
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func (p *pipeline) matchmakeAdd(logger *zap.Logger, session *session, envelope *Envelope) {
	matchmakeAdd := envelope.GetMatchmakeAdd()
	requiredCount := matchmakeAdd.RequiredCount
	if requiredCount < 2 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Required count must be >= 2"))
		return
	}

	properties := make(map[string]interface{}, 0)
	for _, pair := range matchmakeAdd.Properties {
		switch v := pair.Value.(type) {
		case *PropertyPair_BoolValue:
			properties[pair.Key] = v.BoolValue
		case *PropertyPair_IntValue:
			properties[pair.Key] = v.IntValue
		case *PropertyPair_StringSet_:
			properties[pair.Key] = uniqueList(v.StringSet.Values)
		}
	}

	filters := make(map[string]MatchmakerFilter)
	for _, filter := range matchmakeAdd.Filters {
		switch v := filter.Value.(type) {
		case *MatchmakeFilter_Check:
			filters[filter.Name] = &MatchmakerBoolFilter{v.Check}
		case *MatchmakeFilter_Range:
			filters[filter.Name] = &MatchmakerRangeFilter{v.Range.LowerBound, v.Range.UpperBound}
		case *MatchmakeFilter_Term:
			filters[filter.Name] = &MatchmakerTermFilter{uniqueList(v.Term.Terms), v.Term.MatchAllTerms}
		}
	}

	matchmakerProfile := &MatchmakerProfile{
		Meta:          PresenceMeta{Handle: session.handle.Load()},
		RequiredCount: int(requiredCount),
		Properties:    properties,
		Filters:       filters,
	}
	ticket, selected, props := p.matchmaker.Add(session.id, session.userID, matchmakerProfile)

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_MatchmakeTicket{MatchmakeTicket: &TMatchmakeTicket{
		Ticket: ticket.Bytes(),
	}}})

	if selected == nil {
		return
	}

	matchID := uuid.NewV4()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"mid": matchID.String(),
		"exp": time.Now().UTC().Add(30 * time.Second).Unix(),
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

	protoProps := make([]*MatchmakeMatched_UserProperty, 0)
	for _, prop := range props {
		protoProp := &MatchmakeMatched_UserProperty{
			UserId:     prop.UserID.Bytes(),
			Properties: make([]*PropertyPair, 0),
			Filters:    make([]*MatchmakeFilter, 0),
		}
		protoProps = append(protoProps, protoProp)

		for userPropertyKey, userPropertyValue := range prop.Properties {
			pair := &PropertyPair{Key: userPropertyKey}
			protoProp.Properties = append(protoProp.Properties, pair)
			switch v := userPropertyValue.(type) {
			case int64:
				pair.Value = &PropertyPair_IntValue{v}
			case bool:
				pair.Value = &PropertyPair_BoolValue{v}
			case []string:
				pair.Value = &PropertyPair_StringSet_{&PropertyPair_StringSet{v}}
			}
		}

		for userFilterKey, userFilterValue := range prop.Filters {
			filter := &MatchmakeFilter{Name: userFilterKey}
			protoProp.Filters = append(protoProp.Filters, filter)
			switch userFilterValue.Type() {
			case TERM:
				f := userFilterValue.(*MatchmakerTermFilter)
				filter.Value = &MatchmakeFilter_Term{&MatchmakeFilter_TermFilter{f.Terms, f.AllTerms}}
			case RANGE:
				f := userFilterValue.(*MatchmakerRangeFilter)
				filter.Value = &MatchmakeFilter_Range{&MatchmakeFilter_RangeFilter{f.LowerBound, f.UpperBound}}
			case BOOL:
				f := userFilterValue.(*MatchmakerBoolFilter)
				filter.Value = &MatchmakeFilter_Check{f.Value}
			}
		}
	}

	outgoing := &Envelope{Payload: &Envelope_MatchmakeMatched{MatchmakeMatched: &MatchmakeMatched{
		// Ticket: ..., // Set individually below for each recipient.
		Token:      []byte(signedToken),
		Presences:  ps,
		Properties: protoProps,
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

func uniqueList(values []string) []string {
	m := make(map[string]struct{})
	set := make([]string, 0)

	for _, v := range values {
		if _, ok := m[v]; !ok {
			m[v] = struct{}{}
			set = append(set, v)
		}
	}

	return set
}
