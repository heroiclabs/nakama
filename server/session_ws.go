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
	"go.uber.org/zap"
	"sync"
	"go.uber.org/atomic"
	"github.com/gorilla/websocket"
	"time"
	"github.com/satori/go.uuid"
	"bytes"
	"github.com/golang/protobuf/jsonpb"
	"errors"
	"github.com/heroiclabs/nakama/rtapi"
	"fmt"
)

var ErrQueueFull = errors.New("outgoing queue full")

type sessionWS struct {
	sync.Mutex
	logger            *zap.Logger
	config            Config
	id                uuid.UUID
	userID            uuid.UUID
	username          *atomic.String
	expiry            int64

	jsonpbMarshaler   *jsonpb.Marshaler
	jsonpbUnmarshaler *jsonpb.Unmarshaler

	registry          *SessionRegistry
	tracker           Tracker

	stopped           bool
	conn              *websocket.Conn
	pingTicker        *time.Ticker
	outgoingCh        chan []byte
	outgoingStopCh    chan struct{}
}

func NewSessionWS(logger *zap.Logger, config Config, userID uuid.UUID, username string, expiry int64, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, conn *websocket.Conn, registry *SessionRegistry, tracker Tracker) session {
	sessionID := uuid.NewV4()
	sessionLogger := logger.With(zap.String("uid", userID.String()), zap.String("sid", sessionID.String()))

	sessionLogger.Debug("New WebSocket session connected")

	return &sessionWS{
		logger:            sessionLogger,
		config:            config,
		id:                sessionID,
		userID:            userID,
		username:          atomic.NewString(username),
		expiry:            expiry,

		jsonpbMarshaler:   jsonpbMarshaler,
		jsonpbUnmarshaler: jsonpbUnmarshaler,

		registry:          registry,
		tracker:           tracker,

		stopped:           false,
		conn:              conn,
		pingTicker:        time.NewTicker(time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond),
		outgoingCh:        make(chan []byte, config.GetSocket().OutgoingQueueSize),
		outgoingStopCh:    make(chan struct{}),
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

func (s *sessionWS) Username() string {
	return s.username.Load()
}

func (s *sessionWS) SetUsername(username string) {
	s.username.Store(username)
}

func (s *sessionWS) Expiry() int64 {
	return s.expiry
}

func (s *sessionWS) Consume(processRequest func(logger *zap.Logger, session session, envelope *rtapi.Envelope)) {
	defer s.cleanupClosedConnection()
	s.conn.SetReadLimit(s.config.GetSocket().MaxMessageSizeBytes)
	s.conn.SetReadDeadline(time.Now().Add(time.Duration(s.config.GetSocket().PongWaitMs) * time.Millisecond))
	s.conn.SetPongHandler(func(string) error {
		s.conn.SetReadDeadline(time.Now().Add(time.Duration(s.config.GetSocket().PongWaitMs) * time.Millisecond))
		return nil
	})

	// Send an initial ping immediately.
	if !s.pingNow() {
		// If the first ping fails abort the rest of the consume sequence immediately.
		return
	}

	// Start a routine to process outbound messages.
	go s.processOutgoing()

	for {
		_, data, err := s.conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				s.logger.Warn("Error reading message from client", zap.Error(err))
			}
			break
		}

		request := &rtapi.Envelope{}
		if err = s.jsonpbUnmarshaler.Unmarshal(bytes.NewReader(data), request); err != nil {
			// If the payload is malformed the client is incompatible or misbehaving, either way disconnect it now.
			s.logger.Warn("Received malformed payload", zap.String("data", string(data)))
			s.Send(&rtapi.Envelope{Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code: int32(rtapi.Error_UNRECOGNIZED_PAYLOAD),
				Message: "Unrecognized payload",
			}}})
			break
		} else {
			// TODO Add session-global context here to cancel in-progress operations when the session is closed.
			requestLogger := s.logger.With(zap.String("cid", request.Cid))
			processRequest(requestLogger, s, request)
		}
	}
}

func (s *sessionWS) processOutgoing() {
	for {
		select {
		case <-s.outgoingStopCh:
			// Session is closing, close the outgoing process routine.
			return
		case <-s.pingTicker.C:
			// Periodically send pings.
			if !s.pingNow() {
				// If ping fails the session will be stopped, clean up the loop.
				return
			}
		case payload := <-s.outgoingCh:
			// Process the outgoing message queue.
			s.conn.SetWriteDeadline(time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs) * time.Millisecond))
			if err := s.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				s.logger.Warn("Could not write message", zap.Error(err))
				return
			}
		}
	}
}

func (s *sessionWS) pingNow() bool {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return false
	}
	s.conn.SetWriteDeadline(time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs) * time.Millisecond))
	err := s.conn.WriteMessage(websocket.PingMessage, []byte{})
	s.Unlock()
	if err != nil {
		s.logger.Warn("Could not send ping, closing channel", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
		// The connection has already failed.
		s.cleanupClosedConnection()
		return false
	}
	return true
}

func (s *sessionWS) Format() SessionFormat {
	return SessionFormatJson
}

func (s *sessionWS) Send(envelope *rtapi.Envelope) error {
	s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Message), zap.String("cid", envelope.Cid))

	payload, err := s.jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		s.logger.Warn("Could not marshal to json", zap.Error(err))
		return err
	}
	return s.SendBytes([]byte(payload))
}

func (s *sessionWS) SendBytes(payload []byte) error {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return nil
	}

	select {
	case s.outgoingCh <-payload:
		s.Unlock()
		return nil
	default:
		// The outgoing queue is full, likely because the remote client can't keep up.
		// Terminate the connection immediately because the only alternative that doesn't block the server is
		// to start dropping messages, which might cause unexpected behaviour.
		s.Unlock()
		s.logger.Warn("Could not write message, outgoing queue full")
		s.cleanupClosedConnection()
		return ErrQueueFull
	}
}

func (s *sessionWS) cleanupClosedConnection() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	s.logger.Debug("Cleaning up closed client connection", zap.String("remoteAddress", s.conn.RemoteAddr().String()))

	// When connection close originates internally in the session, ensure cleanup of external resources and references.
	s.registry.remove(s.id)
	s.tracker.UntrackAll(s.id)

	// Clean up internals.
	s.pingTicker.Stop()
	close(s.outgoingStopCh)
	close(s.outgoingCh)

	// Close WebSocket.
	s.conn.Close()
	s.logger.Debug("Closed client connection")
}

func (s *sessionWS) Close() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	// Expect the caller of this session.Close() to clean up external resources (like presences) separately.

	// Clean up internals.
	s.pingTicker.Stop()
	close(s.outgoingStopCh)
	close(s.outgoingCh)

	// Send close message.
	err := s.conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs)*time.Millisecond))
	if err != nil {
		s.logger.Warn("Could not send close message, closing prematurely", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
	}

	// Close WebSocket.
	s.conn.Close()
	s.logger.Debug("Closed client connection")
}
