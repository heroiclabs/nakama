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
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/proto"
	"github.com/heroiclabs/nakama/rtapi"
	"go.uber.org/zap"
)

// Deferred message expected to be batched with other deferred messages.
// All deferred messages in a batch are expected to be for the same stream/mode and share a logger context.
type DeferredMessage struct {
	PresenceIDs []*PresenceID
	Envelope    *rtapi.Envelope
}

// MessageRouter is responsible for sending a message to a list of presences or to an entire stream.
type MessageRouter interface {
	SendToPresenceIDs(*zap.Logger, []*PresenceID, bool, uint8, *rtapi.Envelope)
	SendToStream(*zap.Logger, PresenceStream, *rtapi.Envelope)
	SendDeferred(*zap.Logger, bool, uint8, []*DeferredMessage)
}

type LocalMessageRouter struct {
	jsonpbMarshaler *jsonpb.Marshaler
	sessionRegistry SessionRegistry
	tracker         Tracker
}

func NewLocalMessageRouter(sessionRegistry SessionRegistry, tracker Tracker, jsonpbMarshaler *jsonpb.Marshaler) MessageRouter {
	return &LocalMessageRouter{
		jsonpbMarshaler: jsonpbMarshaler,
		sessionRegistry: sessionRegistry,
		tracker:         tracker,
	}
}

func (r *LocalMessageRouter) SendToPresenceIDs(logger *zap.Logger, presenceIDs []*PresenceID, isStream bool, mode uint8, envelope *rtapi.Envelope) {
	if len(presenceIDs) == 0 {
		return
	}

	// Prepare payload variables but do not initialize until we hit a session that needs them to avoid unnecessary work.
	var payloadProtobuf []byte
	var payloadJson []byte

	for _, presenceID := range presenceIDs {
		session := r.sessionRegistry.Get(presenceID.SessionID)
		if session == nil {
			logger.Debug("No session to route to", zap.String("sid", presenceID.SessionID.String()))
			continue
		}

		var err error
		switch session.Format() {
		case SessionFormatProtobuf:
			if payloadProtobuf == nil {
				// Marshal the payload now that we know this format is needed.
				payloadProtobuf, err = proto.Marshal(envelope)
				if err != nil {
					logger.Error("Could not marshal message", zap.Error(err))
					return
				}
			}
			err = session.SendBytes(isStream, mode, payloadProtobuf)
		case SessionFormatJson:
			fallthrough
		default:
			if payloadJson == nil {
				// Marshal the payload now that we know this format is needed.
				var buf bytes.Buffer
				if err = r.jsonpbMarshaler.Marshal(&buf, envelope); err == nil {
					payloadJson = buf.Bytes()
				} else {
					logger.Error("Could not marshal message", zap.Error(err))
					return
				}
			}
			err = session.SendBytes(isStream, mode, payloadJson)
		}
		if err != nil {
			logger.Error("Failed to route message", zap.String("sid", presenceID.SessionID.String()), zap.Error(err))
		}
	}
}

func (r *LocalMessageRouter) SendToStream(logger *zap.Logger, stream PresenceStream, envelope *rtapi.Envelope) {
	presenceIDs := r.tracker.ListPresenceIDByStream(stream)
	r.SendToPresenceIDs(logger, presenceIDs, true, stream.Mode, envelope)
}

func (r *LocalMessageRouter) SendDeferred(logger *zap.Logger, isStream bool, mode uint8, messages []*DeferredMessage) {
	for _, message := range messages {
		r.SendToPresenceIDs(logger, message.PresenceIDs, isStream, mode, message.Envelope)
	}
}
