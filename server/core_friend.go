// Copyright 2017 The Nakama Authors
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
	"errors"

	"encoding/json"
	"fmt"
	"go.uber.org/zap"
	"github.com/lib/pq"
)

func friendAdd(logger *zap.Logger, db *sql.DB, ns *NotificationService, userID string, handle string, friendID string) (err error) {
	tx, txErr := db.Begin()
	if txErr != nil {
		return txErr
	}

	isFriendAccept := false
	updatedAt := nowMs()
	defer func() {
		if err != nil {
			if rollbackErr := tx.Rollback(); rollbackErr != nil { // don't override value of err
				logger.Error("Could not rollback transaction", zap.Error(rollbackErr))
			}

			if e, ok := err.(*pq.Error); ok && e.Code == "23505" {
				// Ignore error if it is dbErrorUniqueViolation,
				// which is the case if we are adding users that already have a relationship.
				err = nil
			}
		} else {
			if e := tx.Commit(); e != nil {
				logger.Error("Could not commit transaction", zap.Error(e))
				err = e
				return
			}

			// If the operation was successful, send a notification.
			content, e := json.Marshal(map[string]interface{}{"handle": handle})
			if e != nil {
				logger.Warn("Failed to send friend add notification", zap.Error(e))
				return
			}
			var subject string
			var code int64
			if isFriendAccept {
				subject = fmt.Sprintf("%v accepted your friend request", handle)
				code = NOTIFICATION_FRIEND_ACCEPT
			} else {
				subject = fmt.Sprintf("%v wants to add you as a friend", handle)
				code = NOTIFICATION_FRIEND_REQUEST
			}

			if e := ns.NotificationSend([]*NNotification{
				&NNotification{
					Id:         generateNewId(),
					UserID:     friendID,
					Subject:    subject,
					Content:    content,
					Code:       code,
					SenderID:   userID,
					CreatedAt:  updatedAt,
					ExpiresAt:  updatedAt + ns.expiryMs,
					Persistent: true,
				},
			}); e != nil {
				logger.Warn("Failed to send friend add notification", zap.Error(e))
			}
		}
	}()

	// Mark an invite as accepted, if one was in place.
	res, err := tx.Exec(`
UPDATE user_edge SET state = 0, updated_at = $3
WHERE (source_id = $1 AND destination_id = $2 AND state = 2)
OR (source_id = $2 AND destination_id = $1 AND state = 1)
  `, friendID, userID, updatedAt)
	if err != nil {
		return err
	}
	// If both edges were updated, it was accepting an invite was successful.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
		isFriendAccept = true
		return err
	}

	// If no edge updates took place, it's a new invite being set up.
	res, err = tx.Exec(`
INSERT INTO user_edge (source_id, destination_id, state, position, updated_at)
SELECT source_id, destination_id, state, position, updated_at
FROM (VALUES
  ($1::BYTEA, $2::BYTEA, 2, $3::BIGINT, $3::BIGINT),
  ($2::BYTEA, $1::BYTEA, 1, $3::BIGINT, $3::BIGINT)
) AS ue(source_id, destination_id, state, position, updated_at)
WHERE EXISTS (SELECT id FROM users WHERE id = $2::BYTEA)
	`, userID, friendID, updatedAt)
	if err != nil {
		return err
	}

	// An invite was successfully added if both components were inserted.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 2 {
		err = sql.ErrNoRows
		return err
	}

	// Update the user edge metadata counts.
	res, err = tx.Exec(`
UPDATE user_edge_metadata
SET count = count + 1, updated_at = $1
WHERE source_id = $2
OR source_id = $3`,
		updatedAt, userID, friendID)
	if err != nil {
		return err
	}

	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 2 {
		err = errors.New("could not update user friend counts")
		return err
	}

	return nil
}

func friendAddHandle(logger *zap.Logger, db *sql.DB, ns *NotificationService, userID string, handle string, friendHandle string) error {
	var friendID string
	err := db.QueryRow("SELECT id FROM users WHERE handle = $1", friendHandle).Scan(&friendID)
	if err != nil {
		return err
	}

	return friendAdd(logger, db, ns, userID, handle, friendID)
}
