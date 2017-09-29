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
	"github.com/gogo/protobuf/proto"
	"go.uber.org/zap"
)

// MessageRouter is responsible for sending a message to a list of presences
type MessageRouter interface {
	Send(*zap.Logger, []Presence, proto.Message, bool)
}

type messageRouterService struct {
	registry *SessionRegistry
}

func NewMessageRouterService(registry *SessionRegistry) *messageRouterService {
	return &messageRouterService{
		registry: registry,
	}
}

func (m *messageRouterService) Send(logger *zap.Logger, ps []Presence, msg proto.Message, reliable bool) {
	if len(ps) == 0 {
		return
	}

	payload, err := proto.Marshal(msg)
	if err != nil {
		logger.Error("Could not marshall message to byte[]", zap.Error(err))
		return
	}

	for _, p := range ps {
		session := m.registry.Get(p.ID.SessionID)
		if session != nil {
			err := session.SendBytes(payload, reliable)
			if err != nil {
				logger.Error("Failed to route to", zap.Any("p", p), zap.Error(err))
			}
		} else {
			logger.Warn("No session to route to", zap.Any("p", p))
		}
	}
}
