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
	"github.com/gogo/protobuf/jsonpb"
	"github.com/gogo/protobuf/proto"
	"go.uber.org/zap"
)

// MessageRouter is responsible for sending a message to a list of presences
type MessageRouter interface {
	Send(*zap.Logger, []Presence, proto.Message, bool)
}

type messageRouterService struct {
	jsonpbMarshaler *jsonpb.Marshaler
	registry        *SessionRegistry
}

func NewMessageRouterService(jsonpbMarshaler *jsonpb.Marshaler, registry *SessionRegistry) *messageRouterService {
	return &messageRouterService{
		jsonpbMarshaler: jsonpbMarshaler,
		registry:        registry,
	}
}

func (m *messageRouterService) Send(logger *zap.Logger, ps []Presence, msg proto.Message, reliable bool) {
	if len(ps) == 0 {
		return
	}

	// Group together target sessions by format.
	jsonSessionIDs := make([]string, 0)
	protobufSessionIDs := make([]string, 0)
	for _, p := range ps {
		switch p.Meta.Format {
		case SessionFormatJson:
			jsonSessionIDs = append(jsonSessionIDs, p.ID.SessionID)
		default:
			protobufSessionIDs = append(protobufSessionIDs, p.ID.SessionID)
		}
	}

	// Encode and route together for Protobuf format.
	if len(protobufSessionIDs) != 0 {
		payload, err := proto.Marshal(msg)
		if err != nil {
			logger.Error("Could not marshall message to byte[]", zap.Error(err))
			return
		}
		for _, sessionID := range protobufSessionIDs {
			session := m.registry.Get(sessionID)
			if session == nil {
				logger.Warn("No session to route to", zap.Any("sid", sessionID))
				continue
			}
			err := session.SendBytes(payload, reliable)
			if err != nil {
				logger.Error("Failed to route to", zap.Any("sid", sessionID), zap.Error(err))
			}
		}
	}

	// Encode and route together for JSON format.
	if len(jsonSessionIDs) != 0 {
		payload, err := m.jsonpbMarshaler.MarshalToString(msg)
		if err != nil {
			logger.Error("Could not marshall message to json", zap.Error(err))
			return
		}
		payloadBytes := []byte(payload)
		for _, sessionID := range jsonSessionIDs {
			session := m.registry.Get(sessionID)
			if session == nil {
				logger.Warn("No session to route to", zap.Any("sid", sessionID))
				continue
			}
			err := session.SendBytes(payloadBytes, reliable)
			if err != nil {
				logger.Error("Failed to route to", zap.Any("sid", sessionID), zap.Error(err))
			}
		}
	}
}
