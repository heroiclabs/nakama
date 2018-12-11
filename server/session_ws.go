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
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/golang/protobuf/proto"
	"sync"
	"time"

	"net"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/gorilla/websocket"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/atomic"
	"go.uber.org/zap"
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
	expiry     int64
	clientIP   string
	clientPort string

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	jsonpbMarshaler        *jsonpb.Marshaler
	jsonpbUnmarshaler      *jsonpb.Unmarshaler
	wsMessageType          int
	queuePriorityThreshold int
	pingPeriodDuration     time.Duration
	pongWaitDuration       time.Duration
	writeWaitDuration      time.Duration

	sessionRegistry *SessionRegistry
	matchmaker      Matchmaker
	tracker         Tracker

	stopped                bool
	conn                   *websocket.Conn
	receivedMessageCounter int
	pingTimer              *time.Timer
	pingTimerCAS           *atomic.Uint32
	outgoingCh             chan []byte
	outgoingStopCh         chan struct{}
}

func NewSessionWS(logger *zap.Logger, config Config, format SessionFormat, userID uuid.UUID, username string, expiry int64, clientIP string, clientPort string, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, conn *websocket.Conn, sessionRegistry *SessionRegistry, matchmaker Matchmaker, tracker Tracker) Session {
	sessionID := uuid.Must(uuid.NewV4())
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
		expiry:     expiry,
		clientIP:   clientIP,
		clientPort: clientPort,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		jsonpbMarshaler:        jsonpbMarshaler,
		jsonpbUnmarshaler:      jsonpbUnmarshaler,
		wsMessageType:          wsMessageType,
		queuePriorityThreshold: (config.GetSocket().OutgoingQueueSize / 3) * 2,
		pingPeriodDuration:     time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond,
		pongWaitDuration:       time.Duration(config.GetSocket().PongWaitMs) * time.Millisecond,
		writeWaitDuration:      time.Duration(config.GetSocket().WriteWaitMs) * time.Millisecond,

		sessionRegistry: sessionRegistry,
		matchmaker:      matchmaker,
		tracker:         tracker,

		stopped:                false,
		conn:                   conn,
		receivedMessageCounter: config.GetSocket().PingBackoffThreshold,
		pingTimer:              time.NewTimer(time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond),
		pingTimerCAS:           atomic.NewUint32(1),
		outgoingCh:             make(chan []byte, config.GetSocket().OutgoingQueueSize),
		outgoingStopCh:         make(chan struct{}),
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

func (s *sessionWS) Context() context.Context {
	return s.ctx
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

func (s *sessionWS) Consume(processRequest func(logger *zap.Logger, session Session, envelope *rtapi.Envelope) bool) {
	defer s.cleanupClosedConnection()
	s.conn.SetReadLimit(s.config.GetSocket().MaxMessageSizeBytes)
	s.conn.SetReadDeadline(time.Now().Add(s.pongWaitDuration))
	s.conn.SetPongHandler(func(string) error {
		s.maybeResetPingTimer()
		return nil
	})

	// Start a routine to process outbound messages.
	go s.processOutgoing()

	for {
		messageType, data, err := s.conn.ReadMessage()
		if err != nil {
			// Ignore "normal" WebSocket errors.
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				// Ignore underlying connection being shut down while read is waiting for data.
				if e, ok := err.(*net.OpError); !ok || e.Err.Error() != "use of closed network connection" {
					s.logger.Debug("Error reading message from client", zap.Error(err))
				}
			}
			break
		}
		if messageType != s.wsMessageType {
			// Expected text but received binary, or expected binary but received text.
			// Disconnect client if it attempts to use this kind of mixed protocol mode.
			s.logger.Debug("Received unexpected WebSocket message type", zap.Int("expected", s.wsMessageType), zap.Int("actual", messageType))
			break
		}

		s.receivedMessageCounter--
		if s.receivedMessageCounter <= 0 {
			s.receivedMessageCounter = s.config.GetSocket().PingBackoffThreshold
			s.maybeResetPingTimer()
		}

		request := &rtapi.Envelope{}
		switch s.format {
		case SessionFormatProtobuf:
			err = proto.Unmarshal(data, request)
		case SessionFormatJson:
			fallthrough
		default:
			err = s.jsonpbUnmarshaler.Unmarshal(bytes.NewReader(data), request)
		}
		if err != nil {
			// If the payload is malformed the client is incompatible or misbehaving, either way disconnect it now.
			s.logger.Warn("Received malformed payload", zap.Binary("data", data))
			break
		}

		switch request.Cid {
		case "":
			if !processRequest(s.logger, s, request) {
				break
			}
		default:
			requestLogger := s.logger.With(zap.String("cid", request.Cid))
			if !processRequest(requestLogger, s, request) {
				break
			}
		}
	}
}

func (s *sessionWS) maybeResetPingTimer() {
	// If there's already a reset in progress there's no need to wait.
	if !s.pingTimerCAS.CAS(1, 0) {
		return
	}

	// CAS ensures concurrency is not a problem here.
	if !s.pingTimer.Stop() {
		select {
		case <-s.pingTimer.C:
		default:
		}
	}
	s.pingTimer.Reset(s.pingPeriodDuration)
	s.conn.SetReadDeadline(time.Now().Add(s.pongWaitDuration))
	s.pingTimerCAS.CAS(0, 1)
}

func (s *sessionWS) processOutgoing() {
	for {
		select {
		case <-s.outgoingStopCh:
			// Session is closing, close the outgoing process routine.
			return
		case <-s.pingTimer.C:
			// Periodically send pings.
			if !s.pingNow() {
				// If ping fails the session will be stopped, clean up the loop.
				return
			}
		case payload := <-s.outgoingCh:
			s.Lock()
			if s.stopped {
				// The connection may have stopped between the payload being queued on the outgoing channel and reaching here.
				// If that's the case then abort outgoing processing at this point and exit.
				s.Unlock()
				return
			}
			// Process the outgoing message queue.
			s.conn.SetWriteDeadline(time.Now().Add(s.writeWaitDuration))
			if err := s.conn.WriteMessage(s.wsMessageType, payload); err != nil {
				s.Unlock()
				s.logger.Warn("Could not write message", zap.Error(err))
				return
			}
			s.Unlock()
		}
	}
}

func (s *sessionWS) pingNow() bool {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return false
	}
	s.conn.SetWriteDeadline(time.Now().Add(s.writeWaitDuration))
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
	return s.format
}

func (s *sessionWS) Send(isStream bool, mode uint8, envelope *rtapi.Envelope) error {
	var payload []byte
	var err error
	switch s.format {
	case SessionFormatProtobuf:
		payload, err = proto.Marshal(envelope)
	case SessionFormatJson:
		fallthrough
	default:
		var buf bytes.Buffer
		if err = s.jsonpbMarshaler.Marshal(&buf, envelope); err == nil {
			payload = buf.Bytes()
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

	return s.SendBytes(isStream, mode, []byte(payload))
}

func (s *sessionWS) SendBytes(isStream bool, mode uint8, payload []byte) error {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return nil
	}

	if isStream {
		switch mode {
		case StreamModeChannel:
			fallthrough
		case StreamModeGroup:
			fallthrough
		case StreamModeDM:
			// Chat messages are only allowed if the current outgoing queue size is below the threshold to
			// ensure there is always room to queue higher priority messages.
			if len(s.outgoingCh) < s.queuePriorityThreshold {
				s.outgoingCh <- payload
			}
			s.Unlock()
			return nil
		}
	}

	// By default attempt to queue messages and observe failures.
	select {
	case s.outgoingCh <- payload:
		s.Unlock()
		return nil
	default:
		// The outgoing queue is full, likely because the remote client can't keep up.
		// Terminate the connection immediately because the only alternative that doesn't block the server is
		// to start dropping messages, which might cause unexpected behaviour.
		s.Unlock()
		s.logger.Warn("Could not write message, session outgoing queue full")
		s.cleanupClosedConnection()
		return ErrSessionQueueFull
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

	// Cancel any ongoing operations tied to this session.
	s.ctxCancelFn()

	if s.logger.Core().Enabled(zap.DebugLevel) {
		s.logger.Info("Cleaning up closed client connection", zap.String("remoteAddress", s.conn.RemoteAddr().String()))
	}

	// When connection close originates internally in the session, ensure cleanup of external resources and references.
	s.sessionRegistry.remove(s.id)
	s.matchmaker.RemoveAll(s.id)
	s.tracker.UntrackAll(s.id)

	// Clean up internals.
	s.pingTimer.Stop()
	close(s.outgoingStopCh)
	close(s.outgoingCh)

	// Close WebSocket.
	s.conn.Close()
	s.logger.Info("Closed client connection")
}

func (s *sessionWS) Close() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	// Cancel any ongoing operations tied to this session.
	s.ctxCancelFn()

	// Expect the caller of this session.Close() to clean up external resources (like presences) separately.

	// Clean up internals.
	s.pingTimer.Stop()
	close(s.outgoingStopCh)
	close(s.outgoingCh)

	// Send close message.
	err := s.conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(s.writeWaitDuration))
	if err != nil {
		s.logger.Warn("Could not send close message, closing prematurely", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
	}

	// Close WebSocket.
	s.conn.Close()
	s.logger.Info("Closed client connection")
}
