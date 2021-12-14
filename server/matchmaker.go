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
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/index"
	"github.com/gofrs/uuid"
	jwt "github.com/golang-jwt/jwt/v4"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
	"go.uber.org/zap"
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

	indexWriter    *bluge.Writer
	sessionTickets map[string]map[string]struct{}
	partyTickets   map[string]map[string]struct{}
	entries        map[string][]*MatchmakerEntry
	indexes        map[string]*MatchmakerIndex
	activeIndexes  map[string]*MatchmakerIndex
}

func NewLocalMatchmaker(logger, startupLogger *zap.Logger, config Config, router MessageRouter, runtime *Runtime) Matchmaker {
	cfg := BlugeInMemoryConfig()
	indexWriter, err := bluge.OpenWriter(cfg)
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

		indexWriter:    indexWriter,
		sessionTickets: make(map[string]map[string]struct{}),
		partyTickets:   make(map[string]map[string]struct{}),
		entries:        make(map[string][]*MatchmakerEntry),
		indexes:        make(map[string]*MatchmakerIndex),
		activeIndexes:  make(map[string]*MatchmakerIndex),
	}

	go func() {
		ticker := time.NewTicker(time.Duration(config.GetMatchmaker().IntervalSec) * time.Second)
		batch := bluge.NewBatch()
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

func (m *LocalMatchmaker) process(batch *index.Batch) {
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

		indexQuery := bluge.NewBooleanQuery()
		// Results must match the query string.
		parsedIndexQuery, err := ParseQueryString(index.Query)
		if err != nil {
			m.logger.Error("error parsing query string", zap.Error(err))
			continue
		}
		indexQuery.AddMust(parsedIndexQuery)

		// Results must also have compatible min/max ranges, for example 2-4 must not match with 6-8.
		minCountRange := bluge.NewNumericRangeInclusiveQuery(
			float64(index.MinCount), math.Inf(1), true, true).
			SetField("min_count")
		indexQuery.AddMust(minCountRange)
		maxCountRange := bluge.NewNumericRangeInclusiveQuery(
			math.Inf(-1), float64(index.MaxCount), true, true).
			SetField("max_count")
		indexQuery.AddMust(maxCountRange)

		// Results must not include the current party, if any.
		if index.PartyId != "" {
			partyIdQuery := bluge.NewTermQuery(index.PartyId)
			partyIdQuery.SetField("party_id")
			indexQuery.AddMustNot(partyIdQuery)
		}

		searchRequest := bluge.NewTopNSearch(len(m.indexes), indexQuery)
		// Sort results to try and select the best match, or if the
		// matches are equivalent, the longest waiting tickets first.
		searchRequest.SortBy([]string{"-_score", "created_at"})

		indexReader, err := m.indexWriter.Reader()
		if err != nil {
			m.logger.Error("error accessing index reader", zap.Error(err))
			continue
		}

		result, err := indexReader.Search(m.ctx, searchRequest)
		if err != nil {
			_ = indexReader.Close()
			m.logger.Error("error searching index", zap.Error(err))
			continue
		}

		blugeMatches, err := IterateBlugeMatches(result, map[string]struct{}{}, m.logger)
		if err != nil {
			_ = indexReader.Close()
			m.logger.Error("error iterating search results", zap.Error(err))
			continue
		}

		err = indexReader.Close()
		if err != nil {
			m.logger.Error("error closing index reader", zap.Error(err))
			continue
		}

		// Form possible combinations, in case multiple matches might be suitable.
		entryCombos := make([][]*MatchmakerEntry, 0, 5)
		for _, hit := range blugeMatches.Hits {
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

			outerMutualMatch, err := validateMatch(m.ctx, indexReader, hitIndex.Query, ticket)
			if err != nil {
				m.logger.Error("error validating mutual match", zap.Error(err))
				continue
			} else if !outerMutualMatch {
				// this search hit is not a mutual match with the outer ticket
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
			var mutualMatchConflict bool
			for entryComboIdx, entryCombo := range entryCombos {
				if len(entryCombo)+len(entries)+index.Count <= index.MaxCount {
					// There is room in this combo for these entries. Check if there are session ID conflicts with current combo.
					for _, entry := range entryCombo {
						if _, found := hitIndex.SessionIDs[entry.Presence.SessionId]; found {
							sessionIdConflict = true
							break
						}
						entryMatchesSearchHitQuery, err := validateMatch(m.ctx, indexReader, hitIndex.Query, entry.Ticket)
						if err != nil {
							mutualMatchConflict = true
							m.logger.Error("error validating mutual match", zap.Error(err))
							break
						} else if !entryMatchesSearchHitQuery {
							mutualMatchConflict = true
							// this search hit is not a mutual match with the outer ticket
							break
						}
						// MatchmakerEntry's do not have the query, have to dig it back out of indexes
						if entriesIndexEntry, ok := m.indexes[entry.Ticket]; ok {
							searchHitMatchesEntryQuery, err := validateMatch(m.ctx, indexReader, entriesIndexEntry.Query, hit.ID)
							if err != nil {
								mutualMatchConflict = true
								m.logger.Error("error validating mutual match", zap.Error(err))
								break
							} else if !searchHitMatchesEntryQuery {
								mutualMatchConflict = true
								// this search hit is not a mutual match with the outer ticket
								break
							}
						} else {
							m.logger.Warn("matchmaker missing index entry for entry combo")
						}

					}
					if sessionIdConflict || mutualMatchConflict {
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
						batch.Delete(bluge.Identifier(entry.Ticket))
						ticketsToDelete[entry.Ticket] = struct{}{}
					}
					delete(m.entries, entry.Ticket)
					delete(m.indexes, entry.Ticket)
					delete(m.activeIndexes, entry.Ticket)
					if sessionTickets, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
						if l := len(sessionTickets); l <= 1 {
							delete(m.sessionTickets, entry.Presence.SessionId)
						} else {
							delete(sessionTickets, entry.Ticket)
						}
					}
					if entry.PartyId != "" {
						if partyTickets, ok := m.partyTickets[entry.PartyId]; ok {
							if l := len(partyTickets); l <= 1 {
								delete(m.partyTickets, entry.PartyId)
							} else {
								delete(partyTickets, entry.Ticket)
							}
						}
					}
				}
				if err := m.indexWriter.Batch(batch); err != nil {
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
		return "", runtime.ErrMatchmakerNotAvailable
	}

	parsedQuery, err := ParseQueryString(query)
	if err != nil {
		return "", runtime.ErrMatchmakerQueryInvalid
	}
	if parsedQuery, ok := parsedQuery.(ValidatableQuery); ok {
		if parsedQuery.Validate() != nil {
			return "", runtime.ErrMatchmakerQueryInvalid
		}
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
			return "", runtime.ErrMatchmakerDuplicateSession
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
			return "", runtime.ErrMatchmakerTooManyTickets
		}
	}
	// Check if party is allowed to create more tickets.
	if partyId != "" {
		if existingTickets := m.partyTickets[partyId]; len(existingTickets) >= m.config.GetMatchmaker().MaxTickets {
			m.Unlock()
			return "", runtime.ErrMatchmakerTooManyTickets
		}
	}

	matchmakerIndexDoc, err := MapMatchmakerIndex(ticket, index)
	if err != nil {
		m.Unlock()
		m.logger.Error("error mapping matchmaker index document", zap.Error(err))
		return "", runtime.ErrMatchmakerIndex
	}

	if err := m.indexWriter.Update(bluge.Identifier(ticket), matchmakerIndexDoc); err != nil {
		m.Unlock()
		m.logger.Error("error indexing matchmaker entries", zap.Error(err))
		return "", runtime.ErrMatchmakerIndex
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
		return runtime.ErrMatchmakerTicketNotFound
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

	if err := m.indexWriter.Delete(bluge.Identifier(ticket)); err != nil {
		m.Unlock()
		m.logger.Error("error deleting matchmaker entries", zap.Error(err))
		return runtime.ErrMatchmakerDelete
	}

	m.Unlock()
	return nil
}

func (m *LocalMatchmaker) RemoveSessionAll(sessionID string) error {
	batch := bluge.NewBatch()

	m.Lock()

	sessionTickets, ok := m.sessionTickets[sessionID]
	if !ok {
		// Session does not have any active matchmaking tickets.
		m.Unlock()
		return nil
	}
	delete(m.sessionTickets, sessionID)

	for ticket := range sessionTickets {
		batch.Delete(bluge.Identifier(ticket))

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

	err := m.indexWriter.Batch(batch)
	m.Unlock()
	if err != nil {
		m.logger.Error("error deleting matchmaker entries batch", zap.Error(err))
		return runtime.ErrMatchmakerDelete
	}
	return nil
}

func (m *LocalMatchmaker) RemoveParty(partyID, ticket string) error {
	m.Lock()

	index, ok := m.indexes[ticket]
	if !ok || index.SessionID != "" || index.PartyId != partyID {
		// Ticket did not exist, or the caller was not the ticket owner - for example a user attempting to remove a party ticket.
		m.Unlock()
		return runtime.ErrMatchmakerTicketNotFound
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

	if err := m.indexWriter.Delete(bluge.Identifier(ticket)); err != nil {
		m.Unlock()
		m.logger.Error("error deleting matchmaker entries", zap.Error(err))
		return runtime.ErrMatchmakerDelete
	}

	m.Unlock()
	return nil
}

func (m *LocalMatchmaker) RemovePartyAll(partyID string) error {
	batch := bluge.NewBatch()

	m.Lock()

	partyTickets, ok := m.partyTickets[partyID]
	if !ok {
		// Party does not have any active matchmaking tickets.
		m.Unlock()
		return nil
	}
	delete(m.partyTickets, partyID)

	for ticket := range partyTickets {
		batch.Delete(bluge.Identifier(ticket))

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

	err := m.indexWriter.Batch(batch)
	m.Unlock()
	if err != nil {
		m.logger.Error("error deleting matchmaker entries batch", zap.Error(err))
		return runtime.ErrMatchmakerDelete
	}
	return nil
}

func MapMatchmakerIndex(id string, in *MatchmakerIndex) (*bluge.Document, error) {
	rv := bluge.NewDocument(id)

	rv.AddField(bluge.NewKeywordField("ticket", in.Ticket).StoreValue())
	rv.AddField(bluge.NewNumericField("min_count", float64(in.MinCount)).StoreValue())
	rv.AddField(bluge.NewNumericField("max_count", float64(in.MaxCount)).StoreValue())
	rv.AddField(bluge.NewKeywordField("party_id", in.PartyId).StoreValue())
	rv.AddField(bluge.NewNumericField("created_at", float64(in.CreatedAt)).StoreValue())

	if in.Properties != nil {
		BlugeWalkDocument(in.Properties, []string{"properties"}, rv)
	}

	return rv, nil
}

func validateMatch(ctx context.Context, r *bluge.Reader, queryStr string, ticket string) (bool, error) {
	ticketQuery, err := ParseQueryString(queryStr)
	if err != nil {
		return false, err
	}

	idQuery := bluge.NewTermQuery(ticket).SetField("_id")

	topQuery := bluge.NewBooleanQuery()
	topQuery.AddMust(ticketQuery, idQuery)

	req := bluge.NewTopNSearch(0, topQuery).WithStandardAggregations()
	dmi, err := r.Search(ctx, req)
	if err != nil {
		return false, err
	}

	if dmi.Aggregations().Count() != 1 {
		return false, nil
	}

	return true, nil
}
