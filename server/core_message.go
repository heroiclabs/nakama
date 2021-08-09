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
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"time"
)

var errInvalidMessageContent = errors.New("Message content must be a valid JSON object")
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
