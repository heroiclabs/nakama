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
	"github.com/golang/protobuf/proto"
	"go.uber.org/zap"
)

// MessageRouter is responsible for sending a message to a list of presences or to an entire stream.
type MessageRouter interface {
	SendToPresences(*zap.Logger, []*Presence, proto.Message)
	SendToStream(*zap.Logger, PresenceStream, proto.Message)
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

func (r *LocalMessageRouter) SendToPresences(logger *zap.Logger, presences []*Presence, msg proto.Message) {
	if len(presences) == 0 {
		return
	}

	payload, err := r.jsonpbMarshaler.MarshalToString(msg)
	if err != nil {
		logger.Error("Could not marshall message to json", zap.Error(err))
		return
	}
	payloadBytes := []byte(payload)
	for _, presence := range presences {
		session := r.sessionRegistry.Get(presence.ID.SessionID)
		if session == nil {
			logger.Warn("No session to route to", zap.Any("sid", presence.ID.SessionID))
			continue
		}
		err := session.SendBytes(payloadBytes)
		if err != nil {
			logger.Error("Failed to route to", zap.Any("sid", presence.ID.SessionID), zap.Error(err))
		}
	}
}

func (r *LocalMessageRouter) SendToStream(logger *zap.Logger, stream PresenceStream, msg proto.Message) {
	presences := r.tracker.ListByStream(stream)
	r.SendToPresences(logger, presences, msg)
}
