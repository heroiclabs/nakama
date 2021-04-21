// Copyright 2021 The Nakama Authors
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
	"sync"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type statusEvent struct {
	userID uuid.UUID
	joins  []*rtapi.UserPresence
	leaves []*rtapi.UserPresence
}

type StatusRegistry struct {
	sync.RWMutex
	logger             *zap.Logger
	sessionRegistry    SessionRegistry
	protojsonMarshaler *protojson.MarshalOptions

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	eventsCh  chan *statusEvent
	bySession map[uuid.UUID]map[uuid.UUID]struct{}
	byUser    map[uuid.UUID]map[uuid.UUID]struct{}
}

func NewStatusRegistry(logger *zap.Logger, config Config, sessionRegistry SessionRegistry, protojsonMarshaler *protojson.MarshalOptions) *StatusRegistry {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	s := &StatusRegistry{
		logger:             logger,
		sessionRegistry:    sessionRegistry,
		protojsonMarshaler: protojsonMarshaler,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		eventsCh:  make(chan *statusEvent, config.GetTracker().EventQueueSize),
		bySession: make(map[uuid.UUID]map[uuid.UUID]struct{}), // session ID to user IDs
		byUser:    make(map[uuid.UUID]map[uuid.UUID]struct{}), // user ID to session IDs
	}

	go func() {
		for {
			select {
			case <-s.ctx.Done():
				return
			case e := <-s.eventsCh:
				s.RLock()
				ids, hasFollowers := s.byUser[e.userID]
				if !hasFollowers {
					s.RUnlock()
					continue
				}
				sessionIDs := make([]uuid.UUID, 0, len(ids))
				for id, _ := range ids {
					sessionIDs = append(sessionIDs, id)
				}
				s.RUnlock()

				// Prepare payload variables but do not initialize until we hit a session that needs them to avoid unnecessary work.
				var payloadProtobuf []byte
				var payloadJSON []byte
				envelope := &rtapi.Envelope{Message: &rtapi.Envelope_StatusPresenceEvent{StatusPresenceEvent: &rtapi.StatusPresenceEvent{
					Joins:  e.joins,
					Leaves: e.leaves,
				}}}

				// Deliver event.
				for _, sessionID := range sessionIDs {
					session := s.sessionRegistry.Get(sessionID)
					if session == nil {
						s.logger.Debug("Could not deliver status event, no session", zap.String("sid", sessionID.String()))
						continue
					}

					var err error
					switch session.Format() {
					case SessionFormatProtobuf:
						if payloadProtobuf == nil {
							// Marshal the payload now that we know this format is needed.
							payloadProtobuf, err = proto.Marshal(envelope)
							if err != nil {
								s.logger.Error("Could not marshal status event", zap.Error(err))
								return
							}
						}
						err = session.SendBytes(payloadProtobuf, true)
					case SessionFormatJson:
						fallthrough
					default:
						if payloadJSON == nil {
							// Marshal the payload now that we know this format is needed.
							if buf, err := s.protojsonMarshaler.Marshal(envelope); err == nil {
								payloadJSON = buf
							} else {
								s.logger.Error("Could not marshal status event", zap.Error(err))
								return
							}
						}
						err = session.SendBytes(payloadJSON, true)
					}
					if err != nil {
						s.logger.Error("Failed to deliver status event", zap.String("sid", sessionID.String()), zap.Error(err))
					}
				}
			}
		}
	}()

	return s
}

func (s *StatusRegistry) Stop() {
	s.ctxCancelFn()
}

func (s *StatusRegistry) Follow(sessionID uuid.UUID, userIDs map[uuid.UUID]struct{}) {
	if len(userIDs) == 0 {
		return
	}

	s.Lock()

	sessionFollows, ok := s.bySession[sessionID]
	if !ok {
		sessionFollows = make(map[uuid.UUID]struct{})
		s.bySession[sessionID] = sessionFollows
	}
	for userID, _ := range userIDs {
		if _, alreadyFollowing := sessionFollows[userID]; alreadyFollowing {
			continue
		}
		sessionFollows[userID] = struct{}{}

		userFollowers, ok := s.byUser[userID]
		if !ok {
			userFollowers = make(map[uuid.UUID]struct{})
			s.byUser[userID] = userFollowers
		}

		if _, alreadyFollowing := userFollowers[sessionID]; alreadyFollowing {
			continue
		}
		userFollowers[sessionID] = struct{}{}
	}

	s.Unlock()
}

func (s *StatusRegistry) Unfollow(sessionID uuid.UUID, userIDs []uuid.UUID) {
	if len(userIDs) == 0 {
		return
	}

	s.Lock()

	sessionFollows, ok := s.bySession[sessionID]
	if !ok {
		s.Unlock()
		return
	}
	for _, userID := range userIDs {
		if _, wasFollowed := sessionFollows[userID]; !wasFollowed {
			// Unfollowing a user that was not followed is a no-op.
			continue
		}

		if userFollowers := s.byUser[userID]; len(userFollowers) == 1 {
			// This was the only follower for that user.
			delete(s.byUser, userID)
		} else {
			// That user had other followers, just drop this one.
			delete(userFollowers, sessionID)
		}

		if len(sessionFollows) == 1 {
			// The session only had this user ID followed.
			delete(s.bySession, sessionID)
			break
		} else {
			// The session is still following other user IDs, just drop this one.
			delete(sessionFollows, userID)
		}
	}

	s.Unlock()
}

func (s *StatusRegistry) UnfollowAll(sessionID uuid.UUID) {
	s.Lock()

	sessionFollows, ok := s.bySession[sessionID]
	if !ok {
		s.Unlock()
		return
	}
	for userID, _ := range sessionFollows {
		if userFollowers := s.byUser[userID]; len(userFollowers) == 1 {
			delete(s.byUser, userID)
		} else {
			delete(userFollowers, sessionID)
		}
	}
	delete(s.bySession, sessionID)

	s.Unlock()
}

func (s *StatusRegistry) Queue(userID uuid.UUID, joins, leaves []*rtapi.UserPresence) {
	s.eventsCh <- &statusEvent{
		userID: userID,
		joins:  joins,
		leaves: leaves,
	}
}
