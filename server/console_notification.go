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
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"slices"
	"time"
)

type notificationsCursor struct {
	NotificationID []byte
	UserID         []byte
	CreateTime     int64
	IsNext         bool
}

func (s *ConsoleServer) ListNotifications(ctx context.Context, in *console.ListNotificationsRequest) (*console.NotificationList, error) {
	var nc *notificationsCursor
	if in.Cursor != "" {
		nc = &notificationsCursor{}
		cb, err := base64.URLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Warn("Could not base64 decode notification cursor.", zap.String("cursor", in.Cursor))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		}
		if err = gob.NewDecoder(bytes.NewReader(cb)).Decode(nc); err != nil {
			s.logger.Warn("Could not decode notification cursor.", zap.String("cursor", in.Cursor))
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
		s.logger.Error("Could not retrieve notifications.", zap.Error(err))
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
			s.logger.Error("Could not scan notification from database.", zap.Error(err))
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
	if err = rows.Err(); err != nil {
		s.logger.Error("Error retrieving notifications", zap.Error(err))
		return nil, err
	}
	_ = rows.Close()

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
			s.logger.Error("Error creating purchases list cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.URLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			s.logger.Error("Error creating purchases list cursor", zap.Error(err))
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
		s.logger.Error("Could not retrieve notification.", zap.Error(err))
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
	if _, err := s.db.ExecContext(ctx, "DELETE FROM notification WHERE id = $1", in.Id); err != nil {
		s.logger.Error("Error deleting notification.", zap.Error(err))
		return nil, status.Error(codes.Internal, "failed to delete notification")
	}

	return &emptypb.Empty{}, nil
}
