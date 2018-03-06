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
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/social"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"sync"
)

type MatchParticipant struct {
	Node      string
	UserID    uuid.UUID
	SessionID uuid.UUID
	Username  string
}

type MatchRegistry interface {
	NewMatch(name string) (*MatchHandler, error)
	RemoveMatch(id uuid.UUID)
	Stop()

	Join(id uuid.UUID, node string, participant MatchParticipant) bool
	Leave(id uuid.UUID, presences []Presence)
	Kick(stream PresenceStream, participants []*MatchParticipant)

	SendData(id uuid.UUID, node string, data *rtapi.MatchData)
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
	node            string
	matches         map[uuid.UUID]*MatchHandler
}

func NewLocalMatchRegistry(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, sessionRegistry *SessionRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, node string) MatchRegistry {
	return &LocalMatchRegistry{
		logger:          logger,
		db:              db,
		config:          config,
		socialClient:    socialClient,
		sessionRegistry: sessionRegistry,
		tracker:         tracker,
		router:          router,
		stdLibs:         stdLibs,
		node:            node,
		matches:         make(map[uuid.UUID]*MatchHandler),
	}
}

func (r *LocalMatchRegistry) NewMatch(name string) (*MatchHandler, error) {
	id := uuid.NewV4()
	match, err := NewMatchHandler(r.logger, r.db, r.config, r.socialClient, r.sessionRegistry, r.tracker, r.router, r.stdLibs, r, id, r.node, name)
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

func (r *LocalMatchRegistry) Join(id uuid.UUID, node string, participant MatchParticipant) bool {
	if node != r.node {
		return false
	}
	return true
}

func (r *LocalMatchRegistry) Leave(id uuid.UUID, presences []Presence) {

}

func (r *LocalMatchRegistry) Kick(stream PresenceStream, participants []*MatchParticipant) {
	for _, participant := range participants {
		if participant.Node != r.node {
			continue
		}
		r.tracker.Untrack(participant.SessionID, stream, participant.UserID)
	}
}

func (r *LocalMatchRegistry) SendData(id uuid.UUID, node string, data *rtapi.MatchData) {

}
