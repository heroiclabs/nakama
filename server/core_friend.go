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
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"context"

	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

func GetFriendIDs(logger *zap.Logger, db *sql.DB, userID uuid.UUID) (*api.Friends, error) {
	query := `
SELECT id, state
FROM users, user_edge WHERE id = destination_id AND source_id = $1`

	rows, err := db.Query(query, userID)
	if err != nil {
		logger.Error("Error retrieving friends.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	friends := make([]*api.Friend, 0)

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
			User:  user,
			State: int32(state.Int64),
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving friend IDs.", zap.Error(err))
		return nil, err
	}

	return &api.Friends{Friends: friends}, nil
}

func GetFriends(logger *zap.Logger, db *sql.DB, tracker Tracker, userID uuid.UUID) (*api.Friends, error) {
	query := `
SELECT id, username, display_name, avatar_url,
	lang_tag, location, timezone, metadata,
	create_time, users.update_time, state
FROM users, user_edge WHERE id = destination_id AND source_id = $1`

	rows, err := db.Query(query, userID)
	if err != nil {
		logger.Error("Error retrieving friends.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	friends := make([]*api.Friend, 0)

	for rows.Next() {
		var id string
		var username sql.NullString
		var displayName sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var location sql.NullString
		var timezone sql.NullString
		var metadata []byte
		var createTime pq.NullTime
		var updateTime pq.NullTime
		var state sql.NullInt64

		if err = rows.Scan(&id, &username, &displayName, &avatarURL, &lang, &location, &timezone, &metadata, &createTime, &updateTime, &state); err != nil {
			logger.Error("Error retrieving friends.", zap.Error(err))
			return nil, err
		}

		friendID := uuid.FromStringOrNil(id)
		online := false
		if tracker != nil {
			online = tracker.StreamExists(PresenceStream{Mode: StreamModeNotifications, Subject: friendID})
		}

		user := &api.User{
			Id:          friendID.String(),
			Username:    username.String,
			DisplayName: displayName.String,
			AvatarUrl:   avatarURL.String,
			LangTag:     lang.String,
			Location:    location.String,
			Timezone:    timezone.String,
			Metadata:    string(metadata),
			CreateTime:  &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:  &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
			Online:      online,
		}

		friends = append(friends, &api.Friend{
			User:  user,
			State: int32(state.Int64) + 1,
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving friends.", zap.Error(err))
		return nil, err
	}

	return &api.Friends{Friends: friends}, nil
}

func AddFriends(logger *zap.Logger, db *sql.DB, messageRouter MessageRouter, userID uuid.UUID, username string, friendIDs []string) error {
	uniqueFriendIDs := make(map[string]struct{})
	for _, fid := range friendIDs {
		uniqueFriendIDs[fid] = struct{}{}
	}

	notificationToSend := make(map[string]bool)

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		for id := range uniqueFriendIDs {
			isFriendAccept, addFriendErr := addFriend(logger, tx, userID, id)
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
		code := NOTIFICATION_FRIEND_REQUEST
		subject := fmt.Sprintf("%v wants to add you as a friend", username)
		if isFriendAccept {
			code = NOTIFICATION_FRIEND_ACCEPT
			subject = fmt.Sprintf("%v accepted your friend request", username)
		}
		notifications[uid] = []*api.Notification{{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    subject,
			Content:    string(content),
			SenderId:   userID.String(),
			Code:       code,
			Persistent: true,
			CreateTime: &timestamp.Timestamp{Seconds: time.Now().UTC().Unix()},
		}}
	}

	NotificationSend(logger, db, messageRouter, notifications)

	return nil
}

// Returns "true" if accepting an invite, otherwise false
func addFriend(logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string) (bool, error) {
	// Check to see if user has already blocked friend, if so ignore.
	rows, err := tx.Query("SELECT state FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state = 3", userID, friendID)
	if err != nil {
		if err == sql.ErrNoRows {
			logger.Info("Ignoring previously blocked friend. Delete friend first before attempting to add.", zap.String("user", userID.String()), zap.String("friend", friendID))
			return false, sql.ErrNoRows
		}
		logger.Debug("Failed to check edge state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}
	// We don't need the result, it only matters if there was one.
	rows.Close()

	// Mark an invite as accepted, if one was in place.
	res, err := tx.Exec(`
UPDATE user_edge SET state = 0, update_time = now()
WHERE (source_id = $1 AND destination_id = $2 AND state = 2)
OR (source_id = $2 AND destination_id = $1 AND state = 1)
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

	position := time.Now().UTC().UnixNano()

	// If no edge updates took place, it's either a new invite being set up, or user was blocked off by friend.
	_, err = tx.Exec(`
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::UUID, $2::UUID, 2, $3::BIGINT, now()),
  ($2::UUID, $1::UUID, 1, $3::BIGINT, now())
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
	if res, err = tx.Exec(`
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

func DeleteFriends(logger *zap.Logger, db *sql.DB, currentUser uuid.UUID, ids []string) error {
	uniqueFriendIDs := make(map[string]struct{})
	for _, fid := range ids {
		uniqueFriendIDs[fid] = struct{}{}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		for id := range uniqueFriendIDs {
			if deleteFriendErr := deleteFriend(logger, tx, currentUser, id); deleteFriendErr != nil {
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

func deleteFriend(logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string) error {
	res, err := tx.Exec("DELETE FROM user_edge WHERE (source_id = $1 AND destination_id = $2) OR (source_id = $2 AND destination_id = $1 AND state <> 3)", userID, friendID)
	if err != nil {
		logger.Debug("Failed to delete user edge relationships.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return err
	}

	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		logger.Debug("Could not delete user relationships as prior relationship did not exist.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return nil
	} else if rowsAffected == 1 {
		if _, err = tx.Exec("UPDATE users SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID", userID); err != nil {
			logger.Debug("Failed to update user edge counts.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	} else if rowsAffected == 2 {
		if _, err = tx.Exec("UPDATE users SET edge_count = edge_count - 1, update_time = now() WHERE id IN ($1, $2)", userID, friendID); err != nil {
			logger.Debug("Failed to update user edge counts.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	} else {
		logger.Debug("Unexpected number of edges were deleted.", zap.String("user", userID.String()), zap.String("friend", friendID), zap.Int64("rows_affected", rowsAffected))
		return errors.New("unexpected number of edges were deleted")
	}

	return nil
}

func BlockFriends(logger *zap.Logger, db *sql.DB, currentUser uuid.UUID, ids []string) error {
	uniqueFriendIDs := make(map[string]struct{})
	for _, fid := range ids {
		uniqueFriendIDs[fid] = struct{}{}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		for id := range uniqueFriendIDs {
			if blockFriendErr := blockFriend(logger, tx, currentUser, id); blockFriendErr != nil {
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

func blockFriend(logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string) error {
	// Try to update any previous edge between these users.
	res, err := tx.Exec("UPDATE user_edge SET state = 3, update_time = now() WHERE source_id = $1 AND destination_id = $2",
		userID, friendID)

	if err != nil {
		logger.Debug("Failed to update user edge state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return err
	}

	position := time.Now().UTC().UnixNano()
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		// If there was no previous edge then create one.
		query := `
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::UUID, $2::UUID, 3, $3::BIGINT, now())
) AS ue(source_id, destination_id, state, position, update_time)
WHERE EXISTS (SELECT id FROM users WHERE id = $2::UUID)`
		res, err = tx.Exec(query, userID, friendID, position)
		if err != nil {
			logger.Debug("Failed to block user.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}

		if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
			logger.Debug("Could not block user as user may not exist.", zap.String("user", userID.String()), zap.String("friend", friendID))
			return nil
		}

		// Update the edge count.
		if _, err = tx.Exec("UPDATE users SET edge_count = edge_count + 1, update_time = now() WHERE id = $1", userID); err != nil {
			logger.Debug("Failed to update user edge count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	}

	// Delete opposite relationship if user hasn't blocked you already
	res, err = tx.Exec("DELETE FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state != 3", friendID, userID)
	if err != nil {
		logger.Debug("Failed to update user edge state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return err
	}

	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 1 {
		if _, err = tx.Exec("UPDATE users SET edge_count = edge_count - 1, update_time = now() WHERE id = $1", friendID); err != nil {
			logger.Debug("Failed to update user edge count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return err
		}
	}

	return nil
}
