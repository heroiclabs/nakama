// Copyright 2017 The Nakama Authors
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
	"encoding/json"
	"regexp"
	"unicode/utf8"

	"fmt"
	"go.uber.org/zap"
)

type messageCursor struct {
	MessageID string
	UserID    string
	CreatedAt int64
}

var controlCharsRegex = regexp.MustCompilePOSIX("[[:cntrl:]]+")

func (p *pipeline) topicJoin(logger *zap.Logger, session session, envelope *Envelope) {
	e := envelope.GetTopicsJoin()

	if len(e.Joins) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"), true)
		return
	} else if len(e.Joins) > 1 {
		logger.Warn("There are more than one item passed to the request - only processing the first item.")
	}

	t := e.Joins[0]

	dmOtherUserID := ""
	var topic *TopicId
	var trackerTopic string
	switch t.Id.(type) {
	case *TTopicsJoin_TopicJoin_UserId:
		// Check input is valid ID.
		otherUserID := t.GetUserId()
		if otherUserID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid User ID"), true)
			return
		}

		// Don't allow chat to self.
		if session.UserID() == otherUserID {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Cannot chat to self"), true)
			return
		}

		// Check the user exists and does not block the requester.
		existsAndDoesNotBlock, err := p.userExistsAndDoesNotBlock(otherUserID, session.UserID())
		if err != nil {
			logger.Error("Could not check if user exists", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Failed to look up user ID"), true)
			return
		} else if !existsAndDoesNotBlock {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "User ID not found"), true)
			return
		}

		userID := session.UserID()
		if userID < otherUserID {
			topic = &TopicId{Id: &TopicId_Dm{Dm: userID + otherUserID}}
			trackerTopic = "dm:" + userID + otherUserID
		} else {
			topic = &TopicId{Id: &TopicId_Dm{Dm: otherUserID + userID}}
			trackerTopic = "dm:" + otherUserID + userID
		}
		dmOtherUserID = otherUserID
	case *TTopicsJoin_TopicJoin_Room:
		// Check input is valid room name.
		room := t.GetRoom()
		if len(room) < 1 || len(room) > 64 {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name is required and must be 1-64 chars"), true)
			return
		}
		if controlCharsRegex.MatchString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must not contain control chars"), true)
			return
		}
		if !utf8.ValidString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must only contain valid UTF-8 bytes"), true)
			return
		}

		topic = &TopicId{Id: &TopicId_Room{Room: room}}
		trackerTopic = "room:" + room
	case *TTopicsJoin_TopicJoin_GroupId:
		// Check input is valid ID.
		groupID := t.GetGroupId()
		if groupID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID not valid"), true)
			return
		}

		// Check if group exists and user is a member.
		member, err := p.isGroupMember(session.UserID(), groupID)
		if err != nil {
			logger.Error("Could not check if user is group member", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Failed to look up group membership"), true)
			return
		} else if !member {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Group not found, or not a member"), true)
			return
		}

		trackerTopic = "group:" + groupID
		topic = &TopicId{Id: &TopicId_GroupId{GroupId: groupID}}
	case nil:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No topic ID found"), true)
		return
	default:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Unrecognized topic ID"), true)
		return
	}

	handle := session.Handle()

	// Track the presence, and gather current member list.
	isNewPresence := p.tracker.Track(session.ID(), trackerTopic, session.UserID(), PresenceMeta{
		Handle: handle,
		Format: session.Format(),
	})
	presences := p.tracker.ListByTopic(trackerTopic)

	// If the topic join is a DM check if we should notify the other user.
	// Only new presences are allowed to send notifications to avoid duplicates.
	if isNewPresence && dmOtherUserID != "" {
		otherUserPresent := false
		for _, pr := range presences {
			if pr.UserID == dmOtherUserID {
				otherUserPresent = true
				break
			}
		}
		if !otherUserPresent {
			ts := nowMs()
			content, e := json.Marshal(map[string]string{"handle": handle})
			if e != nil {
				logger.Warn("Failed to send topic direct message notification", zap.Error(e))
			} else {
				if e := p.notificationService.NotificationSend([]*NNotification{
					&NNotification{
						Id:         generateNewId(),
						UserID:     dmOtherUserID,
						Subject:    fmt.Sprintf("%v wants to chat", handle),
						Content:    content,
						Code:       NOTIFICATION_DM_REQUEST,
						SenderID:   session.UserID(),
						CreatedAt:  ts,
						ExpiresAt:  ts + p.notificationService.expiryMs,
						Persistent: true,
					},
				}); e != nil {
					logger.Warn("Failed to send topic direct message notification", zap.Error(e))
				}
			}
		}
	}

	userPresences := make([]*UserPresence, len(presences))
	for i := 0; i < len(presences); i++ {
		userPresences[i] = &UserPresence{
			UserId:    presences[i].UserID,
			SessionId: presences[i].ID.SessionID,
			Handle:    presences[i].Meta.Handle,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Topics{Topics: &TTopics{
		Topics: []*TTopics_Topic{
			&TTopics_Topic{
				Topic:     topic,
				Presences: userPresences,
				Self: &UserPresence{
					UserId:    session.UserID(),
					SessionId: session.ID(),
					Handle:    handle,
				},
			},
		},
	}}}, true)
}

func (p *pipeline) topicLeave(logger *zap.Logger, session session, envelope *Envelope) {
	e := envelope.GetTopicsLeave()

	if len(e.Topics) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"), true)
		return
	} else if len(e.Topics) > 1 {
		logger.Warn("There are more than one item passed to the request - only processing the first item.")
	}

	t := e.Topics[0]
	var trackerTopic string
	switch t.Id.(type) {
	case *TopicId_Dm:
		// Check input is valid DM topic.
		dmID := t.GetDm()
		if dmID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Topic not valid"), true)
			return
		}

		trackerTopic = "dm:" + dmID
	case *TopicId_Room:
		// Check input is valid room name.
		room := t.GetRoom()
		if len(room) < 1 || len(room) > 64 {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name is required and must be 1-64 chars"), true)
			return
		}
		if controlCharsRegex.MatchString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must not contain control chars"), true)
			return
		}
		if !utf8.ValidString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must only contain valid UTF-8 bytes"), true)
			return
		}

		trackerTopic = "room:" + room
	case *TopicId_GroupId:
		// Check input is valid ID.
		groupID := t.GetGroupId()
		if groupID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID not valid"), true)
			return
		}

		trackerTopic = "group:" + groupID
	case nil:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No topic ID found"), true)
		return
	default:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Unrecognized topic ID"), true)
		return
	}

	// Drop the session's presence from this topic, if any.
	p.tracker.Untrack(session.ID(), trackerTopic, session.UserID())

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) topicMessageSend(logger *zap.Logger, session session, envelope *Envelope) {
	topic := envelope.GetTopicMessageSend().Topic
	if topic == nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Topic ID is required"), true)
		return
	}
	dataBytes := []byte(envelope.GetTopicMessageSend().Data)
	if len(dataBytes) == 0 || len(dataBytes) > 1000 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Data is required and must be 1-1000 JSON bytes"), true)
		return
	}
	// Make this `var js interface{}` if we want to allow top-level JSON arrays.
	var maybeJSON map[string]interface{}
	if json.Unmarshal(dataBytes, &maybeJSON) != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Data must be a valid JSON object"), true)
		return
	}

	var trackerTopic string
	switch topic.Id.(type) {
	case *TopicId_Dm:
		// Check input is valid DM topic.
		dmID := topic.GetDm()
		if dmID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Topic not valid"), true)
			return
		}

		trackerTopic = "dm:" + dmID
	case *TopicId_Room:
		// Check input is valid room name.
		room := topic.GetRoom()
		if len(room) < 1 || len(room) > 64 {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name is required and must be 1-64 chars"), true)
			return
		}
		if controlCharsRegex.MatchString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must not contain control chars"), true)
			return
		}
		if !utf8.ValidString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must only contain valid UTF-8 bytes"), true)
			return
		}

		trackerTopic = "room:" + room
	case *TopicId_GroupId:
		// Check input is valid ID.
		groupID := topic.GetGroupId()
		if groupID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID not valid"), true)
			return
		}

		trackerTopic = "group:" + groupID
	case nil:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No topic ID found"), true)
		return
	default:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Unrecognized topic ID"), true)
		return
	}

	if !p.tracker.CheckLocalByIDTopicUser(session.ID(), trackerTopic, session.UserID()) {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Must join topic before sending messages"), true)
		return
	}

	// Store message to history.
	messageID, handle, createdAt, expiresAt, err := p.storeMessage(logger, session, topic, 0, dataBytes)
	if err != nil {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not store message"), true)
		return
	}

	// Return receipt to sender.
	ack := &TTopicMessageAck{
		MessageId: messageID,
		CreatedAt: createdAt,
		ExpiresAt: expiresAt,
		Handle:    handle,
	}
	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_TopicMessageAck{TopicMessageAck: ack}}, true)

	// Deliver message to topic.
	p.deliverMessage(logger, session, topic, 0, dataBytes, messageID, handle, createdAt, expiresAt)
}

func (p *pipeline) topicMessagesList(logger *zap.Logger, session session, envelope *Envelope) {
	input := envelope.GetTopicMessagesList()
	if input.Id == nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Topic ID is required"), true)
		return
	}
	limit := input.Limit
	if limit == 0 {
		limit = 10
	}
	if limit < 10 || limit > 100 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Limit must be 10-100"), true)
		return
	}

	var topic *TopicId
	var topicString string
	var topicType int64
	switch input.Id.(type) {
	case *TTopicMessagesList_UserId:
		// Check input is valid ID.
		otherUserID := input.GetUserId()
		if otherUserID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid User ID"), true)
			return
		}

		// Don't allow chat to self.
		if session.UserID() == otherUserID {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Cannot chat to self"), true)
			return
		}

		userID := session.UserID()
		if userID < otherUserID {
			topicString = userID + otherUserID
		} else {
			topicString = otherUserID + userID
		}
		topic = &TopicId{Id: &TopicId_Dm{Dm: topicString}}
		topicType = 0
	case *TTopicMessagesList_Room:
		// Check input is valid room name.
		room := input.GetRoom()
		if len(room) < 1 || len(room) > 64 {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name is required and must be 1-64 chars"), true)
			return
		}
		if controlCharsRegex.MatchString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must not contain control chars"), true)
			return
		}
		if !utf8.ValidString(room) {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Room name must only contain valid UTF-8 bytes"), true)
			return
		}

		topic = &TopicId{Id: &TopicId_Room{Room: room}}
		topicString = room
		topicType = 1
	case *TTopicMessagesList_GroupId:
		// Check input is valid ID.
		groupID := input.GetGroupId()
		if groupID == "" {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID not valid"), true)
			return
		}

		// Check if group exists and user is a member.
		member, err := p.isGroupMember(session.UserID(), groupID)
		if err != nil {
			logger.Error("Could not check if user is group member", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Failed to look up group membership"), true)
			return
		} else if !member {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Group not found, or not a member"), true)
			return
		}

		topic = &TopicId{Id: &TopicId_GroupId{GroupId: groupID}}
		topicString = groupID
		topicType = 2
	case nil:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No topic ID found"), true)
		return
	default:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Unrecognized topic ID"), true)
		return
	}

	query := "SELECT message_id, user_id, created_at, expires_at, handle, type, data FROM message WHERE topic = $2 AND topic_type = $3"
	params := []interface{}{limit + 1, topicString, topicType}

	// Only paginate if all cursor components are available.
	if input.Cursor != "" {
		if cb, err := base64.StdEncoding.DecodeString(input.Cursor); err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"), true)
			return
		} else {
			var c messageCursor
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(&c); err != nil {
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"), true)
				return
			}
			op := "<"
			if input.Forward {
				op = ">"
			}
			query += " AND (created_at, message_id, user_id) " + op + " ($4, $5, $6)"
			params = append(params, c.CreatedAt, c.MessageID, c.UserID)
		}
	}

	if input.Forward {
		query += " ORDER BY created_at ASC"
	} else {
		query += " ORDER BY created_at DESC"
	}
	query += " LIMIT $1"

	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not get topic messages list", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not get topic messages list"), true)
		return
	}
	defer rows.Close()

	messages := make([]*TopicMessage, 0)
	var cursor string
	var messageID string
	var userID string
	var createdAt int64
	var expiresAt int64
	var handle string
	var msgType int64
	var data []byte
	for rows.Next() {
		if int64(len(messages)) >= limit {
			cursorBuf := new(bytes.Buffer)
			if gob.NewEncoder(cursorBuf).Encode(&messageCursor{MessageID: messageID, UserID: userID, CreatedAt: createdAt}); err != nil {
				logger.Error("Error creating topic messages list cursor", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not create topic messages list cursor"), true)
			}
			cursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}
		err = rows.Scan(&messageID, &userID, &createdAt, &expiresAt, &handle, &msgType, &data)
		if err != nil {
			logger.Error("Error scanning topic messages list", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error scanning topic messages list"), true)
			return
		}

		message := &TopicMessage{
			Topic:     topic,
			UserId:    userID,
			MessageId: messageID,
			CreatedAt: createdAt,
			ExpiresAt: expiresAt,
			Handle:    handle,
			Type:      msgType,
			Data:      string(data),
		}
		messages = append(messages, message)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error reading topic history", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not read topic history"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_TopicMessages{TopicMessages: &TTopicMessages{Messages: messages, Cursor: cursor}}}, true)
}

func (p *pipeline) isGroupMember(userID string, groupID string) (bool, error) {
	var state int64
	err := p.db.QueryRow("SELECT state FROM group_edge WHERE source_id = $1 AND destination_id = $2", userID, groupID).Scan(&state)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}

		return false, err
	}
	return state == 0 || state == 1, nil
}

func (p *pipeline) userExistsAndDoesNotBlock(checkUserID string, blocksUserID string) (bool, error) {
	var count int64
	err := p.db.QueryRow(`
SELECT COUNT(id) FROM users
WHERE id = $1 AND NOT EXISTS (
	SELECT state FROM user_edge
	WHERE source_id = $1 AND destination_id = $2 AND state = 3
)
`, checkUserID, blocksUserID).Scan(&count)

	return count != 0, err
}

// Assumes `topic` has already been validated, or was constructed internally.
func (p *pipeline) storeMessage(logger *zap.Logger, session session, topic *TopicId, msgType int64, data []byte) (string, string, int64, int64, error) {
	var topicValue string
	var topicType int64
	switch topic.Id.(type) {
	case *TopicId_Dm:
		topicValue = topic.GetDm()
		topicType = 0
	case *TopicId_Room:
		topicValue = topic.GetRoom()
		topicType = 1
	case *TopicId_GroupId:
		topicValue = topic.GetGroupId()
		topicType = 2
	}
	createdAt := nowMs()
	messageID := generateNewId()
	expiresAt := int64(0)
	handle := session.Handle()
	_, err := p.db.Exec(`
INSERT INTO message (topic, topic_type, message_id, user_id, created_at, expires_at, handle, type, data)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		topicValue, topicType, messageID, session.UserID(), createdAt, expiresAt, handle, msgType, data)
	if err != nil {
		logger.Error("Failed to insert new message", zap.Error(err))
		return "", "", 0, 0, err
	}

	return messageID, handle, createdAt, expiresAt, nil
}

func (p *pipeline) deliverMessage(logger *zap.Logger, session session, topic *TopicId, msgType int64, data []byte, messageID string, handle string, createdAt int64, expiresAt int64) {
	var trackerTopic string
	switch topic.Id.(type) {
	case *TopicId_Dm:
		trackerTopic = "dm:" + topic.GetDm()
	case *TopicId_Room:
		trackerTopic = "room:" + topic.GetRoom()
	case *TopicId_GroupId:
		trackerTopic = "group:" + topic.GetGroupId()
	}

	outgoing := &Envelope{
		Payload: &Envelope_TopicMessage{
			TopicMessage: &TopicMessage{
				Topic:     topic,
				UserId:    session.UserID(),
				MessageId: messageID,
				CreatedAt: createdAt,
				ExpiresAt: expiresAt,
				Handle:    handle,
				Type:      msgType,
				Data:      string(data),
			},
		},
	}

	presences := p.tracker.ListByTopic(trackerTopic)
	p.messageRouter.Send(logger, presences, outgoing, true)
}

func (p *pipeline) storeAndDeliverMessage(logger *zap.Logger, session session, topic *TopicId, msgType int64, data []byte) error {
	messageID, handle, createdAt, expiresAt, err := p.storeMessage(logger, session, topic, msgType, data)
	if err != nil {
		return err
	}
	p.deliverMessage(logger, session, topic, msgType, data, messageID, handle, createdAt, expiresAt)
	return nil
}
