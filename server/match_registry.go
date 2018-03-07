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
	"github.com/heroiclabs/nakama/social"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"sync"
	"time"
)

type MatchPresence struct {
	Node      string
	UserId    uuid.UUID
	SessionId uuid.UUID
	Username  string
}

type MatchRegistry interface {
	NewMatch(name string) (*MatchHandler, error)
	RemoveMatch(id uuid.UUID)
	Stop()

	Join(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string) (bool, bool)
	Leave(id uuid.UUID, node string, presences []Presence)
	Kick(stream PresenceStream, presences []*MatchPresence)

	SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte)
}

type LocalMatchRegistry struct {
	sync.RWMutex
	logger          *zap.Logger
	db              *sql.DB
	config          Config
	socialClient    *social.Client
	sessionRegistry *SessionRegistry
	tracker         Tracker
	router          MessageRouter
	stdLibs         map[string]lua.LGFunction
	modules         *sync.Map
	once            *sync.Once
	node            string
	matches         map[uuid.UUID]*MatchHandler
}

func NewLocalMatchRegistry(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, sessionRegistry *SessionRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, once *sync.Once, node string) MatchRegistry {
	return &LocalMatchRegistry{
		logger:          logger,
		db:              db,
		config:          config,
		socialClient:    socialClient,
		sessionRegistry: sessionRegistry,
		tracker:         tracker,
		router:          router,
		stdLibs:         stdLibs,
		once:            once,
		node:            node,
		matches:         make(map[uuid.UUID]*MatchHandler),
	}
}

func (r *LocalMatchRegistry) NewMatch(name string) (*MatchHandler, error) {
	id := uuid.NewV4()
	match, err := NewMatchHandler(r.logger, r.db, r.config, r.socialClient, r.sessionRegistry, r, r.tracker, r.router, r.stdLibs, r.once, id, r.node, name)
	if err != nil {
		return nil, err
	}
	r.Lock()
	r.matches[id] = match
	r.Unlock()
	return match, nil
}

func (r *LocalMatchRegistry) RemoveMatch(id uuid.UUID) {
	r.Lock()
	delete(r.matches, id)
	r.Unlock()
}

func (r *LocalMatchRegistry) Stop() {
	r.Lock()
	for id, mh := range r.matches {
		mh.Close()
		delete(r.matches, id)
	}
	r.Unlock()
}

func (r *LocalMatchRegistry) Join(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string) (bool, bool) {
	if node != r.node {
		return false, false
	}

	var mh *MatchHandler
	var ok bool
	r.RLock()
	mh, ok = r.matches[id]
	r.RUnlock()
	if !ok {
		return false, false
	}

	resultCh := make(chan bool, 1)
	mh.callCh <- JoinAttempt(resultCh, userID, sessionID, username, fromNode)

	// Set up a limit to how long the call will wait.
	ticker := time.NewTicker(time.Second * 10)
	select {
	case <-ticker.C:
		ticker.Stop()
		// The join attempt has timed out, match was found but join is assumed to be rejected.
		return true, false
	case r := <-resultCh:
		ticker.Stop()
		// The join attempt has returned a result.
		return true, r
	}
}

func (r *LocalMatchRegistry) Leave(id uuid.UUID, node string, presences []Presence) {
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

	mh.callCh <- Leave(presences)
}

func (r *LocalMatchRegistry) Kick(stream PresenceStream, presences []*MatchPresence) {
	for _, presence := range presences {
		if presence.Node != r.node {
			continue
		}
		r.tracker.Untrack(presence.SessionId, stream, presence.UserId)
	}
}

func (r *LocalMatchRegistry) SendData(id uuid.UUID, node string, userID, sessionID uuid.UUID, username, fromNode string, opCode int64, data []byte) {
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

	mh.inputCh <- &MatchDataMessage{
		UserID:    userID,
		SessionID: sessionID,
		Username:  username,
		Node:      node,
		OpCode:    opCode,
		Data:      data,
	}
}
