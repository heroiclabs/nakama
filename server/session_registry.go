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
	"sync"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/zap"
)

type SessionFormat uint8

const (
	SessionFormatJson SessionFormat = iota
	SessionFormatProtobuf
)

type Session interface {
	Logger() *zap.Logger
	ID() uuid.UUID
	UserID() uuid.UUID
	ClientIP() string
	ClientPort() string

	Username() string
	SetUsername(string)

	Expiry() int64
	Consume(func(logger *zap.Logger, session Session, envelope *rtapi.Envelope) bool)

	Format() SessionFormat
	Send(isStream bool, mode uint8, envelope *rtapi.Envelope) error
	SendBytes(isStream bool, mode uint8, payload []byte) error

	Close()
}

// SessionRegistry maintains a thread-safe list of sessions to their IDs.
type SessionRegistry struct {
	sync.RWMutex
	sessions map[uuid.UUID]Session
}

func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{
		sessions: make(map[uuid.UUID]Session),
	}
}

func (r *SessionRegistry) Stop() {
	r.Lock()
	for sessionID, session := range r.sessions {
		delete(r.sessions, sessionID)
		// Send graceful close messages to client connections.
		// No need to clean up presences or matchmaker entries because we only expect to be here on server shutdown.
		session.Close()
	}
	r.Unlock()
}

func (r *SessionRegistry) Get(sessionID uuid.UUID) Session {
	var s Session
	r.RLock()
	s = r.sessions[sessionID]
	r.RUnlock()
	return s
}

func (r *SessionRegistry) add(s Session) {
	r.Lock()
	r.sessions[s.ID()] = s
	r.Unlock()
}

func (r *SessionRegistry) remove(sessionID uuid.UUID) {
	r.Lock()
	delete(r.sessions, sessionID)
	r.Unlock()
}
