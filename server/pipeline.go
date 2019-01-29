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
	"go.uber.org/zap"
	"strings"
)

type Pipeline struct {
	logger            *zap.Logger
	config            Config
	db                *sql.DB
	jsonpbMarshaler   *jsonpb.Marshaler
	jsonpbUnmarshaler *jsonpb.Unmarshaler
	sessionRegistry   SessionRegistry
	matchRegistry     MatchRegistry
	matchmaker        Matchmaker
	tracker           Tracker
	router            MessageRouter
	runtime           *Runtime
	node              string
}

func NewPipeline(logger *zap.Logger, config Config, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, sessionRegistry SessionRegistry, matchRegistry MatchRegistry, matchmaker Matchmaker, tracker Tracker, router MessageRouter, runtime *Runtime) *Pipeline {
	return &Pipeline{
		logger:            logger,
		config:            config,
		db:                db,
		jsonpbMarshaler:   jsonpbMarshaler,
		jsonpbUnmarshaler: jsonpbUnmarshaler,
		sessionRegistry:   sessionRegistry,
		matchRegistry:     matchRegistry,
		matchmaker:        matchmaker,
		tracker:           tracker,
		router:            router,
		runtime:           runtime,
		node:              config.GetName(),
	}
}

func (p *Pipeline) ProcessRequest(logger *zap.Logger, session Session, envelope *rtapi.Envelope) bool {
	if logger.Core().Enabled(zap.DebugLevel) { // remove extra heavy reflection processing
		logger.Debug(fmt.Sprintf("Received %T message", envelope.Message), zap.Any("message", envelope.Message))
	}

	if envelope.Message == nil {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_MISSING_PAYLOAD),
			Message: "Missing message.",
		}}})
		return false
	}

	var pipelineFn func(*zap.Logger, Session, *rtapi.Envelope)

	switch envelope.Message.(type) {
	case *rtapi.Envelope_ChannelJoin:
		pipelineFn = p.channelJoin
	case *rtapi.Envelope_ChannelLeave:
		pipelineFn = p.channelLeave
	case *rtapi.Envelope_ChannelMessageSend:
		pipelineFn = p.channelMessageSend
	case *rtapi.Envelope_ChannelMessageUpdate:
		pipelineFn = p.channelMessageUpdate
	case *rtapi.Envelope_ChannelMessageRemove:
		pipelineFn = p.channelMessageRemove
	case *rtapi.Envelope_MatchCreate:
		pipelineFn = p.matchCreate
	case *rtapi.Envelope_MatchDataSend:
		pipelineFn = p.matchDataSend
	case *rtapi.Envelope_MatchJoin:
		pipelineFn = p.matchJoin
	case *rtapi.Envelope_MatchLeave:
		pipelineFn = p.matchLeave
	case *rtapi.Envelope_MatchmakerAdd:
		pipelineFn = p.matchmakerAdd
	case *rtapi.Envelope_MatchmakerRemove:
		pipelineFn = p.matchmakerRemove
	case *rtapi.Envelope_Rpc:
		pipelineFn = p.rpc
	case *rtapi.Envelope_StatusFollow:
		pipelineFn = p.statusFollow
	case *rtapi.Envelope_StatusUnfollow:
		pipelineFn = p.statusUnfollow
	case *rtapi.Envelope_StatusUpdate:
		pipelineFn = p.statusUpdate
	default:
		// If we reached this point the envelope was valid but the contents are missing or unknown.
		// Usually caused by a version mismatch, and should cause the session making this pipeline request to close.
		logger.Error("Unrecognizable payload received.", zap.Any("payload", envelope))
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
			Message: "Unrecognized message.",
		}}})
		return false
	}

	var messageName, messageNameID string

	switch envelope.Message.(type) {
	case *rtapi.Envelope_Rpc:
		// No before/after hooks on RPC.
	default:
		messageName = fmt.Sprintf("%T", envelope.Message)
		messageNameID = strings.ToLower(messageName)

		if fn := p.runtime.BeforeRt(messageNameID); fn != nil {
			hookResult, hookErr := fn(session.Context(), logger, session.UserID().String(), session.Username(), session.Expiry(), session.ID().String(), session.ClientIP(), session.ClientPort(), envelope)

			if hookErr != nil {
				session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
					Message: hookErr.Error(),
				}}})
				return false
			} else if hookResult == nil {
				// if result is nil, requested resource is disabled.
				logger.Warn("Intercepted a disabled resource.", zap.String("resource", messageName))
				session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
					Code:    int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
					Message: "Requested resource was not found.",
				}}})
				return false
			}

			envelope = hookResult
		}
	}

	pipelineFn(logger, session, envelope)

	if messageName != "" {
		if fn := p.runtime.AfterRt(messageNameID); fn != nil {
			fn(session.Context(), logger, session.UserID().String(), session.Username(), session.Expiry(), session.ID().String(), session.ClientIP(), session.ClientPort(), envelope)
		}
	}

	return true
}
