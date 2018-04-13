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
	"database/sql"
	"fmt"

	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type Pipeline struct {
	config            Config
	db                *sql.DB
	jsonpbMarshaler   *jsonpb.Marshaler
	jsonpbUnmarshaler *jsonpb.Unmarshaler
	sessionRegistry   *SessionRegistry
	matchRegistry     MatchRegistry
	tracker           Tracker
	router            MessageRouter
	runtimePool       *RuntimePool
	node              string
}

func NewPipeline(config Config, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, runtimePool *RuntimePool) *Pipeline {
	return &Pipeline{
		config:            config,
		db:                db,
		jsonpbMarshaler:   jsonpbMarshaler,
		jsonpbUnmarshaler: jsonpbUnmarshaler,
		sessionRegistry:   sessionRegistry,
		matchRegistry:     matchRegistry,
		tracker:           tracker,
		router:            router,
		runtimePool:       runtimePool,
		node:              config.GetName(),
	}
}

func (p *Pipeline) ProcessRequest(logger *zap.Logger, session Session, envelope *rtapi.Envelope) bool {
	if logger.Core().Enabled(zap.DebugLevel) {
		logger.Debug(fmt.Sprintf("Received %T message", envelope.Message), zap.Any("message", envelope.Message))
	}

	if envelope.Message == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_MISSING_PAYLOAD),
			Message: "Missing message.",
		}}})
		return false
	}

	activateHooks := true
	messageName := ""
	uid := uuid.Nil
	username := ""
	expiry := int64(0)
	sessionID := ""

	switch envelope.Message.(type) {
	case *rtapi.Envelope_Rpc:
		activateHooks = false
	default:
		messageName = fmt.Sprintf("%T", envelope.Message)
		uid = session.UserID()
		username = session.Username()
		expiry = session.Expiry()
		sessionID = session.ID().String()
	}

	if activateHooks {

		hookResult, hookErr := invokeReqBeforeHook(logger, p.config, p.runtimePool, p.jsonpbMarshaler, p.jsonpbUnmarshaler, sessionID, uid, username, expiry, messageName, envelope)

		if hookErr != nil {
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
				Message: hookErr.Error(),
			}}})
			return false
		} else if hookResult == nil {
			// if result is nil, requested resource is disabled.
			logger.Warn("Intercepted a disabled resource.", zap.String("resource", messageName))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
				Message: "Requested resource was not found.",
			}}})
			return false
		}

		resultCast, ok := hookResult.(*rtapi.Envelope)
		if !ok {
			logger.Error("Invalid runtime Before function result. Make sure that the result matches the structure of the payload.", zap.Any("payload", envelope), zap.Any("result", hookResult))
			session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
				Message: "Invalid runtime Before function result.",
			}}})
			return false
		}
		envelope = resultCast
	}

	switch envelope.Message.(type) {
	case *rtapi.Envelope_ChannelJoin:
		p.channelJoin(logger, session, envelope)
	case *rtapi.Envelope_ChannelLeave:
		p.channelLeave(logger, session, envelope)
	case *rtapi.Envelope_ChannelMessageSend:
		p.channelMessageSend(logger, session, envelope)
	case *rtapi.Envelope_ChannelMessageUpdate:
		p.channelMessageUpdate(logger, session, envelope)
	case *rtapi.Envelope_MatchCreate:
		p.matchCreate(logger, session, envelope)
	case *rtapi.Envelope_MatchDataSend:
		p.matchDataSend(logger, session, envelope)
	case *rtapi.Envelope_MatchJoin:
		p.matchJoin(logger, session, envelope)
	case *rtapi.Envelope_MatchLeave:
		p.matchLeave(logger, session, envelope)
	case *rtapi.Envelope_Rpc:
		p.rpc(logger, session, envelope)
	default:
		// If we reached this point the envelope was valid but the contents are missing or unknown.
		// Usually caused by a version mismatch, and should cause the session making this pipeline request to close.
		logger.Error("Unrecognizable payload received.", zap.Any("payload", envelope))
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
			Message: "Unrecognized message.",
		}}})
		return false
	}

	if activateHooks {
		invokeReqAfterHook(logger, p.config, p.runtimePool, p.jsonpbMarshaler, sessionID, uid, username, expiry, messageName, envelope)
	}

	return true
}
