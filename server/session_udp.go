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
	"github.com/satori/go.uuid"

	"github.com/wirepair/netcode"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type udpSession struct {
	sync.Mutex
	logger           *zap.Logger
	config           Config
	id               uuid.UUID
	userID           uuid.UUID
	handle           *atomic.String
	lang             string
	expiry           int64
	stopped          bool
	pingTicker       *time.Ticker
	pingTickerStopCh chan (bool)
	unregister       func(s session)

	server     *netcode.Server
	serverTime float64
}

// NewUDPSession creates a new session which encapsulates a UDP connection
func NewUDPSession(server *netcode.Server, logger *zap.Logger, config Config, userID uuid.UUID, handle string, lang string, expiry int64, unregister func(s session)) session {
	sessionID := uuid.NewV4()
	sessionLogger := logger.With(zap.String("uid", userID.String()), zap.String("sid", sessionID.String()))

	sessionLogger.Debug("New UDP session connected")

	return &udpSession{
		logger:           sessionLogger,
		config:           config,
		id:               sessionID,
		userID:           userID,
		handle:           atomic.NewString(handle),
		lang:             lang,
		expiry:           expiry,
		stopped:          false,
		pingTicker:       time.NewTicker(time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond),
		pingTickerStopCh: make(chan bool),
		unregister:       unregister,
		server:           server,
		serverTime:       0,
	}
}

func (s *udpSession) Logger() *zap.Logger {
	return s.logger
}

func (s *udpSession) ID() uuid.UUID {
	return s.id
}

func (s *udpSession) UserID() uuid.UUID {
	return s.userID
}

func (s *udpSession) Handle() string {
	return s.handle.Load()
}

func (s *udpSession) SetHandle(handle string) {
	s.handle.Store(handle)
}

func (s *udpSession) Lang() string {
	return s.lang
}

func (s *udpSession) Expiry() int64 {
	return s.expiry
}

func (s *udpSession) Consume(processRequest func(logger *zap.Logger, session session, envelope *Envelope)) {
	defer s.cleanupClosedConnection()
	//s.conn.SetReadLimit(s.config.GetSocket().MaxMessageSizeBytes)
	//s.conn.SetReadDeadline(time.Now().Add(time.Duration(s.config.GetSocket().PongWaitMs) * time.Millisecond))
	//s.conn.SetPongHandler(func(string) error {
	//	s.conn.SetReadDeadline(time.Now().Add(time.Duration(s.config.GetSocket().PongWaitMs) * time.Millisecond))
	//	return nil
	//})

	// Send an initial ping immediately, then at intervals.
	s.pingNow()
	go s.pingPeriodically()

	var t float64
	for {
		if err := s.server.Update(t); err != nil {
			s.logger.Error("UDP server update error", zap.Error(err))
			time.Sleep(time.Duration(5 * time.Millisecond))
			continue
		}
		t += 1

		data, _ := s.server.RecvPayload(0)
		//_, data, err := s.conn.ReadMessage()
		//if err != nil {
		//	if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
		//		s.logger.Warn("Error reading message from client", zap.Error(err))
		//	}
		//	break
		//}
		if len(data) == 0 {
			time.Sleep(time.Duration(5 * time.Millisecond))
			continue
		}

		request := &Envelope{}
		err := proto.Unmarshal(data, request)
		if err != nil {
			s.logger.Warn("Received malformed payload", zap.Any("data", data))
			s.Send(ErrorMessage(request.CollationId, UNRECOGNIZED_PAYLOAD, "Unrecognized payload"))
		} else {
			// TODO Add session-global context here to cancel in-progress operations when the session is closed.
			requestLogger := s.logger.With(zap.String("cid", request.CollationId))
			processRequest(requestLogger, s, request)
		}
	}
}

func (s *udpSession) Unregister() {
	s.unregister(s)
}

func (s *udpSession) pingPeriodically() {
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

func (s *udpSession) pingNow() bool {
	//s.Lock()
	//if s.stopped {
	//	s.Unlock()
	//	return false
	//}
	//s.conn.SetWriteDeadline(time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs) * time.Millisecond))
	//err := s.conn.WriteMessage(websocket.PingMessage, []byte{})
	//s.Unlock()
	//if err != nil {
	//	s.logger.Warn("Could not send ping. Closing channel", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
	//	s.cleanupClosedConnection() // The connection has already failed
	//	return false
	//}

	// Server heartbeat.
	err := s.Send(&Envelope{Payload: &Envelope_Heartbeat{&Heartbeat{Timestamp: nowMs()}}})
	if err != nil {
		//s.logger.Warn("Could not send heartbeat", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
		s.logger.Warn("Could not send heartbeat", zap.String("remoteAddress", "test"), zap.Error(err))
	}

	return true
}

func (s *udpSession) Send(envelope *Envelope) error {
	s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Payload), zap.String("cid", envelope.CollationId))

	payload, err := proto.Marshal(envelope)

	if err != nil {
		s.logger.Warn("Could not marshall Response to byte[]", zap.Error(err))
		return err
	}

	return s.SendBytes(payload)
}

func (s *udpSession) SendBytes(payload []byte) error {
	// TODO Improve on mutex usage here.
	s.Lock()
	defer s.Unlock()
	if s.stopped {
		return nil
	}

	//s.conn.SetWriteDeadline(time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs) * time.Millisecond))
	//err := s.conn.WriteMessage(websocket.BinaryMessage, payload)
	//if err != nil {
	//	s.logger.Warn("Could not write message", zap.Error(err))
	//	//TODO investigate whether we need to cleanupClosedConnection if write fails
	//}
	err := s.server.SendPayloadToClient(0, payload, s.serverTime)
	s.serverTime += 1

	return err
}

func (s *udpSession) cleanupClosedConnection() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	//s.logger.Info("Cleaning up closed client connection", zap.String("remoteAddress", s.conn.RemoteAddr().String()))
	s.logger.Info("Cleaning up closed client connection", zap.String("remoteAddress", "test"))
	s.unregister(s)
	s.pingTicker.Stop()
	s.pingTickerStopCh <- true
	//s.conn.Close()
	s.logger.Info("Closed client connection")
}

func (s *udpSession) Close() {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return
	}
	s.stopped = true
	s.Unlock()

	s.pingTicker.Stop()
	s.pingTickerStopCh <- true
	//err := s.conn.WriteControl(websocket.CloseMessage, []byte{}, time.Now().Add(time.Duration(s.config.GetSocket().WriteWaitMs)*time.Millisecond))
	//if err != nil {
	//	s.logger.Warn("Could not send close message. Closing prematurely.", zap.String("remoteAddress", s.conn.RemoteAddr().String()), zap.Error(err))
	//}
	//s.conn.Close()
	s.logger.Info("Closed client connection")
}
