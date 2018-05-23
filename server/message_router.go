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
	"github.com/golang/protobuf/jsonpb"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/zap"
)

// MessageRouter is responsible for sending a message to a list of presences or to an entire stream.
type MessageRouter interface {
	SendToPresenceIDs(*zap.Logger, []*PresenceID, bool, uint8, *rtapi.Envelope)
	SendToStream(*zap.Logger, PresenceStream, *rtapi.Envelope)
}

type LocalMessageRouter struct {
	jsonpbMarshaler *jsonpb.Marshaler
	sessionRegistry *SessionRegistry
	tracker         Tracker
}

func NewLocalMessageRouter(sessionRegistry *SessionRegistry, tracker Tracker, jsonpbMarshaler *jsonpb.Marshaler) MessageRouter {
	return &LocalMessageRouter{
		jsonpbMarshaler: jsonpbMarshaler,
		sessionRegistry: sessionRegistry,
		tracker:         tracker,
	}
}

func (r *LocalMessageRouter) SendToPresenceIDs(logger *zap.Logger, presenceIDs []*PresenceID, isStream bool, mode uint8, envelope *rtapi.Envelope) {
	if len(presenceIDs) == 0 {
		return
	}

	payload, err := r.jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		logger.Error("Could not marshall message to json", zap.Error(err))
		return
	}
	payloadBytes := []byte(payload)
	for _, presenceID := range presenceIDs {
		session := r.sessionRegistry.Get(presenceID.SessionID)
		if session == nil {
			logger.Debug("No session to route to", zap.String("sid", presenceID.SessionID.String()))
			continue
		}
		if err := session.SendBytes(isStream, mode, payloadBytes); err != nil {
			logger.Error("Failed to route to", zap.String("sid", presenceID.SessionID.String()), zap.Error(err))
		}
	}
}

func (r *LocalMessageRouter) SendToStream(logger *zap.Logger, stream PresenceStream, envelope *rtapi.Envelope) {
	presenceIDs := r.tracker.ListPresenceIDByStream(stream)
	r.SendToPresenceIDs(logger, presenceIDs, true, stream.Mode, envelope)
}
