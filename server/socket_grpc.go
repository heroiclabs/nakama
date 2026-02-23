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
	"strconv"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// Realtime opens a bidirectional gRPC stream using the same Envelope protocol as the WebSocket endpoint.
func (s *ApiServer) Realtime(stream apigrpc.Nakama_RealtimeServer) error {
	// Extract token from gRPC incoming metadata.
	md, ok := metadata.FromIncomingContext(stream.Context())
	if !ok {
		return status.Error(codes.Unauthenticated, "Missing or invalid token")
	}

	var token string
	if auths := md.Get("authorization"); len(auths) >= 1 {
		token = auths[0]
	} else if tokens := md.Get("token"); len(tokens) >= 1 {
		// Support bare token in "token" metadata key as a convenience.
		token = "Bearer " + tokens[0]
	}
	if token == "" {
		return status.Error(codes.Unauthenticated, "Missing or invalid token")
	}

	userID, username, vars, expiry, tokenId, issuedAt, tokenOk := parseBearerAuth([]byte(s.config.GetSession().EncryptionKey), token)
	if !tokenOk || !s.sessionCache.IsValidSession(userID, expiry, tokenId) {
		return status.Error(codes.Unauthenticated, "Missing or invalid token")
	}

	// Extract lang from metadata; default to "en".
	lang := "en"
	if langs := md.Get("lang"); len(langs) > 0 && langs[0] != "" {
		lang = langs[0]
	}

	// Extract status tracking flag from metadata.
	var publishStatus bool
	if statusVals := md.Get("status"); len(statusVals) > 0 {
		publishStatus, _ = strconv.ParseBool(statusVals[0])
	}

	// Extract client IP and port from stream context.
	clientIP, clientPort := extractClientAddressFromContext(s.logger, stream.Context())

	// Generate a unique session ID.
	sessionID := uuid.Must(s.sessionIdGen.NewV1())

	// Mark the start of the session.
	s.metrics.CountWebsocketOpened(1)

	format := SessionFormatProtobuf

	// Construct the gRPC session.
	session := NewSessionGRPC(s.logger, s.config, sessionID, userID, username, tokenId,
		vars, expiry, issuedAt, clientIP, clientPort, lang,
		stream, s.sessionRegistry, s.statusRegistry, s.matchmaker,
		s.tracker, s.metrics, s.pipeline, s.runtime)

	// Add to the session registry.
	s.sessionRegistry.Add(session)

	// Register initial status tracking and presence for this session.
	s.statusRegistry.Follow(sessionID, map[uuid.UUID]struct{}{userID: {}})
	if publishStatus {
		// Both notification and status presence.
		s.tracker.TrackMulti(session.Context(), sessionID, []*TrackerOp{
			{
				Stream: PresenceStream{Mode: StreamModeNotifications, Subject: userID},
				Meta:   PresenceMeta{Format: format, Username: username, Hidden: true},
			},
			{
				Stream: PresenceStream{Mode: StreamModeStatus, Subject: userID},
				Meta:   PresenceMeta{Format: format, Username: username, Status: ""},
			},
		}, userID)
	} else {
		// Only notification presence.
		s.tracker.Track(session.Context(), sessionID, PresenceStream{Mode: StreamModeNotifications, Subject: userID}, userID, PresenceMeta{Format: format, Username: username, Hidden: true})
	}

	if s.config.GetSession().SingleSocket {
		// Kick any other sessions for this user.
		go s.sessionRegistry.SingleSession(session.Context(), s.tracker, userID, sessionID)
	}

	// Block until the stream ends.
	session.Consume()

	// Mark the end of the session.
	s.metrics.CountWebsocketClosed(1)

	return nil
}
