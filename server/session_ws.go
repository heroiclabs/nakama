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
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/gorilla/websocket"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

var ErrSessionQueueFull = errors.New("session outgoing queue full")

type sessionWS struct {
	sync.Mutex
	logger     *zap.Logger
	config     Config
	id         uuid.UUID
	format     SessionFormat
	userID     uuid.UUID
	username   *atomic.String
	vars       map[string]string
	expiry     int64
	clientIP   string
	clientPort string
	lang       string

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	protojsonMarshaler   *protojson.MarshalOptions
	protojsonUnmarshaler *protojson.UnmarshalOptions
	wsMessageType        int
	pingPeriodDuration   time.Duration
	pongWaitDuration     time.Duration
	writeWaitDuration    time.Duration

	sessionRegistry SessionRegistry
	statusRegistry  StatusRegistry
	matchmaker      Matchmaker
	tracker         Tracker
	metrics         Metrics
	pipeline        *Pipeline
	runtime         *Runtime

	stopped                bool
	conn                   *websocket.Conn
	receivedMessageCounter int
	pingTimer              *time.Timer
	pingTimerCAS           *atomic.Uint32
	outgoingCh             chan []byte
	closeMu                sync.Mutex
}

func NewSessionWS(logger *zap.Logger, config Config, format SessionFormat, sessionID, userID uuid.UUID, username string, vars map[string]string, expiry int64, clientIP, clientPort, lang string, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, conn *websocket.Conn, sessionRegistry SessionRegistry, statusRegistry StatusRegistry, matchmaker Matchmaker, tracker Tracker, metrics Metrics, pipeline *Pipeline, runtime *Runtime) Session {
	sessionLogger := logger.With(zap.String("uid", userID.String()), zap.String("sid", sessionID.String()))

	sessionLogger.Info("New WebSocket session connected", zap.Uint8("format", uint8(format)))

	ctx, ctxCancelFn := context.WithCancel(context.Background())

	wsMessageType := websocket.TextMessage
	if format == SessionFormatProtobuf {
		wsMessageType = websocket.BinaryMessage
	}

	return &sessionWS{
		logger:     sessionLogger,
		config:     config,
		id:         sessionID,
		format:     format,
		userID:     userID,
		username:   atomic.NewString(username),
		vars:       vars,
		expiry:     expiry,
		clientIP:   clientIP,
		clientPort: clientPort,
		lang:       lang,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		protojsonMarshaler:   protojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		wsMessageType:        wsMessageType,
		pingPeriodDuration:   time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond,
		pongWaitDuration:     time.Duration(config.GetSocket().PongWaitMs) * time.Millisecond,
		writeWaitDuration:    time.Duration(config.GetSocket().WriteWaitMs) * time.Millisecond,

		sessionRegistry: sessionRegistry,
		statusRegistry:  statusRegistry,
		matchmaker:      matchmaker,
		tracker:         tracker,
		metrics:         metrics,
		pipeline:        pipeline,
		runtime:         runtime,

		stopped:                false,
		conn:                   conn,
		receivedMessageCounter: config.GetSocket().PingBackoffThreshold,
		pingTimer:              time.NewTimer(time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond),
		pingTimerCAS:           atomic.NewUint32(1),
		outgoingCh:             make(chan []byte, config.GetSocket().OutgoingQueueSize),
	}
}

func (s *sessionWS) Logger() *zap.Logger {
	return s.logger
}

func (s *sessionWS) ID() uuid.UUID {
	return s.id
}

func (s *sessionWS) UserID() uuid.UUID {
	return s.userID
}

func (s *sessionWS) ClientIP() string {
	return s.clientIP
}

func (s *sessionWS) ClientPort() string {
	return s.clientPort
}

func (s *sessionWS) Lang() string {
	return s.lang
}

func (s *sessionWS) Context() context.Context {
	return s.ctx
}

func (s *sessionWS) Username() string {
	return s.username.Load()
}

func (s *sessionWS) SetUsername(username string) {
	s.username.Store(username)
}

func (s *sessionWS) Vars() map[string]string {
	return s.vars
}

func (s *sessionWS) Expiry() int64 {
	return s.expiry
}

func (s *sessionWS) Consume() {
	// Fire an event for session start.
	if fn := s.runtime.EventSessionStart(); fn != nil {
		fn(s.userID.String(), s.username.Load(), s.vars, s.expiry, s.id.String(), s.clientIP, s.clientPort, s.lang, time.Now().UTC().Unix())
	}

	s.conn.SetReadLimit(s.config.GetSocket().MaxMessageSizeBytes)
	if err := s.conn.SetReadDeadline(time.Now().Add(s.pongWaitDuration)); err != nil {
		s.logger.Warn("Failed to set initial read deadline", zap.Error(err))
		s.Close("failed to set initial read deadline", runtime.PresenceReasonDisconnect)
		return
	}
	s.conn.SetPongHandler(func(string) error {
		s.maybeResetPingTimer()
		return nil
	})

	// Start a routine to process outbound messages.
	go s.processOutgoing()

	var reason string
	var data []byte

IncomingLoop:
	for {
		messageType, data, err := s.conn.ReadMessage()
		if err != nil {
			// Ignore "normal" WebSocket errors.
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				// Ignore underlying connection being shut down while read is waiting for data.
				if e, ok := err.(*net.OpError); !ok || e.Err.Error() != "use of closed network connection" {
					s.logger.Debug("Error reading message from client", zap.Error(err))
					reason = err.Error()
				}
			}
			break
		}
		if messageType != s.wsMessageType {
			// Expected text but received binary, or expected binary but received text.
			// Disconnect client if it attempts to use this kind of mixed protocol mode.
			s.logger.Debug("Received unexpected WebSocket message type", zap.Int("expected", s.wsMessageType), zap.Int("actual", messageType))
			reason = "received unexpected WebSocket message type"
			break
		}

		s.receivedMessageCounter--
		if s.receivedMessageCounter <= 0 {
			s.receivedMessageCounter = s.config.GetSocket().PingBackoffThreshold
			if !s.maybeResetPingTimer() {
				// Problems resetting the ping timer indicate an error so we need to close the loop.
				reason = "error updating ping timer"
				break
			}
		}

		request := &rtapi.Envelope{}
		switch s.format {
		case SessionFormatProtobuf:
			err = proto.Unmarshal(data, request)
		case SessionFormatJson:
			fallthrough
		default:
			err = s.protojsonUnmarshaler.Unmarshal(data, request)
		}
		if err != nil {
			// If the payload is malformed the client is incompatible or misbehaving, either way disconnect it now.
			s.logger.Warn("Received malformed payload", zap.Binary("data", data))
			reason = "received malformed payload"
			break
		}

		switch request.Cid {
		case "":
			if !s.pipeline.ProcessRequest(s.logger, s, request) {
				reason = "error processing message"
				break IncomingLoop
			}
		default:
			requestLogger := s.logger.With(zap.String("cid", request.Cid))
			if !s.pipeline.ProcessRequest(requestLogger, s, request) {
				reason = "error processing message"
				break IncomingLoop
			}
		}

		// Update incoming message metrics.
		s.metrics.Message(int64(len(data)), false)
	}

	if reason != "" {
		// Update incoming message metrics.
		s.metrics.Message(int64(len(data)), true)
	}

	s.Close(reason, runtime.PresenceReasonDisconnect)
}

func (s *sessionWS) maybeResetPingTimer() bool {
	// If there's already a reset in progress there's no need to wait.
	if !s.pingTimerCAS.CompareAndSwap(1, 0) {
		return true
	}
	defer s.pingTimerCAS.CompareAndSwap(0, 1)

	s.Lock()
	if s.stopped {
		s.Unlock()
		return false
	}
	// CAS ensures concurrency is not a problem here.
	if !s.pingTimer.Stop() {
		select {
		case <-s.pingTimer.C:
		default:
		}
	}
	s.pingTimer.Reset(s.pingPeriodDuration)
	err := s.conn.SetReadDeadline(time.Now().Add(s.pongWaitDuration))
	s.Unlock()
	if err != nil {
		s.logger.Warn("Failed to set read deadline", zap.Error(err))
		s.Close("failed to set read deadline", runtime.PresenceReasonDisconnect)
		return false
	}
	return true
}

func (s *sessionWS) processOutgoing() {
	var reason string

OutgoingLoop:
	for {
		select {
		case <-s.ctx.Done():
			// Session is closing, close the outgoing process routine.
			break OutgoingLoop
		case <-s.pingTimer.C:
			// Periodically send pings.
			if msg, ok := s.pingNow(); !ok {
				// If ping fails the session will be stopped, clean up the loop.
				reason = msg
				break OutgoingLoop
			}
		case payload := <-s.outgoingCh:
			s.Lock()
			if s.stopped {
				// The connection may have stopped between the payload being queued on the outgoing channel and reaching here.
				// If that's the case then abort outgoing processing at this point and exit.
				s.Unlock()
				break OutgoingLoop
			}
			// Process the outgoing message queue.
			if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeWaitDuration)); err != nil {
				s.Unlock()
				s.logger.Warn("Failed to set write deadline", zap.Error(err))
				reason = err.Error()
				break OutgoingLoop
			}
			if err := s.conn.WriteMessage(s.wsMessageType, payload); err != nil {
				s.Unlock()
				s.logger.Warn("Could not write message", zap.Error(err))
				reason = err.Error()
				break OutgoingLoop
			}
			s.Unlock()

			// Update outgoing message metrics.
			s.metrics.MessageBytesSent(int64(len(payload)))
		}
	}

	s.Close(reason, runtime.PresenceReasonDisconnect)
}

func (s *sessionWS) pingNow() (string, bool) {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return "", false
	}
	if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeWaitDuration)); err != nil {
		s.Unlock()
		s.logger.Warn("Could not set write deadline to ping", zap.Error(err))
		return err.Error(), false
	}
	err := s.conn.WriteMessage(websocket.PingMessage, []byte{})
	s.Unlock()
	if err != nil {
		s.logger.Warn("Could not send ping", zap.Error(err))
		return err.Error(), false
	}

	return "", true
}

func (s *sessionWS) Format() SessionFormat {
	return s.format
}

func (s *sessionWS) Send(envelope *rtapi.Envelope, reliable bool) error {
	var payload []byte
	var err error
	switch s.format {
	case SessionFormatProtobuf:
		payload, err = proto.Marshal(envelope)
	case SessionFormatJson:
		fallthrough
	default:
		if buf, err := s.protojsonMarshaler.Marshal(envelope); err == nil {
			payload = buf
		}
	}
	if err != nil {
		s.logger.Warn("Could not marshal envelope", zap.Error(err))
		return err
	}

	if s.logger.Core().Enabled(zap.DebugLevel) {
		switch envelope.Message.(type) {
		case *rtapi.Envelope_Error:
			s.logger.Debug("Sending error message", zap.Binary("payload", payload))
		default:
			s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Message), zap.Any("envelope", envelope))
		}
	}

	return s.SendBytes(payload, reliable)
}

func (s *sessionWS) SendBytes(payload []byte, reliable bool) error {
	// Attempt to queue messages and observe failures.
	select {
	case s.outgoingCh <- payload:
		return nil
	default:
		// The outgoing queue is full, likely because the remote client can't keep up.
		// Terminate the connection immediately because the only alternative that doesn't block the server is
		// to start dropping messages, which might cause unexpected behaviour.
		s.logger.Warn("Could not write message, session outgoing queue full")
		// Close in a goroutine as the method can block
		go s.Close(ErrSessionQueueFull.Error(), runtime.PresenceReasonDisconnect)
		return ErrSessionQueueFull
	}
}

func (s *sessionWS) CloseLock() {
	s.closeMu.Lock()
}

func (s *sessionWS) CloseUnlock() {
	s.closeMu.Unlock()
}

func (s *sessionWS) Close(msg string, reason runtime.PresenceReason, envelopes ...*rtapi.Envelope) {
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
		s.logger.Info("Cleaning up closed client connection")
	}

	// When connection close originates internally in the session, ensure cleanup of external resources and references.
	if err := s.matchmaker.RemoveSessionAll(s.id.String()); err != nil {
		s.logger.Warn("Failed to remove all matchmaking tickets", zap.Error(err))
	}
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection matchmaker")
	}
	s.tracker.UntrackAll(s.id, reason)
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection tracker")
	}
	s.statusRegistry.UnfollowAll(s.id)
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection status registry")
	}
	s.sessionRegistry.Remove(s.id)
	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaned up closed connection session registry")
	}

	// Clean up internals.
	s.pingTimer.Stop()

	// Send final messages, if any are specified.
	for _, envelope := range envelopes {
		var payload []byte
		var err error
		switch s.format {
		case SessionFormatProtobuf:
			payload, err = proto.Marshal(envelope)
		case SessionFormatJson:
			fallthrough
		default:
			if buf, err := s.protojsonMarshaler.Marshal(envelope); err == nil {
				payload = buf
			}
		}
		if err != nil {
			s.logger.Warn("Could not marshal envelope", zap.Error(err))
			continue
		}

		if s.logger.Core().Enabled(zap.DebugLevel) {
			switch envelope.Message.(type) {
			case *rtapi.Envelope_Error:
				s.logger.Debug("Sending error message", zap.Binary("payload", payload))
			default:
				s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Message), zap.Any("envelope", envelope))
			}
		}

		s.Lock()
		if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeWaitDuration)); err != nil {
			s.Unlock()
			s.logger.Warn("Failed to set write deadline", zap.Error(err))
			continue
		}
		if err := s.conn.WriteMessage(s.wsMessageType, payload); err != nil {
			s.Unlock()
			s.logger.Warn("Could not write message", zap.Error(err))
			continue
		}
		s.Unlock()
	}

	// Send close message.
	if err := s.conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(s.writeWaitDuration)); err != nil {
		// This may not be possible if the socket was already fully closed by an error.
		s.logger.Debug("Could not send close message", zap.Error(err))
	}
	// Close WebSocket.
	if err := s.conn.Close(); err != nil {
		s.logger.Debug("Could not close", zap.Error(err))
	}

	s.logger.Info("Closed client connection")

	// Fire an event for session end.
	if fn := s.runtime.EventSessionEnd(); fn != nil {
		fn(s.userID.String(), s.username.Load(), s.vars, s.expiry, s.id.String(), s.clientIP, s.clientPort, s.lang, time.Now().UTC().Unix(), msg)
	}
}
