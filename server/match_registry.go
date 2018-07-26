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
	"database/sql"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/social"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"sync"
	"time"
)

var (
	MatchFilterValue = uint8(0)
	MatchFilterPtr   = &MatchFilterValue

	MatchFilterAny           = map[uint8]*uint8{StreamModeMatchRelayed: MatchFilterPtr, StreamModeMatchAuthoritative: MatchFilterPtr}
	MatchFilterRelayed       = map[uint8]*uint8{StreamModeMatchRelayed: MatchFilterPtr}
	MatchFilterAuthoritative = map[uint8]*uint8{StreamModeMatchAuthoritative: MatchFilterPtr}
)

type MatchPresence struct {
	Node      string
	UserID    uuid.UUID
	SessionID uuid.UUID
	Username  string
}

type MatchJoinResult struct {
	Allow  bool
	Reason string
	Label  string
}

type MatchRegistry interface {
	// Create and start a new match, given a Lua module name.
	NewMatch(name string, params interface{}) (*MatchHandler, error)
	// Return a match handler by ID, only from the local node.
	GetMatch(id uuid.UUID) *MatchHandler
	// Remove a tracked match and ensure all its presences are cleaned up.
	// Does not ensure the match process itself is no longer running, that must be handled separately.
	RemoveMatch(id uuid.UUID, stream PresenceStream)
	// List (and optionally filter) currently running matches.
	// This can list across both authoritative and relayed matches.
	ListMatches(limit int, authoritative *wrappers.BoolValue, label *wrappers.StringValue, minSize *wrappers.Int32Value, maxSize *wrappers.Int32Value) []*api.Match
	// Stop the match registry and close all matches it's tracking.
	Stop()

	// Pass a user join attempt to a match handler. Returns if the match was found, if the join was accepted, a reason for any rejection, and the match label.
	JoinAttempt(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string) (bool, bool, string, string)
	// Notify a match handler that one or more users have successfully joined the match.
	// Expects that the caller has already determined the match is hosted on the current node.
	Join(id uuid.UUID, presences []*MatchPresence)
	// Notify a match handler that one or more users have left or disconnected.
	// Expects that the caller has already determined the match is hosted on the current node.
	Leave(id uuid.UUID, presences []*MatchPresence)
	// Called by match handlers to request the removal fo a match participant.
	Kick(stream PresenceStream, presences []*MatchPresence)
	// Pass a data payload (usually from a user) to the appropriate match handler.
	// Assumes that the data sender has already been validated as a match participant before this call.
	SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, receiveTime int64)
}

type LocalMatchRegistry struct {
	sync.RWMutex
	logger           *zap.Logger
	db               *sql.DB
	config           Config
	socialClient     *social.Client
	leaderboardCache LeaderboardCache
	sessionRegistry  *SessionRegistry
	tracker          Tracker
	router           MessageRouter
	stdLibs          map[string]lua.LGFunction
	modules          *sync.Map
	once             *sync.Once
	node             string
	matches          map[uuid.UUID]*MatchHandler
}

func NewLocalMatchRegistry(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, sessionRegistry *SessionRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, once *sync.Once, node string) MatchRegistry {
	return &LocalMatchRegistry{
		logger:           logger,
		db:               db,
		config:           config,
		socialClient:     socialClient,
		leaderboardCache: leaderboardCache,
		sessionRegistry:  sessionRegistry,
		tracker:          tracker,
		router:           router,
		stdLibs:          stdLibs,
		once:             once,
		node:             node,
		matches:          make(map[uuid.UUID]*MatchHandler),
	}
}

func (r *LocalMatchRegistry) NewMatch(name string, params interface{}) (*MatchHandler, error) {
	id := uuid.Must(uuid.NewV4())
	match, err := NewMatchHandler(r.logger, r.db, r.config, r.socialClient, r.leaderboardCache, r.sessionRegistry, r, r.tracker, r.router, r.stdLibs, r.once, id, r.node, name, params)
	if err != nil {
		return nil, err
	}
	r.Lock()
	r.matches[id] = match
	r.Unlock()
	return match, nil
}

func (r *LocalMatchRegistry) GetMatch(id uuid.UUID) *MatchHandler {
	var mh *MatchHandler
	r.RLock()
	mh = r.matches[id]
	r.RUnlock()
	return mh
}

func (r *LocalMatchRegistry) RemoveMatch(id uuid.UUID, stream PresenceStream) {
	r.Lock()
	delete(r.matches, id)
	r.Unlock()
	r.tracker.UntrackByStream(stream)
}

func (r *LocalMatchRegistry) ListMatches(limit int, authoritative *wrappers.BoolValue, label *wrappers.StringValue, minSize *wrappers.Int32Value, maxSize *wrappers.Int32Value) []*api.Match {
	var modes map[uint8]*uint8
	if authoritative == nil {
		modes = MatchFilterAny
	} else if authoritative.Value {
		modes = MatchFilterAuthoritative
	} else {
		modes = MatchFilterRelayed
	}

	// Initial list of candidate matches.
	matches := r.tracker.CountByStreamModeFilter(modes)

	// Results.
	results := make([]*api.Match, 0, limit)

	// Track authoritative matches that have been checked already, if authoritative results are allowed.
	var checked map[uuid.UUID]struct{}
	if authoritative == nil || authoritative.Value {
		checked = make(map[uuid.UUID]struct{})
	}

	// Maybe filter by label.
	for stream, size := range matches {
		if stream.Mode == StreamModeMatchRelayed {
			if label != nil {
				// Any label filter fails for relayed matches.
				continue
			}
			if minSize != nil && minSize.Value > size {
				// Too few users.
				continue
			}
			if maxSize != nil && maxSize.Value < size {
				// Too many users.
				continue
			}

			matchID := fmt.Sprintf("%v.", stream.Subject.String())
			results = append(results, &api.Match{
				MatchId:       matchID,
				Authoritative: false,
				// No label.
				Size: size,
			})
			if len(results) == limit {
				break
			}
		} else if stream.Mode == StreamModeMatchAuthoritative {
			// Authoritative matches that have already been checked.
			checked[stream.Subject] = struct{}{}

			if minSize != nil && minSize.Value > size {
				// Too few users.
				continue
			}
			if maxSize != nil && maxSize.Value < size {
				// Too many users.
				continue
			}

			mh := r.GetMatch(stream.Subject)
			if mh == nil {
				continue
			}
			mhLabel := mh.Label.Load()
			if label != nil && label.Value != mhLabel {
				continue
			}
			results = append(results, &api.Match{
				MatchId:       mh.IDStr,
				Authoritative: true,
				Label:         &wrappers.StringValue{Value: mhLabel},
				Size:          size,
			})
			if len(results) == limit {
				break
			}
		} else {
			r.logger.Warn("Ignoring unknown stream mode in match listing operation", zap.Uint8("mode", stream.Mode))
		}
	}

	// Return results here if:
	// 1. We have enough results.
	// or
	// 2. Not enough results, but we're not allowed to return potentially empty authoritative matches.
	if len(results) == limit || ((authoritative != nil && !authoritative.Value) || (minSize != nil && minSize.Value > 0)) {
		return results
	}

	// Otherwise look for empty matches to help fulfil the request, but ensure no duplicates.
	r.RLock()
	for _, mh := range r.matches {
		if _, ok := checked[mh.ID]; ok {
			// Already checked and discarded this match for failing a filter, skip it.
			continue
		}
		mhLabel := mh.Label.Load()
		if label != nil && label.Value != mhLabel {
			// Label mismatch.
			continue
		}
		size := int32(r.tracker.CountByStream(mh.Stream))
		if minSize != nil && minSize.Value > size {
			// Too few users.
			continue
		}
		if maxSize != nil && maxSize.Value < size {
			// Too many users.
			continue
		}
		results = append(results, &api.Match{
			MatchId:       mh.IDStr,
			Authoritative: true,
			Label:         &wrappers.StringValue{Value: mhLabel},
			Size:          size,
		})
		if len(results) == limit {
			break
		}
	}
	r.RUnlock()

	return results
}

func (r *LocalMatchRegistry) Stop() {
	r.Lock()
	for id, mh := range r.matches {
		mh.Close()
		delete(r.matches, id)
	}
	r.Unlock()
}

func (r *LocalMatchRegistry) JoinAttempt(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string) (bool, bool, string, string) {
	if node != r.node {
		return false, false, "", ""
	}

	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return false, false, "", ""
	}

	resultCh := make(chan *MatchJoinResult, 1)
	if !mh.QueueCall(JoinAttempt(resultCh, userID, sessionID, username, fromNode)) {
		// The match call queue was full, so will be closed and therefore can't be joined.
		return true, false, "", ""
	}

	// Set up a limit to how long the call will wait, default is 10 seconds.
	ticker := time.NewTicker(time.Second * 10)
	select {
	case <-ticker.C:
		ticker.Stop()
		// The join attempt has timed out, join is assumed to be rejected.
		return true, false, "", ""
	case r := <-resultCh:
		ticker.Stop()
		// The join attempt has returned a result.
		return true, r.Allow, r.Reason, r.Label
	}
}

func (r *LocalMatchRegistry) Join(id uuid.UUID, presences []*MatchPresence) {
	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return
	}

	// Doesn't matter if the call queue was full here. If the match is being closed then joins don't matter anyway.
	mh.QueueCall(Join(presences))
}

func (r *LocalMatchRegistry) Leave(id uuid.UUID, presences []*MatchPresence) {
	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return
	}

	// Doesn't matter if the call queue was full here. If the match is being closed then leaves don't matter anyway.
	mh.QueueCall(Leave(presences))
}

func (r *LocalMatchRegistry) Kick(stream PresenceStream, presences []*MatchPresence) {
	for _, presence := range presences {
		if presence.Node != r.node {
			continue
		}
		r.tracker.Untrack(presence.SessionID, stream, presence.UserID)
	}
}

func (r *LocalMatchRegistry) SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte, receiveTime int64) {
	if node != r.node {
		return
	}

	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return
	}

	mh.QueueData(&MatchDataMessage{
		UserID:      userID,
		SessionID:   sessionID,
		Username:    username,
		Node:        node,
		OpCode:      opCode,
		Data:        data,
		ReceiveTime: receiveTime,
	})
}
