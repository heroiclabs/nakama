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
	"encoding/gob"
	"encoding/json"

	"regexp"
	"unicode/utf8"

	"github.com/satori/go.uuid"
	"github.com/uber-go/zap"
)

type messageCursor struct {
	MessageID []byte
	UserID    []byte
	CreatedAt int64
}

var invalidRoomRegex = regexp.MustCompilePOSIX("[[:cntrl:]]+")

func (p *pipeline) topicJoin(logger zap.Logger, session *session, envelope *Envelope) {
	id := envelope.GetTopicJoin()
	var topic *TopicId
	var trackerTopic string
	switch id.Id.(type) {
	case *TTopicJoin_UserId:
		// Check input is valid ID.
		otherUserIDBytes := id.GetUserId()
		otherUserID, err := uuid.FromBytes(otherUserIDBytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "User ID not valid"}}})
			return
		}

		// Don't allow chat to self.
		if session.userID == otherUserID {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cannot chat to self"}}})
			return
		}

		// Check the user exists and does not block the requester.
		existsAndDoesNotBlock, err := p.userExistsAndDoesNotBlock(otherUserIDBytes, session.userID.Bytes())
		if err != nil {
			logger.Error("Could not check if user exists", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Failed to look up user ID"}}})
			return
		} else if !existsAndDoesNotBlock {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "User ID not found"}}})
			return
		}

		userIDString := session.userID.String()
		otherUserIDString := otherUserID.String()
		if userIDString < otherUserIDString {
			topic = &TopicId{Id: &TopicId_Dm{Dm: append(session.userID.Bytes(), otherUserIDBytes...)}}
			trackerTopic = "dm:" + userIDString + ":" + otherUserIDString
		} else {
			topic = &TopicId{Id: &TopicId_Dm{Dm: append(otherUserIDBytes, session.userID.Bytes()...)}}
			trackerTopic = "dm:" + otherUserIDString + ":" + userIDString
		}
	case *TTopicJoin_Room:
		// Check input is valid room name.
		room := id.GetRoom()
		if room == nil || len(room) < 1 || len(room) > 64 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name is required and must be 1-64 chars"}}})
			return
		}
		if invalidRoomRegex.Match(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}
		if !utf8.Valid(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}

		topic = &TopicId{Id: &TopicId_Room{Room: room}}
		trackerTopic = "room:" + string(room)
	case *TTopicJoin_GroupId:
		// Check input is valid ID.
		groupIDBytes := id.GetGroupId()
		groupID, err := uuid.FromBytes(groupIDBytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Group ID not valid"}}})
			return
		}

		// Check if group exists and user is a member.
		member, err := p.isGroupMember(session.userID, groupIDBytes)
		if err != nil {
			logger.Error("Could not check if user is group member", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Failed to look up group membership"}}})
			return
		} else if !member {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Group not found, or not a member"}}})
			return
		}

		trackerTopic = "group:" + groupID.String()
		topic = &TopicId{Id: &TopicId_GroupId{GroupId: groupIDBytes}}
	case nil:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "No topic ID found"}}})
		return
	default:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Unrecognized topic ID"}}})
		return
	}

	handle := session.handle.Load()

	// Track the presence, and gather current member list.
	p.tracker.Track(session.id, trackerTopic, session.userID, PresenceMeta{
		Handle: handle,
	})
	presences := p.tracker.ListByTopic(trackerTopic)

	userPresences := make([]*UserPresence, len(presences))
	for i := 0; i < len(presences); i++ {
		userPresences[i] = &UserPresence{
			UserId:    presences[i].UserID.Bytes(),
			SessionId: presences[i].ID.SessionID.Bytes(),
			Handle:    presences[i].Meta.Handle,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Topic{Topic: &TTopic{
		Topic:     topic,
		Presences: userPresences,
		Self: &UserPresence{
			UserId:    session.userID.Bytes(),
			SessionId: session.id.Bytes(),
			Handle:    handle,
		},
	}}})
}

func (p *pipeline) topicLeave(logger zap.Logger, session *session, envelope *Envelope) {
	topic := envelope.GetTopicLeave().Topic
	var trackerTopic string
	switch topic.Id.(type) {
	case *TopicId_Dm:
		// Check input is valid DM topic.
		bothUserIDBytes := topic.GetDm()
		if bothUserIDBytes == nil || len(bothUserIDBytes) != 32 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check the DM topic components are valid UUIDs.
		userID1Bytes := bothUserIDBytes[:16]
		userID2Bytes := bothUserIDBytes[16:]
		userID1, err := uuid.FromBytes(userID1Bytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}
		userID2, err := uuid.FromBytes(userID2Bytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check the IDs are ordered correctly.
		userID1String := userID1.String()
		userID2String := userID2.String()
		if userID1String > userID2String {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check one of the users in this DM topic is the current one.
		if userID1 != session.userID && userID2 != session.userID {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check the DM topic is between two different users.
		if userID1 == userID2 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cannot chat to self"}}})
			return
		}

		trackerTopic = "dm:" + userID1String + ":" + userID2String
	case *TopicId_Room:
		// Check input is valid room name.
		room := topic.GetRoom()
		if room == nil || len(room) < 1 || len(room) > 64 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name is required and must be 1-64 chars"}}})
			return
		}
		if invalidRoomRegex.Match(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}
		if !utf8.Valid(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}

		trackerTopic = "room:" + string(room)
	case *TopicId_GroupId:
		// Check input is valid ID.
		groupIDBytes := topic.GetGroupId()
		groupID, err := uuid.FromBytes(groupIDBytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Group ID not valid"}}})
			return
		}

		trackerTopic = "group:" + groupID.String()
	case nil:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "No topic ID found"}}})
		return
	default:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Unrecognized topic ID"}}})
		return
	}

	// Drop the session's presence from this topic, if any.
	p.tracker.Untrack(session.id, trackerTopic, session.userID)

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) topicMessageSend(logger zap.Logger, session *session, envelope *Envelope) {
	topic := envelope.GetTopicMessageSend().Topic
	if topic == nil {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic ID is required"}}})
		return
	}
	data := envelope.GetTopicMessageSend().Data
	if data == nil || len(data) == 0 || len(data) > 1000 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Data is required and must be 1-1000 JSON bytes"}}})
		return
	}
	// Make this `var js interface{}` if we want to allow top-level JSON arrays.
	var maybeJSON map[string]interface{}
	if json.Unmarshal(data, &maybeJSON) != nil {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Data must be a valid JSON object"}}})
		return
	}

	var trackerTopic string
	switch topic.Id.(type) {
	case *TopicId_Dm:
		// Check input is valid DM topic.
		bothUserIDBytes := topic.GetDm()
		if bothUserIDBytes == nil || len(bothUserIDBytes) != 32 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check the DM topic components are valid UUIDs.
		userID1Bytes := bothUserIDBytes[:16]
		userID2Bytes := bothUserIDBytes[16:]
		userID1, err := uuid.FromBytes(userID1Bytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}
		userID2, err := uuid.FromBytes(userID2Bytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check the IDs are ordered correctly.
		userID1String := userID1.String()
		userID2String := userID2.String()
		if userID1String > userID2String {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check one of the users in this DM topic is the current one.
		if userID1 != session.userID && userID2 != session.userID {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic not valid"}}})
			return
		}

		// Check the DM topic is between two different users.
		if userID1 == userID2 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cannot chat to self"}}})
			return
		}

		trackerTopic = "dm:" + userID1String + ":" + userID2String
	case *TopicId_Room:
		// Check input is valid room name.
		room := topic.GetRoom()
		if room == nil || len(room) < 1 || len(room) > 64 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name is required and must be 1-64 chars"}}})
			return
		}
		if invalidRoomRegex.Match(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}
		if !utf8.Valid(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}

		trackerTopic = "room:" + string(room)
	case *TopicId_GroupId:
		// Check input is valid ID.
		groupIDBytes := topic.GetGroupId()
		groupID, err := uuid.FromBytes(groupIDBytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Group ID not valid"}}})
			return
		}

		trackerTopic = "group:" + groupID.String()
	case nil:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "No topic ID found"}}})
		return
	default:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Unrecognized topic ID"}}})
		return
	}

	if !p.tracker.CheckLocalByIDTopicUser(session.id, trackerTopic, session.userID) {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Must join topic before sending messages"}}})
		return
	}

	// Store message to history.
	messageID, handle, createdAt, expiresAt, err := p.storeMessage(logger, session, topic, 0, data)
	if err != nil {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error storing message"}}})
		return
	}

	// Return receipt to sender.
	ack := &TTopicMessageAck{
		MessageId: messageID,
		CreatedAt: createdAt,
		ExpiresAt: expiresAt,
		Handle:    handle,
	}
	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_TopicMessageAck{TopicMessageAck: ack}})

	// Deliver message to topic.
	p.deliverMessage(logger, session, topic, 0, data, messageID, handle, createdAt, expiresAt)
}

func (p *pipeline) topicMessagesList(logger zap.Logger, session *session, envelope *Envelope) {
	input := envelope.GetTopicMessagesList()
	if input.Id == nil {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Topic ID is required"}}})
		return
	}
	limit := input.Limit
	if limit == 0 {
		limit = 10
	}
	if limit < 10 || limit > 100 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Limit must be 10-100"}}})
		return
	}

	var topic *TopicId
	var topicBytes []byte
	var topicType int64
	switch input.Id.(type) {
	case *TTopicMessagesList_UserId:
		// Check input is valid ID.
		otherUserIDBytes := input.GetUserId()
		otherUserID, err := uuid.FromBytes(otherUserIDBytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "User ID not valid"}}})
			return
		}

		// Don't allow chat to self.
		if session.userID == otherUserID {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cannot chat to self"}}})
			return
		}

		userIDString := session.userID.String()
		otherUserIDString := otherUserID.String()
		if userIDString < otherUserIDString {
			topicBytes = append(session.userID.Bytes(), otherUserIDBytes...)
		} else {
			topicBytes = append(otherUserIDBytes, session.userID.Bytes()...)
		}
		topic = &TopicId{Id: &TopicId_Dm{Dm: topicBytes}}
		topicType = 0
	case *TTopicMessagesList_Room:
		// Check input is valid room name.
		room := input.GetRoom()
		if room == nil || len(room) < 1 || len(room) > 64 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name is required and must be 1-64 chars"}}})
			return
		}
		if invalidRoomRegex.Match(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}
		if !utf8.Valid(room) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Room name must not contain control chars"}}})
			return
		}

		topic = &TopicId{Id: &TopicId_Room{Room: room}}
		topicBytes = room
		topicType = 1
	case *TTopicMessagesList_GroupId:
		// Check input is valid ID.
		groupIDBytes := input.GetGroupId()
		_, err := uuid.FromBytes(groupIDBytes)
		if err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Group ID not valid"}}})
			return
		}

		// Check if group exists and user is a member.
		member, err := p.isGroupMember(session.userID, groupIDBytes)
		if err != nil {
			logger.Error("Could not check if user is group member", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Failed to look up group membership"}}})
			return
		} else if !member {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Group not found, or not a member"}}})
			return
		}

		topic = &TopicId{Id: &TopicId_GroupId{GroupId: groupIDBytes}}
		topicBytes = groupIDBytes
		topicType = 2
	case nil:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "No topic ID found"}}})
		return
	default:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Unrecognized topic ID"}}})
		return
	}

	query := "SELECT message_id, user_id, created_at, expires_at, handle, type, data FROM message WHERE topic = $2 AND topic_type = $3"
	params := []interface{}{limit + 1, topicBytes, topicType}

	// Only paginate if all cursor components are available.
	if input.Cursor != nil {
		var c messageCursor
		if err := gob.NewDecoder(bytes.NewReader(input.Cursor)).Decode(&c); err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Invalid cursor data"}}})
			return
		}
		op := "<"
		if input.Forward {
			op = ">"
		}
		query += " AND (created_at, message_id, user_id) " + op + " ($4, $5, $6)"
		params = append(params, c.CreatedAt, c.MessageID, c.UserID)
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
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Could not get topic messages list"}}})
		return
	}
	defer rows.Close()

	messages := make([]*TopicMessage, 0)
	var cursor []byte
	var messageID []byte
	var userID []byte
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
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Database request failed"}}})
			}
			cursor = cursorBuf.Bytes()
			break
		}
		err = rows.Scan(&messageID, &userID, &createdAt, &expiresAt, &handle, &msgType, &data)
		if err != nil {
			logger.Error("Error scanning topic messages list", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error scanning topic messages list"}}})
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
			Data:      data,
		}
		messages = append(messages, message)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error reading topic history", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error reading topic history"}}})
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_TopicMessages{TopicMessages: &TTopicMessages{Messages: messages, Cursor: cursor}}})
}

func (p *pipeline) isGroupMember(userID uuid.UUID, groupID []byte) (bool, error) {
	var state int64
	err := p.db.QueryRow("SELECT state FROM group_edge WHERE source_id = $1 AND destination_id = $2", userID.Bytes(), groupID).Scan(&state)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}

		return false, err
	}
	return (state == 0 || state == 1), nil
}

func (p *pipeline) userExistsAndDoesNotBlock(checkUserID []byte, blocksUserID []byte) (bool, error) {
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
func (p *pipeline) storeMessage(logger zap.Logger, session *session, topic *TopicId, msgType int64, data []byte) ([]byte, string, int64, int64, error) {
	var topicBytes []byte
	var topicType int64
	switch topic.Id.(type) {
	case *TopicId_Dm:
		topicBytes = topic.GetDm()
		topicType = 0
	case *TopicId_Room:
		topicBytes = topic.GetRoom()
		topicType = 1
	case *TopicId_GroupId:
		topicBytes = topic.GetGroupId()
		topicType = 2
	}
	createdAt := nowMs()
	messageID := uuid.NewV4().Bytes()
	expiresAt := int64(0)
	handle := session.handle.Load()
	_, err := p.db.Exec(`
INSERT INTO message (topic, topic_type, message_id, user_id, created_at, expires_at, handle, type, data)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		topicBytes, topicType, messageID, session.userID.Bytes(), createdAt, expiresAt, handle, msgType, data)
	if err != nil {
		logger.Error("Failed to insert new message", zap.Error(err))
		return nil, "", 0, 0, err
	}

	return messageID, handle, createdAt, expiresAt, nil
}

func (p *pipeline) deliverMessage(logger zap.Logger, session *session, topic *TopicId, msgType int64, data []byte, messageID []byte, handle string, createdAt int64, expiresAt int64) {
	var trackerTopic string
	switch topic.Id.(type) {
	case *TopicId_Dm:
		bothUserIDBytes := topic.GetDm()
		userID1 := uuid.FromBytesOrNil(bothUserIDBytes[:16])
		userID2 := uuid.FromBytesOrNil(bothUserIDBytes[16:])

		trackerTopic = "dm:" + userID1.String() + ":" + userID2.String()
	case *TopicId_Room:
		trackerTopic = "room:" + string(topic.GetRoom())
	case *TopicId_GroupId:
		trackerTopic = "group:" + uuid.FromBytesOrNil(topic.GetGroupId()).String()
	}

	outgoing := &Envelope{
		Payload: &Envelope_TopicMessage{
			TopicMessage: &TopicMessage{
				Topic:     topic,
				UserId:    session.userID.Bytes(),
				MessageId: messageID,
				CreatedAt: createdAt,
				ExpiresAt: expiresAt,
				Handle:    handle,
				Type:      msgType,
				Data:      data,
			},
		},
	}

	presences := p.tracker.ListByTopic(trackerTopic)
	p.messageRouter.Send(logger, presences, outgoing)
}

func (p *pipeline) storeAndDeliverMessage(logger zap.Logger, session *session, topic *TopicId, msgType int64, data []byte) error {
	messageID, handle, createdAt, expiresAt, err := p.storeMessage(logger, session, topic, msgType, data)
	if err != nil {
		return err
	}
	p.deliverMessage(logger, session, topic, msgType, data, messageID, handle, createdAt, expiresAt)
	return nil
}
