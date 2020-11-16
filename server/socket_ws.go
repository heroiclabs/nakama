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
	"net"
	"net/http"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

func NewSocketWsAcceptor(logger *zap.Logger, config Config, sessionRegistry SessionRegistry, matchmaker Matchmaker, tracker Tracker, metrics *Metrics, runtime *Runtime, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, pipeline *Pipeline) func(http.ResponseWriter, *http.Request) {
	upgrader := &websocket.Upgrader{
		ReadBufferSize:  config.GetSocket().ReadBufferSizeBytes,
		WriteBufferSize: config.GetSocket().WriteBufferSizeBytes,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}

	sessionIdGen := uuid.NewGenWithHWAF(func() (net.HardwareAddr, error) {
		hash := NodeToHash(config.GetName())
		return hash[:], nil
	})

	// This handler will be attached to the API Gateway server.
	return func(w http.ResponseWriter, r *http.Request) {
		// Check format.
		var format SessionFormat
		switch r.URL.Query().Get("format") {
		case "protobuf":
			format = SessionFormatProtobuf
		case "json":
			fallthrough
		case "":
			format = SessionFormatJson
		default:
			// Invalid values are rejected.
			http.Error(w, "Invalid format parameter", 400)
			return
		}

		// Check authentication.
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "Missing or invalid token", 401)
			return
		}
		userID, username, vars, expiry, ok := parseToken([]byte(config.GetSession().EncryptionKey), token)
		if !ok {
			http.Error(w, "Missing or invalid token", 401)
			return
		}

		clientIP, clientPort := extractClientAddressFromRequest(logger, r)

		status := false
		if r.URL.Query().Get("status") == "true" {
			status = true
		}

		// Upgrade to WebSocket.
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			// http.Error is invoked automatically from within the Upgrade function.
			logger.Warn("Could not upgrade to WebSocket", zap.Error(err))
			return
		}

		sessionID := uuid.Must(sessionIdGen.NewV1())

		// Mark the start of the session.
		metrics.CountWebsocketOpened(1)

		// Wrap the connection for application handling.
		session := NewSessionWS(logger, config, format, sessionID, userID, username, vars, expiry, clientIP, clientPort, jsonpbMarshaler, jsonpbUnmarshaler, conn, sessionRegistry, matchmaker, tracker, metrics, pipeline, runtime)

		// Add to the session registry.
		sessionRegistry.Add(session)

		// Register initial presences for this session.
		tracker.Track(session.ID(), PresenceStream{Mode: StreamModeNotifications, Subject: session.UserID()}, session.UserID(), PresenceMeta{Format: session.Format(), Username: session.Username(), Hidden: true}, true)
		if status {
			tracker.Track(session.ID(), PresenceStream{Mode: StreamModeStatus, Subject: session.UserID()}, session.UserID(), PresenceMeta{Format: session.Format(), Username: session.Username(), Status: ""}, false)
		}

		// Allow the server to begin processing incoming messages from this session.
		session.Consume()

		// Mark the end of the session.
		metrics.CountWebsocketClosed(1)
	}
}
