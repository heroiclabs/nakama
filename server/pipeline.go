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
	"go.uber.org/zap"
	"github.com/heroiclabs/nakama/rtapi"
)

type pipeline struct {
	config      Config
	db          *sql.DB
	registry    *SessionRegistry
	tracker     Tracker
	router      MessageRouter
	runtimePool *RuntimePool
}

func NewPipeline(config Config, db *sql.DB, registry *SessionRegistry, tracker Tracker, router MessageRouter, runtimePool *RuntimePool) *pipeline {
	return &pipeline{
		config:      config,
		db:          db,
		registry:    registry,
		tracker:     tracker,
		router:      router,
		runtimePool: runtimePool,
	}
}

func (p *pipeline) processRequest(logger *zap.Logger, session session, envelope *rtapi.Envelope) {
	switch envelope.Message.(type) {
	case *rtapi.Envelope_Rpc:
		p.rpc(logger, session, envelope)
	default:
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code: int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
			Message: "Unrecognized payload",
		}}})
		return
	}
}
