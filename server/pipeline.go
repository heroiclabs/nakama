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
	"go.opencensus.io/trace"
	"go.uber.org/zap"
)

type Pipeline struct {
	config            Config
	db                *sql.DB
	jsonpbMarshaler   *jsonpb.Marshaler
	jsonpbUnmarshaler *jsonpb.Unmarshaler
	sessionRegistry   *SessionRegistry
	matchRegistry     MatchRegistry
	matchmaker        Matchmaker
	tracker           Tracker
	router            MessageRouter
	runtimePool       *RuntimePool
	node              string
}

func NewPipeline(config Config, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, matchmaker Matchmaker, tracker Tracker, router MessageRouter, runtimePool *RuntimePool) *Pipeline {
	return &Pipeline{
		config:            config,
		db:                db,
		jsonpbMarshaler:   jsonpbMarshaler,
		jsonpbUnmarshaler: jsonpbUnmarshaler,
		sessionRegistry:   sessionRegistry,
		matchRegistry:     matchRegistry,
		matchmaker:        matchmaker,
		tracker:           tracker,
		router:            router,
		runtimePool:       runtimePool,
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

	var messageName string

	switch envelope.Message.(type) {
	case *rtapi.Envelope_Rpc:
		// No before/after hooks on RPC.
	default:
		messageName = fmt.Sprintf("%T", envelope.Message)

		hookResult, hookErr := invokeReqBeforeHook(logger, p.config, p.runtimePool, p.jsonpbMarshaler, p.jsonpbUnmarshaler, session.ID().String(), session.UserID(), session.Username(), session.Expiry(), messageName, envelope)

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

		resultCast, ok := hookResult.(*rtapi.Envelope)
		if !ok {
			logger.Error("Invalid runtime Before function result. Make sure that the result matches the structure of the payload.", zap.Any("payload", envelope), zap.Any("result", hookResult))
			session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
				Message: "Invalid runtime Before function result.",
			}}})
			return false
		}
		envelope = resultCast
	}

	var pipelineFn func(*zap.Logger, Session, *rtapi.Envelope)
	var pipelineName string

	switch envelope.Message.(type) {
	case *rtapi.Envelope_ChannelJoin:
		pipelineFn = p.channelJoin
		pipelineName = "nakama.pipeline.channelJoin"
	case *rtapi.Envelope_ChannelLeave:
		pipelineFn = p.channelLeave
		pipelineName = "nakama.pipeline.channelLeave"
	case *rtapi.Envelope_ChannelMessageSend:
		pipelineFn = p.channelMessageSend
		pipelineName = "nakama.pipeline.channelMessageSend"
	case *rtapi.Envelope_ChannelMessageUpdate:
		pipelineFn = p.channelMessageUpdate
		pipelineName = "nakama.pipeline.channelMessageUpdate"
	case *rtapi.Envelope_ChannelMessageRemove:
		pipelineFn = p.channelMessageRemove
		pipelineName = "nakama.pipeline.channelMessageRemove"
	case *rtapi.Envelope_MatchCreate:
		pipelineFn = p.matchCreate
		pipelineName = "nakama.pipeline.matchCreate"
	case *rtapi.Envelope_MatchDataSend:
		pipelineFn = p.matchDataSend
		pipelineName = "nakama.pipeline.matchDataSend"
	case *rtapi.Envelope_MatchJoin:
		pipelineFn = p.matchJoin
		pipelineName = "nakama.pipeline.matchJoin"
	case *rtapi.Envelope_MatchLeave:
		pipelineFn = p.matchLeave
		pipelineName = "nakama.pipeline.matchLeave"
	case *rtapi.Envelope_MatchmakerAdd:
		pipelineFn = p.matchmakerAdd
		pipelineName = "nakama.pipeline.matchmakerAdd"
	case *rtapi.Envelope_MatchmakerRemove:
		pipelineFn = p.matchmakerRemove
		pipelineName = "nakama.pipeline.matchmakerRemove"
	case *rtapi.Envelope_Rpc:
		pipelineFn = p.rpc
		pipelineName = fmt.Sprintf("nakama.pipeline.rpc.%v", envelope.GetRpc().Id)
	case *rtapi.Envelope_StatusFollow:
		pipelineFn = p.statusFollow
		pipelineName = "nakama.pipeline.statusFollow"
	case *rtapi.Envelope_StatusUnfollow:
		pipelineFn = p.statusUnfollow
		pipelineName = "nakama.pipeline.statusUnfollow"
	case *rtapi.Envelope_StatusUpdate:
		pipelineFn = p.statusUpdate
		pipelineName = "nakama.pipeline.statusUpdate"
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

	span := trace.NewSpan(pipelineName, nil, trace.StartOptions{})
	pipelineFn(logger, session, envelope)
	span.End()

	if messageName != "" {
		invokeReqAfterHook(logger, p.config, p.runtimePool, p.jsonpbMarshaler, session.ID().String(), session.UserID(), session.Username(), session.Expiry(), messageName, envelope)
	}

	return true
}
