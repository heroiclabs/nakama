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
	"time"

	"github.com/gofrs/uuid/v5"
)

type SessionCache interface {
	Stop()

	// Check if a given user, expiry, and session token combination is valid.
	IsValidSession(userID uuid.UUID, exp int64, tokenId string) bool
	// Check if a given user, expiry, and refresh token combination is valid.
	IsValidRefresh(userID uuid.UUID, exp int64, tokenId string) bool
	// Add a valid session and/or refresh token for a given user.
	Add(userID uuid.UUID, sessionExp int64, sessionTokenId string, refreshExp int64, refreshTokenId string)
	// Remove a session and/or refresh token for a given user.
	Remove(userID uuid.UUID, sessionExp int64, sessionTokenId string, refreshExp int64, refreshTokenId string)
	// Remove all of a user's session and refresh tokens.
	RemoveAll(userID uuid.UUID)
	// Mark a set of users as banned.
	Ban(userIDs []uuid.UUID)
	// Unban a set of users.
	Unban(userIDs []uuid.UUID)
}

type sessionCacheUser struct {
	lastInvalidation int64
	sessionTokens    map[string]int64
	refreshTokens    map[string]int64
}

type LocalSessionCache struct {
	sync.RWMutex

	tokenExpirySec        int64
	refreshTokenExpirySec int64

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	cache map[uuid.UUID]*sessionCacheUser
}

func NewLocalSessionCache(tokenExpirySec, refreshTokenExpirySec int64) SessionCache {
	ctx, ctxCancelFn := context.WithCancel(context.Background())

	s := &LocalSessionCache{
		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		tokenExpirySec:        tokenExpirySec,
		refreshTokenExpirySec: refreshTokenExpirySec,

		cache: make(map[uuid.UUID]*sessionCacheUser),
	}

	go func() {
		ticker := time.NewTicker(2 * time.Duration(tokenExpirySec) * time.Second)
		for {
			select {
			case <-s.ctx.Done():
				ticker.Stop()
				return
			case t := <-ticker.C:
				ts := t.UTC().Unix()
				s.Lock()
				for userID, cache := range s.cache {
					for token, exp := range cache.sessionTokens {
						if exp <= ts {
							delete(cache.sessionTokens, token)
						}
					}
					for token, exp := range cache.refreshTokens {
						if exp <= ts {
							delete(cache.refreshTokens, token)
						}
					}
					if len(cache.sessionTokens) == 0 && len(cache.refreshTokens) == 0 && (cache.lastInvalidation == 0 || (cache.lastInvalidation < ts-tokenExpirySec && cache.lastInvalidation < ts-refreshTokenExpirySec)) {
						delete(s.cache, userID)
					}
				}
				s.Unlock()
			}
		}
	}()

	return s
}

func (s *LocalSessionCache) Stop() {
	s.ctxCancelFn()
}

func (s *LocalSessionCache) IsValidSession(userID uuid.UUID, exp int64, tokenId string) bool {
	s.RLock()
	cache, found := s.cache[userID]
	if !found {
		// There are no invalidated records for this user, any session token is valid if it passed other JWT checks.
		s.RUnlock()
		return true
	}
	if cache.lastInvalidation > 0 && exp-s.tokenExpirySec < cache.lastInvalidation {
		// The user has a full invalidation recorded, and this token's expiry indicates it was issued before this point.
		s.RUnlock()
		return false
	}
	if _, isInvalidated := cache.sessionTokens[tokenId]; isInvalidated {
		// This token ID has been invalidated.
		s.RUnlock()
		return false
	}
	s.RUnlock()
	return true
}

func (s *LocalSessionCache) IsValidRefresh(userID uuid.UUID, exp int64, tokenId string) bool {
	s.RLock()
	cache, found := s.cache[userID]
	if !found {
		// There are no invalidated records for this user, any refresh token is valid if it passed other JWT checks.
		s.RUnlock()
		return true
	}
	if cache.lastInvalidation > 0 && exp-s.refreshTokenExpirySec < cache.lastInvalidation {
		// The user has a full invalidation recorded, and this token's expiry indicates it was issued before this point.
		s.RUnlock()
		return false
	}
	if _, isInvalidated := cache.refreshTokens[tokenId]; isInvalidated {
		// This token ID has been invalidated.
		s.RUnlock()
		return false
	}
	s.RUnlock()
	return true
}

func (s *LocalSessionCache) Add(userID uuid.UUID, sessionExp int64, tokenId string, refreshExp int64, refreshTokenId string) {
	// No-op, blacklist only.
}

func (s *LocalSessionCache) Remove(userID uuid.UUID, sessionExp int64, sessionTokenId string, refreshExp int64, refreshTokenId string) {
	s.Lock()
	cache, found := s.cache[userID]
	if !found {
		cache = &sessionCacheUser{
			lastInvalidation: 0,
			sessionTokens:    make(map[string]int64),
			refreshTokens:    make(map[string]int64),
		}
		s.cache[userID] = cache
	}
	if sessionTokenId != "" {
		cache.sessionTokens[sessionTokenId] = sessionExp + 1
	}
	if refreshTokenId != "" {
		cache.refreshTokens[refreshTokenId] = refreshExp + 1
	}
	s.Unlock()
}

func (s *LocalSessionCache) RemoveAll(userID uuid.UUID) {
	ts := time.Now().UTC().Unix()

	s.Lock()
	cache, found := s.cache[userID]
	if !found {
		cache = &sessionCacheUser{
			lastInvalidation: 0,
			sessionTokens:    make(map[string]int64),
			refreshTokens:    make(map[string]int64),
		}
		s.cache[userID] = cache
	}
	if ts > cache.lastInvalidation {
		cache.lastInvalidation = ts
		cache.sessionTokens = make(map[string]int64)
		cache.refreshTokens = make(map[string]int64)
	}
	s.Unlock()
}

func (s *LocalSessionCache) Ban(userIDs []uuid.UUID) {
	ts := time.Now().UTC().Unix()

	s.Lock()
	for _, userID := range userIDs {
		cache, found := s.cache[userID]
		if !found {
			cache = &sessionCacheUser{
				lastInvalidation: 0,
				sessionTokens:    make(map[string]int64),
				refreshTokens:    make(map[string]int64),
			}
			s.cache[userID] = cache
		}
		if ts > cache.lastInvalidation {
			cache.lastInvalidation = ts
		}
	}
	s.Unlock()
}

func (s *LocalSessionCache) Unban(userIDs []uuid.UUID) {}
