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
	"sync"

	"github.com/gorilla/websocket"
	"github.com/satori/go.uuid"
	"github.com/uber-go/zap"
)

// SessionRegistry maintains a list of sessions to their IDs. This is thread-safe.
type SessionRegistry struct {
	sync.RWMutex
	logger   zap.Logger
	config   Config
	tracker  Tracker
	sessions map[uuid.UUID]*session
}

// NewSessionRegistry creates a new SessionRegistry
func NewSessionRegistry(logger zap.Logger, config Config, tracker Tracker) *SessionRegistry {
	return &SessionRegistry{
		logger:   logger,
		config:   config,
		tracker:  tracker,
		sessions: make(map[uuid.UUID]*session),
	}
}

func (a *SessionRegistry) stop() {
	a.Lock()
	for _, session := range a.sessions {
		if a.sessions[session.id] != nil {
			delete(a.sessions, session.id)
			go a.tracker.UntrackAll(session.id) // Drop all tracked presences for this session.
		}
		session.close()
	}
	a.Unlock()
}

// Get returns a session matching the sessionID
func (a *SessionRegistry) Get(sessionID uuid.UUID) *session {
	var s *session
	a.RLock()
	s = a.sessions[sessionID]
	a.RUnlock()
	return s
}

func (a *SessionRegistry) add(userID uuid.UUID, handle string, lang string, conn *websocket.Conn, processRequest func(logger zap.Logger, session *session, envelope *Envelope)) {
	s := NewSession(a.logger, a.config, userID, handle, lang, conn, a.remove)
	a.Lock()
	a.sessions[s.id] = s
	a.Unlock()
	s.Consume(processRequest)
}

func (a *SessionRegistry) remove(c *session) {
	a.Lock()
	if a.sessions[c.id] != nil {
		delete(a.sessions, c.id)
		go a.tracker.UntrackAll(c.id) // Drop all tracked presences for this session.
	}
	a.Unlock()
}
