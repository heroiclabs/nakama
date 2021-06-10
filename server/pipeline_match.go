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
	"crypto"
	"fmt"
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type matchDataFilter struct {
	userID    uuid.UUID
	sessionID uuid.UUID
}

func (p *Pipeline) matchCreate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	matchID := uuid.Must(uuid.NewV4())

	username := session.Username()

	if success, _ := p.tracker.Track(session.Context(), session.ID(), PresenceStream{Mode: StreamModeMatchRelayed, Subject: matchID}, session.UserID(), PresenceMeta{
		Username: username,
		Format:   session.Format(),
	}, false); !success {
		// Presence creation was rejected due to `allowIfFirstForSession` flag, session is gone so no need to reply.
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Match{Match: &rtapi.Match{
		MatchId:       fmt.Sprintf("%v.", matchID.String()),
		Authoritative: false,
		// No label.
		Size: 1,
		// No presences.
		Self: &rtapi.UserPresence{
			UserId:    session.UserID().String(),
			SessionId: session.ID().String(),
			Username:  username,
		},
	}}}, true)
}

func (p *Pipeline) matchJoin(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetMatchJoin()
	var err error
	var matchID uuid.UUID
	var node string
	var matchIDString string
	allowEmpty := false

	switch incoming.Id.(type) {
	case *rtapi.MatchJoin_MatchId:
		matchIDString = incoming.GetMatchId()
		// Validate the match ID.
		matchIDComponents := strings.SplitN(matchIDString, ".", 2)
		if len(matchIDComponents) != 2 {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match ID",
			}}}, true)
			return
		}
		matchID, err = uuid.FromString(matchIDComponents[0])
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match ID",
			}}}, true)
			return
		}
		node = matchIDComponents[1]
	case *rtapi.MatchJoin_Token:
		token, err := jwt.Parse(incoming.GetToken(), func(token *jwt.Token) (interface{}, error) {
			if s, ok := token.Method.(*jwt.SigningMethodHMAC); !ok || s.Hash != crypto.SHA256 {
				return nil, fmt.Errorf("Unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(p.config.GetSession().EncryptionKey), nil
		})
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match token",
			}}}, true)
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || !token.Valid {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match token",
			}}}, true)
			return
		}
		matchIDString = claims["mid"].(string)
		// Validate the match ID.
		matchIDComponents := strings.SplitN(matchIDString, ".", 2)
		if len(matchIDComponents) != 2 {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match token",
			}}}, true)
			return
		}
		matchID, err = uuid.FromString(matchIDComponents[0])
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid match token",
			}}}, true)
			return
		}
		node = matchIDComponents[1]
		allowEmpty = true
	case nil:
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "No match ID or token found",
		}}}, true)
		return
	default:
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Unrecognized match ID or token",
		}}}, true)
		return
	}

	var mode uint8
	var label *wrapperspb.StringValue
	var presences []*rtapi.UserPresence
	username := session.Username()
	if node == "" {
		// Relayed match.
		mode = StreamModeMatchRelayed
		stream := PresenceStream{Mode: mode, Subject: matchID, Label: node}

		if !allowEmpty && !p.tracker.StreamExists(stream) {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_MATCH_NOT_FOUND),
				Message: "Match not found",
			}}}, true)
			return
		}

		isNew := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), stream, session.UserID()) == nil
		if isNew {
			m := PresenceMeta{
				Username: username,
				Format:   session.Format(),
			}
			if success, _ := p.tracker.Track(session.Context(), session.ID(), stream, session.UserID(), m, false); !success {
				// Presence creation was rejected due to `allowIfFirstForSession` flag, session is gone so no need to reply.
				return
			}
		}

		// Whether the user has just (successfully) joined the match or was already a member, return the match info anyway.
		ps := p.tracker.ListByStream(stream, false, true)
		presences = make([]*rtapi.UserPresence, 0, len(ps))
		for _, p := range ps {
			if isNew && p.UserID == session.UserID() && p.ID.SessionID == session.ID() {
				// Ensure the user themselves does not appear in the list of existing match presences.
				// Only for new joins, not if the user is joining a match they're already part of.
				continue
			}
			presences = append(presences, &rtapi.UserPresence{
				UserId:    p.UserID.String(),
				SessionId: p.ID.SessionID.String(),
				Username:  p.Meta.Username,
			})
		}
	} else {
		// Authoritative match.
		mode = StreamModeMatchAuthoritative

		found, allow, isNew, reason, l, ps := p.matchRegistry.JoinAttempt(session.Context(), matchID, node, session.UserID(), session.ID(), username, session.Expiry(), session.Vars(), session.ClientIP(), session.ClientPort(), p.node, incoming.Metadata)
		if !found {
			// Match did not exist.
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_MATCH_NOT_FOUND),
				Message: "Match not found",
			}}}, true)
			return
		}
		if !allow {
			// Use the reject reason set by the match handler, if available.
			if reason == "" {
				reason = "Match join rejected"
			}
			// Match exists, but rejected the join.
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_MATCH_JOIN_REJECTED),
				Message: reason,
			}}}, true)
			return
		}

		if isNew {
			stream := PresenceStream{Mode: mode, Subject: matchID, Label: node}
			m := PresenceMeta{
				Username: session.Username(),
				Format:   session.Format(),
			}
			p.tracker.Track(session.Context(), session.ID(), stream, session.UserID(), m, false)
		}

		label = &wrapperspb.StringValue{Value: l}
		presences = make([]*rtapi.UserPresence, 0, len(ps))
		for _, p := range ps {
			if isNew && p.UserID == session.UserID() && p.SessionID == session.ID() {
				// Ensure the user themselves does not appear in the list of existing match presences.
				// Only for new joins, not if the user is joining a match they're already part of.
				continue
			}
			presences = append(presences, &rtapi.UserPresence{
				UserId:    p.UserID.String(),
				SessionId: p.SessionID.String(),
				Username:  p.Username,
			})
		}
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Match{Match: &rtapi.Match{
		MatchId:       matchIDString,
		Authoritative: mode == StreamModeMatchAuthoritative,
		Label:         label,
		Size:          int32(len(presences)),
		Presences:     presences,
		Self: &rtapi.UserPresence{
			UserId:    session.UserID().String(),
			SessionId: session.ID().String(),
			Username:  username,
		},
	}}}, true)
}

func (p *Pipeline) matchLeave(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	// Validate the match ID.
	matchIDComponents := strings.SplitN(envelope.GetMatchLeave().MatchId, ".", 2)
	if len(matchIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}}, true)
		return
	}
	matchID, err := uuid.FromString(matchIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}}, true)
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

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) matchDataSend(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetMatchDataSend()

	// Validate the match ID.
	matchIDComponents := strings.SplitN(incoming.MatchId, ".", 2)
	if len(matchIDComponents) != 2 {
		session.Send(&rtapi.Envelope{Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}}, true)
		return
	}
	matchID, err := uuid.FromString(matchIDComponents[0])
	if err != nil {
		session.Send(&rtapi.Envelope{Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid match ID",
		}}}, true)
		return
	}

	// If it's an authoritative match pass the data to the match handler.
	if matchIDComponents[1] != "" {
		if p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), PresenceStream{Mode: StreamModeMatchAuthoritative, Subject: matchID, Label: matchIDComponents[1]}, session.UserID()) == nil {
			// User is not part of the match.
			return
		}

		p.matchRegistry.SendData(matchID, matchIDComponents[1], session.UserID(), session.ID(), session.Username(), p.node, incoming.OpCode, incoming.Data, incoming.Reliable, time.Now().UTC().UnixNano()/int64(time.Millisecond))
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
			senderFound = true
			if filters == nil {
				// Don't echo back to sender unless they explicitly appear in the filter list.
				presenceIDs[i] = presenceIDs[len(presenceIDs)-1]
				presenceIDs = presenceIDs[:len(presenceIDs)-1]
				break
			}
		}

		if filters != nil {
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
		OpCode:   incoming.OpCode,
		Data:     incoming.Data,
		Reliable: incoming.Reliable,
	}}}

	p.router.SendToPresenceIDs(logger, presenceIDs, outgoing, incoming.Reliable)
}
