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
	"sync"

	"github.com/blevesearch/bleve/analysis/analyzer/keyword"

	"github.com/blevesearch/bleve"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/pkg/errors"
	"go.uber.org/zap"
)

var ErrMatchmakerTicketNotFound = errors.New("ticket not found")

type MatchmakerPresence struct {
	UserId    string `json:"user_id"`
	SessionId string `json:"session_id"`
	Username  string `json:"username"`
	Node      string `json:"node"`
}

func (p *MatchmakerPresence) GetUserId() string {
	return p.UserId
}
func (p *MatchmakerPresence) GetSessionId() string {
	return p.SessionId
}
func (p *MatchmakerPresence) GetNodeId() string {
	return p.Node
}
func (p *MatchmakerPresence) GetHidden() bool {
	return false
}
func (p *MatchmakerPresence) GetPersistence() bool {
	return false
}
func (p *MatchmakerPresence) GetUsername() string {
	return p.Username
}
func (p *MatchmakerPresence) GetStatus() string {
	return ""
}

type MatchmakerEntry struct {
	Ticket     string                 `json:"ticket"`
	Presence   *MatchmakerPresence    `json:"presence"`
	Properties map[string]interface{} `json:"properties"`
	// Cached for when we need them returned to clients, but not indexed.
	StringProperties  map[string]string  `json:"-"`
	NumericProperties map[string]float64 `json:"-"`
	SessionID         uuid.UUID          `json:"-"`
}

func (m *MatchmakerEntry) GetPresence() runtime.Presence {
	return m.Presence
}
func (m *MatchmakerEntry) GetTicket() string {
	return m.Ticket
}
func (m *MatchmakerEntry) GetProperties() map[string]interface{} {
	return m.Properties
}

type Matchmaker interface {
	Add(session Session, query string, minCount int, maxCount int, stringProperties map[string]string, numericProperties map[string]float64) (string, []*MatchmakerEntry, error)
	Remove(sessionID uuid.UUID, ticket string) error
	RemoveAll(sessionID uuid.UUID) error
}

type LocalMatchmaker struct {
	sync.Mutex
	node    string
	entries map[string]*MatchmakerEntry
	index   bleve.Index
}

func NewLocalMatchmaker(startupLogger *zap.Logger, node string) Matchmaker {
	mapping := bleve.NewIndexMapping()
	mapping.DefaultAnalyzer = keyword.Name

	index, err := bleve.NewMemOnly(mapping)
	if err != nil {
		startupLogger.Fatal("Failed to create matchmaker index", zap.Error(err))
	}

	return &LocalMatchmaker{
		node:    node,
		entries: make(map[string]*MatchmakerEntry),
		index:   index,
	}
}

func (m *LocalMatchmaker) Add(session Session, query string, minCount int, maxCount int, stringProperties map[string]string, numericProperties map[string]float64) (string, []*MatchmakerEntry, error) {
	// Merge incoming properties.
	properties := make(map[string]interface{}, len(stringProperties)+len(numericProperties))
	for k, v := range stringProperties {
		properties[k] = v
	}
	for k, v := range numericProperties {
		properties[k] = v
	}

	filterQuery := bleve.NewTermQuery(session.ID().String())
	filterQuery.SetField("presence.session_id")
	indexQuery := bleve.NewBooleanQuery()
	indexQuery.AddMust(bleve.NewQueryStringQuery(query))
	indexQuery.AddMustNot(filterQuery)

	searchRequest := bleve.NewSearchRequestOptions(indexQuery, maxCount-1, 0, false)

	ticket := uuid.Must(uuid.NewV4()).String()
	entry := &MatchmakerEntry{
		Ticket: ticket,
		Presence: &MatchmakerPresence{
			UserId:    session.UserID().String(),
			SessionId: session.ID().String(),
			Username:  session.Username(),
			Node:      m.node,
		},
		Properties:        properties,
		StringProperties:  stringProperties,
		NumericProperties: numericProperties,
		SessionID:         session.ID(),
	}

	m.Lock()
	result, err := m.index.SearchInContext(session.Context(), searchRequest)
	if err != nil {
		m.Unlock()
		return ticket, nil, err
	}

	// Check if we have enough results to return them, or if we just add a new entry to the matchmaker.
	resultCount := result.Hits.Len()
	if resultCount < minCount-1 {
		if err := m.index.Index(ticket, entry); err != nil {
			m.Unlock()
			return ticket, nil, err
		}
		m.entries[ticket] = entry

		m.Unlock()
		return ticket, nil, nil
	}

	// We have enough entries to satisfy the request.
	entries := make([]*MatchmakerEntry, 0, resultCount+1)
	tickets := make([]string, 0, resultCount)
	batch := m.index.NewBatch()
	for _, hit := range result.Hits {
		entry, ok := m.entries[hit.ID]
		if !ok {
			// Index and entries map are out of sync, should not happen but check to be sure.
			m.Unlock()
			return ticket, nil, ErrMatchmakerTicketNotFound
		}
		entries = append(entries, entry)
		tickets = append(tickets, hit.ID)
		batch.Delete(hit.ID)
	}

	// Only remove the entries after we've processed each one to make sure
	// there were no sync issues between the index and the entries map.
	if err := m.index.Batch(batch); err != nil {
		m.Unlock()
		return ticket, nil, err
	}
	for _, ticket := range tickets {
		delete(m.entries, ticket)
	}

	m.Unlock()

	// Add the current user.
	entries = append(entries, entry)

	return ticket, entries, nil
}

func (m *LocalMatchmaker) Remove(sessionID uuid.UUID, ticket string) error {
	m.Lock()

	if entry, ok := m.entries[ticket]; !ok || entry.Presence.SessionId != sessionID.String() {
		// Ticket does not exist or does not belong to this session.
		m.Unlock()
		return ErrMatchmakerTicketNotFound
	}
	if err := m.index.Delete(ticket); err != nil {
		m.Unlock()
		return err
	}
	delete(m.entries, ticket)

	m.Unlock()
	return nil
}

func (m *LocalMatchmaker) RemoveAll(sessionID uuid.UUID) error {
	query := bleve.NewMatchQuery(sessionID.String())
	query.SetField("presence.session_id")
	queuedRemoves := 0
	batch := m.index.NewBatch()
	tickets := make([]string, 0, 10)

	m.Lock()

	// Look up and accumulate all required removes to be executed as a batch later.
	for {
		// Load a set of matchmaker entries for the given session.
		search := bleve.NewSearchRequestOptions(query, 10, queuedRemoves, false)
		result, err := m.index.Search(search)
		if err != nil {
			m.Unlock()
			return err
		}
		// Queue each hit up to be removed.
		for _, hit := range result.Hits {
			batch.Delete(hit.ID)
			tickets = append(tickets, hit.ID)
			queuedRemoves++
		}
		// Check if we've accumulated all available hits.
		if result.Hits.Len() == 0 || uint64(queuedRemoves) >= result.Total {
			break
		}
	}

	// Execute the batch and delete from the entries map, if any removes are present.
	if queuedRemoves > 0 {
		if err := m.index.Batch(batch); err != nil {
			m.Unlock()
			return err
		}
		for _, ticket := range tickets {
			delete(m.entries, ticket)
		}
	}

	m.Unlock()
	return nil
}
