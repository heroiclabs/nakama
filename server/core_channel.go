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
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var (
	errChannelMessageIdInvalid = errors.New("Invalid message identifier")

	errChannelMessageNotFound = errors.New("channel message not found")
	errChannelMessagePersist  = errors.New("error persisting channel message")
)

// Wrapper type to avoid allocating a stream struct when the input is invalid.
type ChannelIdToStreamResult struct {
	Stream PresenceStream
}

type channelMessageListCursor struct {
	StreamMode       uint8
	StreamSubject    string
	StreamSubcontext string
	StreamLabel      string
	CreateTime       int64
	Id               string
	Forward          bool
	IsNext           bool
}

func ChannelMessagesList(ctx context.Context, logger *zap.Logger, db *sql.DB, caller uuid.UUID, stream PresenceStream, channelID string, limit int, forward bool, cursor string) (*api.ChannelMessageList, error) {
	var incomingCursor *channelMessageListCursor
	if cursor != "" {
		cb, err := base64.StdEncoding.DecodeString(cursor)
		if err != nil {
			return nil, runtime.ErrChannelCursorInvalid
		}
		incomingCursor = &channelMessageListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, runtime.ErrChannelCursorInvalid
		}

		if forward != incomingCursor.Forward {
			// Cursor is for a different channel message list direction.
			return nil, runtime.ErrChannelCursorInvalid
		} else if stream.Mode != incomingCursor.StreamMode {
			// Stream mode does not match.
			return nil, runtime.ErrChannelCursorInvalid
		} else if stream.Subject.String() != incomingCursor.StreamSubject {
			// Stream subject does not match.
			return nil, runtime.ErrChannelCursorInvalid
		} else if stream.Subcontext.String() != incomingCursor.StreamSubcontext {
			// Stream subcontext does not match.
			return nil, runtime.ErrChannelCursorInvalid
		} else if stream.Label != incomingCursor.StreamLabel {
			// Stream label does not match.
			return nil, runtime.ErrChannelCursorInvalid
		}
	}

	// Check channel permissions for non-authoritative calls.
	if caller != uuid.Nil {
		switch stream.Mode {
		case StreamModeGroup:
			// If it's a group, check membership.
			allowed, err := groupCheckUserPermission(ctx, logger, db, stream.Subject, caller, 2)
			if err != nil {
				return nil, err
			}
			if !allowed {
				return nil, runtime.ErrChannelGroupNotFound
			}
		case StreamModeDM:
			// If it's a DM chat, check that the user is one of the chat participants.
			if stream.Subject != caller && stream.Subcontext != caller {
				return nil, runtime.ErrChannelIDInvalid
			}
		case StreamModeChannel:
			fallthrough
		default:
			// No
		}
	}

	query := `SELECT id, code, sender_id, username, content, create_time, update_time FROM message
WHERE stream_mode = $1 AND stream_subject = $2::UUID AND stream_descriptor = $3::UUID AND stream_label = $4`
	if incomingCursor == nil {
		if forward {
			query += " ORDER BY create_time ASC, id ASC"
		} else {
			query += " ORDER BY create_time DESC, id DESC"
		}
	} else {
		if (forward && incomingCursor.IsNext) || (!forward && !incomingCursor.IsNext) {
			// Forward and next page == backwards and previous page.
			query += " AND (stream_mode, stream_subject, stream_descriptor, stream_label, create_time, id) > ($1, $2::UUID, $3::UUID, $4, $6, $7) ORDER BY create_time ASC, id ASC"
		} else {
			// Forward and previous page == backwards and next page.
			query += " AND (stream_mode, stream_subject, stream_descriptor, stream_label, create_time, id) < ($1, $2::UUID, $3::UUID, $4, $6, $7) ORDER BY create_time DESC, id DESC"
		}
	}
	query += " LIMIT $5"
	params := []interface{}{stream.Mode, stream.Subject, stream.Subcontext, stream.Label, limit + 1}
	if incomingCursor != nil {
		params = append(params, time.Unix(incomingCursor.CreateTime, 0).UTC(), incomingCursor.Id)
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error listing channel messages", zap.Error(err))
		return nil, err
	}

	groupID := stream.Subject.String()
	userIDOne := stream.Subject.String()
	userIDTwo := stream.Subcontext.String()
	messages := make([]*api.ChannelMessage, 0, limit)
	var nextCursor, prevCursor *channelMessageListCursor

	var dbID string
	var dbCode int32
	var dbSenderID string
	var dbUsername string
	var dbContent string
	var dbCreateTime pgtype.Timestamptz
	var dbUpdateTime pgtype.Timestamptz
	for rows.Next() {
		if len(messages) >= limit {
			nextCursor = &channelMessageListCursor{
				StreamMode:       stream.Mode,
				StreamSubject:    stream.Subject.String(),
				StreamSubcontext: stream.Subcontext.String(),
				StreamLabel:      stream.Label,
				CreateTime:       dbCreateTime.Time.Unix(),
				Id:               dbID,
				Forward:          forward,
				IsNext:           true,
			}
			break
		}

		err = rows.Scan(&dbID, &dbCode, &dbSenderID, &dbUsername, &dbContent, &dbCreateTime, &dbUpdateTime)
		if err != nil {
			_ = rows.Close()
			logger.Error("Error parsing listed channel messages", zap.Error(err))
			return nil, err
		}

		message := &api.ChannelMessage{
			ChannelId:  channelID,
			MessageId:  dbID,
			Code:       &wrapperspb.Int32Value{Value: dbCode},
			SenderId:   dbSenderID,
			Username:   dbUsername,
			Content:    dbContent,
			CreateTime: &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime: &timestamppb.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
			Persistent: &wrapperspb.BoolValue{Value: true},
		}
		switch stream.Mode {
		case StreamModeChannel:
			message.RoomName = stream.Label
		case StreamModeGroup:
			message.GroupId = groupID
		case StreamModeDM:
			message.UserIdOne = userIDOne
			message.UserIdTwo = userIDTwo
		}

		messages = append(messages, message)

		// There can only be a previous page if this is a paginated listing.
		if incomingCursor != nil && prevCursor == nil {
			prevCursor = &channelMessageListCursor{
				StreamMode:       stream.Mode,
				StreamSubject:    stream.Subject.String(),
				StreamSubcontext: stream.Subcontext.String(),
				StreamLabel:      stream.Label,
				CreateTime:       dbCreateTime.Time.Unix(),
				Id:               dbID,
				Forward:          forward,
				IsNext:           false,
			}
		}
	}
	_ = rows.Close()

	if incomingCursor != nil && !incomingCursor.IsNext {
		// If this was a previous page listing, flip the results to their normal order and swap the cursors.
		nextCursor, prevCursor = prevCursor, nextCursor
		if nextCursor != nil {
			nextCursor.IsNext = !nextCursor.IsNext
		}
		if prevCursor != nil {
			prevCursor.IsNext = !prevCursor.IsNext
		}

		for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
			messages[i], messages[j] = messages[j], messages[i]
		}
	}

	var cacheableCursor *channelMessageListCursor
	if l := len(messages); l > 0 {
		// There is at least 1 message returned by the listing, so use it as the foundation of a new cacheable cursor.
		cacheableCursor = &channelMessageListCursor{
			StreamMode:       stream.Mode,
			StreamSubject:    stream.Subject.String(),
			StreamSubcontext: stream.Subcontext.String(),
			StreamLabel:      stream.Label,
			CreateTime:       messages[l-1].CreateTime.Seconds,
			Id:               messages[l-1].MessageId,
			Forward:          true,
			IsNext:           true,
		}
	} else if forward && incomingCursor != nil {
		// No messages but it was a forward paginated listing and there was a cursor, use that as a cacheable cursor.
		cacheableCursor = incomingCursor
	} else if !forward && incomingCursor != nil {
		// No messages but it was a backwards paginated listing and there was a cursor, use that as a cacheable cursor with its direction flipped.
		cacheableCursor = incomingCursor
		cacheableCursor.Forward = true
		cacheableCursor.IsNext = true
	}

	var nextCursorStr string
	if nextCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			logger.Error("Error creating channel messages list next cursor", zap.Error(err))
			return nil, err
		}
		nextCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}
	var prevCursorStr string
	if prevCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
			logger.Error("Error creating channel messages list previous cursor", zap.Error(err))
			return nil, err
		}
		prevCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}
	var cacheableCursorStr string
	if cacheableCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(cacheableCursor); err != nil {
			logger.Error("Error creating channel messages list cacheable cursor", zap.Error(err))
			return nil, err
		}
		cacheableCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return &api.ChannelMessageList{
		Messages:        messages,
		NextCursor:      nextCursorStr,
		PrevCursor:      prevCursorStr,
		CacheableCursor: cacheableCursorStr,
	}, nil
}

func ChannelMessageSend(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, channelStream PresenceStream, channelId, content, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  channelId,
		MessageId:  uuid.Must(uuid.NewV4()).String(),
		Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeChat},
		SenderId:   senderId,
		Username:   senderUsername,
		Content:    content,
		CreateTime: &timestamppb.Timestamp{Seconds: ts},
		UpdateTime: &timestamppb.Timestamp{Seconds: ts},
		Persistent: &wrapperspb.BoolValue{Value: persist},
	}

	ack := &rtapi.ChannelMessageAck{
		ChannelId:  message.ChannelId,
		MessageId:  message.MessageId,
		Code:       message.Code,
		Username:   message.Username,
		CreateTime: message.CreateTime,
		UpdateTime: message.UpdateTime,
		Persistent: message.Persistent,
	}
	switch channelStream.Mode {
	case StreamModeChannel:
		message.RoomName, ack.RoomName = channelStream.Label, channelStream.Label
	case StreamModeGroup:
		message.GroupId, ack.GroupId = channelStream.Subject.String(), channelStream.Subject.String()
	case StreamModeDM:
		message.UserIdOne, ack.UserIdOne = channelStream.Subject.String(), channelStream.Subject.String()
		message.UserIdTwo, ack.UserIdTwo = channelStream.Subcontext.String(), channelStream.Subcontext.String()
	}

	if persist {
		query := `INSERT INTO message (id, code, sender_id, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $6::UUID, $7::UUID, $8, $9, $10, $10)`
		_, err := db.ExecContext(ctx, query, message.MessageId, message.Code.Value, message.SenderId, message.Username, channelStream.Mode, channelStream.Subject, channelStream.Subcontext, channelStream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC())
		if err != nil {
			logger.Error("Error persisting channel message", zap.Error(err))

			return nil, errChannelMessagePersist
		}
	}

	router.SendToStream(logger, channelStream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	return ack, nil
}

func ChannelMessageUpdate(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, channelStream PresenceStream, channelId, messageId, content, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  channelId,
		MessageId:  messageId,
		Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeChatUpdate},
		SenderId:   senderId,
		Username:   senderUsername,
		Content:    content,
		CreateTime: &timestamppb.Timestamp{Seconds: ts},
		UpdateTime: &timestamppb.Timestamp{Seconds: ts},
		Persistent: &wrapperspb.BoolValue{Value: persist},
	}

	ack := &rtapi.ChannelMessageAck{
		ChannelId:  message.ChannelId,
		MessageId:  message.MessageId,
		Code:       message.Code,
		Username:   message.Username,
		CreateTime: message.CreateTime,
		UpdateTime: message.UpdateTime,
		Persistent: message.Persistent,
	}

	switch channelStream.Mode {
	case StreamModeChannel:
		message.RoomName, ack.RoomName = channelStream.Label, channelStream.Label
	case StreamModeGroup:
		message.GroupId, ack.GroupId = channelStream.Subject.String(), channelStream.Subject.String()
	case StreamModeDM:
		message.UserIdOne, ack.UserIdOne = channelStream.Subject.String(), channelStream.Subject.String()
		message.UserIdTwo, ack.UserIdTwo = channelStream.Subcontext.String(), channelStream.Subcontext.String()
	}

	if persist {
		// First find and update the referenced message.
		var dbCreateTime pgtype.Timestamptz
		query := "UPDATE message SET update_time = $5, username = $4, content = $3 WHERE id = $1 AND sender_id = $2 RETURNING create_time"
		err := db.QueryRowContext(ctx, query, messageId, message.SenderId, message.Content, message.Username, time.Unix(message.UpdateTime.Seconds, 0).UTC()).Scan(&dbCreateTime)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, errChannelMessageNotFound
			}
			logger.Error("Error persisting channel message update", zap.Error(err))
			return nil, errChannelMessagePersist
		}
		// Replace the message create time with the real one from DB.
		message.CreateTime = &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()}
	}

	router.SendToStream(logger, channelStream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	return ack, nil
}

func ChannelMessageRemove(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, channelStream PresenceStream, channelId, messageId, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  channelId,
		MessageId:  messageId,
		Code:       &wrapperspb.Int32Value{Value: ChannelMessageTypeChatRemove},
		SenderId:   senderId,
		Username:   senderUsername,
		Content:    "{}",
		CreateTime: &timestamppb.Timestamp{Seconds: ts},
		UpdateTime: &timestamppb.Timestamp{Seconds: ts},
		Persistent: &wrapperspb.BoolValue{Value: persist},
	}

	ack := &rtapi.ChannelMessageAck{
		ChannelId:  message.ChannelId,
		MessageId:  message.MessageId,
		Code:       message.Code,
		Username:   message.Username,
		CreateTime: message.CreateTime,
		UpdateTime: message.UpdateTime,
		Persistent: message.Persistent,
	}

	switch channelStream.Mode {
	case StreamModeChannel:
		message.RoomName, ack.RoomName = channelStream.Label, channelStream.Label
	case StreamModeGroup:
		message.GroupId, ack.GroupId = channelStream.Subject.String(), channelStream.Subject.String()
	case StreamModeDM:
		message.UserIdOne, ack.UserIdOne = channelStream.Subject.String(), channelStream.Subject.String()
		message.UserIdTwo, ack.UserIdTwo = channelStream.Subcontext.String(), channelStream.Subcontext.String()
	}

	if persist {
		// First find and remove the referenced message.
		var dbCreateTime pgtype.Timestamptz
		query := "DELETE FROM message WHERE id = $1 AND sender_id = $2 RETURNING create_time"
		err := db.QueryRowContext(ctx, query, messageId, message.SenderId).Scan(&dbCreateTime)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, errChannelMessageNotFound
			}
			logger.Error("Error persisting channel message remove", zap.Error(err))
			return nil, errChannelMessagePersist
		}
		// Replace the message create time with the real one from DB.
		message.CreateTime = &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()}
	}

	router.SendToStream(logger, channelStream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	return ack, nil
}

func GetChannelMessages(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*api.ChannelMessage, error) {
	query := "SELECT id, code, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time FROM message WHERE sender_id = $1::UUID"
	rows, err := db.QueryContext(ctx, query, userID)
	if err != nil {
		logger.Error("Error listing channel messages for user", zap.String("user_id", userID.String()), zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	messages := make([]*api.ChannelMessage, 0, 100)
	var dbID string
	var dbCode int32
	var dbUsername string
	var dbStreamMode uint8
	var dbStreamSubject string
	var dbStreamSubcontext string
	var dbStreamLabel string
	var dbContent string
	var dbCreateTime pgtype.Timestamptz
	var dbUpdateTime pgtype.Timestamptz
	for rows.Next() {
		err = rows.Scan(&dbID, &dbCode, &dbUsername, &dbStreamMode, &dbStreamSubject, &dbStreamSubcontext, &dbStreamLabel, &dbContent, &dbCreateTime, &dbUpdateTime)
		if err != nil {
			logger.Error("Error parsing listed channel messages for user", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		channelID, err := StreamToChannelId(PresenceStream{
			Mode:       dbStreamMode,
			Subject:    uuid.FromStringOrNil(dbStreamSubject),
			Subcontext: uuid.FromStringOrNil(dbStreamSubcontext),
			Label:      dbStreamLabel,
		})
		if err != nil {
			logger.Error("Error processing listed channel messages for user", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		messages = append(messages, &api.ChannelMessage{
			ChannelId:  channelID,
			MessageId:  dbID,
			Code:       &wrapperspb.Int32Value{Value: dbCode},
			SenderId:   userID.String(),
			Username:   dbUsername,
			Content:    dbContent,
			CreateTime: &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime: &timestamppb.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
			Persistent: &wrapperspb.BoolValue{Value: true},
		})
	}

	return messages, nil
}

func ChannelIdToStream(channelID string) (*ChannelIdToStreamResult, error) {
	if channelID == "" {
		return nil, runtime.ErrChannelIDInvalid
	}

	components := strings.SplitN(channelID, ".", 4)
	if len(components) != 4 {
		return nil, runtime.ErrChannelIDInvalid
	}

	stream := PresenceStream{
		Mode: StreamModeChannel,
	}

	// Parse and assign mode.
	switch components[0] {
	case "2":
		// StreamModeChannel.
		// Expect no subject or subcontext.
		if components[1] != "" || components[2] != "" {
			return nil, runtime.ErrChannelIDInvalid
		}
		// Label.
		if l := len(components[3]); l < 1 || l > 64 {
			return nil, runtime.ErrChannelIDInvalid
		}
		stream.Label = components[3]
	case "3":
		// Expect no subcontext or label.
		if components[2] != "" || components[3] != "" {
			return nil, runtime.ErrChannelIDInvalid
		}
		// Subject.
		var err error
		if components[1] != "" {
			if stream.Subject, err = uuid.FromString(components[1]); err != nil {
				return nil, runtime.ErrChannelIDInvalid
			}
		}
		// Mode.
		stream.Mode = StreamModeGroup
	case "4":
		// Expect lo label.
		if components[3] != "" {
			return nil, runtime.ErrChannelIDInvalid
		}
		// Subject.
		var err error
		if components[1] != "" {
			if stream.Subject, err = uuid.FromString(components[1]); err != nil {
				return nil, runtime.ErrChannelIDInvalid
			}
		}
		// Subcontext.
		if components[2] != "" {
			if stream.Subcontext, err = uuid.FromString(components[2]); err != nil {
				return nil, runtime.ErrChannelIDInvalid
			}
		}
		// Mode.
		stream.Mode = StreamModeDM
	default:
		return nil, runtime.ErrChannelIDInvalid
	}

	return &ChannelIdToStreamResult{Stream: stream}, nil
}

func StreamToChannelId(stream PresenceStream) (string, error) {
	if stream.Mode != StreamModeChannel && stream.Mode != StreamModeGroup && stream.Mode != StreamModeDM {
		return "", runtime.ErrChannelIDInvalid
	}

	subject := ""
	if stream.Subject != uuid.Nil {
		subject = stream.Subject.String()
	}
	subcontext := ""
	if stream.Subcontext != uuid.Nil {
		subcontext = stream.Subcontext.String()
	}

	return fmt.Sprintf("%v.%v.%v.%v", stream.Mode, subject, subcontext, stream.Label), nil
}

func BuildChannelId(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, target string, chanType rtapi.ChannelJoin_Type) (string, PresenceStream, error) {
	if target == "" {
		return "", PresenceStream{}, runtime.ErrInvalidChannelTarget
	}

	stream := PresenceStream{
		Mode: StreamModeChannel,
	}

	switch chanType {
	case rtapi.ChannelJoin_TYPE_UNSPECIFIED:
		// Defaults to room channel.
		fallthrough
	case rtapi.ChannelJoin_ROOM:
		if len(target) < 1 || len(target) > 64 {
			return "", PresenceStream{}, fmt.Errorf("Channel name is required and must be 1-64 chars: %w", runtime.ErrInvalidChannelTarget)
		}
		if controlCharsRegex.MatchString(target) {
			return "", PresenceStream{}, fmt.Errorf("Channel name must not contain control chars: %w", runtime.ErrInvalidChannelTarget)
		}
		if !utf8.ValidString(target) {
			return "", PresenceStream{}, fmt.Errorf("Channel name must only contain valid UTF-8 bytes: %w", runtime.ErrInvalidChannelTarget)
		}
		stream.Label = target
		// Channel mode is already set by default above.
	case rtapi.ChannelJoin_DIRECT_MESSAGE:
		// Check if user ID is valid.
		uid, err := uuid.FromString(target)
		if err != nil {
			return "", PresenceStream{}, fmt.Errorf("Invalid user ID in direct message join: %w", runtime.ErrInvalidChannelTarget)
		}
		// Not allowed to chat to the nil uuid.
		if uid == uuid.Nil {
			return "", PresenceStream{}, fmt.Errorf("Invalid user ID in direct message join: %w", runtime.ErrInvalidChannelTarget)
		}
		// If userID is the system user, skip these checks
		if userID != uuid.Nil {
			// Check if the other user exists and has not blocked this user.
			allowed, err := UserExistsAndDoesNotBlock(ctx, db, uid, userID)
			if err != nil {
				return "", PresenceStream{}, errors.New("Failed to look up user ID")
			}
			if !allowed {
				return "", PresenceStream{}, fmt.Errorf("User ID not found: %w", runtime.ErrInvalidChannelTarget)
			}
			// Assign the ID pair in a consistent order.
			if uid.String() > userID.String() {
				stream.Subject = userID
				stream.Subcontext = uid
			} else {
				stream.Subject = uid
				stream.Subcontext = userID
			}
			stream.Mode = StreamModeDM
		}
	case rtapi.ChannelJoin_GROUP:
		// Check if group ID is valid.
		gid, err := uuid.FromString(target)
		if err != nil {
			return "", PresenceStream{}, fmt.Errorf("Invalid group ID in group channel join: %w", runtime.ErrInvalidChannelTarget)
		}
		if userID != uuid.Nil {
			allowed, err := groupCheckUserPermission(ctx, logger, db, gid, userID, 2)
			if err != nil {
				return "", PresenceStream{}, errors.New("Failed to look up group membership")
			}
			if !allowed {
				return "", PresenceStream{}, fmt.Errorf("Group not found: %w", runtime.ErrInvalidChannelTarget)
			}
		}

		stream.Subject = gid
		stream.Mode = StreamModeGroup
	default:
		return "", PresenceStream{}, runtime.ErrInvalidChannelType
	}

	channelID, err := StreamToChannelId(stream)
	if err != nil {
		// Should not happen after the input validation above, but guard just in case.
		logger.Error("Error converting stream to channel identifier", zap.Error(err), zap.Any("stream", stream))
		return "", PresenceStream{}, err
	}

	return channelID, stream, nil
}
