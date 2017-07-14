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

	"bytes"
	"encoding/gob"
	"errors"

	"strconv"
	"strings"

	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type notificationResumableCursor struct {
	Expiry         int64
	NotificationID []byte
}

type Notification struct {
	Id        []byte
	Subject   string
	Content   []byte
	Code      int64
	SenderID  []byte
	CreatedAt int64
	ExpiresAt int64
}

func listNotifications(logger *zap.Logger, db *sql.DB, userID uuid.UUID, limit int64, cursor []byte) ([]*Notification, []byte, error) {
	expiryNow := nowMs()
	nc := &notificationResumableCursor{}
	if cursor != nil {
		if err := gob.NewDecoder(bytes.NewReader(cursor)).Decode(nc); err != nil {
			logger.Error("Could not decode notification cursor")
			return nil, nil, errors.New("Malformed cursor was used")
		}
	}

	// if no cursor, or cursor expiry is old, then ignore
	if nc.Expiry < expiryNow {
		nc.Expiry = expiryNow
		nc.NotificationID = uuid.Nil.Bytes()
	}

	rows, err := db.Query(`
SELECT id, subject, content, code, sender_id, created_at, expires_at
FROM notification
WHERE user_id = $1 AND deleted_at = 0 AND (expires_at, id) > ($2, $3)
LIMIT $4
`, userID.Bytes(), nc.Expiry, nc.NotificationID, limit)

	if err != nil {
		logger.Error("Could not retrieve notifications", zap.Error(err))
		return nil, nil, errors.New("Could not retrieve notifications")
	}

	notifications := make([]*Notification, 0)
	for rows.Next() {
		n := &Notification{}
		err := rows.Scan(&n.Id, &n.Subject, &n.Content, &n.Code, &n.SenderID, &n.CreatedAt, &n.ExpiresAt)
		if err != nil {
			logger.Error("Could not scan notification from database", zap.Error(err))
			return nil, nil, errors.New("Could not retrieve notifications")
		}
		notifications = append(notifications, n)
	}

	cursorBuf := new(bytes.Buffer)
	if len(notifications) > 0 {
		lastNotification := notifications[len(notifications)-1]
		newCursor := &notificationResumableCursor{
			Expiry:         lastNotification.ExpiresAt,
			NotificationID: lastNotification.Id,
		}
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Could not create new cursor.", zap.Error(err))
		}
	}

	return notifications, cursorBuf.Bytes(), nil
}

func removeNotifications(logger *zap.Logger, db *sql.DB, userID uuid.UUID, notificationIDs [][]byte) error {
	counter := 2 // userID is first element
	statements := make([]string, 0)
	for range notificationIDs {
		statement := "$" + strconv.Itoa(counter)
		counter += 1
		statements = append(statements, statement)
	}

	_, err := db.Exec("UPDATE notification SET deleted_at = $1 WHERE user_id = $2 AND id IN ("+strings.Join(statements, ", ")+")", nowMs(), userID.Bytes(), notificationIDs)

	if err != nil {
		logger.Error("Could not delete notifications", zap.Error(err))
		return errors.New("Could not delete notifications")
	}

	return nil
}

func saveNotifications(logger *zap.Logger, db *sql.DB, userID uuid.UUID, expiryMs int64, notifications []*Notification) error {
	statements := make([]string, 0)
	params := make([]interface{}, 0)
	counter := 0
	for _, n := range notifications {
		statement := `
id = $` + strconv.Itoa(counter+1) + `
user_id = $` + strconv.Itoa(counter+2) + `
subject = $` + strconv.Itoa(counter+3) + `
content = $` + strconv.Itoa(counter+4) + `
code = $` + strconv.Itoa(counter+5) + `
sender_id = $` + strconv.Itoa(counter+6) + `
created_at = $` + strconv.Itoa(counter+7) + `
expires_at = $` + strconv.Itoa(counter+8)

		statements = append(statements, "("+statement+")")

		params = append(params, uuid.NewV4().Bytes())
		params = append(params, userID.Bytes())
		params = append(params, n.Subject)
		params = append(params, n.Content)
		params = append(params, n.Code)
		params = append(params, n.SenderID)
		params = append(params, nowMs())
		params = append(params, nowMs()+expiryMs)

		counter = counter + 8
	}

	_, err := db.Exec("INSERT INTO notification (id, user_id, subject, content, code, sender_id, created_at, expires_at) VALUES "+strings.Join(statements, ", "), params)
	if err != nil {
		logger.Error("Could not save notifications", zap.Error(err))
		return errors.New("Could not save notifications.")
	}
	return nil
}
