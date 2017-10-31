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

const (
	NOTIFICATION_DM_REQUEST         int64 = 1
	NOTIFICATION_FRIEND_REQUEST     int64 = 2
	NOTIFICATION_FRIEND_ACCEPT      int64 = 3
	NOTIFICATION_GROUP_ADD          int64 = 4
	NOTIFICATION_GROUP_JOIN_REQUEST int64 = 5
	NOTIFICATION_FRIEND_JOIN_GAME   int64 = 6
)

type notificationResumableCursor struct {
	Expiry         int64
	NotificationID []byte
}

type NNotification struct {
	Id         []byte
	UserID     []byte
	Subject    string
	Content    []byte
	Code       int64
	SenderID   []byte
	CreatedAt  int64
	ExpiresAt  int64
	Persistent bool
}

type NotificationService struct {
	logger        *zap.Logger
	db            *sql.DB
	tracker       Tracker
	messageRouter MessageRouter
	expiryMs      int64
}

func NewNotificationService(logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, config *NotificationConfig) *NotificationService {
	return &NotificationService{
		logger:        logger,
		db:            db,
		tracker:       tracker,
		messageRouter: messageRouter,
		expiryMs:      config.ExpiryMs,
	}
}

func (n *NotificationService) NotificationSend(notifications []*NNotification) error {
	persistentNotifications := make([]*NNotification, 0)
	notificationsByUser := make(map[uuid.UUID][]*NNotification)
	for _, n := range notifications {
		// Select persistent notifications for storage.
		if n.Persistent {
			persistentNotifications = append(persistentNotifications, n)
		}

		// Split all notifications by user for grouped delivery later.
		userID := uuid.FromBytesOrNil(n.UserID)
		if ns, ok := notificationsByUser[userID]; ok {
			notificationsByUser[userID] = append(ns, n)
		} else {
			notificationsByUser[userID] = []*NNotification{n}
		}
	}

	if len(persistentNotifications) > 0 {
		if err := n.notificationsSave(persistentNotifications); err != nil {
			return err
		}
	}

	for userID, ns := range notificationsByUser {
		presences := n.tracker.ListByTopicUser("notifications", userID)
		if len(presences) != 0 {
			envelope := &Envelope{
				Payload: &Envelope_LiveNotifications{
					LiveNotifications: convertNotifications(ns),
				},
			}
			n.messageRouter.Send(n.logger, presences, envelope, true)
		}
	}

	return nil
}

func (n *NotificationService) NotificationsList(userID uuid.UUID, limit int64, cursor []byte) ([]*NNotification, []byte, error) {
	expiryNow := nowMs()
	nc := &notificationResumableCursor{}
	if cursor != nil {
		if err := gob.NewDecoder(bytes.NewReader(cursor)).Decode(nc); err != nil {
			n.logger.Error("Could not decode notification cursor")
			return nil, nil, errors.New("Malformed cursor was used")
		}
	}

	// if no cursor, or cursor expiry is old, then ignore
	if nc.Expiry < expiryNow {
		nc.Expiry = expiryNow
		nc.NotificationID = uuid.Nil.Bytes()
	}

	rows, err := n.db.Query(`
SELECT id, user_id, subject, content, code, sender_id, created_at, expires_at
FROM notification
WHERE user_id = $1 AND deleted_at = 0 AND (expires_at, id) > ($2, $3)
LIMIT $4
`, userID.Bytes(), nc.Expiry, nc.NotificationID, limit)

	if err != nil {
		n.logger.Error("Could not retrieve notifications", zap.Error(err))
		return nil, nil, errors.New("Could not retrieve notifications")
	}

	notifications := make([]*NNotification, 0)
	for rows.Next() {
		no := &NNotification{Persistent: true}
		err := rows.Scan(&no.Id, &no.UserID, &no.Subject, &no.Content, &no.Code, &no.SenderID, &no.CreatedAt, &no.ExpiresAt)
		if err != nil {
			n.logger.Error("Could not scan notification from database", zap.Error(err))
			return nil, nil, errors.New("Could not retrieve notifications")
		}
		notifications = append(notifications, no)
	}

	cursorBuf := new(bytes.Buffer)
	if len(notifications) > 0 {
		lastNotification := notifications[len(notifications)-1]
		newCursor := &notificationResumableCursor{
			Expiry:         lastNotification.ExpiresAt,
			NotificationID: lastNotification.Id,
		}
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			n.logger.Error("Could not create new cursor.", zap.Error(err))
		}

		return notifications, cursorBuf.Bytes(), nil
	} else {
		if len(cursor) != 0 {
			return notifications, cursor, nil
		}
	}

	newCursor := &notificationResumableCursor{
		Expiry:         expiryNow,
		NotificationID: make([]byte, 0),
	}
	if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
		n.logger.Error("Could not create new cursor.", zap.Error(err))
	}

	return notifications, cursorBuf.Bytes(), nil
}

func (n *NotificationService) NotificationsRemove(userID uuid.UUID, notificationIDs [][]byte) error {
	statements := make([]string, 0)
	params := []interface{}{
		nowMs(),
		userID.Bytes(),
	}

	for _, id := range notificationIDs {
		statement := "$" + strconv.Itoa(len(params)+1)
		statements = append(statements, statement)
		params = append(params, id)
	}

	_, err := n.db.Exec("UPDATE notification SET deleted_at = $1 WHERE user_id = $2 AND id IN ("+strings.Join(statements, ", ")+")", params...)

	if err != nil {
		n.logger.Error("Could not delete notifications", zap.Error(err))
		return errors.New("Could not delete notifications")
	}

	return nil
}

func (n *NotificationService) notificationsSave(notifications []*NNotification) error {
	createdAt := nowMs()
	expiresAt := createdAt + n.expiryMs

	statements := make([]string, 0)
	params := make([]interface{}, 0)
	counter := 0
	for _, no := range notifications {
		statement := "$" + strconv.Itoa(counter+1) +
			",$" + strconv.Itoa(counter+2) +
			",$" + strconv.Itoa(counter+3) +
			",$" + strconv.Itoa(counter+4) +
			",$" + strconv.Itoa(counter+5) +
			",$" + strconv.Itoa(counter+6) +
			",$" + strconv.Itoa(counter+7) +
			",$" + strconv.Itoa(counter+8)

		statements = append(statements, "("+statement+")")

		params = append(params, uuid.NewV4().Bytes())
		params = append(params, no.UserID)
		params = append(params, no.Subject)
		params = append(params, no.Content)
		params = append(params, no.Code)
		params = append(params, no.SenderID)
		params = append(params, createdAt)
		params = append(params, expiresAt)

		counter = counter + 8
	}

	query := "INSERT INTO notification (id, user_id, subject, content, code, sender_id, created_at, expires_at) VALUES " + strings.Join(statements, ", ")
	n.logger.Debug("notification save query", zap.String("query", query))

	_, err := n.db.Exec(query, params...)
	if err != nil {
		n.logger.Error("Could not save notifications", zap.Error(err))
		return errors.New("Could not save notifications.")
	}
	return nil
}

func convertTNotifications(nots []*NNotification, cursor []byte) *TNotifications {
	notifications := &TNotifications{Notifications: make([]*Notification, 0), ResumableCursor: cursor}
	for _, not := range nots {
		n := &Notification{
			Id:        not.Id,
			Subject:   not.Subject,
			Content:   not.Content,
			Code:      not.Code,
			SenderId:  not.SenderID,
			CreatedAt: not.CreatedAt,
			ExpiresAt: not.ExpiresAt,
		}
		notifications.Notifications = append(notifications.Notifications, n)
	}
	return notifications
}

func convertNotifications(nots []*NNotification) *Notifications {
	notifications := &Notifications{Notifications: make([]*Notification, 0)}
	for _, not := range nots {
		n := &Notification{
			Id:        not.Id,
			Subject:   not.Subject,
			Content:   not.Content,
			Code:      not.Code,
			SenderId:  not.SenderID,
			CreatedAt: not.CreatedAt,
			ExpiresAt: not.ExpiresAt,
		}
		notifications.Notifications = append(notifications.Notifications, n)
	}
	return notifications
}
