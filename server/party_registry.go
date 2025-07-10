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
	"bytes"
	"context"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/index"
	"github.com/blugelabs/bluge/search"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

var (
	ErrPartyNotFound            = errors.New("party not found")
	ErrPartyHiddenNonEmptyLabel = errors.New("party is hidden and label is not empty, invalid operation")
)

const (
	PartyLabelMaxBytes = 2048
)

type PartyRegistry interface {
	Init(matchmaker Matchmaker, tracker Tracker, streamManager StreamManager, router MessageRouter)

	Create(open, hidden bool, maxSize int, leader *rtapi.UserPresence, label string) (*PartyHandler, error)
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
	PartyUpdate(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, label string, open, hidden bool) error
	PartyList(ctx context.Context, limit int, open *bool, showHidden bool, query, cursor string) ([]*api.Party, string, error)
	LabelUpdate(id uuid.UUID, node, label string, open, hidden bool, maxSize int, createTime time.Time) error
}

type LocalPartyRegistry struct {
	logger        *zap.Logger
	config        Config
	matchmaker    Matchmaker
	tracker       Tracker
	streamManager StreamManager
	router        MessageRouter
	node          string
	initialized   *atomic.Bool

	indexWriter         *bluge.Writer
	pendingUpdatesMutex *sync.Mutex
	pendingUpdates      map[string]*PartyIndexEntry

	parties *MapOf[uuid.UUID, *PartyHandler]

	stopped   *atomic.Bool
	stoppedCh chan struct{}
}

type PartyIndexEntry struct {
	Id          string
	Node        string
	Open        bool
	Hidden      bool
	MaxSize     int
	Label       map[string]any
	LabelString string
	CreateTime  time.Time
}

func NewLocalPartyRegistry(ctx context.Context, logger, startupLogger *zap.Logger, config Config, node string) PartyRegistry {
	indexWriter, err := bluge.OpenWriter(BlugeInMemoryConfig())
	if err != nil {
		startupLogger.Fatal("Failed to create party registry index", zap.Error(err))
	}

	r := &LocalPartyRegistry{
		initialized: atomic.NewBool(false),
		logger:      logger,
		config:      config,
		node:        node,

		indexWriter:         indexWriter,
		pendingUpdatesMutex: &sync.Mutex{},
		pendingUpdates:      make(map[string]*PartyIndexEntry, 10),

		stopped:   atomic.NewBool(false),
		stoppedCh: make(chan struct{}, 2),

		parties: &MapOf[uuid.UUID, *PartyHandler]{},
	}

	go func() {
		ticker := time.NewTicker(time.Duration(config.GetParty().LabelUpdateIntervalMs) * time.Millisecond)
		batch := bluge.NewBatch()
		for {
			select {
			case <-ctx.Done():
				ticker.Stop()
				return
			case <-ticker.C:
				r.processUpdates(batch)
			}
		}
	}()

	return r
}

func (p *LocalPartyRegistry) Init(matchmaker Matchmaker, tracker Tracker, streamManager StreamManager, router MessageRouter) {
	p.matchmaker = matchmaker
	p.tracker = tracker
	p.streamManager = streamManager
	p.router = router
	p.initialized.Store(true)
}

func (p *LocalPartyRegistry) processUpdates(batch *index.Batch) {
	p.pendingUpdatesMutex.Lock()
	if len(p.pendingUpdates) == 0 {
		p.pendingUpdatesMutex.Unlock()
		return
	}
	pendingUpdates := p.pendingUpdates
	p.pendingUpdates = make(map[string]*PartyIndexEntry, len(pendingUpdates)+10)
	p.pendingUpdatesMutex.Unlock()

	for id, op := range pendingUpdates {
		if op == nil {
			batch.Delete(bluge.Identifier(id))
			continue
		}
		doc, err := MapPartyIndexEntry(id, op)
		if err != nil {
			p.logger.Error("error mapping party index entry to doc: %v", zap.Error(err))
		}
		batch.Update(bluge.Identifier(id), doc)
	}

	if err := p.indexWriter.Batch(batch); err != nil {
		p.logger.Error("error processing party label updates", zap.Error(err))
	}
	batch.Reset()
}

func (p *LocalPartyRegistry) Create(open, hidden bool, maxSize int, presence *rtapi.UserPresence, label string) (*PartyHandler, error) {
	id := uuid.Must(uuid.NewV4())

	var labelMap map[string]any
	if label == "" {
		label = "{}"
	}
	if len(label) > PartyLabelMaxBytes {
		return nil, runtime.ErrPartyLabelTooLong
	}
	if err := json.Unmarshal([]byte(label), &labelMap); err != nil {
		p.logger.Error("Failed to unmarshal party label", zap.Error(err))
		return nil, fmt.Errorf("failed to unmarshal party label: %s", err.Error())
	}

	partyHandler := NewPartyHandler(p.logger, p, p.matchmaker, p.tracker, p.streamManager, p.router, id, p.node, open, maxSize, presence)

	p.parties.Store(id, partyHandler)

	idStr := fmt.Sprintf("%v.%v", id.String(), p.node)
	entry := &PartyIndexEntry{
		Id:          idStr,
		Node:        p.node,
		Open:        open,
		Hidden:      hidden,
		MaxSize:     maxSize,
		Label:       labelMap,
		LabelString: label,
		CreateTime:  partyHandler.CreateTime,
	}
	p.pendingUpdatesMutex.Lock()
	p.pendingUpdates[idStr] = entry
	p.pendingUpdatesMutex.Unlock()

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

func (p *LocalPartyRegistry) PartyUpdate(ctx context.Context, id uuid.UUID, node, sessionID, fromNode, label string, open, hidden bool) error {
	if !(label == "" || label == "{}") && hidden {
		return ErrPartyHiddenNonEmptyLabel
	}
	if node != p.node {
		return ErrPartyNotFound
	}

	ph, found := p.parties.Load(id)
	if !found {
		return ErrPartyNotFound
	}
	if err := ph.Update(sessionID, fromNode, label, open, hidden); err != nil {
		return err
	}

	return nil
}

func (p *LocalPartyRegistry) LabelUpdate(id uuid.UUID, node, label string, open, hidden bool, maxSize int, createTime time.Time) error {
	if !(label == "" || label == "{}") && hidden {
		return ErrPartyHiddenNonEmptyLabel
	}

	idStr := fmt.Sprintf("%v.%v", id.String(), node)

	if label == "" {
		label = "{}"
	}

	if len(label) > PartyLabelMaxBytes {
		return runtime.ErrPartyLabelTooLong
	}
	var labelMap map[string]any
	if err := json.Unmarshal([]byte(label), &labelMap); err != nil {
		p.logger.Error("Failed to unmarshal party label", zap.Error(err))
		return fmt.Errorf("failed to unmarshal party label: %s", err.Error())
	}
	entry := &PartyIndexEntry{
		Id:          idStr,
		Node:        node,
		Open:        open,
		Hidden:      hidden,
		Label:       labelMap,
		MaxSize:     maxSize,
		LabelString: label,
		CreateTime:  createTime,
	}
	p.pendingUpdatesMutex.Lock()
	p.pendingUpdates[idStr] = entry
	p.pendingUpdatesMutex.Unlock()

	return nil
}

type PartyListCursor struct {
	Query  string
	Open   *bool
	Offset int
	Limit  int
}

func (p *LocalPartyRegistry) PartyList(ctx context.Context, limit int, open *bool, showHidden bool, query, cursor string) ([]*api.Party, string, error) {
	if !p.initialized.Load() {
		// This check is only needed here as only this call should be possible during module initialization.
		return nil, "", fmt.Errorf("party registry not initialized: listing cannot be performed in InitModule")
	}

	if limit == 0 {
		return make([]*api.Party, 0), "", nil
	}

	if query == "" {
		query = "*"
	}

	var idxCursor *PartyListCursor
	if cursor != "" {
		idxCursor = &PartyListCursor{}
		cb, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			p.logger.Error("Could not base64 decode notification cursor.", zap.String("cursor", cursor))
			return nil, "", errors.New("invalid cursor")
		}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(idxCursor); err != nil {
			p.logger.Error("Could not decode notification cursor.", zap.String("cursor", cursor))
			return nil, "", errors.New("invalid cursor")
		}

		if query != idxCursor.Query {
			return nil, "", fmt.Errorf("invalid cursor: param query mismatch")
		}
		if limit != idxCursor.Limit {
			return nil, "", fmt.Errorf("invalid cursor: param limit mismatch")
		}
		if open != idxCursor.Open && *open != *idxCursor.Open {
			return nil, "", fmt.Errorf("invalid cursor: param open mismatch")
		}
	}

	parsedQuery, err := ParseQueryString(query)
	if err != nil {
		return nil, "", fmt.Errorf("error parsing query string: %v", err.Error())
	}

	if open != nil {
		multiQuery := bluge.NewBooleanQuery()
		multiQuery.AddMust(parsedQuery)
		openField := "F"
		if *open {
			openField = "T"
		}
		openQuery := bluge.NewTermQuery(openField)
		openQuery.SetField("open")
		multiQuery.AddMust(openQuery)
		parsedQuery = multiQuery
	}

	if !showHidden {
		// Only show parties that are not hidden.
		multiQuery := bluge.NewBooleanQuery()
		multiQuery.AddMust(parsedQuery)
		hiddenField := "F"
		hiddenQuery := bluge.NewTermQuery(hiddenField)
		hiddenQuery.SetField("hidden")
		multiQuery.AddMust(hiddenQuery)
		parsedQuery = multiQuery
	}

	searchReq := bluge.NewTopNSearch(limit+1, parsedQuery)

	if idxCursor != nil {
		searchReq.SetFrom(idxCursor.Offset)
	}

	indexReader, err := p.indexWriter.Reader()
	if err != nil {
		return nil, "", err
	}
	defer func() {
		if err = indexReader.Close(); err != nil {
			p.logger.Error("error closing index reader", zap.Error(err))
		}
	}()

	results, err := indexReader.Search(ctx, searchReq)
	if err != nil {
		return nil, "", err
	}

	indexResults, err := p.queryMatchesToEntries(results)
	if err != nil {
		return nil, "", err
	}

	if len(indexResults) == 0 {
		return make([]*api.Party, 0), "", nil
	}

	var newCursor string
	if len(indexResults) > limit {
		indexResults = indexResults[:len(indexResults)-1]
		offset := 0
		if idxCursor != nil {
			offset = idxCursor.Offset
		}
		newIdxCursor := &PartyListCursor{
			Open:   open,
			Query:  query,
			Offset: offset + limit,
			Limit:  limit,
		}
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(newIdxCursor); err != nil {
			p.logger.Error("Failed to create new cursor.", zap.Error(err))
			return nil, "", err
		}
		newCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	parties := make([]*api.Party, 0, len(indexResults))
	for _, idxResult := range indexResults {
		party := &api.Party{
			PartyId: idxResult.Id,
			Open:    idxResult.Open,
			Hidden:  idxResult.Hidden,
			MaxSize: int32(idxResult.MaxSize),
			Label:   idxResult.LabelString,
		}

		if idxResult.Label != nil {
			labelBytes, err := json.Marshal(idxResult.Label)
			if err != nil {
				p.logger.Error("Failed to marshal party label", zap.Error(err))
				return nil, "", fmt.Errorf("failed to marshal party label: %s", err.Error())
			}
			party.Label = string(labelBytes)
		}

		parties = append(parties, party)
	}

	return parties, newCursor, nil
}

func (p *LocalPartyRegistry) queryMatchesToEntries(dmi search.DocumentMatchIterator) ([]*PartyIndexEntry, error) {
	idxResults := make([]*PartyIndexEntry, 0)
	next, err := dmi.Next()
	for err == nil && next != nil {
		idxResult := &PartyIndexEntry{}
		err = next.VisitStoredFields(func(field string, value []byte) bool {
			switch field {
			case "_id":
				idxResult.Id = string(value)
			case "node":
				idxResult.Node = string(value)
			case "open":
				o := false
				if string(value) == "T" {
					o = true
				}
				idxResult.Open = o
			case "hidden":
				h := false
				if string(value) == "T" {
					h = true
				}
				idxResult.Hidden = h
			case "max_size":
				read, vErr := bluge.DecodeNumericFloat64(value)
				if vErr != nil {
					err = vErr
					return false
				}
				idxResult.MaxSize = int(read)
			case "label_string":
				idxResult.LabelString = string(value)
			case "create_time":
				createTime, vErr := bluge.DecodeDateTime(value)
				if vErr != nil {
					err = vErr
					return false
				}
				idxResult.CreateTime = createTime
			}
			return true
		})
		if err != nil {
			return nil, err
		}
		idxResults = append(idxResults, idxResult)
		next, err = dmi.Next()
	}
	if err != nil {
		return nil, err
	}
	return idxResults, nil
}

func MapPartyIndexEntry(id string, in *PartyIndexEntry) (*bluge.Document, error) {
	rv := bluge.NewDocument(id)

	openField := "F"
	if in.Open {
		openField = "T"
	}

	hiddenField := "F"
	if in.Hidden {
		hiddenField = "T"
	}

	rv.AddField(bluge.NewKeywordField("node", in.Node).StoreValue())
	rv.AddField(bluge.NewKeywordField("open", openField).StoreValue())
	rv.AddField(bluge.NewKeywordField("hidden", hiddenField).StoreValue())
	rv.AddField(bluge.NewNumericField("max_size", float64(in.MaxSize)).StoreValue())
	rv.AddField(bluge.NewDateTimeField("create_time", in.CreateTime).StoreValue().Sortable())
	rv.AddField(bluge.NewStoredOnlyField("label_string", []byte(in.LabelString)))
	if in.Label != nil {
		BlugeWalkDocument(in.Label, []string{"label"}, map[string]bool{"label": true}, rv)
	}

	return rv, nil
}
