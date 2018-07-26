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
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/zap"
	"strconv"
	"strings"
)

func (p *Pipeline) statusFollow(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetStatusFollow()

	if len(incoming.UserIds) == 0 {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
			Presences: make([]*rtapi.UserPresence, 0),
		}}})
		return
	}

	uniqueUserIDs := make(map[uuid.UUID]struct{}, len(incoming.UserIds))
	for _, uid := range incoming.UserIds {
		userID, err := uuid.FromString(uid)
		if err != nil {
			session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user identifier",
			}}})
			return
		}
		uniqueUserIDs[userID] = struct{}{}
	}

	userIDs := make([]interface{}, 0, len(uniqueUserIDs))
	statements := make([]string, 0, len(uniqueUserIDs))
	index := 1
	for userID, _ := range uniqueUserIDs {
		userIDs = append(userIDs, userID)
		statements = append(statements, "$"+strconv.Itoa(index)+"::UUID")
		index++
	}

	query := "SELECT COUNT(id) FROM users WHERE id IN (" + strings.Join(statements, ", ") + ")"
	var dbCount int
	err := p.db.QueryRow(query, userIDs...).Scan(&dbCount)
	if err != nil {
		logger.Error("Error checking users in status follow", zap.Error(err))
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Could not check users",
		}}})
		return
	}
	if dbCount != len(userIDs) {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "One or more users do not exist",
		}}})
		return
	}

	presences := make([]*rtapi.UserPresence, 0, len(userIDs))
	for userID, _ := range uniqueUserIDs {
		stream := PresenceStream{Mode: StreamModeStatus, Subject: userID}
		success, _ := p.tracker.Track(session.ID(), stream, session.UserID(), PresenceMeta{Format: session.Format(), Username: session.Username(), Hidden: true}, false)
		if !success {
			session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not follow user status",
			}}})
			return
		}

		ps := p.tracker.ListByStream(stream, false, true)
		for _, p := range ps {
			presences = append(presences, &rtapi.UserPresence{
				UserId:    p.UserID.String(),
				SessionId: p.ID.SessionID.String(),
				Username:  p.Meta.Username,
				Status:    &wrappers.StringValue{Value: p.Meta.Status},
			})
		}
	}

	session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
		Presences: presences,
	}}})
}

func (p *Pipeline) statusUnfollow(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetStatusUnfollow()

	if len(incoming.UserIds) == 0 {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid})
		return
	}

	userIDs := make([]uuid.UUID, 0, len(incoming.UserIds))
	for _, uid := range incoming.UserIds {
		userID, err := uuid.FromString(uid)
		if err != nil {
			session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user identifier",
			}}})
			return
		}
		userIDs = append(userIDs, userID)
	}

	for _, userID := range userIDs {
		p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: userID}, session.UserID())
	}

	session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid})
}

func (p *Pipeline) statusUpdate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetStatusUpdate()

	if incoming.Status == nil {
		p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID())

		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid})
		return
	}

	if len(incoming.Status.Value) > 128 {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Status must be 128 characters or less",
		}}})
		return
	}

	success := p.tracker.Update(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID(), PresenceMeta{
		Format:   session.Format(),
		Username: session.Username(),
		Status:   incoming.Status.Value,
	}, false)

	if !success {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error tracking status update",
		}}})
		return
	}

	session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid})
}
