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
	"context"
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

	Context() context.Context

	Username() string
	SetUsername(string)

	Expiry() int64
	Consume(func(logger *zap.Logger, session Session, envelope *rtapi.Envelope) bool)

	Format() SessionFormat
	Send(isStream bool, mode uint8, envelope *rtapi.Envelope) error
	SendBytes(isStream bool, mode uint8, payload []byte) error

	Close()
}

type SessionRegistry interface {
	Stop()
	Count() int
	Get(sessionID uuid.UUID) Session
	Add(session Session)
	Remove(sessionID uuid.UUID)
	Disconnect(ctx context.Context, sessionID uuid.UUID, node string) error
}

type LocalSessionRegistry struct {
	sync.RWMutex
	sessions map[uuid.UUID]Session
}

func NewLocalSessionRegistry() SessionRegistry {
	return &LocalSessionRegistry{
		sessions: make(map[uuid.UUID]Session),
	}
}

func (r *LocalSessionRegistry) Stop() {}

func (r *LocalSessionRegistry) Count() int {
	var count int
	r.RLock()
	count = len(r.sessions)
	r.RUnlock()
	return count
}

func (r *LocalSessionRegistry) Get(sessionID uuid.UUID) Session {
	var session Session
	r.RLock()
	session = r.sessions[sessionID]
	r.RUnlock()
	return session
}

func (r *LocalSessionRegistry) Add(session Session) {
	r.Lock()
	r.sessions[session.ID()] = session
	r.Unlock()
}

func (r *LocalSessionRegistry) Remove(sessionID uuid.UUID) {
	r.Lock()
	delete(r.sessions, sessionID)
	r.Unlock()
}

func (r *LocalSessionRegistry) Disconnect(ctx context.Context, sessionID uuid.UUID, node string) error {
	var session Session
	r.RLock()
	session = r.sessions[sessionID]
	r.RUnlock()
	if session != nil {
		session.Close()
	}
	return nil
}
