package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/jackc/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"time"
)

var errInvalidMessageId = errors.New("Invalid message identifier")
var errInvalidMessageContent = errors.New("Message content must be a valid JSON object")
var errMessageNotFound = errors.New("Could not find message to update in channel history")
var errMessagePersist = errors.New("Error persisting channel message")

func ChannelMessageSend(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, channelStream PresenceStream, channelId, content, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	if maybeJSON := []byte(content); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		return nil, errInvalidMessageContent
	}

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

			return nil, errMessagePersist
		}
	}

	router.SendToStream(logger, channelStream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	return ack, nil
}

func ChannelMessageUpdate(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, channelStream PresenceStream, channelId, messageId, content, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	if _, err := uuid.FromString(messageId); err != nil {
		return nil, errInvalidMessageId
	}

	if maybeJSON := []byte(content); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		return nil, errInvalidMessageContent
	}

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
				return nil, errMessageNotFound
			}
			logger.Error("Error persisting channel message update", zap.Error(err))
			return nil, errMessagePersist
		}
		// Replace the message create time with the real one from DB.
		message.CreateTime = &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()}
	}

	router.SendToStream(logger, channelStream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	return ack, nil
}

func ChannelMessageRemove(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, channelStream PresenceStream, channelId, messageId, senderId, senderUsername string, persist bool) (*rtapi.ChannelMessageAck, error) {
	if _, err := uuid.FromString(messageId); err != nil {
		return nil, errInvalidMessageId
	}

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
				return nil, errMessageNotFound
			}
			logger.Error("Error persisting channel message remove", zap.Error(err))
			return nil, errMessagePersist
		}
		// Replace the message create time with the real one from DB.
		message.CreateTime = &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()}
	}

	router.SendToStream(logger, channelStream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)

	return ack, nil
}
