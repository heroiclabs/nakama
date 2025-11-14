// Copyright 2024 The Nakama Authors
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
	"slices"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type notificationsCursor struct {
	NotificationID []byte
	UserID         []byte
	CreateTime     int64
	IsNext         bool
}

func (s *ConsoleServer) ListNotifications(ctx context.Context, in *console.ListNotificationsRequest) (*console.NotificationList, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	var nc *notificationsCursor
	if in.Cursor != "" {
		nc = &notificationsCursor{}
		cb, err := base64.URLEncoding.DecodeString(in.Cursor)
		if err != nil {
			logger.Warn("Could not base64 decode notification cursor.", zap.String("cursor", in.Cursor))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		}
		if err = gob.NewDecoder(bytes.NewReader(cb)).Decode(nc); err != nil {
			logger.Warn("Could not decode notification cursor.", zap.String("cursor", in.Cursor))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		}
	}

	query := `
SELECT
    id,
    user_id,
    subject,
    content,
    code,
    sender_id,
    create_time
FROM
    notification
`

	var params []any

	if nc != nil {
		if nc.IsNext {
			if in.UserId == "" {
				query += `
WHERE (user_id, create_time, id) > ($1::UUID, $2::TIMESTAMPTZ, $3::UUID)
ORDER BY user_id, create_time, id
LIMIT $4`
			} else {
				query += `
WHERE user_id = $1::UUID
	AND (user_id, create_time, id) > ($1::UUID, $2::TIMESTAMPTZ, $3::UUID)
ORDER BY user_id, create_time, id
LIMIT $4`
			}
		} else {
			if in.UserId == "" {
				query += `
WHERE (user_id, create_time, id) < ($1::UUID, $2::TIMESTAMPTZ, $3::UUID)
ORDER BY user_id DESC, create_time DESC, id DESC
LIMIT $4`
			} else {
				query += `
WHERE user_id = $1::UUID
	AND (user_id, create_time, id) < ($1::UUID, $2::TIMESTAMPTZ, $3::UUID)
ORDER BY user_id DESC, create_time DESC, id DESC
LIMIT $4`
			}
		}
		params = append(params, nc.UserID, &pgtype.Timestamptz{Time: time.Unix(0, nc.CreateTime).UTC(), Valid: true}, uuid.FromBytesOrNil(nc.NotificationID))
	} else {
		if in.UserId == "" {
			query += " ORDER BY user_id, create_time, id LIMIT $1"
		} else {
			query += " WHERE user_id = $1 ORDER BY user_id, create_time, id LIMIT $2"
			params = append(params, in.UserId)
		}
	}

	params = append(params, in.Limit+1)

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Could not retrieve notifications.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	var nextCursor *notificationsCursor
	var prevCursor *notificationsCursor
	notifications := make([]*console.Notification, 0, in.Limit)

	var (
		id         uuid.UUID
		userId     uuid.UUID
		subject    string
		content    string
		code       int32
		senderId   string
		createTime pgtype.Timestamptz
	)

	for rows.Next() {
		if len(notifications) >= int(in.Limit) {
			nextCursor = &notificationsCursor{
				NotificationID: id.Bytes(),
				CreateTime:     createTime.Time.UnixNano(),
				UserID:         userId.Bytes(),
				IsNext:         true,
			}
			break
		}

		if err := rows.Scan(&id, &userId, &subject, &content, &code, &senderId, &createTime); err != nil {
			_ = rows.Close()
			logger.Error("Could not scan notification from database.", zap.Error(err))
			return nil, err
		}

		no := &console.Notification{
			UserId:     userId.String(),
			Id:         id.String(),
			Subject:    subject,
			Content:    content,
			Code:       code,
			SenderId:   senderId,
			CreateTime: timestamppb.New(createTime.Time),
			Persistent: true,
		}

		notifications = append(notifications, no)

		if nc != nil && prevCursor == nil {
			prevCursor = &notificationsCursor{
				NotificationID: id.Bytes(),
				CreateTime:     createTime.Time.UnixNano(),
				UserID:         userId.Bytes(),
				IsNext:         false,
			}
		}
	}
	_ = rows.Close()
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving notifications", zap.Error(err))
		return nil, err
	}

	if nc != nil && !nc.IsNext {
		if nextCursor != nil && prevCursor != nil {
			nextCursor, nextCursor.IsNext, prevCursor, prevCursor.IsNext = prevCursor, prevCursor.IsNext, nextCursor, nextCursor.IsNext
		} else if nextCursor != nil {
			nextCursor, prevCursor = nil, nextCursor
			prevCursor.IsNext = !prevCursor.IsNext
		} else if prevCursor != nil {
			nextCursor, prevCursor = prevCursor, nil
			nextCursor.IsNext = !nextCursor.IsNext
		}

		slices.Reverse(notifications)
	}

	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating purchases list cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating purchases list cursor", zap.Error(err))
			return nil, err
		}
		prevCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return &console.NotificationList{
		NextCursor:    nextCursorStr,
		PrevCursor:    prevCursorStr,
		Notifications: notifications,
	}, nil
}

func (s *ConsoleServer) GetNotification(ctx context.Context, in *console.GetNotificationRequest) (*console.Notification, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "notification id is required.")
	}

	query := `
SELECT
	id,
	user_id,
	subject,
	content,
	code,
	sender_id,
	create_time
FROM
	notification
WHERE
	id = $1
`
	var (
		id         uuid.UUID
		userId     uuid.UUID
		subject    string
		content    string
		code       int32
		senderId   string
		createTime pgtype.Timestamptz
	)

	if err := s.db.QueryRowContext(ctx, query, in.Id).Scan(&id, &userId, &subject, &content, &code, &senderId, &createTime); err != nil {
		if err == sql.ErrNoRows {
			return nil, status.Error(codes.NotFound, "Notification not found.")
		}
		logger.Error("Could not retrieve notification.", zap.Error(err))
		return nil, status.Error(codes.Internal, "failed to fetch notification")
	}

	return &console.Notification{
		Id:         id.String(),
		Subject:    subject,
		Content:    content,
		Code:       code,
		SenderId:   senderId,
		CreateTime: timestamppb.New(createTime.Time),
		Persistent: true,
		UserId:     userId.String(),
	}, nil
}

func (s *ConsoleServer) DeleteNotification(ctx context.Context, in *console.DeleteNotificationRequest) (*emptypb.Empty, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if _, err := s.db.ExecContext(ctx, "DELETE FROM notification WHERE id = $1", in.Id); err != nil {
		logger.Error("Error deleting notification.", zap.Error(err))
		return nil, status.Error(codes.Internal, "failed to delete notification")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) SendNotification(ctx context.Context, in *console.SendNotificationRequest) (*emptypb.Empty, error) {
	logger, _ := LoggerWithTraceId(ctx, s.logger)
	if l := len(in.UserIds); l == 0 {
		senderId := uuid.Nil.String()
		if in.SenderId != "" {
			if _, err := uuid.FromString(in.SenderId); err != nil {
				return nil, status.Error(codes.Internal, "failed to send notification, invalid sender id")
			}
			senderId = in.SenderId
		}
		contentBytes, err := in.Content.MarshalJSON()
		if err != nil {
			logger.Error("Error marshaling notification content.", zap.Error(err))
			return nil, status.Error(codes.Internal, "failed to send notification, invalid content")
		}
		notification := &api.Notification{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    in.Subject,
			Content:    string(contentBytes),
			Code:       in.Code,
			SenderId:   senderId,
			CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
			Persistent: in.Persistent,
		}

		if err := NotificationSendAll(ctx, logger, s.db, s.tracker, s.router, notification); err != nil {
			logger.Error("Error sending notification.", zap.Error(err))
			return nil, status.Error(codes.Internal, "failed to send notification")
		}
	} else {
		senderId := uuid.Nil.String()
		if in.SenderId != "" {
			if _, err := uuid.FromString(in.SenderId); err != nil {
				return nil, status.Error(codes.Internal, "failed to send notification, invalid sender id")
			}
			senderId = in.SenderId
		}
		contentBytes, err := in.Content.MarshalJSON()
		if err != nil {
			logger.Error("Error marshaling notification content.", zap.Error(err))
			return nil, status.Error(codes.Internal, "failed to send notification, invalid content")
		}
		t := &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()}
		notifications := make(map[uuid.UUID][]*api.Notification, l)
		for _, id := range in.UserIds {
			userID, err := uuid.FromString(id)
			if err != nil {
				logger.Error("Error parsing user id.", zap.Error(err), zap.String("id", id))
				return nil, status.Error(codes.Internal, "failed to send notification, invalid user id")
			}
			if userID == uuid.Nil {
				return nil, status.Error(codes.Internal, "failed to send notification, cannot send to system user")
			}
			notifications[userID] = []*api.Notification{{
				Id:         uuid.Must(uuid.NewV4()).String(),
				Subject:    in.Subject,
				Content:    string(contentBytes),
				Code:       in.Code,
				SenderId:   senderId,
				CreateTime: t,
				Persistent: in.Persistent,
			}}
		}

		if err := NotificationSend(ctx, logger, s.db, s.tracker, s.router, notifications); err != nil {
			logger.Error("Error sending notification.", zap.Error(err))
			return nil, status.Error(codes.Internal, "failed to send notification")
		}
	}

	return &emptypb.Empty{}, nil
}
