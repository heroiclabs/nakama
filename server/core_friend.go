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
	"strings"
	"strconv"
	"time"
)

func AddFriends(logger *zap.Logger, db *sql.DB, currentUser uuid.UUID, ids []string) error {
	ts := time.Now().UTC().Unix()
	notificationToSend := make(map[string]bool)
	if err := Transact(logger, db, func (tx *sql.Tx) error {
		for _, id := range ids {
			isFriendAccept, addFriendErr := addFriend(logger, tx, currentUser, id, ts)

			if addFriendErr != nil {
				// Check to see if friend had blocked user.
				if addFriendErr != sql.ErrNoRows {
					return addFriendErr
				}
			} else {
				notificationToSend[id] = isFriendAccept
			}
		}
		return nil
	}); err != nil {
		return err
	}

	// TODO(mo, zyro): Use notificationToSend to send notification here.
	return nil
}

func fetchUserID(db *sql.DB, usernames []string) ([]string, error) {
	ids := make([]string, 0)
	if len(usernames) == 0 {
		return ids, nil
	}

	statements := make([]string, 0)
	params := make([]interface{}, 0)
	counter := 1
	for _, username := range usernames {
		params = append(params, username)
		statement := "$" + strconv.Itoa(counter)
		statements = append(statements, statement)
		counter++
	}

	query := "SELECT id FROM users WHERE username IN ("+ strings.Join(usernames, ", ") + ")"
	rows, err := db.Query(query, params...)
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var id string
		err := rows.Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}

	return ids, nil
}

// Returns "true" if accepting an invite, otherwise false
func addFriend(logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, friendID string, timestamp int64) (bool, error) {

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
			return false, nil
		}

		logger.Error("Unblocked user.", zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, nil
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
	res, err = tx.Exec(`
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::BYTEA, $2::BYTEA, 2, $3::BIGINT, $3::BIGINT),
  ($2::BYTEA, $1::BYTEA, 1, $3::BIGINT, $3::BIGINT)
) AS ue(source_id, destination_id, state, position, update_time)
WHERE EXISTS (SELECT id FROM users WHERE id = $2::BYTEA)
ON CONFLICT DO NOTHING
	`, userID, friendID, timestamp)
	if err != nil {
		logger.Error("Failed to insert new friend link.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, err
	}

	// An invite was successfully added if both components were inserted.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 2 {
		logger.Info("Did not add new friend as friend has blocked user.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, sql.ErrNoRows
	}

	if _ , err = tx.Exec(`
UPDATE users
SET edge_count = edge_count +1, update_time = $3
WHERE id = $1 OR id = $2`, userID, friendID, timestamp); err != nil {
		logger.Error("Failed to update user count.", zap.Error(err), zap.String("user", userID.String()), zap.String("friend", friendID))
		return false, nil
	}

	logger.Info("Added new friend invitation.", zap.String("user", userID.String()), zap.String("friend", friendID))
	return false, nil
}
