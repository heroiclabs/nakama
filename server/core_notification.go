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
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/jackc/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	NotificationCodeDmRequest        int32 = -1
	NotificationCodeFriendRequest    int32 = -2
	NotificationCodeFriendAccept     int32 = -3
	NotificationCodeGroupAdd         int32 = -4
	NotificationCodeGroupJoinRequest int32 = -5
	NotificationCodeFriendJoinGame   int32 = -6
	NotificationCodeSingleSocket     int32 = -7
)

type notificationCacheableCursor struct {
	NotificationID []byte
	CreateTime     int64
}

func NotificationSend(ctx context.Context, logger *zap.Logger, db *sql.DB, messageRouter MessageRouter, notifications map[uuid.UUID][]*api.Notification) error {
	persistentNotifications := make(map[uuid.UUID][]*api.Notification, len(notifications))
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
		if err := NotificationSave(ctx, logger, db, persistentNotifications); err != nil {
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
		}, true)
	}

	return nil
}

func NotificationSendAll(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, notification *api.Notification) error {
	// Non-persistent notifications don't need to work through all database users, just use currently connected notification streams.
	if !notification.Persistent {
		env := &rtapi.Envelope{
			Message: &rtapi.Envelope_Notifications{
				Notifications: &rtapi.Notifications{
					Notifications: []*api.Notification{notification},
				},
			},
		}

		notificationStreamMode := StreamModeNotifications
		streams := tracker.CountByStreamModeFilter(map[uint8]*uint8{StreamModeNotifications: &notificationStreamMode})
		for streamPtr, count := range streams {
			if streamPtr == nil || count == 0 {
				continue
			}
			messageRouter.SendToStream(logger, *streamPtr, env, true)
		}
		return nil
	}

	const limit = 10_000

	// Start dispatch in paginated batches.
	go func() {
		// Switch to a background context, the caller should not wait for the full operation to complete.
		ctx := context.Background()
		notificationLogger := logger.With(zap.String("notification_subject", notification.Subject))

		var userIDStr string
		for {
			sends := make(map[uuid.UUID][]*api.Notification, limit)

			params := make([]interface{}, 0, 1)
			query := "SELECT id FROM users"
			if userIDStr != "" {
				query += " AND id > $1"
				params = append(params, userIDStr)
			}
			query += fmt.Sprintf(" ORDER BY id ASC LIMIT %d", limit)

			rows, err := db.QueryContext(ctx, query, params...)
			if err != nil {
				notificationLogger.Error("Failed to retrieve user data to send notification", zap.Error(err))
				return
			}

			for rows.Next() {
				if err = rows.Scan(&userIDStr); err != nil {
					_ = rows.Close()
					notificationLogger.Error("Failed to scan user data to send notification", zap.String("id", userIDStr), zap.Error(err))
					return
				}
				userID, err := uuid.FromString(userIDStr)
				if err != nil {
					_ = rows.Close()
					notificationLogger.Error("Failed to parse scanned user id data to send notification", zap.String("id", userIDStr), zap.Error(err))
					return
				}
				sends[userID] = []*api.Notification{{
					Id:         uuid.Must(uuid.NewV4()).String(),
					Subject:    notification.Subject,
					Content:    notification.Content,
					Code:       notification.Code,
					SenderId:   notification.SenderId,
					CreateTime: notification.CreateTime,
					Persistent: notification.Persistent,
				}}
			}
			_ = rows.Close()

			if len(sends) == 0 {
				// Pagination finished.
				return
			}

			if err := NotificationSave(ctx, notificationLogger, db, sends); err != nil {
				notificationLogger.Error("Failed to save persistent notifications", zap.Error(err))
				return
			}

			// Deliver live notifications to connected users.
			for userID, notifications := range sends {
				env := &rtapi.Envelope{
					Message: &rtapi.Envelope_Notifications{
						Notifications: &rtapi.Notifications{
							Notifications: []*api.Notification{notifications[0]},
						},
					},
				}

				messageRouter.SendToStream(logger, PresenceStream{Mode: StreamModeNotifications, Subject: userID}, env, true)
			}

			// Stop pagination when reaching the last (incomplete) page.
			if len(sends) < limit {
				return
			}
		}
	}()

	return nil
}

func NotificationList(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, limit int, cursor string, nc *notificationCacheableCursor) (*api.NotificationList, error) {
	params := []interface{}{userID}

	limitQuery := " "
	if limit > 0 {
		params = append(params, limit)
		limitQuery = " LIMIT $2"
	}

	cursorQuery := " "
	if nc != nil && nc.NotificationID != nil {
		cursorQuery = " AND (user_id, create_time, id) > ($1::UUID, $3::TIMESTAMPTZ, $4::UUID)"
		params = append(params, &pgtype.Timestamptz{Time: time.Unix(0, nc.CreateTime).UTC(), Status: pgtype.Present}, uuid.FromBytesOrNil(nc.NotificationID))
	}

	rows, err := db.QueryContext(ctx, `
SELECT id, subject, content, code, sender_id, create_time
FROM notification
WHERE user_id = $1`+cursorQuery+`
ORDER BY create_time ASC, id ASC`+limitQuery, params...)

	if err != nil {
		logger.Error("Could not retrieve notifications.", zap.Error(err))
		return nil, err
	}

	notifications := make([]*api.Notification, 0, limit)
	var lastCreateTime int64
	for rows.Next() {
		no := &api.Notification{Persistent: true, CreateTime: &timestamppb.Timestamp{}}
		var createTime pgtype.Timestamptz
		if err := rows.Scan(&no.Id, &no.Subject, &no.Content, &no.Code, &no.SenderId, &createTime); err != nil {
			_ = rows.Close()
			logger.Error("Could not scan notification from database.", zap.Error(err))
			return nil, err
		}

		lastCreateTime = createTime.Time.UnixNano()
		no.CreateTime.Seconds = createTime.Time.Unix()
		if no.SenderId == uuid.Nil.String() {
			no.SenderId = ""
		}
		notifications = append(notifications, no)
	}
	_ = rows.Close()

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
			CreateTime:     lastCreateTime,
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

func NotificationDelete(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, notificationIDs []string) error {
	statements := make([]string, 0, len(notificationIDs))
	params := make([]interface{}, 0, len(notificationIDs)+1)
	params = append(params, userID)

	for _, id := range notificationIDs {
		statement := "$" + strconv.Itoa(len(params)+1)
		statements = append(statements, statement)
		params = append(params, id)
	}

	query := "DELETE FROM notification WHERE user_id = $1 AND id IN (" + strings.Join(statements, ", ") + ")"
	logger.Debug("Delete notification query", zap.String("query", query), zap.Any("params", params))
	_, err := db.ExecContext(ctx, query, params...)
	if err != nil {
		logger.Error("Could not delete notifications.", zap.Error(err))
		return err
	}

	return nil
}

func NotificationSave(ctx context.Context, logger *zap.Logger, db *sql.DB, notifications map[uuid.UUID][]*api.Notification) error {
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

			counter = counter + 6
			statements = append(statements, "("+statement+")")

			params = append(params, un.Id)
			params = append(params, userID)
			params = append(params, un.Subject)
			params = append(params, un.Content)
			params = append(params, un.Code)
			params = append(params, un.SenderId)
		}
	}

	query := "INSERT INTO notification (id, user_id, subject, content, code, sender_id) VALUES " + strings.Join(statements, ", ")

	if _, err := db.ExecContext(ctx, query, params...); err != nil {
		logger.Error("Could not save notifications.", zap.Error(err))
		return err
	}

	return nil
}
