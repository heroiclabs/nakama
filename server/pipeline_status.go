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
	"fmt"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func (p *Pipeline) statusFollow(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetStatusFollow()

	if len(incoming.UserIds) == 0 && len(incoming.Usernames) == 0 {
		out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
			Presences: make([]*rtapi.UserPresence, 0),
		}}}
		_ = session.Send(out, true)

		return true, nil
	}

	// Deduplicate user IDs.
	uniqueUserIDs := make(map[uuid.UUID]struct{}, len(incoming.UserIds))
	for _, uid := range incoming.UserIds {
		userID, err := uuid.FromString(uid)
		if err != nil {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user identifier",
			}}}, true)
			return false, nil
		}
		if userID == session.UserID() {
			// The user cannot follow themselves.
			continue
		}

		uniqueUserIDs[userID] = struct{}{}
	}

	// Deduplicate usernames.
	// Note: we do not yet know if these usernames and the previous user IDs may point to the same user account.
	uniqueUsernames := make(map[string]struct{}, len(incoming.Usernames))
	for _, username := range incoming.Usernames {
		if username == "" {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid username",
			}}}, true)
			return false, nil
		}
		if username == session.Username() {
			// The user cannot follow themselves.
			continue
		}

		uniqueUsernames[username] = struct{}{}
	}

	if len(uniqueUserIDs) == 0 && len(uniqueUsernames) == 0 {
		out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
			Presences: make([]*rtapi.UserPresence, 0),
		}}}
		_ = session.Send(out, true)

		return true, out
	}

	followUserIDs := make(map[uuid.UUID]struct{}, len(uniqueUserIDs)+len(uniqueUsernames))
	foundUsernames := make(map[string]struct{}, len(uniqueUsernames))
	if len(uniqueUsernames) == 0 {
		ids := make([]uuid.UUID, 0, len(uniqueUserIDs))
		for userID := range uniqueUserIDs {
			ids = append(ids, userID)
		}

		// See if all the users exist.
		query := "SELECT id FROM users WHERE id = ANY($1::UUID[])"
		rows, err := p.db.QueryContext(session.Context(), query, ids)
		if err != nil {
			logger.Error("Error checking users in status follow", zap.Error(err))
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not check users",
			}}}, true)
			return false, nil
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				_ = rows.Close()
				logger.Error("Error scanning users in status follow", zap.Error(err))
				break
			}
			userID := uuid.FromStringOrNil(id)
			if userID == uuid.Nil {
				// Cannot follow the system user.
				continue
			}
			followUserIDs[userID] = struct{}{}
		}
		_ = rows.Close()
	} else {
		query := "SELECT id, username FROM users WHERE "

		params := make([]any, 0, 2)
		ids := make([]uuid.UUID, 0, len(uniqueUserIDs))
		for userID := range uniqueUserIDs {
			ids = append(ids, userID)
		}
		if len(ids) != 0 {
			params = append(params, ids)
			query += fmt.Sprintf("id = ANY($%d::UUID[])", len(params))
		}

		usernames := make([]string, 0, len(uniqueUsernames))
		for username := range uniqueUsernames {
			usernames = append(usernames, username)
		}
		if len(uniqueUserIDs) != 0 {
			query += " OR "
		}
		params = append(params, usernames)
		query += fmt.Sprintf("username = ANY($%d::text[])", len(params))

		// See if all the users exist.
		rows, err := p.db.QueryContext(session.Context(), query, params...)
		if err != nil {
			logger.Error("Error checking users in status follow", zap.Error(err))
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not check users",
			}}}, true)
			return false, nil
		}
		for rows.Next() {
			var id string
			var username string
			if err := rows.Scan(&id, &username); err != nil {
				_ = rows.Close()
				logger.Error("Error scanning users in status follow", zap.Error(err))
				_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
					Message: "Could not check users",
				}}}, true)
				return false, nil
			}

			// Mark the username as found.
			foundUsernames[username] = struct{}{}

			userID := uuid.FromStringOrNil(id)
			if userID == session.UserID() || userID == uuid.Nil {
				// The user cannot follow themselves or the system user.
				continue
			}

			followUserIDs[userID] = struct{}{}
		}
		_ = rows.Close()
	}

	if l := len(uniqueUserIDs) + len(uniqueUsernames); len(followUserIDs) != l {
		// There's a mismatch in what the user wanted to follow and what is actually possible to follow.
		missingUserIDs := make([]string, 0, l)
		missingUsernames := make([]string, 0, l)
		for userID := range uniqueUserIDs {
			if _, found := followUserIDs[userID]; !found {
				missingUserIDs = append(missingUserIDs, userID.String())
			}
		}
		for username := range uniqueUsernames {
			if _, found := foundUsernames[username]; !found {
				missingUsernames = append(missingUsernames, username)
			}
		}
		if len(missingUserIDs) != 0 || len(missingUsernames) != 0 {
			logger.Debug("Could not follow users, no user found", zap.Strings("user_ids", missingUserIDs), zap.Strings("usernames", missingUsernames))
		}
	}

	// Follow all validated user IDs, and prepare a list of current presences to return.
	p.statusRegistry.Follow(session.ID(), followUserIDs)

	presences := make([]*rtapi.UserPresence, 0, len(followUserIDs))
	for userID := range followUserIDs {
		ps := p.tracker.ListByStream(PresenceStream{Mode: StreamModeStatus, Subject: userID}, false, true)
		for _, p := range ps {
			presences = append(presences, &rtapi.UserPresence{
				UserId:    p.UserID.String(),
				SessionId: p.ID.SessionID.String(),
				Username:  p.Meta.Username,
				Status:    &wrapperspb.StringValue{Value: p.Meta.Status},
			})
		}
	}

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Status{Status: &rtapi.Status{
		Presences: presences,
	}}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) statusUnfollow(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetStatusUnfollow()

	if len(incoming.UserIds) == 0 {
		out := &rtapi.Envelope{Cid: envelope.Cid}
		_ = session.Send(out, true)

		return true, out
	}

	userIDs := make([]uuid.UUID, 0, len(incoming.UserIds))
	for _, uid := range incoming.UserIds {
		userID, err := uuid.FromString(uid)
		if err != nil {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user identifier",
			}}}, true)
			return false, nil
		}
		if userID == session.UserID() {
			// The user cannot unfollow themselves.
			continue
		}
		userIDs = append(userIDs, userID)
	}

	p.statusRegistry.Unfollow(session.ID(), userIDs)

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) statusUpdate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetStatusUpdate()

	if incoming.Status == nil {
		p.tracker.Untrack(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID())

		out := &rtapi.Envelope{Cid: envelope.Cid}
		_ = session.Send(out, true)

		return true, out
	}

	if len(incoming.Status.Value) > 2048 {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Status must be 2048 characters or less",
		}}}, true)
		return false, nil
	}

	success := p.tracker.Update(session.Context(), session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID(), PresenceMeta{
		Format:   session.Format(),
		Username: session.Username(),
		Status:   incoming.Status.Value,
	})

	if !success {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error tracking status update",
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}
