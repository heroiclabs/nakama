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
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"errors"
	"strconv"
	"strings"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

const (
	NOTIFICATION_DM_REQUEST         int32 = -1
	NOTIFICATION_FRIEND_REQUEST     int32 = -2
	NOTIFICATION_FRIEND_ACCEPT      int32 = -3
	NOTIFICATION_GROUP_ADD          int32 = -4
	NOTIFICATION_GROUP_JOIN_REQUEST int32 = -5
	NOTIFICATION_FRIEND_JOIN_GAME   int32 = -6
)

type notificationCacheableCursor struct {
	NotificationID []byte
	CreateTime     int64
}

func NotificationSend(logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, notifications map[uuid.UUID][]*api.Notification) error {
	persistentNotifications := make(map[uuid.UUID][]*api.Notification)
	for userID, ns := range notifications {
		for _, userNotification := range ns {
			// Select persistent notifications for storage.
			if userNotification.Persistent {
				if pun := persistentNotifications[userID]; pun == nil {
					persistentNotifications[userID] = []*api.Notification{userNotification}
				} else {
					persistentNotifications[userID] = append(pun, userNotification)
				}
			}
		}
	}

	// Store any persistent notifications.
	if len(persistentNotifications) > 0 {
		if err := NotificationSave(logger, db, persistentNotifications); err != nil {
			return err
		}
	}

	// Deliver live notifications to connected users.
	for userID, ns := range notifications {
		messageRouter.SendToStream(logger, PresenceStream{Mode: StreamModeNotifications, Subject: userID}, &rtapi.Envelope{
			Message: &rtapi.Envelope_Notifications{
				Notifications: &rtapi.Notifications{
					Notifications: ns,
				},
			},
		})
	}

	return nil
}

func NotificationList(logger *zap.Logger, db *sql.DB, userID uuid.UUID, limit int, cursor string) (*api.NotificationList, error) {
	nc := &notificationCacheableCursor{}
	if cursor != "" {
		if cb, err := base64.RawURLEncoding.DecodeString(cursor); err != nil {
			logger.Warn("Could not base64 decode notification cursor.", zap.String("cursor", cursor))
			return nil, errors.New("Malformed cursor was used.")
		} else {
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(nc); err != nil {
				logger.Warn("Could not decode notification cursor.", zap.String("cursor", cursor))
				return nil, errors.New("Malformed cursor was used.")
			}
		}
	}

	params := []interface{}{userID, limit}
	cursorQuery := " "
	if nc.NotificationID != nil {
		cursorQuery = " AND (user_id, create_time, id) > ($1::UUID, $3, $4::UUID)"
		params = append(params, nc.CreateTime, uuid.FromBytesOrNil(nc.NotificationID))
	}

	rows, err := db.Query(`
SELECT id, subject, content, code, sender_id, create_time
FROM notification
WHERE user_id = $1`+cursorQuery+`
ORDER BY create_time ASC
LIMIT $2`, params...)

	if err != nil {
		logger.Error("Could not retrieve notifications.", zap.Error(err))
		return nil, err
	}

	notifications := make([]*api.Notification, 0)
	for rows.Next() {
		no := &api.Notification{Persistent: true, CreateTime: &timestamp.Timestamp{}}
		var senderId sql.NullString
		if err := rows.Scan(&no.Id, &no.Subject, &no.Content, &no.Code, &senderId, &no.CreateTime.Seconds); err != nil {
			logger.Error("Could not scan notification from database.", zap.Error(err))
			return nil, err
		}
		no.SenderId = senderId.String
		notifications = append(notifications, no)
	}

	notificationList := &api.NotificationList{}
	cursorBuf := new(bytes.Buffer)
	if len(notifications) == 0 {
		if len(cursor) > 0 {
			notificationList.CacheableCursor = cursor
		} else {
			newCursor := &notificationCacheableCursor{NotificationID: nil, CreateTime: 0}
			if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Could not create new cursor.", zap.Error(err))
				return nil, err
			}
			notificationList.CacheableCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
		}
	} else {
		lastNotification := notifications[len(notifications)-1]
		newCursor := &notificationCacheableCursor{
			NotificationID: uuid.FromStringOrNil(lastNotification.Id).Bytes(),
			CreateTime:     lastNotification.CreateTime.Seconds,
		}
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Could not create new cursor.", zap.Error(err))
			return nil, err
		}
		notificationList.Notifications = notifications
		notificationList.CacheableCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return notificationList, nil
}

func NotificationDelete(logger *zap.Logger, db *sql.DB, userID uuid.UUID, notificationIDs []string) error {
	statements := make([]string, 0, len(notificationIDs))
	params := make([]interface{}, 0, len(notificationIDs))
	params = append(params, userID)

	for _, id := range notificationIDs {
		statement := "$" + strconv.Itoa(len(params)+1)
		statements = append(statements, statement)
		params = append(params, id)
	}

	_, err := db.Exec("DELETE FROM notification WHERE user_id = $1 AND id IN ("+strings.Join(statements, ", ")+")", params...)
	if err != nil {
		logger.Error("Could not delete notifications.", zap.Error(err))
		return err
	}

	return nil
}

func NotificationSave(logger *zap.Logger, db *sql.DB, notifications map[uuid.UUID][]*api.Notification) error {
	statements := make([]string, 0, len(notifications))
	params := make([]interface{}, 0, len(notifications))
	counter := 0
	for userID, no := range notifications {
		for _, un := range no {
			statement := "$" + strconv.Itoa(counter+1) +
				",$" + strconv.Itoa(counter+2) +
				",$" + strconv.Itoa(counter+3) +
				",$" + strconv.Itoa(counter+4) +
				",$" + strconv.Itoa(counter+5) +
				",$" + strconv.Itoa(counter+6)

			if un.SenderId == "" {
				statement += ",NULL"
				counter = counter + 6
			} else {
				statement += ",$" + strconv.Itoa(counter+7)
				counter = counter + 7
			}

			statements = append(statements, "("+statement+")")

			params = append(params, un.Id)
			params = append(params, userID)
			params = append(params, un.Subject)
			params = append(params, un.Content)
			params = append(params, un.Code)
			params = append(params, un.CreateTime.Seconds)
			if un.SenderId != "" {
				params = append(params, un.SenderId)
			}
		}
	}

	query := "INSERT INTO notification (id, user_id, subject, content, code, create_time, sender_id) VALUES " + strings.Join(statements, ", ")

	if _, err := db.Exec(query, params...); err != nil {
		logger.Error("Could not save notifications", zap.Error(err))
		return err
	}

	return nil
}
