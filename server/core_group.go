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
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"strconv"
	"strings"
	"time"

	"github.com/heroiclabs/nakama-common/rtapi"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/jackc/pgx"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var (
	ErrGroupNameInUse         = errors.New("group name in use")
	ErrGroupPermissionDenied  = errors.New("group permission denied")
	ErrGroupNoUpdateOps       = errors.New("no group updates")
	ErrGroupNotUpdated        = errors.New("group not updated")
	ErrGroupNotFound          = errors.New("group not found")
	ErrGroupFull              = errors.New("group is full")
	ErrGroupUserNotFound      = errors.New("user not found")
	ErrGroupLastSuperadmin    = errors.New("user is last group superadmin")
	ErrGroupUserInvalidCursor = errors.New("group user cursor invalid")
	ErrUserGroupInvalidCursor = errors.New("user group cursor invalid")
)

type groupListCursor struct {
	Lang      string
	EdgeCount int32
	ID        uuid.UUID
}

func CreateGroup(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, creatorID uuid.UUID, name, lang, desc, avatarURL, metadata string, open bool, maxCount int) (*api.Group, error) {
	if userID == uuid.Nil {
		logger.Panic("This function must be used with non-system user ID.")
	}

	state := 1
	if open {
		state = 0
	}

	params := []interface{}{uuid.Must(uuid.NewV4()), creatorID, name, desc, avatarURL, state}
	statements := []string{"$1", "$2", "$3", "$4", "$5", "$6"}

	query := "INSERT INTO groups(id, creator_id, name, description, avatar_url, state"

	// Add lang tag if any.
	if lang != "" {
		query += ", lang_tag"
		params = append(params, lang)
		statements = append(statements, "$"+strconv.Itoa(len(params)))
	}
	// Add max count if any.
	if maxCount > 0 {
		query += ", max_count"
		params = append(params, maxCount)
		statements = append(statements, "$"+strconv.Itoa(len(params)))
	}
	// Add metadata if any.
	if metadata != "" {
		query += ", metadata"
		params = append(params, metadata)
		statements = append(statements, "$"+strconv.Itoa(len(params)))
	}

	// Add the trailing edge count value.
	query += `, edge_count) VALUES (` + strings.Join(statements, ",") + `,1)
RETURNING id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time`

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, err
	}

	var group *api.Group
	if err = ExecuteInTx(ctx, tx, func() error {
		rows, err := tx.QueryContext(ctx, query, params...)
		if err != nil {
			logger.Debug("Could not create group.", zap.Error(err))
			return err
		}
		// Rows closed in groupConvertRows()

		groups, err := groupConvertRows(rows)
		if err != nil {
			if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorUniqueViolation {
				logger.Info("Could not create group as it already exists.", zap.String("name", name))
				return ErrGroupNameInUse
			}
			logger.Debug("Could not parse rows.", zap.Error(err))
			return err
		}

		group = groups[0]
		_, err = groupAddUser(ctx, db, tx, uuid.Must(uuid.FromString(group.Id)), userID, 0)
		if err != nil {
			logger.Debug("Could not add user to group.", zap.Error(err))
			return err
		}

		return nil
	}); err != nil {
		if err == ErrGroupNameInUse {
			return nil, ErrGroupNameInUse
		}
		logger.Error("Error creating group.", zap.Error(err))
		return nil, err
	}

	return group, nil
}

func UpdateGroup(ctx context.Context, logger *zap.Logger, db *sql.DB, groupID uuid.UUID, userID uuid.UUID, creatorID uuid.UUID, name, lang, desc, avatar, metadata *wrapperspb.StringValue, open *wrapperspb.BoolValue, maxCount int) error {
	if userID != uuid.Nil {
		allowedUser, err := groupCheckUserPermission(ctx, logger, db, groupID, userID, 1)
		if err != nil {
			return err
		}

		if !allowedUser {
			logger.Info("User does not have permission to update group.", zap.String("group", groupID.String()), zap.String("user", userID.String()))
			return ErrGroupPermissionDenied
		}
	}

	statements := make([]string, 0)
	params := []interface{}{groupID}
	index := 2

	if name != nil {
		statements = append(statements, "name = $"+strconv.Itoa(index))
		params = append(params, name.GetValue())
		index++
	}

	if lang != nil {
		statements = append(statements, "lang_tag = $"+strconv.Itoa(index))
		params = append(params, lang.GetValue())
		index++
	}

	if desc != nil {
		if u := desc.GetValue(); u == "" {
			statements = append(statements, "description = NULL")
		} else {
			statements = append(statements, "description = $"+strconv.Itoa(index))
			params = append(params, u)
			index++
		}
	}

	if avatar != nil {
		if u := avatar.GetValue(); u == "" {
			statements = append(statements, "avatar_url = NULL")
		} else {
			statements = append(statements, "avatar_url = $"+strconv.Itoa(index))
			params = append(params, u)
			index++
		}
	}

	if open != nil {
		state := 0
		if !open.GetValue() {
			state = 1
		}
		statements = append(statements, "state = $"+strconv.Itoa(index))
		params = append(params, state)
		index++
	}

	if metadata != nil {
		statements = append(statements, "metadata = $"+strconv.Itoa(index))
		params = append(params, metadata.GetValue())
		index++
	}

	if maxCount >= 1 {
		statements = append(statements, "max_count = $"+strconv.Itoa(index))
		params = append(params, maxCount)
		index++
	}

	if creatorID != uuid.Nil {
		statements = append(statements, "creator_id = $"+strconv.Itoa(index))
		params = append(params, creatorID)
	}

	if len(statements) == 0 {
		logger.Info("Did not update group as no fields were changed.")
		return ErrGroupNoUpdateOps
	}

	query := "UPDATE groups SET update_time = now(), " + strings.Join(statements, ", ") + " WHERE (id = $1) AND (disable_time = '1970-01-01 00:00:00 UTC')"
	res, err := db.ExecContext(ctx, query, params...)
	if err != nil {
		if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorUniqueViolation {
			logger.Info("Could not update group as it already exists.", zap.String("group_id", groupID.String()))
			return ErrGroupNameInUse
		}
		logger.Error("Could not update group.", zap.Error(err))
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		logger.Error("Could not get rows affected after group update query.", zap.Error(err))
		return err
	}
	if rowsAffected == 0 {
		return ErrGroupNotUpdated
	}
	return nil
}

func DeleteGroup(ctx context.Context, logger *zap.Logger, db *sql.DB, groupID uuid.UUID, userID uuid.UUID) error {
	if userID != uuid.Nil {
		// only super-admins can delete group.
		allowedUser, err := groupCheckUserPermission(ctx, logger, db, groupID, userID, 0)
		if err != nil {
			return err
		}

		if !allowedUser {
			logger.Info("User does not have permission to delete group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return ErrGroupPermissionDenied
		}
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		return deleteGroup(ctx, logger, tx, groupID)
	}); err != nil {
		logger.Error("Error deleting group.", zap.Error(err))
		return err
	}

	return nil
}

func JoinGroup(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, groupID uuid.UUID, userID uuid.UUID, username string) error {
	query := `
SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups
WHERE (id = $1) AND (disable_time = '1970-01-01 00:00:00 UTC')`
	rows, err := db.QueryContext(ctx, query, groupID)
	if err != nil {
		logger.Error("Could not look up group while trying to join it.", zap.Error(err))
		return err
	}
	// Rows closed in groupConvertRows()

	groups, err := groupConvertRows(rows)
	if err != nil {
		logger.Error("Could not parse groups.", zap.Error(err))
		return err
	}

	if len(groups) == 0 {
		logger.Info("Group does not exist.", zap.Error(err), zap.String("group_id", groupID.String()))
		return ErrGroupNotFound
	}

	group := groups[0]
	if group.EdgeCount >= group.MaxCount {
		logger.Info("Group maximum count has reached.", zap.Error(err), zap.String("group_id", groupID.String()))
		return ErrGroupFull
	}

	state := 2
	if !group.Open.Value {
		state = 3
		_, err = groupAddUser(ctx, db, nil, uuid.Must(uuid.FromString(group.Id)), userID, state)
		if err != nil {
			if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorUniqueViolation {
				logger.Info("Could not add user to group as relationship already exists.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return nil // completed successfully
			}

			logger.Error("Could not add user to group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		// If it's a private group notify superadmins/admins that someone has requested to join.
		// Prepare notification data.
		notificationContentBytes, err := json.Marshal(map[string]string{"group_id": groupID.String(), "username": username})
		if err != nil {
			logger.Error("Could not encode notification content.", zap.Error(err))
		} else {
			notificationContent := string(notificationContentBytes)
			notificationSubject := fmt.Sprintf("User %v wants to join your group", username)
			notifications := make(map[uuid.UUID][]*api.Notification)

			query = "SELECT destination_id FROM group_edge WHERE source_id = $1::UUID AND (state = 0 OR state = 1)"
			rows, err := db.QueryContext(ctx, query, groupID)
			if err != nil {
				// Errors here will not cause the join operation to fail.
				logger.Error("Error looking up group admins to notify of join request.", zap.Error(err))
			} else {
				for rows.Next() {
					var id string
					if err = rows.Scan(&id); err != nil {
						// Errors here will not cause the join operation to fail.
						logger.Error("Error reading up group admins to notify of join request.", zap.Error(err))
						break
					}

					adminID := uuid.FromStringOrNil(id)
					notifications[adminID] = []*api.Notification{
						{
							Id:         uuid.Must(uuid.NewV4()).String(),
							Subject:    notificationSubject,
							Content:    notificationContent,
							SenderId:   userID.String(),
							Code:       NotificationCodeGroupJoinRequest,
							Persistent: true,
							CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
						},
					}
				}
				_ = rows.Close()
			}

			if len(notifications) > 0 {
				// Any error is already logged before it's returned here.
				_ = NotificationSend(ctx, logger, db, router, notifications)
			}
		}

		logger.Info("Added join request to group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
		return nil
	}

	// Prepare the message we'll need to send to the group channel.
	stream := PresenceStream{
		Mode:    StreamModeGroup,
		Subject: groupID,
	}
	channelID, err := StreamToChannelId(stream)
	if err != nil {
		logger.Error("Could not create channel ID.", zap.Error(err))
		return err
	}
	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  channelID,
		MessageId:  uuid.Must(uuid.NewV4()).String(),
		Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupJoin},
		SenderId:   userID.String(),
		Username:   username,
		Content:    "{}",
		CreateTime: &timestamppb.Timestamp{Seconds: ts},
		UpdateTime: &timestamppb.Timestamp{Seconds: ts},
		Persistent: &wrapperspb.BoolValue{Value: true},
		GroupId:    group.Id,
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		if _, err = groupAddUser(ctx, db, tx, uuid.Must(uuid.FromString(group.Id)), userID, state); err != nil {
			if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorUniqueViolation {
				logger.Info("Could not add user to group as relationship already exists.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return e
			}

			logger.Debug("Could not add user to group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		query = "UPDATE groups SET edge_count = edge_count + 1, update_time = now() WHERE id = $1::UUID AND edge_count+1 <= max_count"
		if _, err = tx.ExecContext(ctx, query, groupID); err != nil {
			logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		query = `INSERT INTO message (id, code, sender_id, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $6::UUID, $7::UUID, $8, $9, $10, $10)`
		if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
			logger.Debug("Could insert group join channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		return nil
	}); err != nil {
		if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorUniqueViolation {
			// No-op, user was already in group.
			return nil
		}

		logger.Error("Error joining group.", zap.Error(err))
		return err
	}

	router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	logger.Info("Successfully joined group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	return nil
}

func LeaveGroup(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, groupID uuid.UUID, userID uuid.UUID, username string) error {
	var myState sql.NullInt64
	query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
	if err := db.QueryRowContext(ctx, query, groupID, userID).Scan(&myState); err != nil {
		if err == sql.ErrNoRows {
			logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return nil // Completed successfully.
		}
		logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
		return err
	}

	if myState.Int64 == 0 {
		// check for other superadmins
		var otherSuperadminCount sql.NullInt64
		query := "SELECT COUNT(destination_id) FROM group_edge WHERE source_id = $1::UUID AND destination_id != $2::UUID AND state = 0"
		if err := db.QueryRowContext(ctx, query, groupID, userID).Scan(&otherSuperadminCount); err != nil {
			logger.Error("Could not look up superadmin count group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		if otherSuperadminCount.Int64 == 0 {
			logger.Info("Cannot leave group as user is last superadmin.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return ErrGroupLastSuperadmin
		}
	}

	// Prepare the message we'll need to send to the group channel.
	stream := PresenceStream{
		Mode:    StreamModeGroup,
		Subject: groupID,
	}
	channelID, err := StreamToChannelId(stream)
	if err != nil {
		logger.Error("Could not create channel ID.", zap.Error(err))
		return err
	}
	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  channelID,
		MessageId:  uuid.Must(uuid.NewV4()).String(),
		Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupLeave},
		SenderId:   userID.String(),
		Username:   username,
		Content:    "{}",
		CreateTime: &timestamppb.Timestamp{Seconds: ts},
		UpdateTime: &timestamppb.Timestamp{Seconds: ts},
		Persistent: &wrapperspb.BoolValue{Value: true},
		GroupId:    groupID.String(),
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		query = "DELETE FROM group_edge WHERE (source_id = $1::UUID AND destination_id = $2::UUID) OR (source_id = $2::UUID AND destination_id = $1::UUID)"
		// don't need to check affectedRows as we've confirmed the existence of the relationship above
		if _, err = tx.ExecContext(ctx, query, groupID, userID); err != nil {
			logger.Debug("Could not delete group_edge relationships.", zap.Error(err))
			return err
		}

		// check to ensure we are not decrementing the count when the relationship was an invite.
		if myState.Int64 < 3 {
			query = "UPDATE groups SET edge_count = edge_count - 1, update_time = now() WHERE (id = $1::UUID) AND (disable_time = '1970-01-01 00:00:00 UTC')"
			res, err := tx.ExecContext(ctx, query, groupID)
			if err != nil {
				logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return err
			}

			rowsAffected, err := res.RowsAffected()
			if err != nil {
				logger.Debug("Could not fetch affected rows.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return err
			}

			if rowsAffected == 0 {
				logger.Debug("Did not update group edge_count as group is disabled.")
				return ErrGroupNotFound
			}
		}

		query = `INSERT INTO message (id, code, sender_id, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $6::UUID, $7::UUID, $8, $9, $10, $10)`
		if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
			logger.Debug("Could insert group leave channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		return nil
	}); err != nil {
		logger.Error("Error leaving group.", zap.Error(err))
		return err
	}

	router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	logger.Info("Successfully left group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	return nil
}

func AddGroupUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) error {
	if caller != uuid.Nil {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return ErrGroupPermissionDenied
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return err
		}

		if dbState.Int64 > 1 {
			logger.Info("Cannot add users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int64("state", dbState.Int64))
			return ErrGroupPermissionDenied
		}
	}

	var groupName sql.NullString
	query := "SELECT name FROM groups WHERE id = $1 AND disable_time = '1970-01-01 00:00:00 UTC'"
	if err := db.QueryRowContext(ctx, query, groupID).Scan(&groupName); err != nil {
		if err == sql.ErrNoRows {
			logger.Info("Cannot add users to disabled group.", zap.String("group_id", groupID.String()))
			return ErrGroupNotFound
		}
		logger.Error("Could not look up group when adding users.", zap.Error(err), zap.String("group_id", groupID.String()))
		return err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	// Prepare notification data.
	notificationContentBytes, err := json.Marshal(map[string]string{"group_id": groupID.String(), "name": groupName.String})
	if err != nil {
		logger.Error("Could not encode notification content.", zap.Error(err))
		return err
	}
	notificationContent := string(notificationContentBytes)
	notificationSubject := fmt.Sprintf("You've been added to group %v", groupName.String)
	var notifications map[uuid.UUID][]*api.Notification

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
	ts := time.Now().Unix()
	var messages []*api.ChannelMessage

	if err := ExecuteInTx(ctx, tx, func() error {
		// If the transaction is retried ensure we wipe any notifications/messages that may have been prepared by previous attempts.
		notifications = make(map[uuid.UUID][]*api.Notification, len(userIDs))
		messages = make([]*api.ChannelMessage, 0, len(userIDs))

		for _, uid := range userIDs {
			if uid == caller {
				continue
			}

			// Look up the username, and implicitly if this user exists.
			var username sql.NullString
			query := "SELECT username FROM users WHERE id = $1::UUID"
			if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
				if err == sql.ErrNoRows {
					return ErrGroupUserNotFound
				}
				logger.Debug("Could not retrieve username to add user to group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			// Check if this is a join request being accepted.
			incrementEdgeCount := true
			var userExists sql.NullBool
			query = "SELECT EXISTS(SELECT 1 FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID)"
			if err := tx.QueryRowContext(ctx, query, groupID, uid).Scan(&userExists); err != nil {
				logger.Debug("Could not retrieve user state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			if !userExists.Bool {
				if _, err = groupAddUser(ctx, db, tx, groupID, uid, 2); err != nil {
					logger.Debug("Could not add user to group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
			} else {
				res, err := groupUpdateUserState(ctx, db, tx, groupID, uid, 3, 2)
				if err != nil {
					logger.Debug("Could not update user state in group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
				if res != 2 {
					incrementEdgeCount = false
				}
			}

			if incrementEdgeCount {
				query = "UPDATE groups SET edge_count = edge_count + 1, update_time = now() WHERE id = $1::UUID AND edge_count+1 <= max_count"
				res, err := tx.ExecContext(ctx, query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				if rowsAffected, err := res.RowsAffected(); err != nil {
					logger.Debug("Could not update group edge_count.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				} else if rowsAffected == 0 {
					logger.Info("Could not add users as group maximum count was reached.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return ErrGroupFull
				}
			} else {
				// If we reach here then this was a repeated (or failed, if the user was banned) operation.
				// No need to send a message to the channel.
				continue
			}

			message := &api.ChannelMessage{
				ChannelId:  channelID,
				MessageId:  uuid.Must(uuid.NewV4()).String(),
				Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupAdd},
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
			if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
				logger.Debug("Could insert group add channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			messages = append(messages, message)

			notifications[uid] = []*api.Notification{
				{
					Id:         uuid.Must(uuid.NewV4()).String(),
					Subject:    notificationSubject,
					Content:    notificationContent,
					SenderId:   caller.String(),
					Code:       NotificationCodeGroupAdd,
					Persistent: true,
					CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
				},
			}
		}
		return nil
	}); err != nil {
		return err
	}

	for _, message := range messages {
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	}

	if len(notifications) > 0 {
		// Any error is already logged before it's returned here.
		_ = NotificationSend(ctx, logger, db, router, notifications)
	}

	return nil
}

func BanGroupUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) error {
	myState := 0
	if caller != uuid.Nil {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return ErrGroupPermissionDenied
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return err
		}

		myState = int(dbState.Int64)
		if myState > 1 {
			logger.Info("Cannot ban users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
			return ErrGroupPermissionDenied
		}
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
	ts := time.Now().Unix()
	var messages []*api.ChannelMessage

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		// If the transaction is retried ensure we wipe any messages that may have been prepared by previous attempts.
		messages = make([]*api.ChannelMessage, 0, len(userIDs))
		// Position to use for new banned edges.
		position := time.Now().UTC().UnixNano()

		for _, uid := range userIDs {
			// Shouldn't ban self.
			if uid == caller {
				continue
			}

			params := []interface{}{groupID, uid}
			query := ""
			if myState == 0 {
				// Ensure we aren't banning the last superadmin when deleting authoritatively.
				// Query is for superadmin or if done authoritatively.
				query = `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID)
	)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1::UUID AND disable_time = '1970-01-01 00:00:00 UTC')
AND
	NOT (
		(EXISTS (SELECT 1 FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID AND state = 0))
		AND
		((SELECT COUNT(destination_id) FROM group_edge WHERE (source_id = $1::UUID AND destination_id != $2::UUID AND state = 0)) = 0)
	)
RETURNING state`
			} else {
				// Query is just for admins.
				query = `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID AND state > 1)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID AND state > 1)
	)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1::UUID AND disable_time = '1970-01-01 00:00:00 UTC')
RETURNING state`
			}

			var deletedState sql.NullInt64
			logger.Debug("Ban user from group query.", zap.String("query", query), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()), zap.String("caller", caller.String()), zap.Int("caller_state", myState))
			if err := tx.QueryRowContext(ctx, query, params...).Scan(&deletedState); err != nil {
				if err == sql.ErrNoRows {
					// Ignore - move to the next user ID.
					continue
				}
				logger.Debug("Could not delete relationship from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			query = `
INSERT INTO group_edge (position, state, source_id, destination_id) VALUES ($1, $2, $3, $4)
ON CONFLICT (source_id, state, position) DO
UPDATE SET state = $2, update_time = now()`
			_, err := tx.ExecContext(ctx, query, position, 4, groupID, uid)
			if err != nil {
				logger.Debug("Could not add banned relationship in group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			// Only update group edge count and send messages when we kicked valid members, not invites.
			if deletedState.Int64 < 3 {
				query = "UPDATE groups SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID"
				_, err = tx.ExecContext(ctx, query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				// Look up the username.
				var username sql.NullString
				query = "SELECT username FROM users WHERE id = $1::UUID"
				if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
					if err == sql.ErrNoRows {
						return ErrGroupUserNotFound
					}
					logger.Debug("Could not retrieve username to ban user from group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				message := &api.ChannelMessage{
					ChannelId:  channelID,
					MessageId:  uuid.Must(uuid.NewV4()).String(),
					Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupBan},
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
				if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
					logger.Debug("Could insert group ban channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				messages = append(messages, message)
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error banning users from group.", zap.Error(err))
		return err
	}

	for _, message := range messages {
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	}

	return nil
}

func KickGroupUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) error {
	myState := 0
	if caller != uuid.Nil {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return ErrGroupPermissionDenied
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return err
		}

		myState = int(dbState.Int64)
		if myState > 1 {
			logger.Info("Cannot kick users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
			return ErrGroupPermissionDenied
		}
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
	ts := time.Now().Unix()
	var messages []*api.ChannelMessage

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		// If the transaction is retried ensure we wipe any messages that may have been prepared by previous attempts.
		messages = make([]*api.ChannelMessage, 0, len(userIDs))

		for _, uid := range userIDs {
			// Shouldn't kick self.
			if uid == caller {
				continue
			}

			params := []interface{}{groupID, uid}
			query := ""
			if myState == 0 {
				// Ensure we aren't removing the last superadmin when deleting authoritatively.
				// Query is for superadmin or if done authoritatively.
				query = `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID)
	)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1::UUID AND disable_time = '1970-01-01 00:00:00 UTC')
AND
	NOT (
		(EXISTS (SELECT 1 FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID AND state = 0))
		AND
		((SELECT COUNT(destination_id) FROM group_edge WHERE (source_id = $1::UUID AND destination_id != $2::UUID AND state = 0)) = 0)
	)
RETURNING state`
			} else {
				// Query is just for admins.
				query = `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID AND state > 1)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID AND state > 1)
	)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1::UUID AND disable_time = '1970-01-01 00:00:00 UTC')
RETURNING state`
			}

			var deletedState sql.NullInt64
			logger.Debug("Kick user from group query.", zap.String("query", query), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()), zap.String("caller", caller.String()), zap.Int("caller_state", myState))
			if err := tx.QueryRowContext(ctx, query, params...).Scan(&deletedState); err != nil {
				if err == sql.ErrNoRows {
					// Ignore - move to the next user ID.
					continue
				} else {
					logger.Debug("Could not delete relationship from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
			}

			// Only update group edge count and send messages when we kicked valid members, not invites.
			if deletedState.Int64 < 3 {
				query = "UPDATE groups SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID"
				_, err = tx.ExecContext(ctx, query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				// Look up the username.
				var username sql.NullString
				query = "SELECT username FROM users WHERE id = $1::UUID"
				if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
					if err == sql.ErrNoRows {
						return ErrGroupUserNotFound
					}
					logger.Debug("Could not retrieve username to kick user from group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				message := &api.ChannelMessage{
					ChannelId:  channelID,
					MessageId:  uuid.Must(uuid.NewV4()).String(),
					Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeGroupKick},
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
				if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
					logger.Debug("Could insert group kick channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				messages = append(messages, message)
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error kicking users from group.", zap.Error(err))
		return err
	}

	for _, message := range messages {
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	}

	return nil
}

func PromoteGroupUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) error {
	myState := 0
	if caller != uuid.Nil {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return ErrGroupPermissionDenied
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return err
		}

		myState = int(dbState.Int64)
		if myState > 1 {
			logger.Info("Cannot promote users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
			return ErrGroupPermissionDenied
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
		logger.Info("Cannot promote users to disabled group.", zap.String("group_id", groupID.String()))
		return ErrGroupNotFound
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
	ts := time.Now().Unix()
	var messages []*api.ChannelMessage

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		// If the transaction is retried ensure we wipe any messages that may have been prepared by previous attempts.
		messages = make([]*api.ChannelMessage, 0, len(userIDs))

		for _, uid := range userIDs {
			if uid == caller {
				continue
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
					continue
				}
				logger.Debug("Could not promote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			if newState.Int64 == 2 {
				query = "UPDATE groups SET edge_count = edge_count + 1, update_time = now() WHERE id = $1::UUID AND edge_count+1 <= max_count"
				res, err := tx.ExecContext(ctx, query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()), zap.Error(err))
					return err
				}

				if rowsAffected, err := res.RowsAffected(); err != nil {
					logger.Debug("Could not retrieve affect rows.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()), zap.Error(err))
					return err
				} else if rowsAffected == 0 {
					logger.Debug("Did not update group edge count - check edge count has not reached max count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return ErrGroupFull
				}
			}

			// Look up the username.
			var username sql.NullString
			query = "SELECT username FROM users WHERE id = $1::UUID"
			if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
				if err == sql.ErrNoRows {
					return ErrGroupUserNotFound
				}
				logger.Debug("Could not retrieve username to promote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			message := &api.ChannelMessage{
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
			if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
				logger.Debug("Could not insert group promote channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			messages = append(messages, message)
		}
		return nil
	}); err != nil {
		logger.Error("Error promoting users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
		return err
	}

	for _, message := range messages {
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	}

	return nil
}

func DemoteGroupUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) error {
	myState := 0
	if caller != uuid.Nil {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRowContext(ctx, query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return ErrGroupPermissionDenied
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return err
		}

		myState = int(dbState.Int64)
		if myState > 1 {
			logger.Info("Cannot demote users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
			return ErrGroupPermissionDenied
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
		return ErrGroupNotFound
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
	ts := time.Now().Unix()
	var messages []*api.ChannelMessage

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		// If the transaction is retried ensure we wipe any messages that may have been prepared by previous attempts.
		messages = make([]*api.ChannelMessage, 0, len(userIDs))

		for _, uid := range userIDs {
			if uid == caller {
				continue
			}

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
			} else {
				// Simpler query for everyone but superadmins.
				query = `
UPDATE group_edge SET state = state + 1
WHERE
  (
    (source_id = $1::UUID AND destination_id = $2::UUID AND state >= $3 AND state < $4)
    OR
    (source_id = $2::UUID AND destination_id = $1::UUID AND state >= $3 AND state < $4)
  )
RETURNING state`
			}

			var newState sql.NullInt64
			if err := tx.QueryRowContext(ctx, query, groupID, uid, myState, api.GroupUserList_GroupUser_MEMBER).Scan(&newState); err != nil {
				if err == sql.ErrNoRows {
					continue
				}
				logger.Debug("Could not demote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			// Look up the username.
			var username sql.NullString
			query = "SELECT username FROM users WHERE id = $1::UUID"
			if err := tx.QueryRowContext(ctx, query, uid).Scan(&username); err != nil {
				if err == sql.ErrNoRows {
					return ErrGroupUserNotFound
				}
				logger.Debug("Could not retrieve username to demote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			message := &api.ChannelMessage{
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
			if _, err = tx.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, stream.Mode, stream.Subject, stream.Subcontext, stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC()); err != nil {
				logger.Debug("Could not insert group demote channel message.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			messages = append(messages, message)
		}
		return nil
	}); err != nil {
		logger.Error("Error demoting users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
		return err
	}

	for _, message := range messages {
		router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	}

	return nil
}

func ListGroupUsers(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, groupID uuid.UUID, limit int, state *wrapperspb.Int32Value, cursor string) (*api.GroupUserList, error) {
	var incomingCursor *edgeListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, ErrGroupUserInvalidCursor
		}
		incomingCursor = &edgeListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrGroupUserInvalidCursor
		}

		// Cursor and filter mismatch. Perhaps the caller has sent an old cursor with a changed filter.
		if state != nil && int64(state.Value) != incomingCursor.State {
			return nil, ErrGroupUserInvalidCursor
		}
	}

	params := make([]interface{}, 0, 4)
	query := `
SELECT u.id, u.username, u.display_name, u.avatar_url,
	u.lang_tag, u.location, u.timezone, u.metadata,
	u.apple_id, u.facebook_id, u.facebook_instant_game_id, u.google_id, u.gamecenter_id, u.steam_id,
  u.edge_count, u.create_time, u.update_time, ge.state, ge.position
FROM users u, group_edge ge
WHERE u.id = ge.destination_id AND ge.source_id = $1`
	params = append(params, groupID)
	if state != nil {
		// Assumes the state has already been validated before this function.
		query += " AND ge.state = $2"
		params = append(params, state.Value)
	} else {
		// Hint for the query analyzer to ensure it performs and index scan on the appropriate range of the group_edge pkey.
		query += " AND ge.state >= 0 AND ge.state <= 3"
	}
	if incomingCursor != nil {
		query += " AND (ge.source_id, ge.state, ge.position) >= ($1, $2, $3)"
		if state == nil {
			params = append(params, incomingCursor.State)
		}
		params = append(params, incomingCursor.Position)
	}
	query += " ORDER BY ge.state ASC, ge.position ASC"
	if limit != 0 {
		// Console API can select all group users in one request. Client/runtime calls will set a non-0 limit.
		params = append(params, limit+1)
		query += " LIMIT $" + strconv.Itoa(len(params))
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrGroupNotFound
		}

		logger.Debug("Could not list users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
		return nil, err
	}
	defer rows.Close()

	groupUsers := make([]*api.GroupUserList_GroupUser, 0, limit)
	var outgoingCursor string

	for rows.Next() {
		var id string
		var displayName sql.NullString
		var username sql.NullString
		var avatarURL sql.NullString
		var langTag sql.NullString
		var location sql.NullString
		var timezone sql.NullString
		var metadata []byte
		var apple sql.NullString
		var facebook sql.NullString
		var facebookInstantGame sql.NullString
		var google sql.NullString
		var gamecenter sql.NullString
		var steam sql.NullString
		var edgeCount int
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var state sql.NullInt64
		var position sql.NullInt64

		if err := rows.Scan(&id, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata,
			&apple, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &edgeCount, &createTime, &updateTime, &state, &position); err != nil {
			if err == sql.ErrNoRows {
				return nil, ErrGroupNotFound
			}
			logger.Error("Could not parse rows when listing users in a group.", zap.Error(err), zap.String("group_id", groupID.String()))
			return nil, err
		}

		if limit != 0 && len(groupUsers) >= limit {
			cursorBuf := new(bytes.Buffer)
			if err := gob.NewEncoder(cursorBuf).Encode(&edgeListCursor{State: state.Int64, Position: position.Int64}); err != nil {
				logger.Error("Error creating group user list cursor", zap.Error(err))
				return nil, err
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		userID := uuid.Must(uuid.FromString(id))
		user := &api.User{
			Id:                    userID.String(),
			Username:              username.String,
			DisplayName:           displayName.String,
			AvatarUrl:             avatarURL.String,
			LangTag:               langTag.String,
			Location:              location.String,
			Timezone:              timezone.String,
			Metadata:              string(metadata),
			AppleId:               apple.String,
			FacebookId:            facebook.String,
			FacebookInstantGameId: facebookInstantGame.String,
			GoogleId:              google.String,
			GamecenterId:          gamecenter.String,
			SteamId:               steam.String,
			EdgeCount:             int32(edgeCount),
			CreateTime:            &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:            &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
			Online:                tracker.StreamExists(PresenceStream{Mode: StreamModeStatus, Subject: userID}),
		}

		groupUser := &api.GroupUserList_GroupUser{
			User: user,
			State: &wrapperspb.Int32Value{
				Value: int32(state.Int64),
			},
		}

		groupUsers = append(groupUsers, groupUser)
	}

	return &api.GroupUserList{GroupUsers: groupUsers, Cursor: outgoingCursor}, nil
}

func ListUserGroups(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, limit int, state *wrapperspb.Int32Value, cursor string) (*api.UserGroupList, error) {
	var incomingCursor *edgeListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, ErrUserGroupInvalidCursor
		}
		incomingCursor = &edgeListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrUserGroupInvalidCursor
		}

		// Cursor and filter mismatch. Perhaps the caller has sent an old cursor with a changed filter.
		if state != nil && int64(state.Value) != incomingCursor.State {
			return nil, ErrUserGroupInvalidCursor
		}
	}

	params := make([]interface{}, 0, 4)
	query := `
SELECT g.id, g.creator_id, g.name, g.description, g.avatar_url,
g.lang_tag, g.metadata, g.state, g.edge_count, g.max_count,
g.create_time, g.update_time, ge.state, ge.position
FROM groups g, group_edge ge
WHERE g.id = ge.destination_id AND ge.source_id = $1`
	params = append(params, userID)
	if state != nil {
		// Assumes the state has already been validated before this function.
		query += " AND ge.state = $2"
		params = append(params, state.Value)
	} else {
		// Hint for the query analyzer to ensure it performs and index scan on the appropriate range of the group_edge pkey.
		query += " AND ge.state >= 0 AND ge.state <= 3"
	}
	if incomingCursor != nil {
		query += " AND (ge.source_id, ge.state, ge.position) >= ($1, $2, $3)"
		if state == nil {
			params = append(params, incomingCursor.State)
		}
		params = append(params, incomingCursor.Position)
	}
	query += " ORDER BY ge.state ASC, ge.position ASC"
	if limit != 0 {
		// Console API can select all user groups in one request. Client/runtime calls will set a non-0 limit.
		params = append(params, limit+1)
		query += " LIMIT $" + strconv.Itoa(len(params))
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrGroupNotFound
		}
		logger.Debug("Could not list groups for a user.", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, err
	}
	defer rows.Close()

	userGroups := make([]*api.UserGroupList_UserGroup, 0, limit)
	var outgoingCursor string

	for rows.Next() {
		var id string
		var creatorID sql.NullString
		var name sql.NullString
		var description sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var metadata []byte
		var state sql.NullInt64
		var edgeCount sql.NullInt64
		var maxCount sql.NullInt64
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var userState sql.NullInt64
		var userPosition sql.NullInt64

		if err := rows.Scan(&id, &creatorID, &name, &description, &avatarURL, &lang, &metadata, &state,
			&edgeCount, &maxCount, &createTime, &updateTime, &userState, &userPosition); err != nil {
			if err == sql.ErrNoRows {
				return &api.UserGroupList{UserGroups: make([]*api.UserGroupList_UserGroup, 0)}, nil
			}
			logger.Error("Could not parse rows when listing groups for a user.", zap.Error(err), zap.String("user_id", userID.String()))
			return nil, err
		}

		if limit != 0 && len(userGroups) >= limit {
			cursorBuf := new(bytes.Buffer)
			if err := gob.NewEncoder(cursorBuf).Encode(&edgeListCursor{State: userState.Int64, Position: userPosition.Int64}); err != nil {
				logger.Error("Error creating group user list cursor", zap.Error(err))
				return nil, err
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		open := true
		if state.Int64 == 1 {
			open = false
		}

		group := &api.Group{
			Id:          uuid.Must(uuid.FromString(id)).String(),
			CreatorId:   uuid.Must(uuid.FromString(creatorID.String)).String(),
			Name:        name.String,
			Description: description.String,
			AvatarUrl:   avatarURL.String,
			LangTag:     lang.String,
			Metadata:    string(metadata),
			Open:        &wrapperspb.BoolValue{Value: open},
			EdgeCount:   int32(edgeCount.Int64),
			MaxCount:    int32(maxCount.Int64),
			CreateTime:  &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:  &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
		}

		userGroup := &api.UserGroupList_UserGroup{
			Group: group,
			State: &wrapperspb.Int32Value{
				Value: int32(userState.Int64),
			},
		}

		userGroups = append(userGroups, userGroup)
	}

	return &api.UserGroupList{UserGroups: userGroups, Cursor: outgoingCursor}, nil
}

func GetGroups(ctx context.Context, logger *zap.Logger, db *sql.DB, ids []string) ([]*api.Group, error) {
	if len(ids) == 0 {
		return make([]*api.Group, 0), nil
	}

	statements := make([]string, 0, len(ids))
	params := make([]interface{}, 0, len(ids))
	for i, id := range ids {
		statements = append(statements, "$"+strconv.Itoa(i+1))
		params = append(params, id)
	}

	query := `SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups
WHERE disable_time = '1970-01-01 00:00:00 UTC'
AND id IN (` + strings.Join(statements, ",") + `)`
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return make([]*api.Group, 0), nil
		}
		logger.Error("Could not get groups.", zap.Error(err))
		return nil, err
	}
	// Rows closed in groupConvertRows()

	groups, err := groupConvertRows(rows)
	if err != nil {
		if err == sql.ErrNoRows {
			return make([]*api.Group, 0), nil
		}
		logger.Error("Could not get groups.", zap.Error(err))
		return nil, err
	}

	return groups, nil
}

func ListGroups(ctx context.Context, logger *zap.Logger, db *sql.DB, name string, limit int, cursorStr string) (*api.GroupList, error) {
	var cursor *groupListCursor
	if cursorStr != "" {
		cursor = &groupListCursor{}
		cb, err := base64.RawURLEncoding.DecodeString(cursorStr)
		if err != nil {
			logger.Warn("Could not base64 decode group listing cursor.", zap.String("cursor", cursorStr))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		}
		if err = gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
			logger.Warn("Could not decode group listing cursor.", zap.String("cursor", cursorStr))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		}
	}

	var query string
	params := []interface{}{limit}
	if name == "" {
		query = `
SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups
WHERE disable_time = '1970-01-01 00:00:00 UTC'
ORDER BY lang_tag ASC, edge_count ASC, id ASC
LIMIT $1`
		if cursor != nil {
			params = append(params, cursor.Lang, cursor.EdgeCount, cursor.ID)
			query = `
SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups
WHERE disable_time = '1970-01-01 00:00:00 UTC'
AND (lang_tag, edge_count, id) > ($2, $3, $4)
ORDER BY lang_tag ASC, edge_count ASC, id ASC
LIMIT $1`
		}
	} else {
		params = append(params, name)
		query = `
SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups
WHERE
	(disable_time = '1970-01-01 00:00:00 UTC')
AND
	(name LIKE $2)
LIMIT $1`
		if cursor != nil {
			params = append(params, cursor.Lang, cursor.EdgeCount, cursor.ID)
			query = `
SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups
WHERE
	(disable_time = '1970-01-01 00:00:00 UTC')
AND
	(name LIKE $2)
AND
	((lang_tag, edge_count, id) > ($3, $4, $5))
LIMIT $1`
		}
	}

	groupList := &api.GroupList{Groups: make([]*api.Group, 0)}
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return groupList, nil
		}
		logger.Error("Could not list groups.", zap.Error(err), zap.String("name", name))
		return nil, err
	}
	// Rows closed in groupConvertRows()

	groups, err := groupConvertRows(rows)
	if err != nil {
		if err == sql.ErrNoRows {
			return groupList, nil
		}
		logger.Error("Could not list groups.", zap.Error(err), zap.String("name", name))
		return nil, err
	}

	cursorBuf := new(bytes.Buffer)
	if len(groups) > 0 {
		lastGroup := groups[len(groups)-1]
		newCursor := &groupListCursor{
			ID:        uuid.Must(uuid.FromString(lastGroup.Id)),
			EdgeCount: lastGroup.EdgeCount,
			Lang:      lastGroup.LangTag,
		}
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Could not create new cursor.", zap.Error(err))
			return nil, err
		}
		groupList.Groups = groups
		groupList.Cursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return groupList, nil
}

func groupConvertRows(rows *sql.Rows) ([]*api.Group, error) {
	defer rows.Close()

	groups := make([]*api.Group, 0, 10)

	for rows.Next() {
		var id string
		var creatorID sql.NullString
		var name sql.NullString
		var description sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var metadata []byte
		var state sql.NullInt64
		var edgeCount sql.NullInt64
		var maxCount sql.NullInt64
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz

		if err := rows.Scan(&id, &creatorID, &name, &description, &avatarURL, &state, &edgeCount, &lang, &maxCount, &metadata, &createTime, &updateTime); err != nil {
			return nil, err
		}

		open := true
		if state.Int64 == 1 {
			open = false
		}

		group := &api.Group{
			Id:          uuid.Must(uuid.FromString(id)).String(),
			CreatorId:   uuid.Must(uuid.FromString(creatorID.String)).String(),
			Name:        name.String,
			Description: description.String,
			AvatarUrl:   avatarURL.String,
			LangTag:     lang.String,
			Metadata:    string(metadata),
			Open:        &wrapperspb.BoolValue{Value: open},
			EdgeCount:   int32(edgeCount.Int64),
			MaxCount:    int32(maxCount.Int64),
			CreateTime:  &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:  &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
		}

		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return groups, nil
}

func groupAddUser(ctx context.Context, db *sql.DB, tx *sql.Tx, groupID uuid.UUID, userID uuid.UUID, state int) (int64, error) {
	query := `
INSERT INTO group_edge
	(position, state, source_id, destination_id)
VALUES
	($1, $2, $3, $4),
	($1, $2, $4, $3)`

	position := time.Now().UTC().UnixNano()

	var res sql.Result
	var err error
	if tx != nil {
		res, err = tx.ExecContext(ctx, query, position, state, groupID, userID)
	} else {
		res, err = db.ExecContext(ctx, query, position, state, groupID, userID)
	}

	if err != nil {
		return 0, err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return rowsAffected, nil
}

func groupUpdateUserState(ctx context.Context, db *sql.DB, tx *sql.Tx, groupID uuid.UUID, userID uuid.UUID, fromState int, toState int) (int64, error) {
	query := `
UPDATE group_edge SET
	update_time = now(), state = $4
WHERE
	(source_id = $1::UUID AND destination_id = $2::UUID AND state = $3)
OR
	(source_id = $2::UUID AND destination_id = $1::UUID AND state = $3)`

	var res sql.Result
	var err error
	if tx != nil {
		res, err = tx.ExecContext(ctx, query, groupID, userID, fromState, toState)
	} else {
		res, err = db.ExecContext(ctx, query, groupID, userID, fromState, toState)
	}

	if err != nil {
		return 0, err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return rowsAffected, nil
}

func groupCheckUserPermission(ctx context.Context, logger *zap.Logger, db *sql.DB, groupID, userID uuid.UUID, state int) (bool, error) {
	query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
	var dbState int
	if err := db.QueryRowContext(ctx, query, groupID, userID).Scan(&dbState); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		logger.Error("Could not look up user state with group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
		return false, err
	}
	return dbState <= state, nil
}

func deleteGroup(ctx context.Context, logger *zap.Logger, tx *sql.Tx, groupID uuid.UUID) error {
	query := "DELETE FROM groups WHERE id = $1::UUID"
	res, err := tx.ExecContext(ctx, query, groupID)
	if err != nil {
		logger.Debug("Could not delete group.", zap.Error(err))
		return err
	}

	if rowsAffected, err := res.RowsAffected(); err != nil {
		logger.Debug("Could not count deleted groups.", zap.Error(err))
		return err
	} else if rowsAffected == 0 {
		logger.Info("Did not delete group as group with given ID does not exist.", zap.Error(err), zap.String("group_id", groupID.String()))
		return nil
	}

	query = "DELETE FROM group_edge WHERE source_id = $1::UUID OR destination_id = $1::UUID"
	if _, err = tx.ExecContext(ctx, query, groupID); err != nil {
		logger.Debug("Could not delete group_edge relationships.", zap.Error(err))
		return err
	}

	return nil
}

func deleteRelationship(ctx context.Context, logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, groupID uuid.UUID) error {
	query := `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID AND state > 1)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID AND state > 1)
	)
RETURNING state`

	var deletedState sql.NullInt64
	logger.Debug("Removing relationship from group.", zap.String("query", query), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	if err := tx.QueryRowContext(ctx, query, userID, groupID).Scan(&deletedState); err != nil {
		if err != sql.ErrNoRows {
			logger.Debug("Could not delete relationship from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}
	}

	if deletedState.Int64 < 3 {
		query = "UPDATE groups SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID"
		_, err := tx.ExecContext(ctx, query, groupID)
		if err != nil {
			logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}
	}

	return nil
}

func GroupDeleteAll(ctx context.Context, logger *zap.Logger, tx *sql.Tx, userID uuid.UUID) error {
	query := `
SELECT id, edge_count, group_edge.state FROM groups
JOIN group_edge ON (group_edge.source_id = id)
WHERE group_edge.destination_id = $1`

	rows, err := tx.QueryContext(ctx, query, userID)
	if err != nil {
		logger.Debug("Could not list groups for a user.", zap.Error(err), zap.String("user_id", userID.String()))
		return err
	}

	deleteGroupsAndRelationships := make([]uuid.UUID, 0, 5)
	deleteRelationships := make([]uuid.UUID, 0, 5)
	checkForOtherSuperadmins := make([]uuid.UUID, 0, 5)

	for rows.Next() {
		var id string
		var edgeCount sql.NullInt64
		var userState sql.NullInt64

		if err := rows.Scan(&id, &edgeCount, &userState); err != nil {
			_ = rows.Close()
			logger.Error("Could not parse rows when listing groups for a user.", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		}

		groupID := uuid.Must(uuid.FromString(id))
		if userState.Int64 == 0 {
			if edgeCount.Int64 == 1 {
				deleteGroupsAndRelationships = append(deleteGroupsAndRelationships, groupID)
			} else {
				checkForOtherSuperadmins = append(checkForOtherSuperadmins, groupID)
			}
		} else {
			deleteRelationships = append(deleteRelationships, groupID)
		}
	}
	_ = rows.Close()

	countOtherSuperadminsQuery := "SELECT COUNT(source_id) FROM group_edge WHERE source_id = $1 AND destination_id != $2 AND state = 0"
	for _, g := range checkForOtherSuperadmins {
		var otherSuperadminCount sql.NullInt64
		err := tx.QueryRowContext(ctx, countOtherSuperadminsQuery, g, userID).Scan(&otherSuperadminCount)
		if err != nil {
			logger.Error("Could not parse rows when listing other superadmins.", zap.Error(err), zap.String("group_id", g.String()), zap.String("user_id", userID.String()))
			return err
		}

		if otherSuperadminCount.Int64 == 0 {
			deleteGroupsAndRelationships = append(deleteGroupsAndRelationships, g)
		} else {
			deleteRelationships = append(deleteRelationships, g)
		}
	}

	for _, g := range deleteGroupsAndRelationships {
		if err := deleteGroup(ctx, logger, tx, g); err != nil {
			return err
		}
	}

	for _, g := range deleteRelationships {
		err := deleteRelationship(ctx, logger, tx, userID, g)
		if err != nil {
			return err
		}
	}

	return nil
}
