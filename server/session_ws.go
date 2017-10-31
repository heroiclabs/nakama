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
	"time"

	"fmt"

	"github.com/gogo/protobuf/proto"
	"github.com/gorilla/websocket"
	"github.com/satori/go.uuid"

	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type wsSession struct {
	sync.Mutex
	logger           *zap.Logger
	config           Config
	id               uuid.UUID
	userID           uuid.UUID
	handle           *atomic.String
	lang             string
	expiry           int64
	stopped          bool
	conn             *websocket.Conn
	pingTicker       *time.Ticker
	pingTickerStopCh chan bool
	unregister       func(s session)
}

// NewWSSession creates a new session which encapsulates a WebSocket connection.
func NewWSSession(logger *zap.Logger, config Config, userID uuid.UUID, handle string, lang string, expiry int64, websocketConn *websocket.Conn, unregister func(s session)) session {
	sessionID := uuid.NewV4()
	sessionLogger := logger.With(zap.String("uid", userID.String()), zap.String("sid", sessionID.String()))

	sessionLogger.Debug("New WS session connected")

	return &wsSession{
		logger:           sessionLogger,
		config:           config,
		id:               sessionID,
		userID:           userID,
		handle:           atomic.NewString(handle),
		lang:             lang,
		expiry:           expiry,
		conn:             websocketConn,
		stopped:          false,
		pingTicker:       time.NewTicker(time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond),
		pingTickerStopCh: make(chan bool),
		unregister:       unregister,
	}
}

func (s *wsSession) Logger() *zap.Logger {
	return s.logger
}

func (s *wsSession) ID() uuid.UUID {
	return s.id
}

func (s *wsSession) UserID() uuid.UUID {
	return s.userID
}

func (s *wsSession) Handle() string {
	return s.handle.Load()
}

func (s *wsSession) SetHandle(handle string) {
	s.handle.Store(handle)
}

func (s *wsSession) Lang() string {
	return s.lang
}

func (s *wsSession) Expiry() int64 {
	return s.expiry
}

func (s *wsSession) Consume(processRequest func(logger *zap.Logger, session session, envelope *Envelope, reliable bool)) {
	defer s.cleanupClosedConnection()
	s.conn.SetReadLimit(s.config.GetSocket().MaxMessageSizeBytes)
	s.conn.SetReadDeadline(time.Now().Add(time.Duration(s.config.GetSocket().PongWaitMs) * time.Millisecond))
	s.conn.SetPongHandler(func(string) error {
		s.conn.SetReadDeadline(time.Now().Add(time.Duration(s.config.GetSocket().PongWaitMs) * time.Millisecond))
		return nil
	})

	// Send an initial ping immediately, then at intervals.
	s.pingNow()
	go s.pingPeriodically()

	for {
		_, data, err := s.conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				s.logger.Warn("Error reading message from client", zap.Error(err))
			}
			break
		}

		request := &Envelope{}
		err = proto.Unmarshal(data, request)
		if err != nil {
			s.logger.Warn("Received malformed payload", zap.Any("data", data))
			s.Send(ErrorMessage(request.CollationId, UNRECOGNIZED_PAYLOAD, "Unrecognized payload"), true)
		} else {
			// TODO Add session-global context here to cancel in-progress operations when the session is closed.
			requestLogger := s.logger.With(zap.String("cid", request.CollationId))
			processRequest(requestLogger, s, request, true)
		}
	}
}

func (s *wsSession) Unregister() {
	s.unregister(s)
}

func (s *wsSession) pingPeriodically() {
	for {
		select {
		case <-s.pingTicker.C:
			if !s.pingNow() {
				// If ping fails the session will be stopped, clean up the loop.
				return
			}
		case <-s.pingTickerStopCh:
			return
		}
	}
}

func (s *wsSession) pingNow() bool {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return false
	}
	s.conn.SetWriteDeadline(time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs) * time.Millisecond))
	err := s.conn.WriteMessage(websocket.PingMessage, []byte{})
	s.Unlock()
	if err != nil {
		s.logger.Warn("Could not send ping. Closing channel", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
		s.cleanupClosedConnection() // The connection has already failed
		return false
	}

	// Server heartbeat.
	err = s.Send(&Envelope{Payload: &Envelope_Heartbeat{&Heartbeat{Timestamp: nowMs()}}}, true)
	if err != nil {
		s.logger.Warn("Could not send heartbeat", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
	}

	return true
}

func (s *wsSession) Send(envelope *Envelope, reliable bool) error {
	s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Payload), zap.String("cid", envelope.CollationId))

	payload, err := proto.Marshal(envelope)

	if err != nil {
		s.logger.Warn("Could not marshall Response to byte[]", zap.Error(err))
		return err
	}

	return s.SendBytes(payload, reliable)
}

func (s *wsSession) SendBytes(payload []byte, reliable bool) error {
	// NOTE: WebSocket sessions ignore the reliable flag and will always deliver messages reliably.
	// TODO Improve on mutex usage here.
	s.Lock()
	defer s.Unlock()
	if s.stopped {
		return nil
	}

	s.conn.SetWriteDeadline(time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs) * time.Millisecond))
	err := s.conn.WriteMessage(websocket.BinaryMessage, payload)
	if err != nil {
		s.logger.Warn("Could not write message", zap.Error(err))
		// TODO investigate whether we need to cleanupClosedConnection if write fails
	}

	return err
}

func (s *wsSession) cleanupClosedConnection() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	s.logger.Debug("Cleaning up closed client connection", zap.String("remoteAddress", s.conn.RemoteAddr().String()))
	s.unregister(s)
	s.pingTicker.Stop()
	close(s.pingTickerStopCh)
	s.conn.Close()
	s.logger.Debug("Closed client connection")
}

func (s *wsSession) Close() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	s.pingTicker.Stop()
	close(s.pingTickerStopCh)
	err := s.conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs)*time.Millisecond))
	if err != nil {
		s.logger.Warn("Could not send close message. Closing prematurely.", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
	}
	s.conn.Close()
	s.logger.Debug("Closed client connection")
}
