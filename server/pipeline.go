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
	"database/sql"
	"fmt"

	"nakama/pkg/social"

	"github.com/gogo/protobuf/jsonpb"
	"go.uber.org/zap"
)

type pipeline struct {
	config              Config
	db                  *sql.DB
	tracker             Tracker
	matchmaker          Matchmaker
	hmacSecretByte      []byte
	messageRouter       MessageRouter
	sessionRegistry     *SessionRegistry
	socialClient        *social.Client
	runtimePool         *RuntimePool
	purchaseService     *PurchaseService
	notificationService *NotificationService
	jsonpbMarshaler     *jsonpb.Marshaler
	jsonpbUnmarshaler   *jsonpb.Unmarshaler
}

// NewPipeline creates a new Pipeline
func NewPipeline(config Config,
	db *sql.DB,
	tracker Tracker,
	matchmaker Matchmaker,
	messageRouter MessageRouter,
	registry *SessionRegistry,
	socialClient *social.Client,
	runtimePool *RuntimePool,
	purchaseService *PurchaseService,
	notificationService *NotificationService) *pipeline {
	return &pipeline{
		config:              config,
		db:                  db,
		tracker:             tracker,
		matchmaker:          matchmaker,
		hmacSecretByte:      []byte(config.GetSession().EncryptionKey),
		messageRouter:       messageRouter,
		sessionRegistry:     registry,
		socialClient:        socialClient,
		runtimePool:         runtimePool,
		purchaseService:     purchaseService,
		notificationService: notificationService,
		jsonpbMarshaler: &jsonpb.Marshaler{
			EnumsAsInts:  true,
			EmitDefaults: false,
			Indent:       "",
			OrigName:     false,
		},
		jsonpbUnmarshaler: &jsonpb.Unmarshaler{
			AllowUnknownFields: false,
		},
	}
}

func (p *pipeline) processRequest(logger *zap.Logger, session session, originalEnvelope *Envelope, reliable bool) {
	// NOTE: pipeline ignores reliability flag on most messages, especially collated ones.

	if originalEnvelope.Payload == nil {
		session.Send(ErrorMessage(originalEnvelope.CollationId, MISSING_PAYLOAD, "No payload found"), reliable)
		return
	}

	messageType := fmt.Sprintf("%T", originalEnvelope.Payload)
	logger.Debug("Received message", zap.String("type", messageType))

	messageType = RUNTIME_MESSAGES[messageType]
	envelope, fnErr := RuntimeBeforeHook(p.runtimePool, p.jsonpbMarshaler, p.jsonpbUnmarshaler, messageType, originalEnvelope, session)
	if fnErr != nil {
		logger.Error("Runtime before function caused an error", zap.String("message", messageType), zap.Error(fnErr))
		session.Send(ErrorMessage(originalEnvelope.CollationId, RUNTIME_FUNCTION_EXCEPTION, fmt.Sprintf("Runtime before function caused an error: %s", fnErr.Error())), reliable)
		return
	}

	switch envelope.Payload.(type) {
	case *Envelope_Logout:
		// TODO Store JWT into a blacklist until remaining JWT expiry.
		p.sessionRegistry.remove(session)
		session.Close()

	case *Envelope_Link:
		p.linkID(logger, session, envelope)
	case *Envelope_Unlink:
		p.unlinkID(logger, session, envelope)

	case *Envelope_SelfFetch:
		p.selfFetch(logger, session, envelope)
	case *Envelope_SelfUpdate:
		p.selfUpdate(logger, session, envelope)
	case *Envelope_UsersFetch:
		p.usersFetch(logger, session, envelope)

	case *Envelope_FriendsAdd:
		p.friendAdd(logger, session, envelope)
	case *Envelope_FriendsRemove:
		p.friendRemove(logger, session, envelope)
	case *Envelope_FriendsBlock:
		p.friendBlock(logger, session, envelope)
	case *Envelope_FriendsList:
		p.friendsList(logger, session, envelope)

	case *Envelope_GroupsCreate:
		p.groupCreate(logger, session, envelope)
	case *Envelope_GroupsUpdate:
		p.groupUpdate(logger, session, envelope)
	case *Envelope_GroupsRemove:
		p.groupRemove(logger, session, envelope)
	case *Envelope_GroupsFetch:
		p.groupsFetch(logger, session, envelope)
	case *Envelope_GroupsList:
		p.groupsList(logger, session, envelope)
	case *Envelope_GroupsSelfList:
		p.groupsSelfList(logger, session, envelope)
	case *Envelope_GroupUsersList:
		p.groupUsersList(logger, session, envelope)
	case *Envelope_GroupsJoin:
		p.groupJoin(logger, session, envelope)
	case *Envelope_GroupsLeave:
		p.groupLeave(logger, session, envelope)
	case *Envelope_GroupUsersAdd:
		p.groupUserAdd(logger, session, envelope)
	case *Envelope_GroupUsersKick:
		p.groupUserKick(logger, session, envelope)
	case *Envelope_GroupUsersPromote:
		p.groupUserPromote(logger, session, envelope)

	case *Envelope_TopicsJoin:
		p.topicJoin(logger, session, envelope)
	case *Envelope_TopicsLeave:
		p.topicLeave(logger, session, envelope)
	case *Envelope_TopicMessageSend:
		p.topicMessageSend(logger, session, envelope)
	case *Envelope_TopicMessagesList:
		p.topicMessagesList(logger, session, envelope)

	case *Envelope_MatchCreate:
		p.matchCreate(logger, session, envelope)
	case *Envelope_MatchesJoin:
		p.matchJoin(logger, session, envelope)
	case *Envelope_MatchesLeave:
		p.matchLeave(logger, session, envelope)
	case *Envelope_MatchDataSend:
		p.matchDataSend(logger, session, envelope, reliable)

	case *Envelope_MatchmakeAdd:
		p.matchmakeAdd(logger, session, envelope)
	case *Envelope_MatchmakeRemove:
		p.matchmakeRemove(logger, session, envelope)

	case *Envelope_StorageList:
		p.storageList(logger, session, envelope)
	case *Envelope_StorageFetch:
		p.storageFetch(logger, session, envelope)
	case *Envelope_StorageWrite:
		p.storageWrite(logger, session, envelope)
	case *Envelope_StorageUpdate:
		p.storageUpdate(logger, session, envelope)
	case *Envelope_StorageRemove:
		p.storageRemove(logger, session, envelope)

	case *Envelope_LeaderboardsList:
		p.leaderboardsList(logger, session, envelope)
	case *Envelope_LeaderboardRecordsWrite:
		p.leaderboardRecordWrite(logger, session, envelope)
	case *Envelope_LeaderboardRecordsFetch:
		p.leaderboardRecordsFetch(logger, session, envelope)
	case *Envelope_LeaderboardRecordsList:
		p.leaderboardRecordsList(logger, session, envelope)

	case *Envelope_Rpc:
		p.rpc(logger, session, envelope)

	case *Envelope_Purchase:
		p.purchaseValidate(logger, session, envelope)

	case *Envelope_NotificationsList:
		p.notificationsList(logger, session, envelope)
	case *Envelope_NotificationsRemove:
		p.notificationsRemove(logger, session, envelope)

	default:
		session.Send(ErrorMessage(envelope.CollationId, UNRECOGNIZED_PAYLOAD, "Unrecognized payload"), reliable)
		return
	}

	RuntimeAfterHook(logger, p.runtimePool, p.jsonpbMarshaler, messageType, envelope, session)
}

func ErrorMessageRuntimeException(collationID string, message string) *Envelope {
	return ErrorMessage(collationID, RUNTIME_EXCEPTION, message)
}

func ErrorMessageBadInput(collationID string, message string) *Envelope {
	return ErrorMessage(collationID, BAD_INPUT, message)
}

func ErrorMessage(collationID string, code Error_Code, message string) *Envelope {
	return &Envelope{
		CollationId: collationID,
		Payload: &Envelope_Error{&Error{
			Message: message,
			Code:    int32(code),
		}}}
}
