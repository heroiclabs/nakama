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
	"encoding/json"
	"fmt"
	"regexp"
	"time"
	"unicode/utf8"

	"database/sql"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/jackc/pgx/pgtype"
	"github.com/pkg/errors"
	"go.uber.org/zap"
)

const (
	ChannelMessageTypeChat int32 = iota
	ChannelMessageTypeChatUpdate
	ChannelMessageTypeChatRemove
	ChannelMessageTypeGroupJoin
	ChannelMessageTypeGroupAdd
	ChannelMessageTypeGroupLeave
	ChannelMessageTypeGroupKick
	ChannelMessageTypeGroupPromote
	ChannelMessageTypeGroupBan
)

var ErrChannelMessageUpdateNotFound = errors.New("channel message not found")

var controlCharsRegex = regexp.MustCompilePOSIX("[[:cntrl:]]+")

func (p *Pipeline) channelJoin(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetChannelJoin()

	if incoming.Target == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel target",
		}}}, true)
		return
	}

	stream := PresenceStream{
		Mode: StreamModeChannel,
	}

	switch incoming.Type {
	case int32(rtapi.ChannelJoin_TYPE_UNSPECIFIED):
		// Defaults to room channel.
		fallthrough
	case int32(rtapi.ChannelJoin_ROOM):
		if len(incoming.Target) < 1 || len(incoming.Target) > 64 {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Channel name is required and must be 1-64 chars",
			}}}, true)
			return
		}
		if controlCharsRegex.MatchString(incoming.Target) {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Channel name must not contain control chars",
			}}}, true)
			return
		}
		if !utf8.ValidString(incoming.Target) {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Channel name must only contain valid UTF-8 bytes",
			}}}, true)
			return
		}
		stream.Label = incoming.Target
		// Channel mode is already set by default above.
	case int32(rtapi.ChannelJoin_DIRECT_MESSAGE):
		// Check if user ID is valid.
		uid, err := uuid.FromString(incoming.Target)
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user ID in direct message join",
			}}}, true)
			return
		}
		// Not allowed to chat to the nil uuid.
		if uid == uuid.Nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid user ID in direct message join",
			}}}, true)
			return
		}
		// Check if attempting to chat to self.
		userID := session.UserID()
		if userID == uid {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Cannot open direct message channel with self",
			}}}, true)
			return
		}
		// Check if the other user exists and has not blocked this user.
		allowed, err := UserExistsAndDoesNotBlock(session.Context(), p.db, uid, userID)
		if err != nil {
			logger.Warn("Failed to execute query to check user and friend block state", zap.Error(err), zap.String("uid", userID.String()), zap.String("friend", uid.String()))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Failed to look up user ID",
			}}}, true)
			return
		}
		if !allowed {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "User ID not found",
			}}}, true)
			return
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
	case int32(rtapi.ChannelJoin_GROUP):
		// Check if group ID is valid.
		gid, err := uuid.FromString(incoming.Target)
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Invalid group ID in group channel join",
			}}}, true)
			return
		}
		allowed, err := groupCheckUserPermission(session.Context(), logger, p.db, gid, session.UserID(), 2)
		if err != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Failed to look up group membership",
			}}}, true)
			return
		}
		if !allowed {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: "Group not found",
			}}}, true)
			return
		}
		stream.Subject = gid
		stream.Mode = StreamModeGroup
	default:
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Unrecognized channel type",
		}}}, true)
		return
	}

	channelID, err := StreamToChannelId(stream)
	if err != nil {
		// Should not happen after the input validation above, but guard just in case.
		logger.Error("Error converting stream to channel identifier", zap.Error(err), zap.Any("stream", stream))
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error identifying channel stream",
		}}}, true)
		return
	}

	meta := PresenceMeta{
		Format:      session.Format(),
		Hidden:      incoming.Hidden != nil && incoming.Hidden.Value,
		Persistence: incoming.Persistence == nil || incoming.Persistence.Value,
		Username:    session.Username(),
	}
	success, isNew := p.tracker.Track(session.ID(), stream, session.UserID(), meta, false)
	if !success {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error joining channel",
		}}}, true)
		return
	}

	// List current presences, not including hidden ones.
	presences := p.tracker.ListByStream(stream, false, true)

	// If the topic join is a DM check if we should notify the other user.
	// Only new presences are allowed to send notifications to avoid duplicates.
	if isNew && stream.Mode == StreamModeDM {
		userID := session.UserID()
		otherUserID := stream.Subject
		if userID == otherUserID {
			otherUserID = stream.Subcontext
		}

		otherUserPresent := false
		for _, pr := range presences {
			if pr.UserID == otherUserID {
				otherUserPresent = true
				break
			}
		}

		if !otherUserPresent {
			content, e := json.Marshal(map[string]string{"username": session.Username()})
			if e != nil {
				logger.Warn("Failed to send channel direct message notification", zap.Error(e))
			} else {
				notifications := map[uuid.UUID][]*api.Notification{
					otherUserID: {
						{
							Id:         uuid.Must(uuid.NewV4()).String(),
							Subject:    fmt.Sprintf("%v wants to chat", session.Username()),
							Content:    string(content),
							SenderId:   userID.String(),
							Code:       NotificationCodeDmRequest,
							Persistent: true,
							CreateTime: &timestamp.Timestamp{Seconds: time.Now().UTC().Unix()},
						},
					},
				}

				// Any error is already logged before it's returned here.
				_ = NotificationSend(session.Context(), logger, p.db, p.router, notifications)
			}
		}
	}

	userPresences := make([]*rtapi.UserPresence, 0, len(presences))
	for _, presence := range presences {
		if isNew && presence.UserID == session.UserID() && presence.ID.SessionID == session.ID() {
			// Ensure the user themselves does not appear in the list of existing channel presences.
			// Only for new joins, not if the user is joining a channel they're already part of.
			continue
		}
		userPresences = append(userPresences, &rtapi.UserPresence{
			UserId:      presence.UserID.String(),
			SessionId:   presence.ID.SessionID.String(),
			Username:    presence.Meta.Username,
			Persistence: presence.Meta.Persistence,
		})
	}

	channel := &rtapi.Channel{
		Id:        channelID,
		Presences: userPresences,
		Self: &rtapi.UserPresence{
			UserId:      session.UserID().String(),
			SessionId:   session.ID().String(),
			Username:    meta.Username,
			Persistence: meta.Persistence,
		},
	}
	switch stream.Mode {
	case StreamModeChannel:
		channel.RoomName = stream.Label
	case StreamModeGroup:
		channel.GroupId = stream.Subject.String()
	case StreamModeDM:
		channel.UserIdOne = stream.Subject.String()
		channel.UserIdTwo = stream.Subcontext.String()
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Channel{Channel: channel}}, true)
}

func (p *Pipeline) channelLeave(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetChannelLeave()

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return
	}

	p.tracker.Untrack(session.ID(), streamConversionResult.Stream, session.UserID())

	session.Send(&rtapi.Envelope{Cid: envelope.Cid}, true)
}

func (p *Pipeline) channelMessageSend(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetChannelMessageSend()

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return
	}

	if maybeJSON := []byte(incoming.Content); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Message content must be a valid JSON object",
		}}}, true)
		return
	}

	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), streamConversionResult.Stream, session.UserID())
	if meta == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Must join channel before sending messages",
		}}}, true)
		return
	}

	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  incoming.ChannelId,
		MessageId:  uuid.Must(uuid.NewV4()).String(),
		Code:       &wrappers.Int32Value{Value: ChannelMessageTypeChat},
		SenderId:   session.UserID().String(),
		Username:   session.Username(),
		Content:    incoming.Content,
		CreateTime: &timestamp.Timestamp{Seconds: ts},
		UpdateTime: &timestamp.Timestamp{Seconds: ts},
		Persistent: &wrappers.BoolValue{Value: meta.Persistence},
	}
	switch streamConversionResult.Stream.Mode {
	case StreamModeChannel:
		message.RoomName = streamConversionResult.Stream.Label
	case StreamModeGroup:
		message.GroupId = streamConversionResult.Stream.Subject.String()
	case StreamModeDM:
		message.UserIdOne = streamConversionResult.Stream.Subject.String()
		message.UserIdTwo = streamConversionResult.Stream.Subcontext.String()
	}

	if meta.Persistence {
		query := `INSERT INTO message (id, code, sender_id, username, stream_mode, stream_subject, stream_descriptor, stream_label, content, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $6::UUID, $7::UUID, $8, $9, $10, $10)`
		_, err := p.db.ExecContext(session.Context(), query, message.MessageId, message.Code.Value, message.SenderId, message.Username, streamConversionResult.Stream.Mode, streamConversionResult.Stream.Subject, streamConversionResult.Stream.Subcontext, streamConversionResult.Stream.Label, message.Content, time.Unix(message.CreateTime.Seconds, 0).UTC())
		if err != nil {
			logger.Error("Error persisting channel message", zap.Error(err))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not persist message to channel history",
			}}}, true)
			return
		}
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
	switch streamConversionResult.Stream.Mode {
	case StreamModeChannel:
		ack.RoomName = streamConversionResult.Stream.Label
	case StreamModeGroup:
		ack.GroupId = streamConversionResult.Stream.Subject.String()
	case StreamModeDM:
		ack.UserIdOne = streamConversionResult.Stream.Subject.String()
		ack.UserIdTwo = streamConversionResult.Stream.Subcontext.String()
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_ChannelMessageAck{ChannelMessageAck: ack}}, true)

	p.router.SendToStream(logger, streamConversionResult.Stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
}

func (p *Pipeline) channelMessageUpdate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetChannelMessageUpdate()

	if _, err := uuid.FromString(incoming.MessageId); err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid message identifier",
		}}}, true)
		return
	}

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return
	}

	if maybeJSON := []byte(incoming.Content); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Message content must be a valid JSON object",
		}}}, true)
		return
	}

	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), streamConversionResult.Stream, session.UserID())
	if meta == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Must join channel before updating messages",
		}}}, true)
		return
	}

	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  incoming.ChannelId,
		MessageId:  incoming.MessageId,
		Code:       &wrappers.Int32Value{Value: ChannelMessageTypeChatUpdate},
		SenderId:   session.UserID().String(),
		Username:   session.Username(),
		Content:    incoming.Content,
		CreateTime: &timestamp.Timestamp{Seconds: ts},
		UpdateTime: &timestamp.Timestamp{Seconds: ts},
		Persistent: &wrappers.BoolValue{Value: meta.Persistence},
	}
	switch streamConversionResult.Stream.Mode {
	case StreamModeChannel:
		message.RoomName = streamConversionResult.Stream.Label
	case StreamModeGroup:
		message.GroupId = streamConversionResult.Stream.Subject.String()
	case StreamModeDM:
		message.UserIdOne = streamConversionResult.Stream.Subject.String()
		message.UserIdTwo = streamConversionResult.Stream.Subcontext.String()
	}

	if meta.Persistence {
		// First find and update the referenced message.
		var dbCreateTime pgtype.Timestamptz
		query := "UPDATE message SET update_time = $5, username = $4, content = $3 WHERE id = $1 AND sender_id = $2 RETURNING create_time"
		err := p.db.QueryRowContext(session.Context(), query, incoming.MessageId, message.SenderId, message.Content, message.Username, time.Unix(message.UpdateTime.Seconds, 0).UTC()).Scan(&dbCreateTime)
		if err != nil {
			if err == sql.ErrNoRows {
				session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_BAD_INPUT),
					Message: "Could not find message to update in channel history",
				}}}, true)
				return
			}
			logger.Error("Error persisting channel message update", zap.Error(err))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not persist message update to channel history",
			}}}, true)
			return
		}
		// Replace the message create time with the real one from DB.
		message.CreateTime = &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()}
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
	switch streamConversionResult.Stream.Mode {
	case StreamModeChannel:
		ack.RoomName = streamConversionResult.Stream.Label
	case StreamModeGroup:
		ack.GroupId = streamConversionResult.Stream.Subject.String()
	case StreamModeDM:
		ack.UserIdOne = streamConversionResult.Stream.Subject.String()
		ack.UserIdTwo = streamConversionResult.Stream.Subcontext.String()
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_ChannelMessageAck{ChannelMessageAck: ack}}, true)

	p.router.SendToStream(logger, streamConversionResult.Stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
}

func (p *Pipeline) channelMessageRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	incoming := envelope.GetChannelMessageRemove()

	if _, err := uuid.FromString(incoming.MessageId); err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid message identifier",
		}}}, true)
		return
	}

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return
	}

	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), streamConversionResult.Stream, session.UserID())
	if meta == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Must join channel before removing messages",
		}}}, true)
		return
	}

	ts := time.Now().Unix()
	message := &api.ChannelMessage{
		ChannelId:  incoming.ChannelId,
		MessageId:  incoming.MessageId,
		Code:       &wrappers.Int32Value{Value: ChannelMessageTypeChatRemove},
		SenderId:   session.UserID().String(),
		Username:   session.Username(),
		Content:    "{}",
		CreateTime: &timestamp.Timestamp{Seconds: ts},
		UpdateTime: &timestamp.Timestamp{Seconds: ts},
		Persistent: &wrappers.BoolValue{Value: meta.Persistence},
	}
	switch streamConversionResult.Stream.Mode {
	case StreamModeChannel:
		message.RoomName = streamConversionResult.Stream.Label
	case StreamModeGroup:
		message.GroupId = streamConversionResult.Stream.Subject.String()
	case StreamModeDM:
		message.UserIdOne = streamConversionResult.Stream.Subject.String()
		message.UserIdTwo = streamConversionResult.Stream.Subcontext.String()
	}

	if meta.Persistence {
		// First find and remove the referenced message.
		var dbCreateTime pgtype.Timestamptz
		query := "DELETE FROM message WHERE id = $1 AND sender_id = $2 RETURNING create_time"
		err := p.db.QueryRowContext(session.Context(), query, incoming.MessageId, message.SenderId).Scan(&dbCreateTime)
		if err != nil {
			if err == sql.ErrNoRows {
				session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_BAD_INPUT),
					Message: "Could not find message to remove in channel history",
				}}}, true)
				return
			}
			logger.Error("Error persisting channel message remove", zap.Error(err))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: "Could not persist message remove to channel history",
			}}}, true)
			return
		}
		// Replace the message create time with the real one from DB.
		message.CreateTime = &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()}
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
	switch streamConversionResult.Stream.Mode {
	case StreamModeChannel:
		ack.RoomName = streamConversionResult.Stream.Label
	case StreamModeGroup:
		ack.GroupId = streamConversionResult.Stream.Subject.String()
	case StreamModeDM:
		ack.UserIdOne = streamConversionResult.Stream.Subject.String()
		ack.UserIdTwo = streamConversionResult.Stream.Subcontext.String()
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_ChannelMessageAck{ChannelMessageAck: ack}}, true)

	p.router.SendToStream(logger, streamConversionResult.Stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
}
