// Copyright 2024 The Nakama Authors
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
	"fmt"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

type sessionGRPC struct {
	sync.Mutex
	logger     *zap.Logger
	config     Config
	id         uuid.UUID
	userID     uuid.UUID
	username   *atomic.String
	vars       map[string]string
	expiry     int64
	clientIP   string
	clientPort string
	lang       string

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	sessionRegistry SessionRegistry
	statusRegistry  StatusRegistry
	matchmaker      Matchmaker
	tracker         Tracker
	metrics         Metrics
	pipeline        *Pipeline
	runtime         *Runtime

	stream     apigrpc.Nakama_RealtimeServer
	stopped    bool
	closeMu    sync.Mutex
	outgoingCh chan *rtapi.Envelope
}

func NewSessionGRPC(logger *zap.Logger, config Config, sessionID, userID uuid.UUID, username, tokenId string, vars map[string]string, tokenExpiry, tokenIssuedAt int64, clientIP, clientPort, lang string, stream apigrpc.Nakama_RealtimeServer, sessionRegistry SessionRegistry, statusRegistry StatusRegistry, matchmaker Matchmaker, tracker Tracker, metrics Metrics, pipeline *Pipeline, runtime *Runtime) Session {
	sessionLogger := logger.With(zap.String("uid", userID.String()), zap.String("sid", sessionID.String()))

	sessionLogger.Info("New gRPC realtime session connected")

	ctx, ctxCancelFn := context.WithCancel(context.Background())
	ctx = populateCtx(ctx, userID, username, tokenId, vars, tokenExpiry, tokenIssuedAt)

	return &sessionGRPC{
		logger:     sessionLogger,
		config:     config,
		id:         sessionID,
		userID:     userID,
		username:   atomic.NewString(username),
		vars:       vars,
		expiry:     tokenExpiry,
		clientIP:   clientIP,
		clientPort: clientPort,
		lang:       lang,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		sessionRegistry: sessionRegistry,
		statusRegistry:  statusRegistry,
		matchmaker:      matchmaker,
		tracker:         tracker,
		metrics:         metrics,
		pipeline:        pipeline,
		runtime:         runtime,

		stream:     stream,
		stopped:    false,
		outgoingCh: make(chan *rtapi.Envelope, config.GetSocket().OutgoingQueueSize),
	}
}

func (s *sessionGRPC) Logger() *zap.Logger {
	return s.logger
}

func (s *sessionGRPC) ID() uuid.UUID {
	return s.id
}

func (s *sessionGRPC) UserID() uuid.UUID {
	return s.userID
}

func (s *sessionGRPC) ClientIP() string {
	return s.clientIP
}

func (s *sessionGRPC) ClientPort() string {
	return s.clientPort
}

func (s *sessionGRPC) Lang() string {
	return s.lang
}

func (s *sessionGRPC) Context() context.Context {
	return s.ctx
}

func (s *sessionGRPC) Username() string {
	return s.username.Load()
}

func (s *sessionGRPC) SetUsername(username string) {
	s.username.Store(username)
}

func (s *sessionGRPC) Vars() map[string]string {
	return s.vars
}

func (s *sessionGRPC) Expiry() int64 {
	return s.expiry
}

func (s *sessionGRPC) Format() SessionFormat {
	return SessionFormatProtobuf
}

func (s *sessionGRPC) Consume() {
	// Fire an event for session start.
	if fn := s.runtime.EventSessionStart(); fn != nil {
		fn(s.ctx, s.userID.String(), s.username.Load(), s.vars, s.expiry, s.id.String(), s.clientIP, s.clientPort, s.lang, time.Now().UTC().Unix())
	}

	// Start a routine to process outbound messages.
	go s.processOutgoing()

	var reason string

IncomingLoop:
	for {
		envelope, err := s.stream.Recv()
		if err != nil {
			reason = err.Error()
			break
		}

		switch envelope.Cid {
		case "":
			if !s.pipeline.ProcessRequest(s.logger, s, envelope) {
				reason = "error processing message"
				break IncomingLoop
			}
		default:
			requestLogger := s.logger.With(zap.String("cid", envelope.Cid))
			if !s.pipeline.ProcessRequest(requestLogger, s, envelope) {
				reason = "error processing message"
				break IncomingLoop
			}
		}

		s.metrics.Message(int64(proto.Size(envelope)), false)
	}

	if reason != "" {
		s.metrics.Message(0, true)
	}

	s.Close(reason, runtime.PresenceReasonDisconnect)
}

func (s *sessionGRPC) processOutgoing() {
	var reason string

OutgoingLoop:
	for {
		select {
		case <-s.ctx.Done():
			// Session is closing, clean up the outgoing process routine.
			break OutgoingLoop
		case envelope := <-s.outgoingCh:
			s.Lock()
			if s.stopped {
				s.Unlock()
				break OutgoingLoop
			}
			if err := s.stream.Send(envelope); err != nil {
				s.Unlock()
				s.logger.Warn("Could not send message", zap.Error(err))
				reason = err.Error()
				break OutgoingLoop
			}
			s.Unlock()

			s.metrics.MessageBytesSent(int64(proto.Size(envelope)))
		}
	}

	s.Close(reason, runtime.PresenceReasonDisconnect)
}

func (s *sessionGRPC) Send(envelope *rtapi.Envelope, reliable bool) error {
	if s.logger.Core().Enabled(zap.DebugLevel) {
		switch envelope.Message.(type) {
		case *rtapi.Envelope_Error:
			s.logger.Debug("Sending error message", zap.Any("envelope", envelope))
		default:
			s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Message), zap.Any("envelope", envelope))
		}
	}

	select {
	case s.outgoingCh <- envelope:
		return nil
	default:
		// The outgoing queue is full, likely because the remote client can't keep up.
		s.logger.Warn("Could not write message, session outgoing queue full")
		go s.Close(ErrSessionQueueFull.Error(), runtime.PresenceReasonDisconnect)
		return ErrSessionQueueFull
	}
}

func (s *sessionGRPC) SendBytes(payload []byte, reliable bool) error {
	// MessageRouter sends pre-serialized protobuf bytes; unmarshal and re-queue.
	envelope := &rtapi.Envelope{}
	if err := proto.Unmarshal(payload, envelope); err != nil {
		s.logger.Warn("Could not unmarshal payload for gRPC session", zap.Error(err))
		return err
	}
	return s.Send(envelope, reliable)
}

func (s *sessionGRPC) CloseLock() {
	s.closeMu.Lock()
}

func (s *sessionGRPC) CloseUnlock() {
	s.closeMu.Unlock()
}

func (s *sessionGRPC) Close(msg string, reason runtime.PresenceReason, envelopes ...*rtapi.Envelope) {
	s.CloseLock()
	// Cancel any ongoing operations tied to this session.
	s.ctxCancelFn()
	s.CloseUnlock()

	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaning up closed gRPC realtime session")
	}

	// When connection close originates internally in the session, ensure cleanup of external resources and references.
	if err := s.matchmaker.RemoveSessionAll(s.id.String()); err != nil {
		s.logger.Warn("Failed to remove all matchmaking tickets", zap.Error(err))
	}
	s.tracker.UntrackAll(s.id, reason)
	s.statusRegistry.UnfollowAll(s.id)
	s.sessionRegistry.Remove(s.id)

	// Send final messages, if any are specified.
	for _, envelope := range envelopes {
		if err := s.stream.Send(envelope); err != nil {
			s.logger.Warn("Could not send final message", zap.Error(err))
		}
	}

	if msg != "" {
		s.logger.Debug("Closed gRPC realtime session", zap.String("reason", msg))
	} else {
		s.logger.Debug("Closed gRPC realtime session")
	}

	// Fire an event for session end.
	if fn := s.runtime.EventSessionEnd(); fn != nil {
		fn(s.ctx, s.userID.String(), s.username.Load(), s.vars, s.expiry, s.id.String(), s.clientIP, s.clientPort, s.lang, time.Now().UTC().Unix(), msg)
	}

}
