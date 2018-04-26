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
	"net/http"

	"github.com/golang/protobuf/jsonpb"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

func NewSocketWsAcceptor(logger *zap.Logger, config Config, sessionRegistry *SessionRegistry, matchmaker Matchmaker, tracker Tracker, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, pipeline *Pipeline) func(http.ResponseWriter, *http.Request) {
	upgrader := &websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}

	// This handler will be attached to the API Gateway server.
	return func(w http.ResponseWriter, r *http.Request) {
		// Check authentication.
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "Missing or invalid token", 401)
			return
		}
		userID, username, expiry, ok := parseToken([]byte(config.GetSession().EncryptionKey), token)
		if !ok {
			http.Error(w, "Missing or invalid token", 401)
			return
		}

		// Upgrade to WebSocket.
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			// http.Error is invoked automatically from within the Upgrade function.
			logger.Warn("Could not upgrade to WebSocket", zap.Error(err))
			return
		}

		// Wrap the connection for application handling.
		s := NewSessionWS(logger, config, userID, username, expiry, jsonpbMarshaler, jsonpbUnmarshaler, conn, sessionRegistry, matchmaker, tracker)

		// Add to the session registry.
		sessionRegistry.add(s)

		// Register initial presences for this session.
		tracker.Track(s.ID(), PresenceStream{Mode: StreamModeNotifications, Subject: s.UserID()}, s.UserID(), PresenceMeta{Format: s.Format(), Username: s.Username(), Hidden: true}, true)

		// Allow the server to begin processing incoming messages from this session.
		s.Consume(pipeline.ProcessRequest)
	}
}
