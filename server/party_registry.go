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
	"errors"
	"sync"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

var ErrPartyNotFound = errors.New("party not found")

type PartyRegistry interface {
	Create(open bool, maxSize int) *PartyHandler
	Delete(id uuid.UUID)

	Join(id uuid.UUID, presences []*Presence)
	Leave(id uuid.UUID, presences []*Presence)

	PartyJoinRequest(ctx context.Context, id uuid.UUID, node string, presence *Presence) (bool, error)
	PartyPromote(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error
	PartyAccept(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error
	PartyRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error
	PartyClose(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) error
	PartyJoinRequestList(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) ([]*rtapi.UserPresence, error)
	PartyMatchmakerAdd(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, query string, minCount, maxCount int, stringProperties map[string]string, numericProperties map[string]float64) (string, error)
	PartyMatchmakerRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, ticket string) error
	PartyDataSend(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, opCode int64, data []byte) error
}

type LocalPartyRegistry struct {
	logger        *zap.Logger
	matchmaker    Matchmaker
	tracker       Tracker
	streamManager StreamManager
	router        MessageRouter
	node          string

	parties *sync.Map
}

func NewLocalPartyRegistry(logger *zap.Logger, matchmaker Matchmaker, tracker Tracker, streamManager StreamManager, router MessageRouter, node string) PartyRegistry {
	return &LocalPartyRegistry{
		logger:        logger,
		matchmaker:    matchmaker,
		tracker:       tracker,
		streamManager: streamManager,
		router:        router,
		node:          node,

		parties: &sync.Map{},
	}
}

func (p *LocalPartyRegistry) Create(open bool, maxSize int) *PartyHandler {
	id := uuid.Must(uuid.NewV4())
	partyHandler := NewPartyHandler(p.logger, p, p.matchmaker, p.tracker, p.streamManager, p.router, id, p.node, open, maxSize)

	p.parties.Store(id, partyHandler)

	return partyHandler
}

func (p *LocalPartyRegistry) Delete(id uuid.UUID) {
	p.parties.Delete(id)
}

func (p *LocalPartyRegistry) Join(id uuid.UUID, presences []*Presence) {
	ph, found := p.parties.Load(id)
	if !found {
		return
	}
	ph.(*PartyHandler).Join(presences)
}

func (p *LocalPartyRegistry) Leave(id uuid.UUID, presences []*Presence) {
	ph, found := p.parties.Load(id)
	if !found {
		return
	}
	ph.(*PartyHandler).Leave(presences)
}

func (p *LocalPartyRegistry) PartyJoinRequest(ctx context.Context, id uuid.UUID, node string, presence *Presence) (bool, error) {
	if node != p.node {
		return false, ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return false, ErrPartyNotFound
	}

	return ph.(*PartyHandler).JoinRequest(presence)
}

func (p *LocalPartyRegistry) PartyPromote(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.(*PartyHandler).Promote(sessionID, fromNode, presence)
}

func (p *LocalPartyRegistry) PartyAccept(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.(*PartyHandler).Accept(sessionID, fromNode, presence)
}

func (p *LocalPartyRegistry) PartyRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.(*PartyHandler).Remove(sessionID, fromNode, presence)
}

func (p *LocalPartyRegistry) PartyClose(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.(*PartyHandler).Close(sessionID, fromNode)
}

func (p *LocalPartyRegistry) PartyJoinRequestList(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) ([]*rtapi.UserPresence, error) {
	if node != p.node {
		return nil, ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return nil, ErrPartyNotFound
	}

	return ph.(*PartyHandler).JoinRequestList(sessionID, fromNode)
}

func (p *LocalPartyRegistry) PartyMatchmakerAdd(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, query string, minCount, maxCount int, stringProperties map[string]string, numericProperties map[string]float64) (string, error) {
	if node != p.node {
		return "", ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return "", ErrPartyNotFound
	}

	return ph.(*PartyHandler).MatchmakerAdd(sessionID, fromNode, query, minCount, maxCount, stringProperties, numericProperties)
}

func (p *LocalPartyRegistry) PartyMatchmakerRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, ticket string) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.(*PartyHandler).MatchmakerRemove(sessionID, fromNode, ticket)
}

func (p *LocalPartyRegistry) PartyDataSend(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, opCode int64, data []byte) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.(*PartyHandler).DataSend(sessionID, fromNode, opCode, data)
}
