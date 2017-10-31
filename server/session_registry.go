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
	"go.uber.org/zap"
	"nakama/pkg/multicode"
)

// SessionRegistry maintains a list of sessions to their IDs. This is thread-safe.
type SessionRegistry struct {
	sync.RWMutex
	logger     *zap.Logger
	config     Config
	tracker    Tracker
	matchmaker Matchmaker
	sessions   map[uuid.UUID]session
}

// NewSessionRegistry creates a new SessionRegistry
func NewSessionRegistry(logger *zap.Logger, config Config, tracker Tracker, matchmaker Matchmaker) *SessionRegistry {
	return &SessionRegistry{
		logger:     logger,
		config:     config,
		tracker:    tracker,
		matchmaker: matchmaker,
		sessions:   make(map[uuid.UUID]session),
	}
}

func (a *SessionRegistry) stop() {
	a.Lock()
	for _, session := range a.sessions {
		if a.sessions[session.ID()] != nil {
			delete(a.sessions, session.ID())
			go func() {
				a.matchmaker.RemoveAll(session.ID()) // Drop all active matchmaking requests for this session.
				a.tracker.UntrackAll(session.ID())   // Drop all tracked presences for this session.
			}()
		}
		session.Close()
	}
	a.Unlock()
}

// Get returns a session matching the sessionID
func (a *SessionRegistry) Get(sessionID uuid.UUID) session {
	var s session
	a.RLock()
	s = a.sessions[sessionID]
	a.RUnlock()
	return s
}

func (a *SessionRegistry) addWS(userID uuid.UUID, handle string, lang string, expiry int64, conn *websocket.Conn, processRequest func(logger *zap.Logger, session session, envelope *Envelope, reliable bool)) {
	s := NewWSSession(a.logger, a.config, userID, handle, lang, expiry, conn, a.remove)
	a.Lock()
	a.sessions[s.ID()] = s
	a.Unlock()

	// Register the session for notifications.
	a.tracker.Track(s.ID(), "notifications", s.UserID(), PresenceMeta{Handle: handle})

	// Allow the server to begin processing incoming messages from this session.
	s.Consume(processRequest)
}

func (a *SessionRegistry) addUDP(userID uuid.UUID, handle string, lang string, expiry int64, clientInstance *multicode.ClientInstance, processRequest func(logger *zap.Logger, session session, envelope *Envelope, reliable bool)) {
	s := NewUDPSession(a.logger, a.config, userID, handle, lang, expiry, clientInstance, a.remove)
	a.Lock()
	a.sessions[s.ID()] = s
	a.Unlock()

	// Register the session for notifications.
	a.tracker.Track(s.ID(), "notifications", s.UserID(), PresenceMeta{Handle: handle})

	// Allow the server to begin processing incoming messages from this session.
	s.Consume(processRequest)
}

func (a *SessionRegistry) remove(c session) {
	a.Lock()
	if a.sessions[c.ID()] != nil {
		delete(a.sessions, c.ID())
		go func() {
			a.matchmaker.RemoveAll(c.ID()) // Drop all active matchmaking requests for this session.
			a.tracker.UntrackAll(c.ID())   // Drop all tracked presences for this session.
		}()
	}
	a.Unlock()
}
