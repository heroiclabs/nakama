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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
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

var _ StatusRegistry = (*LocalStatusRegistry)(nil)

type StatusRegistry interface {
	Stop()
	Follow(sessionID uuid.UUID, userIDs map[uuid.UUID]struct{})
	Unfollow(sessionID uuid.UUID, userIDs []uuid.UUID)
	UnfollowAll(sessionID uuid.UUID)
	IsOnline(userID uuid.UUID) bool
	FillOnlineUsers(users []*api.User)
	FillOnlineAccounts(accounts []*api.Account)
	FillOnlineFriends(friends []*api.Friend)
	FillOnlineGroupUsers(groupUsers []*api.GroupUserList_GroupUser)
	Queue(userID uuid.UUID, joins, leaves []*rtapi.UserPresence)
}

type LocalStatusRegistry struct {
	sync.RWMutex
	logger             *zap.Logger
	sessionRegistry    SessionRegistry
	protojsonMarshaler *protojson.MarshalOptions

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	eventsCh  chan *statusEvent
	bySession map[uuid.UUID]map[uuid.UUID]struct{}
	byUser    map[uuid.UUID]map[uuid.UUID]struct{}

	onlineMutex *sync.RWMutex
	onlineCache map[uuid.UUID]map[string]struct{}
}

func NewLocalStatusRegistry(logger *zap.Logger, config Config, sessionRegistry SessionRegistry, protojsonMarshaler *protojson.MarshalOptions) StatusRegistry {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	s := &LocalStatusRegistry{
		logger:             logger,
		sessionRegistry:    sessionRegistry,
		protojsonMarshaler: protojsonMarshaler,

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		eventsCh:  make(chan *statusEvent, config.GetTracker().EventQueueSize),
		bySession: make(map[uuid.UUID]map[uuid.UUID]struct{}), // Session ID to user IDs they follow.
		byUser:    make(map[uuid.UUID]map[uuid.UUID]struct{}), // User ID to session IDs that follow them.

		onlineMutex: &sync.RWMutex{},
		onlineCache: make(map[uuid.UUID]map[string]struct{}), // User ID to their own session IDs they have a status on.
	}

	go func() {
		for {
			select {
			case <-s.ctx.Done():
				return
			case e := <-s.eventsCh:
				// Track overall user online status.
				s.onlineMutex.Lock()
				existing, found := s.onlineCache[e.userID]
				for _, leave := range e.leaves {
					if !found {
						continue
					}
					delete(existing, leave.SessionId)
				}
				for _, join := range e.joins {
					if !found {
						existing = make(map[string]struct{}, 1)
						s.onlineCache[e.userID] = existing
						found = true
					}
					existing[join.SessionId] = struct{}{}
				}
				if found && len(existing) == 0 {
					delete(s.onlineCache, e.userID)
				}
				s.onlineMutex.Unlock()

				// Process status update if the user has any followers.
				s.RLock()
				ids, hasFollowers := s.byUser[e.userID]
				if !hasFollowers {
					s.RUnlock()
					continue
				}
				sessionIDs := make([]uuid.UUID, 0, len(ids))
				for id := range ids {
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

func (s *LocalStatusRegistry) Stop() {
	s.ctxCancelFn()
}

func (s *LocalStatusRegistry) Follow(sessionID uuid.UUID, userIDs map[uuid.UUID]struct{}) {
	if len(userIDs) == 0 {
		return
	}

	s.Lock()

	sessionFollows, ok := s.bySession[sessionID]
	if !ok {
		sessionFollows = make(map[uuid.UUID]struct{})
		s.bySession[sessionID] = sessionFollows
	}
	for userID := range userIDs {
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

func (s *LocalStatusRegistry) Unfollow(sessionID uuid.UUID, userIDs []uuid.UUID) {
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

func (s *LocalStatusRegistry) UnfollowAll(sessionID uuid.UUID) {
	s.Lock()

	sessionFollows, ok := s.bySession[sessionID]
	if !ok {
		s.Unlock()
		return
	}
	for userID := range sessionFollows {
		if userFollowers := s.byUser[userID]; len(userFollowers) == 1 {
			delete(s.byUser, userID)
		} else {
			delete(userFollowers, sessionID)
		}
	}
	delete(s.bySession, sessionID)

	s.Unlock()
}

func (s *LocalStatusRegistry) IsOnline(userID uuid.UUID) bool {
	s.onlineMutex.RLock()
	_, found := s.onlineCache[userID]
	s.onlineMutex.RUnlock()
	return found
}

func (s *LocalStatusRegistry) FillOnlineUsers(users []*api.User) {
	if len(users) == 0 {
		return
	}

	s.onlineMutex.RLock()
	for _, user := range users {
		_, found := s.onlineCache[uuid.FromStringOrNil(user.Id)]
		user.Online = found
	}
	s.onlineMutex.RUnlock()
}

func (s *LocalStatusRegistry) FillOnlineAccounts(accounts []*api.Account) {
	if len(accounts) == 0 {
		return
	}

	s.onlineMutex.RLock()
	for _, account := range accounts {
		_, found := s.onlineCache[uuid.FromStringOrNil(account.User.Id)]
		account.User.Online = found
	}
	s.onlineMutex.RUnlock()
}

func (s *LocalStatusRegistry) FillOnlineFriends(friends []*api.Friend) {
	if len(friends) == 0 {
		return
	}

	s.onlineMutex.RLock()
	for _, friend := range friends {
		_, found := s.onlineCache[uuid.FromStringOrNil(friend.User.Id)]
		friend.User.Online = found
	}
	s.onlineMutex.RUnlock()
}

func (s *LocalStatusRegistry) FillOnlineGroupUsers(groupUsers []*api.GroupUserList_GroupUser) {
	if len(groupUsers) == 0 {
		return
	}

	s.onlineMutex.RLock()
	for _, groupUser := range groupUsers {
		_, found := s.onlineCache[uuid.FromStringOrNil(groupUser.User.Id)]
		groupUser.User.Online = found
	}
	s.onlineMutex.RUnlock()
}

func (s *LocalStatusRegistry) Queue(userID uuid.UUID, joins, leaves []*rtapi.UserPresence) {
	s.eventsCh <- &statusEvent{
		userID: userID,
		joins:  joins,
		leaves: leaves,
	}
}
