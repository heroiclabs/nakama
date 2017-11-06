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

	"nakama/pkg/multicode"

	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type udpSession struct {
	sync.Mutex
	logger           *zap.Logger
	config           Config
	id               string
	userID           string
	handle           *atomic.String
	lang             string
	expiry           int64
	stopped          bool
	clientInstance   *multicode.ClientInstance
	pingTicker       *time.Ticker
	pingTickerStopCh chan bool
	unregister       func(s session)
}

// NewUDPSession creates a new session which encapsulates a UDP client instance.
func NewUDPSession(logger *zap.Logger, config Config, userID string, handle string, lang string, expiry int64, clientInstance *multicode.ClientInstance, unregister func(s session)) session {
	sessionID := generateNewId()
	sessionLogger := logger.With(zap.String("uid", userID), zap.String("sid", sessionID))

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
		clientInstance:   clientInstance,
		pingTicker:       time.NewTicker(time.Duration(config.GetSocket().PingPeriodMs) * time.Millisecond),
		pingTickerStopCh: make(chan bool),
		unregister:       unregister,
	}
}

func (s *udpSession) Logger() *zap.Logger {
	return s.logger
}

func (s *udpSession) ID() string {
	return s.id
}

func (s *udpSession) UserID() string {
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

func (s *udpSession) Consume(processRequest func(logger *zap.Logger, session session, envelope *Envelope, reliable bool)) {
	defer s.cleanupClosedConnection()

	// Send an initial ping immediately, then at intervals.
	s.pingNow()
	go s.pingPeriodically()

	for {
		data, reliable, err := s.clientInstance.Read()
		if err != nil {
			// Will happen if client disconnects while Read() is waiting.
			break
		}

		request := &Envelope{}
		err = proto.Unmarshal(data, request)
		if err != nil {
			s.logger.Warn("Received malformed payload", zap.Any("data", data))
			s.Send(ErrorMessage(request.CollationId, UNRECOGNIZED_PAYLOAD, "Unrecognized payload"), reliable)
		} else {
			// TODO Add session-global context here to cancel in-progress operations when the session is closed.
			requestLogger := s.logger.With(zap.String("cid", request.CollationId))
			processRequest(requestLogger, s, request, reliable)
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
	s.Lock()
	if s.stopped {
		s.Unlock()
		return false
	}
	s.Unlock()

	// Server heartbeat.
	err := s.Send(&Envelope{Payload: &Envelope_Heartbeat{&Heartbeat{Timestamp: nowMs()}}}, true)
	if err != nil {
		s.logger.Warn("Could not send heartbeat. Closing channel", zap.String("remoteAddress", s.clientInstance.Address.String()), zap.Error(err))
		//s.cleanupClosedConnection() // The connection has already failed
		return false
	}

	return true
}

func (s *udpSession) Format() SessionFormat {
	return SessionFormatProtobuf
}

func (s *udpSession) Send(envelope *Envelope, reliable bool) error {
	s.logger.Debug(fmt.Sprintf("Sending %T message", envelope.Payload), zap.String("cid", envelope.CollationId))

	payload, err := proto.Marshal(envelope)
	if err != nil {
		s.logger.Warn("Could not marshall Response to byte[]", zap.Error(err))
		return err
	}

	return s.SendBytes(payload, reliable)
}

func (s *udpSession) SendBytes(payload []byte, reliable bool) error {
	s.Lock()
	if s.stopped {
		s.Unlock()
		return nil
	}
	s.Unlock()

	// Send(...) is expected to be concurrency-safe so no need to lock here.
	err := s.clientInstance.Send(payload, reliable)
	if err != nil {
		s.logger.Warn("Could not write message", zap.Error(err))
	}

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

	s.logger.Debug("Cleaning up closed client connection", zap.String("remoteAddress", s.clientInstance.Address.String()))
	s.unregister(s)
	s.pingTicker.Stop()
	close(s.pingTickerStopCh)
	s.clientInstance.Close(false)
	s.logger.Debug("Closed client connection")
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
	close(s.pingTickerStopCh)
	s.clientInstance.Close(true)
	s.logger.Debug("Closed client connection")
}
