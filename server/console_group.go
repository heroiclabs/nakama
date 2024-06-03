// Copyright 2022 The Nakama Authors
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
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type consoleGroupCursor struct {
	ID   uuid.UUID
	Name string
}

func (s *ConsoleServer) ListGroups(ctx context.Context, in *console.ListGroupsRequest) (*console.GroupList, error) {
	const defaultLimit = 50

	// Validate cursor, if provided.
	var cursor *consoleGroupCursor
	if in.Cursor != "" {
		cb, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Error("Error decoding group list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode group list request cursor.")
		}
		cursor = &consoleGroupCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(&cursor); err != nil {
			s.logger.Error("Error decoding account list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode group list request cursor.")
		}
	}

	buildListGroupsQuery := func(cursor *consoleGroupCursor, filter string) (query string, params []interface{}, limit int) {
		// Check if we have a filter and it's a group ID.
		var groupIDFilter *uuid.UUID
		if filter != "" {
			groupID, err := uuid.FromString(filter)
			if err == nil {
				groupIDFilter = &groupID
			}
		}

		limit = defaultLimit
		switch {
		case groupIDFilter != nil:
			// Filtering for a single exact group ID. Querying on primary key (id).
			query = `SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups WHERE id = $1`
			params = []interface{}{*groupIDFilter}
			limit = 0
		// Pagination not possible.
		case filter != "" && strings.Contains(filter, "%"):
			// Filtering for a partial username. Querying and paginating on unique index (name).
			query = `SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups WHERE name ILIKE $1`
			params = []interface{}{filter}
			// Pagination is possible.
			if cursor != nil {
				query += " AND name > $2"
				params = append(params, cursor.Name)
			}
			// Order and limit.
			params = append(params, limit+1)
			query += "ORDER BY name ASC LIMIT $" + strconv.Itoa(len(params))
		case filter != "":
			// Filtering for an exact username. Querying on unique index (name).
			query = `SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups WHERE name = $1`
			params = []interface{}{filter}
			limit = 0
		// Pagination not possible.
		case cursor != nil:
			// Non-filtered, but paginated query. Assume pagination on group ID. Querying and paginating on primary key (id).
			query = `SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups WHERE id > $1 ORDER BY id ASC LIMIT $2`
			params = []interface{}{cursor.ID, limit + 1}
		default:
			// Non-filtered, non-paginated query. Querying and paginating on primary key (id).
			query = `SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups ORDER BY id ASC LIMIT $1`
			params = []interface{}{limit + 1}
		}

		return query, params, limit
	}

	query, params, limit := buildListGroupsQuery(cursor, in.Filter)

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		s.logger.Error("Error querying groups.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list groups.")
	}

	groups := make([]*api.Group, 0, defaultLimit)
	var nextCursor *consoleGroupCursor
	var previousGroup *api.Group

	for rows.Next() {
		group, _, err := convertToGroup(rows)
		if err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning groups.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list groups.")
		}
		// checks limit before append for the use case where (last page == limit) => null cursor
		if limit > 0 && len(groups) >= limit {
			nextCursor = &consoleGroupCursor{
				ID:   uuid.FromStringOrNil(previousGroup.Id),
				Name: previousGroup.Name,
			}
			break
		}
		groups = append(groups, group)
		previousGroup = group
	}
	_ = rows.Close()

	response := &console.GroupList{
		Groups:     groups,
		TotalCount: countDatabase(ctx, s.logger, s.db, "groups"),
	}

	if nextCursor != nil {
		cursorBuf := &bytes.Buffer{}
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			s.logger.Error("Error encoding groups cursor.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list groups.")
		}
		response.NextCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return response, nil
}

func (s *ConsoleServer) DeleteGroup(ctx context.Context, in *console.DeleteGroupRequest) (*emptypb.Empty, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	if err = DeleteGroup(ctx, s.logger, s.db, groupID, uuid.Nil); err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) GetGroup(ctx context.Context, in *console.GroupId) (*api.Group, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	group, err := getGroup(ctx, s.logger, s.db, groupID)
	if err != nil {
		if err == runtime.ErrGroupNotFound {
			return nil, status.Error(codes.NotFound, "Group not found.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to retrieve group.")
	}

	return group, nil
}

func (s *ConsoleServer) ExportGroup(ctx context.Context, in *console.GroupId) (*console.GroupExport, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}
	if groupID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot export the group.")
	}

	group, err := getGroup(ctx, s.logger, s.db, groupID)
	if err != nil {
		if err == runtime.ErrGroupNotFound {
			return nil, status.Error(codes.NotFound, "Group not found.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to export group data.")
	}

	users, err := ListGroupUsers(ctx, s.logger, s.db, s.statusRegistry, groupID, 0, nil, "")
	if err != nil {
		return nil, status.Error(codes.Internal, "An error occurred while trying to export group members.")
	}

	return &console.GroupExport{
		Group:   group,
		Members: users.GroupUsers,
	}, nil
}

func (s *ConsoleServer) UpdateGroup(ctx context.Context, in *console.UpdateGroupRequest) (*emptypb.Empty, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	var maxCount int
	if in.MaxCount != nil {
		maxCount = int(in.MaxCount.Value)
	}

	err = UpdateGroup(ctx, s.logger, s.db, groupID, uuid.Nil, uuid.Nil, in.Name, in.LangTag, in.Description, in.AvatarUrl, in.Metadata, in.Open, maxCount)
	if err != nil {
		return nil, err
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) GetMembers(ctx context.Context, in *console.GroupId) (*api.GroupUserList, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	users, err := ListGroupUsers(ctx, s.logger, s.db, s.statusRegistry, groupID, 0, nil, "")
	if err != nil {
		return nil, status.Error(codes.Internal, "An error occurred while trying to list group members.")
	}

	return users, nil
}

func (s *ConsoleServer) DemoteGroupMember(ctx context.Context, in *console.UpdateGroupUserStateRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	groupID, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	demoteGroupUser := func(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, uid uuid.UUID) error {
		myState := 0
		if caller != uuid.Nil {
			var dbState sql.NullInt64
			query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
			if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
				if err == sql.ErrNoRows {
					logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
					return runtime.ErrGroupPermissionDenied
				}
				logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return err
			}

			myState = int(dbState.Int64)
			if myState > 1 {
				logger.Info("Cannot demote users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
				return runtime.ErrGroupPermissionDenied
			}
		}

		var groupExists sql.NullBool
		query := "SELECT EXISTS (SELECT id FROM groups WHERE id = $1 AND disable_time = '1970-01-01 00:00:00 UTC')"
		err := db.QueryRowContext(ctx, query, groupID).Scan(&groupExists)
		if err != nil {
			logger.Error("Could not look up group when demoting users.", zap.Error(err), zap.String("group_id", groupID.String()))
			return err
		}
		if !groupExists.Bool {
			logger.Info("Cannot demote users in a disabled group.", zap.String("group_id", groupID.String()))
			return runtime.ErrGroupNotFound
		}

		// Prepare the messages we'll need to send to the group channel.
		stream := PresenceStream{
			Mode:    StreamModeGroup,
			Subject: groupID,
		}
		channelID, err := StreamToChannelId(stream)
		if err != nil {
			logger.Error("Could not create channel ID.", zap.Error(err))
			return err
		}

		if uid == caller {
			return errors.New("cannot demote self")
		}

		var message *api.ChannelMessage
		ts := time.Now().Unix()

		if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
			query := ""
			if myState == 0 {
				// Ensure we aren't removing the last superadmin when deleting authoritatively.
				// Query is for superadmin or if done authoritatively.
				query = `
UPDATE group_edge SET state = state + 1
WHERE
  (
    (source_id = $1::UUID AND destination_id = $2::UUID AND state >= $3 AND state < $4)
    OR
    (source_id = $2::UUID AND destination_id = $1::UUID AND state >= $3 AND state < $4)
  )
AND
  (
    (SELECT COUNT(destination_id) FROM group_edge WHERE source_id = $1::UUID AND destination_id != $2::UUID AND state = 0) > 0
  )
RETURNING state`
			}

			var newState sql.NullInt64
			if err := tx.QueryRowContext(ctx, query, groupID, uid, myState, api.GroupUserList_GroupUser_MEMBER).Scan(&newState); err != nil {
				if err == sql.ErrNoRows {
					return ErrEmptyMemberDemote
				}
				logger.Debug("Could not demote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			// Look up the username.
			var username sql.NullString
			query = "SELECT username FROM users WHERE id = $1::UUID"
			if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
				if err == sql.ErrNoRows {
					return runtime.ErrGroupUserNotFound
				}
				logger.Debug("Could not retrieve username to demote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			message = &api.ChannelMessage{
				ChannelId:  channelID,
				MessageId:  uuid.Must(uuid.NewV4()).String(),
				Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupDemote},
				SenderId:   uid.String(),
				Username:   username.String,
				Content:    "{}",
				CreateTime: &timestamppb.Timestamp{Seconds: ts},
				UpdateTime: &timestamppb.Timestamp{Seconds: ts},
				Persistent: &wrapperspb.BoolValue{Value: true},
				GroupId:    groupID.String(),
			}

			query = `INSERT INTO message (id, code, sender_id, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $6::UUID, $7::UUID, $8, $9, $10, $10)`
			if _, err := tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
				logger.Debug("Could not insert group demote channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}
			return nil
		}); err != nil {
			if err != ErrEmptyMemberDemote {
				logger.Error("Error demoting users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
			}
			return err
		}
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
		return nil
	}

	if err = demoteGroupUser(ctx, s.logger, s.db, s.router, uuid.Nil, groupID, userID); err != nil {
		if err == ErrEmptyMemberDemote {
			return nil, status.Error(codes.FailedPrecondition, "Cannot demote user in the group.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to demote the user in the group.")
	}
	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) PromoteGroupMember(ctx context.Context, in *console.UpdateGroupUserStateRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	groupID, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	promoteGroupUser := func(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, uid uuid.UUID) error {
		//myState, tx, err := preGroupUserStateChangeValidate(ctx, logger, db, groupID, caller)
		//if err != nil {
		//	return err
		//}
		myState := 0
		if caller != uuid.Nil {
			var dbState sql.NullInt64
			query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
			if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
				if err == sql.ErrNoRows {
					logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
					return runtime.ErrGroupPermissionDenied
				}
				logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return err
			}

			myState = int(dbState.Int64)
			if myState > 1 {
				logger.Info("Cannot promote users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
				return runtime.ErrGroupPermissionDenied
			}
		}

		var groupExists sql.NullBool
		query := "SELECT EXISTS (SELECT id FROM groups WHERE id = $1 AND disable_time = '1970-01-01 00:00:00 UTC')"
		err := db.QueryRowContext(ctx, query, groupID).Scan(&groupExists)
		if err != nil {
			logger.Error("Could not look up group when promoting users.", zap.Error(err), zap.String("group_id", groupID.String()))
			return err
		}
		if !groupExists.Bool {
			logger.Info("Cannot promote users in a disabled group.", zap.String("group_id", groupID.String()))
			return runtime.ErrGroupNotFound
		}

		// Prepare the messages we'll need to send to the group channel.
		stream := PresenceStream{
			Mode:    StreamModeGroup,
			Subject: groupID,
		}
		channelID, err := StreamToChannelId(stream)
		if err != nil {
			logger.Error("Could not create channel ID.", zap.Error(err))
			return err
		}

		var message *api.ChannelMessage
		ts := time.Now().Unix()

		if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
			if uid == caller {
				return errors.New("cannot promote self")
			}

			query := `
UPDATE group_edge SET state = state - 1
WHERE
	(source_id = $1::UUID AND destination_id = $2::UUID AND state > 0 AND state > $3)
OR
	(source_id = $2::UUID AND destination_id = $1::UUID AND state > 0 AND state > $3)
RETURNING state`

			var newState sql.NullInt64
			if err := tx.QueryRowContext(ctx, query, groupID, uid, myState).Scan(&newState); err != nil {
				if err == sql.ErrNoRows {
					return ErrEmptyMemberPromote
				}
				logger.Debug("Could not promote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			if newState.Int64 == 2 {
				err := incrementGroupEdge(ctx, logger, tx, uid, groupID)
				if err != nil {
					return err
				}
			}

			// Look up the username.
			var username sql.NullString
			query = "SELECT username FROM users WHERE id = $1::UUID"
			if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
				if err == sql.ErrNoRows {
					return runtime.ErrGroupUserNotFound
				}
				logger.Debug("Could not retrieve username to promote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			message = &api.ChannelMessage{
				ChannelId:  channelID,
				MessageId:  uuid.Must(uuid.NewV4()).String(),
				Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupPromote},
				SenderId:   uid.String(),
				Username:   username.String,
				Content:    "{}",
				CreateTime: &timestamppb.Timestamp{Seconds: ts},
				UpdateTime: &timestamppb.Timestamp{Seconds: ts},
				Persistent: &wrapperspb.BoolValue{Value: true},
				GroupId:    groupID.String(),
			}

			query = `INSERT INTO message (id, code, sender_id, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $6::UUID, $7::UUID, $8, $9, $10, $10)`
			if _, err := tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
				logger.Debug("Could not insert group demote channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}
			return nil
		}); err != nil {
			if err != ErrEmptyMemberPromote {
				logger.Error("Error promoting users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
			}
			return err
		}
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
		return nil
	}

	if err = promoteGroupUser(ctx, s.logger, s.db, s.router, uuid.Nil, groupID, userID); err != nil {
		if err == ErrEmptyMemberPromote {
			return nil, status.Error(codes.FailedPrecondition, "Cannot promote user in the group.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to promote the user in the group.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) AddGroupUsers(ctx context.Context, in *console.AddGroupUsersRequest) (*emptypb.Empty, error) {
	groupUid, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.NotFound, "Invalid group ID format.")
	}
	ids := strings.Split(in.Ids, ",")
	uuids := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		id := strings.TrimSpace(id)
		uid, err := uuid.FromString(id)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID format: "+id)
		}
		uuids = append(uuids, uid)
	}

	if in.JoinRequest {
		for _, uid := range uuids {
			// Look up the username, and implicitly if this user exists.
			var username sql.NullString
			query := "SELECT username FROM users WHERE id = $1::UUID"
			if err = s.db.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
				if err == sql.ErrNoRows {
					return nil, status.Error(codes.InvalidArgument, "User not found: "+uid.String()+". Refresh the page to see any updates.")
				}
				s.logger.Debug("Could not retrieve username to join user to group.", zap.Error(err), zap.String("user_id", uid.String()))
				return nil, status.Error(codes.Internal, "An error occurred while trying to join the user to the group. Refresh the page to see any updates.")
			}
			if err = JoinGroup(ctx, s.logger, s.db, s.tracker, s.router, groupUid, uid, username.String); err != nil {
				return nil, status.Error(codes.Internal, "An error occurred while trying to join an user to the group, refresh the page: "+err.Error()+". Refresh the page to see any updates.")
			}
		}
	} else {
		if err = AddGroupUsers(ctx, s.logger, s.db, s.tracker, s.router, uuid.Nil, groupUid, uuids); err != nil {
			return nil, status.Error(codes.Internal, "An error occurred while trying to add the users: "+err.Error())
		}
	}
	return &emptypb.Empty{}, nil
}
