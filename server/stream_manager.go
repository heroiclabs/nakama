// Copyright 2019 The Nakama Authors
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
	"errors"
	"github.com/gofrs/uuid"
)

var (
	ErrNodeNotFound = errors.New("node not found")
)

type StreamManager interface {
	UserKick(userID, sessionID uuid.UUID, node string, stream PresenceStream) error
}

type LocalStreamManager struct {
	sessionRegistry SessionRegistry
	tracker         Tracker

	node string
}

func NewLocalStreamManager(config Config, sessionRegistry SessionRegistry, tracker Tracker) StreamManager {
	return &LocalStreamManager{
		sessionRegistry: sessionRegistry,
		tracker:         tracker,

		node: config.GetName(),
	}
}

func (m *LocalStreamManager) UserKick(userID, sessionID uuid.UUID, node string, stream PresenceStream) error {
	if node != m.node {
		return ErrNodeNotFound
	}

	m.tracker.Untrack(sessionID, stream, userID)

	return nil
}
