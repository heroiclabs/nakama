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
	"strconv"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type edgeListCursor struct {
	// ID fields.
	State    int64
	Position int64
}

// Only used to get all friend IDs for the console. NOTE: Not intended for use in client/runtime APIs.
func GetFriendIDs(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) (*api.FriendList, error) {
	query := `
SELECT id, state
FROM users, user_edge WHERE id = destination_id AND source_id = $1`

	rows, err := db.QueryContext(ctx, query, userID)
	if err != nil {
		logger.Error("Error retrieving friends.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	friends := make([]*api.Friend, 0, 10)

	for rows.Next() {
		var id string
		var state sql.NullInt64

		if err = rows.Scan(&id, &state); err != nil {
			logger.Error("Error retrieving friend IDs.", zap.Error(err))
			return nil, err
		}

		friendID := uuid.FromStringOrNil(id)
		user := &api.User{
			Id: friendID.String(),
		}

		friends = append(friends, &api.Friend{
			User: user,
			State: &wrapperspb.Int32Value{
				Value: int32(state.Int64),
			},
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving friend IDs.", zap.Error(err))
		return nil, err
	}

	return &api.FriendList{Friends: friends}, nil
}

func ListFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, userID uuid.UUID, limit int, state *wrapperspb.Int32Value, cursor string) (*api.FriendList, error) {
	var incomingCursor *edgeListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, runtime.ErrFriendInvalidCursor
		}
		incomingCursor = &edgeListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, runtime.ErrFriendInvalidCursor
		}

		// Cursor and filter mismatch. Perhaps the caller has sent an old cursor with a changed filter.
		if state != nil && int64(state.Value) != incomingCursor.State {
			return nil, runtime.ErrFriendInvalidCursor
		}
	}

	params := make([]interface{}, 0, 4)
	query := `
SELECT id, username, display_name, avatar_url,
	lang_tag, location, timezone, metadata,
	create_time, users.update_time, user_edge.update_time, state, position,
	facebook_id, google_id, gamecenter_id, steam_id, facebook_instant_game_id, apple_id
FROM users, user_edge WHERE id = destination_id AND source_id = $1`
	params = append(params, userID)
	if state != nil {
		// Assumes the state has already been validated before this function.
		query += " AND state = $2"
		params = append(params, state.Value)
	}
	if incomingCursor != nil {
		query += " AND (source_id, state, position) >= ($1, $2, $3)"
		if state == nil {
			params = append(params, incomingCursor.State)
		}
		params = append(params, incomingCursor.Position)
	}
	query += " ORDER BY state ASC, position ASC"
	if limit != 0 {
		// Console API can select all friends in one request. Client/runtime calls will set a non-0 limit.
		params = append(params, limit+1)
		query += " LIMIT $" + strconv.Itoa(len(params))
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving friends.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	friends := make([]*api.Friend, 0, limit)
	var outgoingCursor string

	for rows.Next() {
		var id string
		var username sql.NullString
		var displayName sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var location sql.NullString
		var timezone sql.NullString
		var metadata []byte
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var edgeUpdateTime pgtype.Timestamptz
		var state sql.NullInt64
		var position sql.NullInt64
		var facebookID sql.NullString
		var googleID sql.NullString
		var gamecenterID sql.NullString
		var steamID sql.NullString
		var facebookInstantGameID sql.NullString
		var appleID sql.NullString

		if err = rows.Scan(&id, &username, &displayName, &avatarURL, &lang, &location, &timezone, &metadata,
			&createTime, &updateTime, &edgeUpdateTime, &state, &position,
			&facebookID, &googleID, &gamecenterID, &steamID, &facebookInstantGameID, &appleID); err != nil {
			logger.Error("Error retrieving friends.", zap.Error(err))
			return nil, err
		}

		if limit != 0 && len(friends) >= limit {
			cursorBuf := new(bytes.Buffer)
			if err := gob.NewEncoder(cursorBuf).Encode(&edgeListCursor{State: state.Int64, Position: position.Int64}); err != nil {
				logger.Error("Error creating friend list cursor", zap.Error(err))
				return nil, err
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		user := &api.User{
			Id:          id,
			Username:    username.String,
			DisplayName: displayName.String,
			AvatarUrl:   avatarURL.String,
			LangTag:     lang.String,
			Location:    location.String,
			Timezone:    timezone.String,
			Metadata:    string(metadata),
			CreateTime:  &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:  &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
			// Online filled below.
			FacebookId:            facebookID.String,
			GoogleId:              googleID.String,
			GamecenterId:          gamecenterID.String,
			SteamId:               steamID.String,
			FacebookInstantGameId: facebookInstantGameID.String,
			AppleId:               appleID.String,
		}

		friends = append(friends, &api.Friend{
			User: user,
			State: &wrapperspb.Int32Value{
				Value: int32(state.Int64),
			},
			UpdateTime: &timestamppb.Timestamp{Seconds: edgeUpdateTime.Time.Unix()},
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving friends.", zap.Error(err))
		return nil, err
	}

	if statusRegistry != nil {
		statusRegistry.FillOnlineFriends(friends)
	}

	return &api.FriendList{Friends: friends, Cursor: outgoingCursor}, nil
}

type friendsOfFriendsListCursor struct {
	SourceId      string
	DestinationId string
}

func ListFriendsOfFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, userID uuid.UUID, limit int, cursor string) (*api.FriendsOfFriendsList, error) {
	var incomingCursor *friendsOfFriendsListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, runtime.ErrFriendInvalidCursor
		}
		incomingCursor = &friendsOfFriendsListCursor{}
		if err = gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, runtime.ErrFriendInvalidCursor
		}

		if incomingCursor.SourceId == "" || incomingCursor.DestinationId == "" {
			return nil, runtime.ErrFriendInvalidCursor
		}
	}

	// Grab all friends
	query := `SELECT destination_id FROM user_edge
WHERE source_id = $1
AND state = 0
ORDER BY destination_id`
	friendsRows, err := db.QueryContext(ctx, query, userID)
	if err != nil {
		logger.Error("Could not list friends of friends.", zap.Error(err))
		return nil, err
	}
	defer friendsRows.Close()

	friends := make([]uuid.UUID, 0)
	for friendsRows.Next() {
		var friendId uuid.UUID
		if err = friendsRows.Scan(&friendId); err != nil {
			logger.Error("Error scanning friends.", zap.Error(err))
			return nil, err
		}
		friends = append(friends, friendId)
	}
	_ = friendsRows.Close()

	if len(friends) == 0 {
		// return early if user has no friends
		return &api.FriendsOfFriendsList{FriendsOfFriends: []*api.FriendsOfFriendsList_FriendOfFriend{}}, nil
	}

	type friendOfFriend struct {
		Referrer *uuid.UUID
		UserID   *uuid.UUID
	}

	// Go over friends of friends
	friendsOfFriends := make([]*friendOfFriend, 0)
	userIds := make([]string, 0)
	var outgoingCursor string
friendLoop:
	for _, f := range friends {
		if incomingCursor != nil && f.String() != incomingCursor.SourceId {
			continue
		}
		query = `SELECT source_id, destination_id
FROM user_edge
WHERE source_id = $1
AND destination_id != $2
AND destination_id != ALL($3::UUID[])
AND state = 0
`
		params := []any{f, userID, friends, limit + 1}

		if incomingCursor != nil {
			query += " AND (source_id, destination_id) >= ($5, $6) "
			params = append(params, incomingCursor.SourceId, incomingCursor.DestinationId)
		}

		query += "ORDER BY source_id, destination_id LIMIT $4"

		rows, err := db.QueryContext(ctx, query, params...)
		if err != nil {
			logger.Error("Could not list friends of friends.", zap.Error(err))
			return nil, err
		}

		for rows.Next() {
			var sourceId, destinationId uuid.UUID
			if err = rows.Scan(&sourceId, &destinationId); err != nil {
				logger.Error("Error scanning friends.", zap.Error(err))
				rows.Close()
				return nil, err
			}

			if len(friendsOfFriends) >= limit {
				_ = rows.Close()
				cursorBuf := new(bytes.Buffer)
				if err := gob.NewEncoder(cursorBuf).Encode(&friendsOfFriendsListCursor{
					SourceId:      sourceId.String(),
					DestinationId: destinationId.String(),
				}); err != nil {
					logger.Error("Error creating friends of friends list cursor", zap.Error(err))
					return nil, err
				}
				outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
				break friendLoop
			}

			friendsOfFriends = append(friendsOfFriends, &friendOfFriend{
				Referrer: &sourceId,
				UserID:   &destinationId,
			})
			userIds = append(userIds, destinationId.String())
		}
		rows.Close()
	}

	if len(userIds) == 0 {
		// return early if friends have no other friends
		return &api.FriendsOfFriendsList{FriendsOfFriends: []*api.FriendsOfFriendsList_FriendOfFriend{}}, nil
	}

	users, err := GetUsers(ctx, logger, db, statusRegistry, userIds, nil, nil)
	if err != nil {
		return nil, err
	}

	userMap := make(map[string]*api.User, len(users.Users))
	for _, user := range users.Users {
		userMap[user.Id] = user
	}

	fof := make([]*api.FriendsOfFriendsList_FriendOfFriend, 0, len(friendsOfFriends))
	for _, friend := range friendsOfFriends {
		friendUser, ok := userMap[friend.UserID.String()]
		if !ok {
			// can happen if account was deleted before GetUsers call, skip.
			continue
		}

		fof = append(fof, &api.FriendsOfFriendsList_FriendOfFriend{
			Referrer: friend.Referrer.String(),
			User:     friendUser,
		})
	}

	return &api.FriendsOfFriendsList{FriendsOfFriends: fof, Cursor: outgoingCursor}, nil
}

func AddFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, userID uuid.UUID, username string, friendIDs []string) error {
	uniqueFriendIDs := make(map[string]struct{})
	for _, fid := range friendIDs {
		uniqueFriendIDs[fid] = struct{}{}
	}

	var notificationToSend map[string]bool

	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		// If the transaction is retried ensure we wipe any notifications that may have been prepared by previous attempts.
		notificationToSend = make(map[string]bool)

		for id := range uniqueFriendIDs {
			// Check to see if user has already blocked friend, if so, don't add friend or send notification.
			var blockState int
			err := tx.QueryRowContext(ctx, "SELECT state FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state = 3", userID, id).Scan(&blockState)
			// ignore if the error is sql.ErrNoRows as means block was not found - continue as intended.
			if err != nil && err != sql.ErrNoRows {
				// genuine DB error was found.
				logger.Debug("Failed to check edge state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", id))
				return err
			} else if err == nil {
				// the block was found, don't add friend or send notification.
				logger.Info("Ignoring previously blocked friend. Delete friend first before attempting to add.", zap.String("user", userID.String()), zap.String("friend", id))
				continue
			}

			isFriendAccept, addFriendErr := addFriend(ctx, logger, tx, userID, id)
			if addFriendErr == nil {
				notificationToSend[id] = isFriendAccept
			} else if addFriendErr != sql.ErrNoRows { // Check to see if friend had blocked user.
				return addFriendErr
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error adding friends.", zap.Error(err))
		return err
	}

	notifications := make(map[uuid.UUID][]*api.Notification)
	content, _ := json.Marshal(map[string]interface{}{"username": username})
	for id, isFriendAccept := range notificationToSend {
		uid := uuid.FromStringOrNil(id)
		code := NotificationCodeFriendRequest
		subject := fmt.Sprintf("%v wants to add you as a friend", username)
		if isFriendAccept {
			code = NotificationCodeFriendAccept
			subject = fmt.Sprintf("%v accepted your friend request", username)
		}
		notifications[uid] = []*api.Notification{{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    subject,
			Content:    string(content),
			SenderId:   userID.String(),
			Code:       code,
			Persistent: true,
			CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
		}}
	}

	// Any error is already logged before it's returned here.
	_ = NotificationSend(ctx, logger, db, tracker, messageRouter, notifications)

	return nil
}

// Returns "true" if accepting an invite, otherwise false
func addFriend(ctx context.Context, logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string) (bool, error) {
	// Mark an invite as accepted, if one was in place.
	res, err := tx.ExecContext(ctx, `
UPDATE user_edge SET state = 0, update_time = now()
WHERE (source_id = $1 AND destination_id = $2 AND state = 1)
OR (source_id = $2 AND destination_id = $1 AND state = 2)
  `, friendID, userID)
	if err != nil {
		logger.Debug("Failed to update user state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// If both edges were updated, it was accepting an invite was successful.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
		logger.Debug("Accepting friend invitation.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return true, nil
	}

	position := fmt.Sprintf("%v", time.Now().UTC().UnixNano())

	// If no edge updates took place, it's either a new invite being set up, or user was blocked off by friend.
	_, err = tx.ExecContext(ctx, `
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::UUID, $2::UUID, 1, $3::BIGINT, now()),
  ($2::UUID, $1::UUID, 2, $3::BIGINT, now())
) AS ue(source_id, destination_id, state, position, update_time)
WHERE
	EXISTS (SELECT id FROM users WHERE id = $2::UUID)
	AND
	NOT EXISTS
	(SELECT state
   FROM user_edge
   WHERE source_id = $2::UUID AND destination_id = $1::UUID AND state = 3
  )
ON CONFLICT (source_id, destination_id) DO NOTHING
`, userID, friendID, position)
	if err != nil {
		logger.Debug("Failed to insert new user edge link.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// Update friend count if we've just created the relationship.
	// This check is done by comparing the the timestamp(position) to the timestamp available.
	// i.e. only increase count when the relationship was first formed.
	// This is caused by an existing bug in CockroachDB: https://github.com/cockroachdb/cockroach/issues/10264
	if res, err = tx.ExecContext(ctx, `
UPDATE users
SET edge_count = edge_count +1, update_time = now()
WHERE
	(id = $1::UUID OR id = $2::UUID)
AND EXISTS
	(SELECT state
   FROM user_edge
   WHERE
   	(source_id = $1::UUID AND destination_id = $2::UUID AND position = $3::BIGINT)
   	OR
   	(source_id = $2::UUID AND destination_id = $1::UUID AND position = $3::BIGINT)
  )
`, userID, friendID, position); err != nil {
		logger.Debug("Failed to update user count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// An invite was successfully added if both components were inserted.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 2 {
		logger.Debug("Did not add new friend as friend connection already exists or user is blocked.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, sql.ErrNoRows
	}

	logger.Debug("Added new friend invitation.", zap.String("user", userID.String()), zap.String("friend", friendID))
	return false, nil
}

func DeleteFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, currentUser uuid.UUID, ids []string) error {
	uniqueFriendIDs := make(map[string]struct{})
	for _, fid := range ids {
		uniqueFriendIDs[fid] = struct{}{}
	}

	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		for id := range uniqueFriendIDs {
			if deleteFriendErr := deleteFriend(ctx, logger, tx, currentUser, id); deleteFriendErr != nil {
				return deleteFriendErr
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error deleting friends.", zap.Error(err))
		return err
	}

	return nil
}

func deleteFriend(ctx context.Context, logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string) error {
	res, err := tx.ExecContext(ctx, "DELETE FROM user_edge WHERE (source_id = $1 AND destination_id = $2) OR (source_id = $2 AND destination_id = $1 AND state <> 3)", userID, friendID)
	if err != nil {
		logger.Debug("Failed to delete user edge relationships.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return err
	}

	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		logger.Debug("Could not delete user relationships as prior relationship did not exist.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return nil
	} else if rowsAffected == 1 {
		if _, err = tx.ExecContext(ctx, "UPDATE users SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID", userID); err != nil {
			logger.Debug("Failed to update user edge counts.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	} else if rowsAffected == 2 {
		if _, err = tx.ExecContext(ctx, "UPDATE users SET edge_count = edge_count - 1, update_time = now() WHERE id IN ($1, $2)", userID, friendID); err != nil {
			logger.Debug("Failed to update user edge counts.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	} else {
		logger.Debug("Unexpected number of edges were deleted.", zap.String("user", userID.String()), zap.String("friend", friendID), zap.Int64("rows_affected", rowsAffected))
		return errors.New("unexpected number of edges were deleted")
	}

	return nil
}

func BlockFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, currentUser uuid.UUID, ids []string) error {
	uniqueFriendIDs := make(map[string]struct{})
	for _, fid := range ids {
		uniqueFriendIDs[fid] = struct{}{}
	}

	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		for id := range uniqueFriendIDs {
			if blockFriendErr := blockFriend(ctx, logger, tx, tracker, currentUser, id); blockFriendErr != nil {
				return blockFriendErr
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error blocking friends.", zap.Error(err))
		return err
	}

	return nil
}

func blockFriend(ctx context.Context, logger *zap.Logger, tx *sql.Tx, tracker Tracker, userID uuid.UUID, friendID string) error {
	// Try to update any previous edge between these users.
	res, err := tx.ExecContext(ctx, "UPDATE user_edge SET state = 3, update_time = now() WHERE source_id = $1 AND destination_id = $2",
		userID, friendID)
	if err != nil {
		logger.Debug("Failed to update user edge state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return err
	}

	position := fmt.Sprintf("%v", time.Now().UTC().UnixNano())

	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		// If there was no previous edge then create one.
		query := `
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::UUID, $2::UUID, 3, $3::BIGINT, now())
) AS ue(source_id, destination_id, state, position, update_time)
WHERE EXISTS (SELECT id FROM users WHERE id = $2::UUID)`
		res, err = tx.ExecContext(ctx, query, userID, friendID, position)
		if err != nil {
			logger.Debug("Failed to block user.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}

		if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
			logger.Debug("Could not block user as user may not exist.", zap.String("user", userID.String()), zap.String("friend", friendID))
			return nil
		}

		// Update the edge count.
		if _, err = tx.ExecContext(ctx, "UPDATE users SET edge_count = edge_count + 1, update_time = now() WHERE id = $1", userID); err != nil {
			logger.Debug("Failed to update user edge count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	}

	// Delete opposite relationship if user hasn't blocked you already
	res, err = tx.ExecContext(ctx, "DELETE FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state != 3", friendID, userID)
	if err != nil {
		logger.Debug("Failed to update user edge state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return err
	}

	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 1 {
		if _, err = tx.ExecContext(ctx, "UPDATE users SET edge_count = edge_count - 1, update_time = now() WHERE id = $1", friendID); err != nil {
			logger.Debug("Failed to update user edge count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	}

	stream := PresenceStream{
		Mode: StreamModeDM,
	}
	fuid := uuid.Must(uuid.FromString(friendID))
	if friendID > userID.String() {
		stream.Subject = userID
		stream.Subcontext = fuid
	} else {
		stream.Subject = fuid
		stream.Subcontext = userID
	}

	tracker.UntrackByStream(stream)

	return nil
}
