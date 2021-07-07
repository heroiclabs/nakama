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
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
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
	Vars() map[string]string
	ClientIP() string
	ClientPort() string
	Lang() string

	Context() context.Context

	Username() string
	SetUsername(string)

	Expiry() int64
	Consume()

	Format() SessionFormat
	Send(envelope *rtapi.Envelope, reliable bool) error
	SendBytes(payload []byte, reliable bool) error

	Close(msg string, reason runtime.PresenceReason)
}

type SessionRegistry interface {
	Stop()
	Count() int
	Get(sessionID uuid.UUID) Session
	Add(session Session)
	Remove(sessionID uuid.UUID)
	Disconnect(ctx context.Context, sessionID uuid.UUID, reason ...runtime.PresenceReason) error
}

type LocalSessionRegistry struct {
	metrics *Metrics

	sessions     *sync.Map
	sessionCount *atomic.Int32
}

func NewLocalSessionRegistry(metrics *Metrics) SessionRegistry {
	return &LocalSessionRegistry{
		metrics: metrics,

		sessions:     &sync.Map{},
		sessionCount: atomic.NewInt32(0),
	}
}

func (r *LocalSessionRegistry) Stop() {}

func (r *LocalSessionRegistry) Count() int {
	return int(r.sessionCount.Load())
}

func (r *LocalSessionRegistry) Get(sessionID uuid.UUID) Session {
	session, ok := r.sessions.Load(sessionID)
	if !ok {
		return nil
	}
	return session.(Session)
}

func (r *LocalSessionRegistry) Add(session Session) {
	r.sessions.Store(session.ID(), session)
	count := r.sessionCount.Inc()
	r.metrics.GaugeSessions(float64(count))
}

func (r *LocalSessionRegistry) Remove(sessionID uuid.UUID) {
	r.sessions.Delete(sessionID)
	count := r.sessionCount.Dec()
	r.metrics.GaugeSessions(float64(count))
}

func (r *LocalSessionRegistry) Disconnect(ctx context.Context, sessionID uuid.UUID, reason ...runtime.PresenceReason) error {
	session, ok := r.sessions.Load(sessionID)
	if ok {
		// No need to remove the session from the map, session.Close() will do that.
		reasonOverride := runtime.PresenceReasonDisconnect
		if len(reason) > 0 {
			reasonOverride = reason[0]
		}
		session.(Session).Close("server-side session disconnect", reasonOverride)
	}
	return nil
}
