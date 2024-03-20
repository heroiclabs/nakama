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
	"crypto/sha1"
	"errors"

	"github.com/gofrs/uuid/v5"
)

var (
	ErrNodeNotFound    = errors.New("node not found")
	ErrSessionNotFound = errors.New("session not found")
)

type StreamManager interface {
	UserJoin(stream PresenceStream, userID, sessionID uuid.UUID, hidden, persistence bool, status string) (bool, bool, error)
	UserUpdate(stream PresenceStream, userID, sessionID uuid.UUID, hidden, persistence bool, status string) (bool, error)
	UserLeave(stream PresenceStream, userID, sessionID uuid.UUID) error
}

type LocalStreamManager struct {
	sessionRegistry SessionRegistry
	tracker         Tracker

	nodeHash [6]byte
}

func NewLocalStreamManager(config Config, sessionRegistry SessionRegistry, tracker Tracker) StreamManager {
	return &LocalStreamManager{
		sessionRegistry: sessionRegistry,
		tracker:         tracker,

		nodeHash: NodeToHash(config.GetName()),
	}
}

func (m *LocalStreamManager) UserJoin(stream PresenceStream, userID, sessionID uuid.UUID, hidden, persistence bool, status string) (bool, bool, error) {
	if HashFromId(sessionID) != m.nodeHash {
		return false, false, ErrNodeNotFound
	}

	session := m.sessionRegistry.Get(sessionID)
	if session == nil {
		return false, false, ErrSessionNotFound
	}

	success, newlyTracked := m.tracker.Track(session.Context(), sessionID, stream, userID, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
		Status:      status,
	})

	return success, newlyTracked, nil
}

func (m *LocalStreamManager) UserUpdate(stream PresenceStream, userID, sessionID uuid.UUID, hidden, persistence bool, status string) (bool, error) {
	if HashFromId(sessionID) != m.nodeHash {
		return false, ErrNodeNotFound
	}

	session := m.sessionRegistry.Get(sessionID)
	if session == nil {
		return false, ErrSessionNotFound
	}

	success := m.tracker.Update(session.Context(), sessionID, stream, userID, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
		Status:      status,
	})

	return success, nil
}

func (m *LocalStreamManager) UserLeave(stream PresenceStream, userID, sessionID uuid.UUID) error {
	if HashFromId(sessionID) != m.nodeHash {
		return ErrNodeNotFound
	}

	m.tracker.Untrack(sessionID, stream, userID)

	return nil
}

func NodeToHash(node string) [6]byte {
	hash := sha1.Sum([]byte(node))
	var hashArr [6]byte
	copy(hashArr[:], hash[:6])
	return hashArr
}

func HashFromId(id uuid.UUID) [6]byte {
	var idArr [6]byte
	copy(idArr[:], id[10:])
	return idArr
}
