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

	"errors"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/zap"
)

var ErrPipelineUnrecognizedPayload = errors.New("pipeline received unrecognized payload")

type pipeline struct {
	config          Config
	db              *sql.DB
	sessionRegistry *SessionRegistry
	matchRegistry   MatchRegistry
	tracker         Tracker
	router          MessageRouter
	runtimePool     *RuntimePool
	node            string
}

func NewPipeline(config Config, db *sql.DB, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, runtimePool *RuntimePool) *pipeline {
	return &pipeline{
		config:          config,
		db:              db,
		sessionRegistry: sessionRegistry,
		matchRegistry:   matchRegistry,
		tracker:         tracker,
		router:          router,
		runtimePool:     runtimePool,
		node:            config.GetName(),
	}
}

func (p *pipeline) processRequest(logger *zap.Logger, session session, envelope *rtapi.Envelope) error {
	if logger.Core().Enabled(zap.DebugLevel) {
		logger.Debug(fmt.Sprintf("Received %T message", envelope.Message), zap.Any("message", envelope.Message))
	}

	switch envelope.Message.(type) {
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
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
			Message: "Unrecognized payload",
		}}})
		// If we reached this point the envelope was valid but the contents are missing or unknown.
		// Usually caused by a version mismatch, and should cause the session making this pipeline request to close.
		return ErrPipelineUnrecognizedPayload
	}
	return nil
}
