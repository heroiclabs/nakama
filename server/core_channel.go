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
	"fmt"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"github.com/pkg/errors"
	"go.uber.org/zap"
)

var (
	ErrChannelIdInvalid     = errors.New("invalid channel id")
	ErrChannelCursorInvalid = errors.New("invalid channel cursor")
	ErrChannelGroupNotFound = errors.New("group not found")
)

// Wrapper type to avoid allocating a stream struct when the input is invalid.
type ChannelIdToStreamResult struct {
	Stream PresenceStream
}

type channelMessageListCursor struct {
	StreamMode       uint8
	StreamSubject    string
	StreamDescriptor string
	StreamLabel      string
	CreateTime       int64
	Id               string
	Forward          bool
	IsNext           bool
}

func ChannelMessagesList(logger *zap.Logger, db *sql.DB, caller uuid.UUID, stream PresenceStream, channelId string, limit int, forward bool, cursor string) (*api.ChannelMessageList, error) {
	var incomingCursor *channelMessageListCursor
	if cursor != "" {
		if cb, err := base64.StdEncoding.DecodeString(cursor); err != nil {
			return nil, ErrChannelCursorInvalid
		} else {
			incomingCursor = &channelMessageListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
				return nil, ErrChannelCursorInvalid
			}
		}

		if forward != incomingCursor.Forward {
			// Cursor is for a different channel message list direction.
			return nil, ErrChannelCursorInvalid
		} else if stream.Mode != incomingCursor.StreamMode {
			// Stream mode does not match.
			return nil, ErrChannelCursorInvalid
		} else if stream.Subject.String() != incomingCursor.StreamSubject {
			// Stream subject does not match.
			return nil, ErrChannelCursorInvalid
		} else if stream.Descriptor.String() != incomingCursor.StreamDescriptor {
			// Stream descriptor does not match.
			return nil, ErrChannelCursorInvalid
		} else if stream.Label != incomingCursor.StreamLabel {
			// Stream label does not match.
			return nil, ErrChannelCursorInvalid
		}
	}

	// If it's a group, check membership.
	if !uuid.Equal(uuid.Nil, caller) && stream.Mode == StreamModeGroup {
		allowed, err := groupCheckUserPermission(logger, db, stream.Subject, caller, 2)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, ErrChannelGroupNotFound
		}
	}

	query := `SELECT id, code, sender_id, username, content, create_time, update_time FROM message
WHERE stream_mode = $1 AND stream_subject = $2::UUID AND stream_descriptor = $3::UUID AND stream_label = $4`
	if incomingCursor == nil {
		// Ascending doesn't need an ordering clause.
		if !forward {
			query += " ORDER BY create_time DESC, id DESC"
		}
	} else {
		if (forward && incomingCursor.IsNext) || (!forward && !incomingCursor.IsNext) {
			// Forward and next page == backwards and previous page.
			query += " AND (stream_mode, stream_subject, stream_descriptor, stream_label, create_time, id) > ($1, $2::UUID, $3::UUID, CAST($6::BIGINT AS TIMESTAMPTZ), $7)"
		} else {
			// Forward and previous page == backwards and next page.
			query += " AND (stream_mode, stream_subject, stream_descriptor, stream_label, create_time, id) < ($1, $2::UUID, $3::UUID, CAST($6::BIGINT AS TIMESTAMPTZ), $7) ORDER BY create_time DESC, id DESC"
		}
	}
	query += " LIMIT $5"
	params := []interface{}{stream.Mode, stream.Subject, stream.Descriptor, stream.Label, limit + 1}
	if incomingCursor != nil {
		params = append(params, incomingCursor.CreateTime, incomingCursor.Id)
	}

	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Error listing channel messages", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	messages := make([]*api.ChannelMessage, 0, limit)
	var nextCursor, prevCursor *channelMessageListCursor

	var dbId string
	var dbCode int32
	var dbSenderId string
	var dbUsername string
	var dbContent string
	var dbCreateTime pq.NullTime
	var dbUpdateTime pq.NullTime
	for rows.Next() {
		if len(messages) >= limit {
			nextCursor = &channelMessageListCursor{
				StreamMode:       stream.Mode,
				StreamSubject:    stream.Subject.String(),
				StreamDescriptor: stream.Descriptor.String(),
				StreamLabel:      stream.Label,
				CreateTime:       dbCreateTime.Time.Unix(),
				Id:               dbId,
				Forward:          forward,
				IsNext:           true,
			}
			break
		}

		err = rows.Scan(&dbId, &dbCode, &dbSenderId, &dbUsername, &dbContent, &dbCreateTime, &dbUpdateTime)
		if err != nil {
			logger.Error("Error parsing listed channel messages", zap.Error(err))
			return nil, err
		}

		messages = append(messages, &api.ChannelMessage{
			ChannelId:  channelId,
			MessageId:  dbId,
			Code:       &wrappers.Int32Value{Value: dbCode},
			SenderId:   dbSenderId,
			Username:   dbUsername,
			Content:    dbContent,
			CreateTime: &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime: &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
			Persistent: &wrappers.BoolValue{Value: true},
		})

		// There can only be a previous page if this is a paginated listing.
		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &channelMessageListCursor{
				StreamMode:       stream.Mode,
				StreamSubject:    stream.Subject.String(),
				StreamDescriptor: stream.Descriptor.String(),
				StreamLabel:      stream.Label,
				CreateTime:       dbCreateTime.Time.Unix(),
				Id:               dbId,
				Forward:          forward,
				IsNext:           false,
			}
		}
	}

	if incomingCursor != nil && !incomingCursor.IsNext {
		// If this was a previous page listing, flip the results to their normal order and swap the cursors.
		nextCursor, nextCursor.IsNext, prevCursor, prevCursor.IsNext = prevCursor, prevCursor.IsNext, nextCursor, nextCursor.IsNext

		for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
			messages[i], messages[j] = messages[j], messages[i]
		}
	}

	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating channel messages list next cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}
	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating channel messages list previous cursor", zap.Error(err))
			return nil, err
		}
		prevCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return &api.ChannelMessageList{
		Messages:   messages,
		NextCursor: nextCursorStr,
		PrevCursor: prevCursorStr,
	}, nil
}

func GetChannelMessages(logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*api.ChannelMessage, error) {
	query := "SELECT id, code, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time FROM message WHERE sender_id = $1::UUID"
	rows, err := db.Query(query, userID)
	if err != nil {
		logger.Error("Error listing channel messages for user", zap.String("user_id", userID.String()), zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	messages := make([]*api.ChannelMessage, 0, 100)
	var dbId string
	var dbCode int32
	var dbUsername string
	var dbStreamMode uint8
	var dbStreamSubject string
	var dbStreamDescriptor string
	var dbStreamLabel string
	var dbContent string
	var dbCreateTime pq.NullTime
	var dbUpdateTime pq.NullTime
	for rows.Next() {
		err = rows.Scan(&dbId, &dbCode, &dbUsername, &dbStreamMode, &dbStreamSubject, &dbStreamDescriptor, &dbStreamLabel, &dbContent, &dbCreateTime, &dbUpdateTime)
		if err != nil {
			logger.Error("Error parsing listed channel messages for user", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		channelId, err := StreamToChannelId(PresenceStream{
			Mode:       dbStreamMode,
			Subject:    uuid.FromStringOrNil(dbStreamSubject),
			Descriptor: uuid.FromStringOrNil(dbStreamDescriptor),
			Label:      dbStreamLabel,
		})
		if err != nil {
			logger.Error("Error processing listed channel messages for user", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		messages = append(messages, &api.ChannelMessage{
			ChannelId:  channelId,
			MessageId:  dbId,
			Code:       &wrappers.Int32Value{Value: dbCode},
			SenderId:   userID.String(),
			Username:   dbUsername,
			Content:    dbContent,
			CreateTime: &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime: &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
			Persistent: &wrappers.BoolValue{Value: true},
		})
	}

	return messages, nil
}

func ChannelIdToStream(channelId string) (*ChannelIdToStreamResult, error) {
	if channelId == "" {
		return nil, ErrChannelIdInvalid
	}

	components := strings.SplitN(channelId, ".", 4)
	if len(components) != 4 {
		return nil, ErrChannelIdInvalid
	}

	stream := PresenceStream{
		Mode: StreamModeChannel,
	}

	// Parse and assign mode.
	switch components[0] {
	case "2":
		// StreamModeChannel.
		// Expect no subject or descriptor.
		if components[1] != "" || components[2] != "" {
			return nil, ErrChannelIdInvalid
		}
		// Label.
		if l := len(components[3]); l < 1 || l > 64 {
			return nil, ErrChannelIdInvalid
		}
		stream.Label = components[3]
	case "3":
		// Expect no descriptor or label.
		if components[2] != "" || components[3] != "" {
			return nil, ErrChannelIdInvalid
		}
		// Subject.
		var err error
		if components[1] != "" {
			if stream.Subject, err = uuid.FromString(components[1]); err != nil {
				return nil, ErrChannelIdInvalid
			}
		}
		// Mode.
		stream.Mode = StreamModeGroup
	case "4":
		// Expect lo label.
		if components[3] != "" {
			return nil, ErrChannelIdInvalid
		}
		// Subject.
		var err error
		if components[1] != "" {
			if stream.Subject, err = uuid.FromString(components[1]); err != nil {
				return nil, ErrChannelIdInvalid
			}
		}
		// Descriptor.
		if components[2] != "" {
			if stream.Descriptor, err = uuid.FromString(components[2]); err != nil {
				return nil, ErrChannelIdInvalid
			}
		}
		// Mode.
		stream.Mode = StreamModeDM
	default:
		return nil, ErrChannelIdInvalid
	}

	return &ChannelIdToStreamResult{Stream: stream}, nil
}

func StreamToChannelId(stream PresenceStream) (string, error) {
	if stream.Mode != StreamModeChannel && stream.Mode != StreamModeGroup && stream.Mode != StreamModeDM {
		return "", ErrChannelIdInvalid
	}

	subject := ""
	if stream.Subject != uuid.Nil {
		subject = stream.Subject.String()
	}
	descriptor := ""
	if stream.Descriptor != uuid.Nil {
		descriptor = stream.Descriptor.String()
	}

	return fmt.Sprintf("%v.%v.%v.%v", stream.Mode, subject, descriptor, stream.Label), nil
}
