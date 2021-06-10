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
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/blevesearch/bleve/v2"
	"github.com/blevesearch/bleve/v2/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/v2/index/upsidedown"
	"github.com/dgrijalva/jwt-go"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/gtreap_compact"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

var (
	ErrMatchmakerQueryInvalid     = errors.New("matchmaker query invalid")
	ErrMatchmakerDuplicateSession = errors.New("matchmaker duplicate session")
	ErrMatchmakerIndex            = errors.New("matchmaker index error")
	ErrMatchmakerDelete           = errors.New("matchmaker delete error")
	ErrMatchmakerNotAvailable     = errors.New("matchmaker not available")
	ErrMatchmakerTooManyTickets   = errors.New("matchmaker too many tickets")
	ErrMatchmakerTicketNotFound   = errors.New("matchmaker ticket not found")
)

type MatchmakerPresence struct {
	UserId    string    `json:"user_id"`
	SessionId string    `json:"session_id"`
	Username  string    `json:"username"`
	Node      string    `json:"node"`
	SessionID uuid.UUID `json:"-"`
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
func (p *MatchmakerPresence) GetReason() runtime.PresenceReason {
	return runtime.PresenceReasonUnknown
}

type MatchmakerEntry struct {
	Ticket     string                 `json:"ticket"`
	Presence   *MatchmakerPresence    `json:"presence"`
	Properties map[string]interface{} `json:"properties"`
	PartyId    string                 `json:"party_id"`

	StringProperties  map[string]string  `json:"-"`
	NumericProperties map[string]float64 `json:"-"`
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
func (m *MatchmakerEntry) GetPartyId() string {
	return m.PartyId
}

type MatchmakerIndex struct {
	Ticket     string                 `json:"ticket"`
	Properties map[string]interface{} `json:"properties"`
	MinCount   int                    `json:"min_count"`
	MaxCount   int                    `json:"max_count"`
	PartyId    string                 `json:"party_id"`
	CreatedAt  int64                  `json:"created_at"`

	// Parameters used for correctly processing various matchmaker operations, but not indexed for searching.
	Query      string              `json:"-"`
	Count      int                 `json:"-"`
	SessionID  string              `json:"-"`
	Intervals  int                 `json:"-"`
	SessionIDs map[string]struct{} `json:"-"`
}

type Matchmaker interface {
	Stop()
	Add(presences []*MatchmakerPresence, sessionID, partyId, query string, minCount, maxCount int, stringProperties map[string]string, numericProperties map[string]float64) (string, error)
	RemoveSession(sessionID, ticket string) error
	RemoveSessionAll(sessionID string) error
	RemoveParty(partyID, ticket string) error
	RemovePartyAll(partyID string) error
}

type LocalMatchmaker struct {
	sync.Mutex
	logger  *zap.Logger
	node    string
	config  Config
	router  MessageRouter
	runtime *Runtime

	stopped     *atomic.Bool
	ctx         context.Context
	ctxCancelFn context.CancelFunc

	index          bleve.Index
	batchPool      chan *bleve.Batch
	sessionTickets map[string]map[string]struct{}
	partyTickets   map[string]map[string]struct{}
	entries        map[string][]*MatchmakerEntry
	indexes        map[string]*MatchmakerIndex
	activeIndexes  map[string]*MatchmakerIndex
}

func NewLocalMatchmaker(logger, startupLogger *zap.Logger, config Config, router MessageRouter, runtime *Runtime) Matchmaker {
	mapping := bleve.NewIndexMapping()
	mapping.DefaultAnalyzer = keyword.Name

	index, err := bleve.NewUsing("", mapping, upsidedown.Name, gtreap_compact.Name, nil)
	if err != nil {
		startupLogger.Fatal("Failed to create matchmaker index", zap.Error(err))
	}

	ctx, ctxCancelFn := context.WithCancel(context.Background())

	m := &LocalMatchmaker{
		logger:  logger,
		node:    config.GetName(),
		config:  config,
		router:  router,
		runtime: runtime,

		stopped:     atomic.NewBool(false),
		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		index:          index,
		batchPool:      make(chan *bleve.Batch, config.GetMatchmaker().BatchPoolSize),
		sessionTickets: make(map[string]map[string]struct{}),
		partyTickets:   make(map[string]map[string]struct{}),
		entries:        make(map[string][]*MatchmakerEntry),
		indexes:        make(map[string]*MatchmakerIndex),
		activeIndexes:  make(map[string]*MatchmakerIndex),
	}

	for i := 0; i < config.GetMatchmaker().BatchPoolSize; i++ {
		m.batchPool <- m.index.NewBatch()
	}

	go func() {
		ticker := time.NewTicker(time.Duration(config.GetMatchmaker().IntervalSec) * time.Second)
		batch := m.index.NewBatch()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.process(batch)
			}
		}
	}()

	return m
}

func (m *LocalMatchmaker) Stop() {
	m.stopped.Store(true)
	m.ctxCancelFn()
}

func (m *LocalMatchmaker) process(batch *bleve.Batch) {
	matchedEntries := make([][]*MatchmakerEntry, 0, 5)

	m.Lock()

	// No active matchmaking tickets, the pool may be non-empty but there are no new tickets to check/query with.
	if len(m.activeIndexes) == 0 {
		m.Unlock()
		return
	}

	for ticket, index := range m.activeIndexes {
		index.Intervals++
		lastInterval := index.Intervals > m.config.GetMatchmaker().MaxIntervals || index.MinCount == index.MaxCount
		if lastInterval {
			// Drop from active indexes if it has reached its max intervals, or if its min/max counts are equal. In the
			// latter case keeping it active would have the same result as leaving it in the pool, so this saves work.
			delete(m.activeIndexes, ticket)
		}

		indexQuery := bleve.NewBooleanQuery()
		// Results must match the query string.
		indexQuery.AddMust(bleve.NewQueryStringQuery(index.Query))
		// Results must also have compatible min/max ranges, for example 2-4 must not match with 6-8.
		indexQuery.AddMust(bleve.NewQueryStringQuery(fmt.Sprintf("+min_count:<=%d +max_count:>=%d", index.MaxCount, index.MinCount)))
		// Results must not include the current ticket.
		ticketQuery := bleve.NewTermQuery(ticket)
		ticketQuery.SetField("ticket")
		indexQuery.AddMustNot(ticketQuery)
		// Results must not include the current party, if any.
		if index.PartyId != "" {
			partyIdQuery := bleve.NewTermQuery(index.PartyId)
			partyIdQuery.SetField("party_id")
			indexQuery.AddMustNot(partyIdQuery)
		}

		searchRequest := bleve.NewSearchRequestOptions(indexQuery, len(m.indexes), 0, false)
		// Sort indexes to try and select the longest waiting tickets first.
		searchRequest.SortBy([]string{"created_at"})
		result, err := m.index.SearchInContext(m.ctx, searchRequest)
		if err != nil {
			m.logger.Error("error searching index", zap.Error(err))
			continue
		}

		// Form possible combinations, in case multiple matches might be suitable.
		entryCombos := make([][]*MatchmakerEntry, 0, 5)
		for _, hit := range result.Hits {
			if hit.ID == ticket {
				// Skip the current ticket.
				continue
			}

			hitIndex, ok := m.indexes[hit.ID]
			if !ok {
				// Ticket did not exist, should not happen.
				m.logger.Warn("matchmaker process missing index", zap.String("ticket", hit.ID))
				continue
			}

			if index.MaxCount < hitIndex.MaxCount && hitIndex.Intervals <= m.config.GetMatchmaker().MaxIntervals {
				// This match would be less than the search hit's preferred max, and they can still wait. Let them wait more.
				continue
			}

			// Check if there are overlapping session IDs, and if so these tickets are ineligible to match together.
			var sessionIdConflict bool
			for sessionID := range index.SessionIDs {
				if _, found := hitIndex.SessionIDs[sessionID]; found {
					sessionIdConflict = true
					break
				}
			}
			if sessionIdConflict {
				continue
			}

			entries, ok := m.entries[hit.ID]
			if !ok {
				// Ticket did not exist, should not happen.
				m.logger.Warn("matchmaker process missing entries", zap.String("ticket", hit.ID))
				continue
			}

			var foundComboIdx int
			var foundCombo []*MatchmakerEntry
			for entryComboIdx, entryCombo := range entryCombos {
				if len(entryCombo)+len(entries)+index.Count <= index.MaxCount {
					// There is room in this combo for these entries. Check if there are session ID conflicts with current combo.
					for _, entry := range entryCombo {
						if _, found := hitIndex.SessionIDs[entry.Presence.SessionId]; found {
							sessionIdConflict = true
							break
						}
					}
					if sessionIdConflict {
						continue
					}

					entryCombo = append(entryCombo, entries...)
					entryCombos[entryComboIdx] = entryCombo

					foundCombo = entryCombo
					foundComboIdx = entryComboIdx
					break
				}
			}
			if foundCombo == nil {
				entryCombo := make([]*MatchmakerEntry, len(entries))
				copy(entryCombo, entries)
				entryCombos = append(entryCombos, entryCombo)

				foundCombo = entryCombo
				foundComboIdx = len(entryCombos) - 1
			}

			if l := len(foundCombo) + index.Count; l == index.MaxCount || (lastInterval && l >= index.MinCount) {
				// Check that the minimum count that satisfies the current index is also good enough for all matched entries.
				var minCountFailed bool
				for _, e := range foundCombo {
					if foundIndex, ok := m.indexes[e.Ticket]; ok && foundIndex.MinCount > l {
						minCountFailed = true
						break
					}
				}
				if minCountFailed {
					continue
				}

				// Found a suitable match.
				entries, ok := m.entries[ticket]
				if !ok {
					// Ticket did not exist, should not happen.
					m.logger.Warn("matchmaker process missing entries", zap.String("ticket", hit.ID))
					break
				}
				currentMatchedEntries := append(foundCombo, entries...)

				// Remove the found combos from currently tracked list.
				entryCombos = append(entryCombos[:foundComboIdx], entryCombos[foundComboIdx+1:]...)

				matchedEntries = append(matchedEntries, currentMatchedEntries)

				// Remove all entries/indexes that have just matched. It must be done here so any following process iterations
				// cannot pick up the same tickets to match against.
				ticketsToDelete := make(map[string]struct{}, len(currentMatchedEntries))
				for _, entry := range currentMatchedEntries {
					if _, ok := ticketsToDelete[entry.Ticket]; !ok {
						batch.Delete(entry.Ticket)
						ticketsToDelete[entry.Ticket] = struct{}{}
					}
					delete(m.entries, entry.Ticket)
					delete(m.indexes, entry.Ticket)
					delete(m.activeIndexes, entry.Ticket)
					if sessionTickets, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
						if l := len(sessionTickets); l <= 1 {
							delete(m.sessionTickets, entry.Presence.SessionId)
						} else {
							delete(sessionTickets, ticket)
						}
					}
					if entry.PartyId != "" {
						if partyTickets, ok := m.partyTickets[entry.PartyId]; ok {
							if l := len(partyTickets); l <= 1 {
								delete(m.partyTickets, entry.PartyId)
							} else {
								delete(partyTickets, ticket)
							}
						}
					}
				}
				if err := m.index.Batch(batch); err != nil {
					m.logger.Error("error deleting matchmaker process entries batch", zap.Error(err))
				}
				batch.Reset()

				break
			}
		}
	}

	m.Unlock()

	for _, entries := range matchedEntries {
		var tokenOrMatchID string
		var isMatchID bool
		var err error

		// Check if there's a matchmaker matched runtime callback, call it, and see if it returns a match ID.
		fn := m.runtime.MatchmakerMatched()
		if fn != nil {
			tokenOrMatchID, isMatchID, err = fn(context.Background(), entries)
			if err != nil {
				m.logger.Error("Error running Matchmaker Matched hook.", zap.Error(err))
			}
		}

		if !isMatchID {
			// If there was no callback or it didn't return a valid match ID always return at least a token.
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"mid": fmt.Sprintf("%v.", uuid.Must(uuid.NewV4()).String()),
				"exp": time.Now().UTC().Add(30 * time.Second).Unix(),
			})
			tokenOrMatchID, _ = token.SignedString([]byte(m.config.GetSession().EncryptionKey))
		}

		users := make([]*rtapi.MatchmakerMatched_MatchmakerUser, 0, len(entries))
		for _, entry := range entries {
			users = append(users, &rtapi.MatchmakerMatched_MatchmakerUser{
				Presence: &rtapi.UserPresence{
					UserId:    entry.Presence.UserId,
					SessionId: entry.Presence.SessionId,
					Username:  entry.Presence.Username,
				},
				StringProperties:  entry.StringProperties,
				NumericProperties: entry.NumericProperties,
				PartyId:           entry.PartyId,
			})
		}
		outgoing := &rtapi.Envelope{Message: &rtapi.Envelope_MatchmakerMatched{MatchmakerMatched: &rtapi.MatchmakerMatched{
			// Ticket is set individually below for each recipient.
			// Id set below to account for token or match ID case.
			Users: users,
			// Self is set individually below for each recipient.
		}}}
		if isMatchID {
			outgoing.GetMatchmakerMatched().Id = &rtapi.MatchmakerMatched_MatchId{MatchId: tokenOrMatchID}
		} else {
			outgoing.GetMatchmakerMatched().Id = &rtapi.MatchmakerMatched_Token{Token: tokenOrMatchID}
		}

		for i, entry := range entries {
			// Set per-recipient fields.
			outgoing.GetMatchmakerMatched().Self = users[i]
			outgoing.GetMatchmakerMatched().Ticket = entry.Ticket

			// Route outgoing message.
			m.router.SendToPresenceIDs(m.logger, []*PresenceID{{Node: entry.Presence.Node, SessionID: entry.Presence.SessionID}}, outgoing, true)
		}
	}
}

func (m *LocalMatchmaker) Add(presences []*MatchmakerPresence, sessionID, partyId, query string, minCount, maxCount int, stringProperties map[string]string, numericProperties map[string]float64) (string, error) {
	// Check if the matchmaker has been stopped.
	if m.stopped.Load() {
		return "", ErrMatchmakerNotAvailable
	}

	if bleve.NewQueryStringQuery(query).Validate() != nil {
		return "", ErrMatchmakerQueryInvalid
	}

	// Merge incoming properties.
	properties := make(map[string]interface{}, len(stringProperties)+len(numericProperties))
	for k, v := range stringProperties {
		properties[k] = v
	}
	for k, v := range numericProperties {
		properties[k] = v
	}
	// Generate a ticket ID.
	ticket := uuid.Must(uuid.NewV4()).String()
	// Unique session IDs.
	sessionIDs := make(map[string]struct{}, len(presences))
	for _, presence := range presences {
		if _, found := sessionIDs[presence.SessionId]; found {
			return "", ErrMatchmakerDuplicateSession
		}
		sessionIDs[presence.SessionId] = struct{}{}
	}
	// Prepare index data.
	index := &MatchmakerIndex{
		Ticket:     ticket,
		Properties: properties,
		MinCount:   minCount,
		MaxCount:   maxCount,
		PartyId:    partyId,
		CreatedAt:  time.Now().UTC().UnixNano(),

		Query:      query,
		Count:      len(presences),
		SessionID:  sessionID,
		Intervals:  0,
		SessionIDs: sessionIDs,
	}

	m.Lock()

	// Check if all presences are allowed to create more tickets.
	for _, presence := range presences {
		if existingTickets := m.sessionTickets[presence.SessionId]; len(existingTickets) >= m.config.GetMatchmaker().MaxTickets {
			m.Unlock()
			return "", ErrMatchmakerTooManyTickets
		}
	}
	// Check if party is allowed to create more tickets.
	if partyId != "" {
		if existingTickets := m.partyTickets[partyId]; len(existingTickets) >= m.config.GetMatchmaker().MaxTickets {
			m.Unlock()
			return "", ErrMatchmakerTooManyTickets
		}
	}

	if err := m.index.Index(ticket, index); err != nil {
		m.Unlock()
		m.logger.Error("error indexing matchmaker entries", zap.Error(err))
		return "", ErrMatchmakerIndex
	}

	entries := make([]*MatchmakerEntry, 0, len(presences))
	for _, presence := range presences {
		if _, ok := m.sessionTickets[presence.SessionId]; ok {
			m.sessionTickets[presence.SessionId][ticket] = struct{}{}
		} else {
			m.sessionTickets[presence.SessionId] = map[string]struct{}{ticket: {}}
		}
		entries = append(entries, &MatchmakerEntry{
			Ticket:            ticket,
			Presence:          presence,
			Properties:        properties,
			PartyId:           partyId,
			StringProperties:  stringProperties,
			NumericProperties: numericProperties,
		})
	}
	if partyId != "" {
		if _, ok := m.partyTickets[partyId]; ok {
			m.partyTickets[partyId][ticket] = struct{}{}
		} else {
			m.partyTickets[partyId] = map[string]struct{}{ticket: {}}
		}
	}
	m.entries[ticket] = entries
	m.indexes[ticket] = index
	m.activeIndexes[ticket] = index

	m.Unlock()
	return ticket, nil
}

func (m *LocalMatchmaker) RemoveSession(sessionID, ticket string) error {
	m.Lock()

	index, ok := m.indexes[ticket]
	if !ok || index.PartyId != "" || index.SessionID != sessionID {
		// Ticket did not exist, or the caller was not the ticket owner - for example a user attempting to remove a party ticket.
		m.Unlock()
		return ErrMatchmakerTicketNotFound
	}
	delete(m.indexes, ticket)

	entries, ok := m.entries[ticket]
	if !ok {
		m.logger.Warn("matchmaker remove found ticket with no entries", zap.String("ticket", ticket))
	}
	delete(m.entries, ticket)

	for _, entry := range entries {
		if sessionTickets, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
			if l := len(sessionTickets); l <= 1 {
				delete(m.sessionTickets, entry.Presence.SessionId)
			} else {
				delete(sessionTickets, ticket)
			}
		}
	}

	if index.PartyId != "" {
		if partyTickets, ok := m.partyTickets[index.PartyId]; ok {
			if l := len(partyTickets); l <= 1 {
				delete(m.partyTickets, index.PartyId)
			} else {
				delete(partyTickets, ticket)
			}
		}
	}

	delete(m.activeIndexes, ticket)

	if err := m.index.Delete(ticket); err != nil {
		m.Unlock()
		m.logger.Error("error deleting matchmaker entries", zap.Error(err))
		return ErrMatchmakerDelete
	}

	m.Unlock()
	return nil
}

func (m *LocalMatchmaker) RemoveSessionAll(sessionID string) error {
	batch := <-m.batchPool

	m.Lock()

	sessionTickets, ok := m.sessionTickets[sessionID]
	if !ok {
		// Session does not have any active matchmaking tickets.
		m.Unlock()
		m.batchPool <- batch
		return nil
	}
	delete(m.sessionTickets, sessionID)

	for ticket := range sessionTickets {
		batch.Delete(ticket)

		index, ok := m.indexes[ticket]
		if !ok {
			// Ticket did not exist, should not happen.
			m.logger.Warn("matchmaker remove all found ticket with no index", zap.String("ticket", ticket))
			continue
		}
		delete(m.indexes, ticket)

		delete(m.activeIndexes, ticket)

		entries, ok := m.entries[ticket]
		if !ok {
			m.logger.Warn("matchmaker remove all found ticket with no entries", zap.String("ticket", ticket))
		}
		delete(m.entries, ticket)

		for _, entry := range entries {
			if entry.Presence.SessionId == sessionID {
				// Already deleted above.
				continue
			}
			if sessionTickets, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
				if l := len(sessionTickets); l <= 1 {
					delete(m.sessionTickets, entry.Presence.SessionId)
				} else {
					delete(sessionTickets, ticket)
				}
			}
		}

		if index.PartyId != "" {
			if partyTickets, ok := m.partyTickets[index.PartyId]; ok {
				if l := len(partyTickets); l <= 1 {
					delete(m.partyTickets, index.PartyId)
				} else {
					delete(partyTickets, ticket)
				}
			}
		}
	}

	if batch.Size() == 0 {
		m.Unlock()
		m.batchPool <- batch
		return nil
	}

	err := m.index.Batch(batch)
	m.Unlock()
	batch.Reset()
	m.batchPool <- batch
	if err != nil {
		m.logger.Error("error deleting matchmaker entries batch", zap.Error(err))
		return ErrMatchmakerDelete
	}
	return nil
}

func (m *LocalMatchmaker) RemoveParty(partyID, ticket string) error {
	m.Lock()

	index, ok := m.indexes[ticket]
	if !ok || index.SessionID != "" || index.PartyId != partyID {
		// Ticket did not exist, or the caller was not the ticket owner - for example a user attempting to remove a party ticket.
		m.Unlock()
		return ErrMatchmakerTicketNotFound
	}
	delete(m.indexes, ticket)

	entries, ok := m.entries[ticket]
	if !ok {
		m.logger.Warn("matchmaker remove found ticket with no entries", zap.String("ticket", ticket))
	}
	delete(m.entries, ticket)

	for _, entry := range entries {
		if sessionTickets, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
			if l := len(sessionTickets); l <= 1 {
				delete(m.sessionTickets, entry.Presence.SessionId)
			} else {
				delete(sessionTickets, ticket)
			}
		}
	}

	if partyTickets, ok := m.partyTickets[partyID]; ok {
		if l := len(partyTickets); l <= 1 {
			delete(m.partyTickets, partyID)
		} else {
			delete(partyTickets, ticket)
		}
	}

	delete(m.activeIndexes, ticket)

	if err := m.index.Delete(ticket); err != nil {
		m.Unlock()
		m.logger.Error("error deleting matchmaker entries", zap.Error(err))
		return ErrMatchmakerDelete
	}

	m.Unlock()
	return nil
}

func (m *LocalMatchmaker) RemovePartyAll(partyID string) error {
	batch := <-m.batchPool

	m.Lock()

	partyTickets, ok := m.partyTickets[partyID]
	if !ok {
		// Party does not have any active matchmaking tickets.
		m.Unlock()
		m.batchPool <- batch
		return nil
	}
	delete(m.partyTickets, partyID)

	for ticket := range partyTickets {
		batch.Delete(ticket)

		_, ok := m.indexes[ticket]
		if !ok {
			// Ticket did not exist, should not happen.
			m.logger.Warn("matchmaker remove all found ticket with no index", zap.String("ticket", ticket))
			continue
		}
		delete(m.indexes, ticket)

		delete(m.activeIndexes, ticket)

		entries, ok := m.entries[ticket]
		if !ok {
			m.logger.Warn("matchmaker remove all found ticket with no entries", zap.String("ticket", ticket))
		}
		delete(m.entries, ticket)

		for _, entry := range entries {
			if sessionTickets, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
				if l := len(sessionTickets); l <= 1 {
					delete(m.sessionTickets, entry.Presence.SessionId)
				} else {
					delete(sessionTickets, ticket)
				}
			}
		}
	}

	if batch.Size() == 0 {
		m.Unlock()
		m.batchPool <- batch
		return nil
	}

	err := m.index.Batch(batch)
	m.Unlock()
	batch.Reset()
	m.batchPool <- batch
	if err != nil {
		m.logger.Error("error deleting matchmaker entries batch", zap.Error(err))
		return ErrMatchmakerDelete
	}
	return nil
}
