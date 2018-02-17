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
	"go.uber.org/zap"
	"database/sql"
	"github.com/satori/go.uuid"
	"time"
	"github.com/lib/pq"
	"strings"
)

func AddFriends(logger *zap.Logger, db *sql.DB, currentUser uuid.UUID, ids []string) error {
	ts := time.Now().UTC().Unix()
	notificationToSend := make(map[string]bool)
	if err := Transact(logger, db, func (tx *sql.Tx) error {
		for _, id := range ids {
			isFriendAccept, addFriendErr := addFriend(logger, tx, currentUser, id, ts)
			if addFriendErr == nil {
				notificationToSend[id] = isFriendAccept
			} else if addFriendErr != sql.ErrNoRows { // Check to see if friend had blocked user.
				return addFriendErr
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// TODO(mo, zyro): Use notificationToSend to send notification here.
	return nil
}

// Returns "true" if accepting an invite, otherwise false
func addFriend(logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string, timestamp int64) (bool, error) {
	//TODO(mo, zyro, novabyte):
	// - What's the right behaviour for adding someone that you had previously blocked?
	// - How to unblock a friend? Delete friend or unblock api call?
	// irrespective of above, we need to check for adding a friend that was previously blocked

	// Unblock user if possible
	res, err := tx.Exec("DELETE FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state = 3", userID, friendID)
	if err != nil {
		logger.Error("Failed to delete from user edge to unblock user.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// Update user count after unblocking a user
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 1 {
		if _ , err = tx.Exec("UPDATE users SET edge_count = edge_count - 1, update_time = $2 WHERE id = $1", userID, timestamp); err != nil {
			logger.Error("Failed to update user count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
			return false, err
		}

		logger.Error("Unblocked user.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, sql.ErrNoRows
	}

	// Mark an invite as accepted, if one was in place.
	res, err = tx.Exec(`
UPDATE user_edge SET state = 0, update_time = $3
WHERE (source_id = $1 AND destination_id = $2 AND state = 2)
OR (source_id = $2 AND destination_id = $1 AND state = 1)
  `, friendID, userID, timestamp)
	if err != nil {
		logger.Error("Failed to update user state.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// If both edges were updated, it was accepting an invite was successful.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
		logger.Info("Accepting friend invitation.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return true, nil
	}

	// If no edge updates took place, it's either a new invite being set up, or user was blocked off by friend.
	_, err = tx.Exec(`
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::UUID, $2::UUID, 2, $3::BIGINT, $3::BIGINT),
  ($2::UUID, $1::UUID, 1, $3::BIGINT, $3::BIGINT)
) AS ue(source_id, destination_id, state, position, update_time)
WHERE EXISTS (SELECT id FROM users WHERE id = $2::UUID)
ON CONFLICT (source_id, destination_id) DO NOTHING
`, userID, friendID, timestamp)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "user_edge_source_id_destination_id_key") {
			logger.Info("Did not add new friend as friend connection already exists or user is blocked.", zap.String("user", userID.String()), zap.String("friend", friendID))
			return false, sql.ErrNoRows
		}
		logger.Error("Failed to insert new friend link.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// Update friend count if we've just created the relationship.
	// This check is done by comparing the the timestamp(position) to the timestamp available.
	// i.e. only increase count when the relationship was first formed.
	// This is caused by an existing bug in CockroachDB: https://github.com/cockroachdb/cockroach/issues/10264
	if res, err = tx.Exec(`
UPDATE users
SET edge_count = edge_count +1, update_time = $3
WHERE
	(id = $1::UUID OR id = $2::UUID)
AND NOT EXISTS
	(SELECT state
   FROM user_edge
   WHERE
   	(source_id = $1 AND destination_id = $2 AND position <> $3)
   	OR
   	(source_id = $2 AND destination_id = $1 AND position <> $3)
  )
`, userID, friendID, timestamp); err != nil {
		logger.Error("Failed to update user count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// An invite was successfully added if both components were inserted.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 2 {
		logger.Info("Did not add new friend as friend connection already exists or user is blocked.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, sql.ErrNoRows
	}

	logger.Info("Added new friend invitation.", zap.String("user", userID.String()), zap.String("friend", friendID))
	return false, nil
}
