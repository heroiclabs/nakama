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
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	ChannelMessageTypeGroupDemote
)

var controlCharsRegex = regexp.MustCompilePOSIX("[[:cntrl:]]+")

func (p *Pipeline) channelJoin(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetChannelJoin()

	channelID, stream, err := BuildChannelId(session.Context(), logger, p.db, session.UserID(), incoming.Target, rtapi.ChannelJoin_Type(incoming.Type))
	if err != nil {
		if errors.Is(err, runtime.ErrInvalidChannelTarget) || errors.Is(err, runtime.ErrInvalidChannelType) {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_BAD_INPUT),
				Message: err.Error(),
			}}}, true)
			return false, nil
		} else {
			_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
				Message: err.Error(),
			}}}, true)
			return false, nil
		}
	}

	meta := PresenceMeta{
		Format:      session.Format(),
		Hidden:      incoming.Hidden != nil && incoming.Hidden.Value,
		Persistence: incoming.Persistence == nil || incoming.Persistence.Value,
		Username:    session.Username(),
	}
	success, isNew := p.tracker.Track(session.Context(), session.ID(), stream, session.UserID(), meta)
	if !success {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Error joining channel",
		}}}, true)
		return false, nil
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
							CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
						},
					},
				}

				// Any error is already logged before it's returned here.
				_ = NotificationSend(session.Context(), logger, p.db, p.tracker, p.router, notifications)
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

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Channel{Channel: channel}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) channelLeave(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetChannelLeave()

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return false, nil
	}

	p.tracker.Untrack(session.ID(), streamConversionResult.Stream, session.UserID())

	out := &rtapi.Envelope{Cid: envelope.Cid}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) channelMessageSend(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetChannelMessageSend()

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return false, nil
	}

	if maybeJSON := []byte(incoming.Content); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Message content must be a valid JSON object",
		}}}, true)
		return false, nil
	}

	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), streamConversionResult.Stream, session.UserID())
	if meta == nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Must join channel before sending messages",
		}}}, true)
		return false, nil
	}

	ack, err := ChannelMessageSend(session.Context(), p.logger, p.db, p.router, streamConversionResult.Stream, incoming.ChannelId, incoming.Content, session.UserID().String(), session.Username(), meta.Persistence)
	switch err {
	case errChannelMessagePersist:
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Could not persist message to channel history",
		}}}, true)
		return false, nil
	}

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_ChannelMessageAck{ChannelMessageAck: ack}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) channelMessageUpdate(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetChannelMessageUpdate()

	if _, err := uuid.FromString(incoming.MessageId); err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid message identifier",
		}}}, true)
		return false, nil
	}

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return false, nil
	}

	if maybeJSON := []byte(incoming.Content); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Message content must be a valid JSON object",
		}}}, true)
		return false, nil
	}

	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), streamConversionResult.Stream, session.UserID())
	if meta == nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Must join channel before updating messages",
		}}}, true)
		return false, nil
	}

	ack, err := ChannelMessageUpdate(session.Context(), p.logger, p.db, p.router, streamConversionResult.Stream, incoming.ChannelId, incoming.MessageId, incoming.Content, session.UserID().String(), session.Username(), meta.Persistence)
	switch err {
	case errChannelMessageNotFound:
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Could not find message to update in channel history",
		}}}, true)
		return false, nil
	case errChannelMessagePersist:
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Could not persist message update to channel history",
		}}}, true)
	}

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_ChannelMessageAck{ChannelMessageAck: ack}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) channelMessageRemove(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	incoming := envelope.GetChannelMessageRemove()

	if _, err := uuid.FromString(incoming.MessageId); err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid message identifier",
		}}}, true)
		return false, nil
	}

	streamConversionResult, err := ChannelIdToStream(incoming.ChannelId)
	if err != nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Invalid channel identifier",
		}}}, true)
		return false, nil
	}

	meta := p.tracker.GetLocalBySessionIDStreamUserID(session.ID(), streamConversionResult.Stream, session.UserID())
	if meta == nil {
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Must join channel before removing messages",
		}}}, true)
		return false, nil
	}

	ack, err := ChannelMessageRemove(session.Context(), p.logger, p.db, p.router, streamConversionResult.Stream, incoming.ChannelId, incoming.MessageId, session.UserID().String(), session.Username(), meta.Persistence)
	switch err {
	case errChannelMessageNotFound:
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "Could not find message to remove in channel history",
		}}}, true)
		return false, nil
	case errChannelMessagePersist:
		_ = session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_EXCEPTION),
			Message: "Could not persist message remove to channel history",
		}}}, true)
	}

	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_ChannelMessageAck{ChannelMessageAck: ack}}
	_ = session.Send(out, true)

	return true, out
}
