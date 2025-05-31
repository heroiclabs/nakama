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
	"encoding/json"
	"errors"
	"fmt"
	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/index"
	"go.uber.org/atomic"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

var ErrPartyNotFound = errors.New("party not found")

type PartyRegistry interface {
	Create(open bool, maxSize int, leader *rtapi.UserPresence, label string) (*PartyHandler, error)
	Delete(id uuid.UUID)

	Join(id uuid.UUID, presences []*Presence)
	Leave(id uuid.UUID, presences []*Presence)

	PartyJoinRequest(ctx context.Context, id uuid.UUID, node string, presence *Presence) (bool, error)
	PartyPromote(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error
	PartyAccept(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error
	PartyRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error
	PartyClose(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) error
	PartyJoinRequestList(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) ([]*rtapi.UserPresence, error)
	PartyMatchmakerAdd(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, query string, minCount, maxCount, countMultiple int, stringProperties map[string]string, numericProperties map[string]float64) (string, []*PresenceID, error)
	PartyMatchmakerRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, ticket string) error
	PartyDataSend(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, opCode int64, data []byte) error
	PartyUpdate(id uuid.UUID, node, sessionID, fromNode string, open bool, label string) error
}

type LocalPartyRegistry struct {
	logger        *zap.Logger
	config        Config
	matchmaker    Matchmaker
	tracker       Tracker
	streamManager StreamManager
	router        MessageRouter
	node          string

	ctx         context.Context
	ctxCancelFn context.CancelFunc

	indexWriter         *bluge.Writer
	pendingUpdatesMutex *sync.Mutex
	pendingUpdates      map[string]*PartyIndexEntry

	parties *MapOf[uuid.UUID, *PartyHandler]

	stopped   *atomic.Bool
	stoppedCh chan struct{}
}

type PartyIndexEntry struct {
	Node       string         `json:"node"`
	Label      map[string]any `json:"label"`
	CreateTime time.Time      `json:"create_time"`
}

func NewLocalPartyRegistry(logger, startupLogger *zap.Logger, config Config, matchmaker Matchmaker, tracker Tracker, streamManager StreamManager, router MessageRouter, node string) PartyRegistry {
	indexWriter, err := bluge.OpenWriter(BlugeInMemoryConfig())
	if err != nil {
		startupLogger.Fatal("Failed to create party registry index", zap.Error(err))
	}

	r := &LocalPartyRegistry{
		logger:        logger,
		config:        config,
		matchmaker:    matchmaker,
		tracker:       tracker,
		streamManager: streamManager,
		router:        router,
		node:          node,

		indexWriter:         indexWriter,
		pendingUpdatesMutex: &sync.Mutex{},
		pendingUpdates:      make(map[string]*PartyIndexEntry, 10),

		stopped:   atomic.NewBool(false),
		stoppedCh: make(chan struct{}, 2),

		parties: &MapOf[uuid.UUID, *PartyHandler]{},
	}

	go func() {
		ticker := time.NewTicker(time.Duration(config.GetMatch().LabelUpdateIntervalMs) * time.Millisecond)
		batch := bluge.NewBatch()
		for {
			select {
			// TODO: handle shutdown gracefully.
			case <-ticker.C:
				r.processUpdates(batch)
			}
		}
	}()

	return r
}

func (r *LocalPartyRegistry) processUpdates(batch *index.Batch) {
	r.pendingUpdatesMutex.Lock()
	if len(r.pendingUpdates) == 0 {
		r.pendingUpdatesMutex.Unlock()
		return
	}
	pendingUpdates := r.pendingUpdates
	r.pendingUpdates = make(map[string]*PartyIndexEntry, len(pendingUpdates)+10)
	r.pendingUpdatesMutex.Unlock()

	for id, op := range pendingUpdates {
		if op == nil {
			batch.Delete(bluge.Identifier(id))
			continue
		}
		doc, err := MapPartyIndexEntry(id, op)
		if err != nil {
			r.logger.Error("error mapping party index entry to doc: %v", zap.Error(err))
		}
		batch.Update(bluge.Identifier(id), doc)
	}

	if err := r.indexWriter.Batch(batch); err != nil {
		r.logger.Error("error processing party label updates", zap.Error(err))
	}
	batch.Reset()
}

func (p *LocalPartyRegistry) Create(open bool, maxSize int, presence *rtapi.UserPresence, label string) (*PartyHandler, error) {
	id := uuid.Must(uuid.NewV4())

	var labelMap map[string]any
	if label != "" {
		if err := json.Unmarshal([]byte(label), &labelMap); err != nil {
			p.logger.Error("Failed to unmarshal party label", zap.Error(err))
			return nil, fmt.Errorf("failed to unmarshal party label: %s", err.Error())
		}
	}

	partyHandler := NewPartyHandler(p.logger, p, p.matchmaker, p.tracker, p.streamManager, p.router, id, p.node, open, maxSize, presence)

	p.parties.Store(id, partyHandler)

	if labelMap != nil {
		idStr := fmt.Sprintf("%v.%v", id.String(), p.node)
		entry := &PartyIndexEntry{
			Node:       p.node,
			Label:      labelMap,
			CreateTime: partyHandler.CreateTime,
		}
		p.pendingUpdatesMutex.Lock()
		p.pendingUpdates[idStr] = entry
		p.pendingUpdatesMutex.Unlock()
	}

	return partyHandler, nil
}

func (p *LocalPartyRegistry) Delete(id uuid.UUID) {
	idStr := fmt.Sprintf("%v.%v", id.String(), p.node)
	p.pendingUpdatesMutex.Lock()
	p.pendingUpdates[idStr] = nil
	p.pendingUpdatesMutex.Unlock()

	p.parties.Delete(id)
}

func (p *LocalPartyRegistry) Join(id uuid.UUID, presences []*Presence) {
	ph, found := p.parties.Load(id)
	if !found {
		return
	}
	ph.Join(presences)
}

func (p *LocalPartyRegistry) Leave(id uuid.UUID, presences []*Presence) {
	ph, found := p.parties.Load(id)
	if !found {
		return
	}
	ph.Leave(presences)
}

func (p *LocalPartyRegistry) PartyJoinRequest(ctx context.Context, id uuid.UUID, node string, presence *Presence) (bool, error) {
	if node != p.node {
		return false, ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return false, ErrPartyNotFound
	}

	return ph.JoinRequest(presence)
}

func (p *LocalPartyRegistry) PartyPromote(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.Promote(sessionID, fromNode, presence)
}

func (p *LocalPartyRegistry) PartyAccept(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.Accept(sessionID, fromNode, presence, p.config.GetSession().SingleParty)
}

func (p *LocalPartyRegistry) PartyRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, presence *rtapi.UserPresence) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.Remove(sessionID, fromNode, presence)
}

func (p *LocalPartyRegistry) PartyClose(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	idStr := fmt.Sprintf("%v.%v", id.String(), p.node)
	p.pendingUpdatesMutex.Lock()
	p.pendingUpdates[idStr] = nil
	p.pendingUpdatesMutex.Unlock()

	return ph.Close(sessionID, fromNode)
}

func (p *LocalPartyRegistry) PartyJoinRequestList(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string) ([]*rtapi.UserPresence, error) {
	if node != p.node {
		return nil, ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return nil, ErrPartyNotFound
	}

	return ph.JoinRequestList(sessionID, fromNode)
}

func (p *LocalPartyRegistry) PartyMatchmakerAdd(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, query string, minCount, maxCount, countMultiple int, stringProperties map[string]string, numericProperties map[string]float64) (string, []*PresenceID, error) {
	if node != p.node {
		return "", nil, ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return "", nil, ErrPartyNotFound
	}

	return ph.MatchmakerAdd(sessionID, fromNode, query, minCount, maxCount, countMultiple, stringProperties, numericProperties)
}

func (p *LocalPartyRegistry) PartyMatchmakerRemove(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, ticket string) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.MatchmakerRemove(sessionID, fromNode, ticket)
}

func (p *LocalPartyRegistry) PartyDataSend(ctx context.Context, id uuid.UUID, node, sessionID, fromNode string, opCode int64, data []byte) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	return ph.DataSend(sessionID, fromNode, opCode, data)
}

func (p *LocalPartyRegistry) PartyUpdate(id uuid.UUID, node, sessionID, fromNode string, open bool, label string) error {
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}

	ph.Open = open

	idStr := fmt.Sprintf("%v.%v", id.String(), p.node)
	if label == "" {
		// If the label is empty we remove it from the index.
		p.pendingUpdatesMutex.Lock()
		p.pendingUpdates[idStr] = nil
		p.pendingUpdatesMutex.Unlock()
	} else {
		var labelMap map[string]any
		if err := json.Unmarshal([]byte(label), &labelMap); err != nil {
			p.logger.Error("Failed to unmarshal party label", zap.Error(err))
			return fmt.Errorf("failed to unmarshal party label: %s", err.Error())
		}
		entry := &PartyIndexEntry{
			Node:       "",
			Label:      labelMap,
			CreateTime: ph.CreateTime,
		}
		p.pendingUpdatesMutex.Lock()
		p.pendingUpdates[idStr] = entry
		p.pendingUpdatesMutex.Unlock()
	}

	return nil
}

func MapPartyIndexEntry(id string, in *PartyIndexEntry) (*bluge.Document, error) {
	rv := bluge.NewDocument(id)

	rv.AddField(bluge.NewKeywordField("node", in.Node).StoreValue())
	rv.AddField(bluge.NewDateTimeField("create_time", in.CreateTime).StoreValue().Sortable())
	if in.Label != nil {
		BlugeWalkDocument(in.Label, []string{"label"}, nil, rv)
	}

	return rv, nil
}
