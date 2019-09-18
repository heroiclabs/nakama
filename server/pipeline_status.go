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
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"strconv"
	"strings"
)

func (p *Pipeline) statusFollow(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetStatusFollow()

	if len(incoming.UserIds) == 0 && len(incoming.Usernames) == 0 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
			Presences: make([]*rtapi.UserPresence, 0),
		}}}, true)
		return
	}

	// Deduplicate user IDs.
	uniqueUserIDs := make(map[uuid.UUID]struct{}, len(incoming.UserIds))
	for _, uid := range incoming.UserIds {
		userID, err := uuid.FromString(uid)
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user identifier",
			}}}, true)
			return
		}

		uniqueUserIDs[userID] = struct{}{}
	}

	// Deduplicate usernames.
	// Note: we do not yet know if these usernames and the previous user IDs may point to the same user account.
	uniqueUsernames := make(map[string]struct{}, len(incoming.Usernames))
	for _, username := range incoming.Usernames {
		if username == "" {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid username",
			}}}, true)
			return
		}

		uniqueUsernames[username] = struct{}{}
	}

	var followUserIDs map[uuid.UUID]struct{}
	if len(uniqueUsernames) == 0 {
		params := make([]interface{}, 0, len(uniqueUserIDs))
		statements := make([]string, 0, len(uniqueUserIDs))
		for userID := range uniqueUserIDs {
			params = append(params, userID)
			statements = append(statements, "$"+strconv.Itoa(len(params))+"::UUID")
		}

		// See if all the users exist.
		query := "SELECT COUNT(id) FROM users WHERE id IN (" + strings.Join(statements, ", ") + ")"
		var dbCount int
		err := p.db.QueryRowContext(session.Context(), query, params...).Scan(&dbCount)
		if err != nil {
			logger.Error("Error checking users in status follow", zap.Error(err))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not check users",
			}}}, true)
			return
		}

		// If one or more users were missing reject the whole operation.
		if dbCount != len(params) {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "One or more users do not exist",
			}}}, true)
			return
		}

		followUserIDs = uniqueUserIDs
	} else {
		query := "SELECT id FROM users WHERE "

		params := make([]interface{}, 0, len(uniqueUserIDs))
		statements := make([]string, 0, len(uniqueUserIDs))
		for userID := range uniqueUserIDs {
			params = append(params, userID)
			statements = append(statements, "$"+strconv.Itoa(len(params))+"::UUID")
		}
		if len(statements) != 0 {
			query += "id IN (" + strings.Join(statements, ", ") + ")"
			statements = make([]string, 0, len(uniqueUsernames))
		}

		for username := range uniqueUsernames {
			params = append(params, username)
			statements = append(statements, "$"+strconv.Itoa(len(params)))
		}
		if len(uniqueUserIDs) != 0 {
			query += " OR "
		}
		query += "username IN (" + strings.Join(statements, ", ") + ")"

		followUserIDs = make(map[uuid.UUID]struct{}, len(uniqueUserIDs)+len(uniqueUsernames))

		// See if all the users exist.
		rows, err := p.db.QueryContext(session.Context(), query, params...)
		if err != nil {
			logger.Error("Error checking users in status follow", zap.Error(err))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not check users",
			}}}, true)
			return
		}
		for rows.Next() {
			var id string
			err := rows.Scan(&id)
			if err != nil {
				_ = rows.Close()
				logger.Error("Error scanning users in status follow", zap.Error(err))
				session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
					Message: "Could not check users",
				}}}, true)
				return
			}
			uid, err := uuid.FromString(id)
			if err != nil {
				_ = rows.Close()
				logger.Error("Error parsing users in status follow", zap.Error(err))
				session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
					Message: "Could not check users",
				}}}, true)
				return
			}

			followUserIDs[uid] = struct{}{}
		}
		_ = rows.Close()

		// If one or more users were missing reject the whole operation.
		// Note: any overlap between user IDs and usernames (pointing to the same user) will also fail here.
		if len(followUserIDs) != len(uniqueUserIDs)+len(uniqueUsernames) {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "One or more users do not exist",
			}}}, true)
			return
		}
	}

	// Follow all of the validated user IDs, and prepare a list of current presences to return.
	presences := make([]*rtapi.UserPresence, 0, len(followUserIDs))
	for userID := range followUserIDs {
		stream := PresenceStream{Mode: StreamModeStatus, Subject: userID}
		success, _ := p.tracker.Track(session.ID(), stream, session.UserID(), PresenceMeta{Format: session.Format(), Username: session.Username(), Hidden: true}, false)
		if !success {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not follow user status",
			}}}, true)
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

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
		Presences: presences,
	}}}, true)
}

func (p *Pipeline) statusUnfollow(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetStatusUnfollow()

	if len(incoming.UserIds) == 0 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
		return
	}

	userIDs := make([]uuid.UUID, 0, len(incoming.UserIds))
	for _, uid := range incoming.UserIds {
		userID, err := uuid.FromString(uid)
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user identifier",
			}}}, true)
			return
		}
		userIDs = append(userIDs, userID)
	}

	for _, userID := range userIDs {
		p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: userID}, session.UserID())
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) statusUpdate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetStatusUpdate()

	if incoming.Status == nil {
		p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID())

		session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
		return
	}

	if len(incoming.Status.Value) > 128 {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Status must be 128 characters or less",
		}}}, true)
		return
	}

	success := p.tracker.Update(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID(), PresenceMeta{
		Format:   session.Format(),
		Username: session.Username(),
		Status:   incoming.Status.Value,
	}, false)

	if !success {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error tracking status update",
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}
