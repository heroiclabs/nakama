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
	"sort"
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
	Query             string              `json:"-"`
	Count             int                 `json:"-"`
	CountMultiple     int                 `json:"-"`
	SessionID         string              `json:"-"`
	Intervals         int                 `json:"-"`
	SessionIDs        map[string]struct{} `json:"-"`
	Node              string              `json:"-"`
	StringProperties  map[string]string   `json:"-"`
	NumericProperties map[string]float64  `json:"-"`
	ParsedQuery       bluge.Query         `json:"-"`
}

type MatchmakerExtract struct {
	Presences         []*MatchmakerPresence
	SessionID         string
	PartyId           string
	Query             string
	MinCount          int
	MaxCount          int
	CountMultiple     int
	StringProperties  map[string]string
	NumericProperties map[string]float64
	Ticket            string
	Count             int
	Intervals         int
	CreatedAt         int64
	Node              string
}

type MatchmakerIndexGroup struct {
	indexes      []*MatchmakerIndex
	avgCreatedAt int64
}

func groupIndexes(indexes []*MatchmakerIndex, required int) []*MatchmakerIndexGroup {
	if len(indexes) == 0 || required <= 0 {
		return nil
	}

	current, others := indexes[0], indexes[1:]

	if current.Count > required {
		// Current index is too large for the requirement, and cannot be used at all.
		return groupIndexes(others, required)
	}

	var results []*MatchmakerIndexGroup

	if current.Count == required {
		// 1. The current index by itself satisfies the requirement. No need to combine with anything else.
		results = append(results, &MatchmakerIndexGroup{
			indexes:      []*MatchmakerIndex{current},
			avgCreatedAt: current.CreatedAt,
		})
	} else if current.Count < required {
		// 2. The current index plus some combination(s) of the others.
		fillResults := groupIndexes(others, required-current.Count)
		for _, fillResult := range fillResults {
			indexesCount := int64(len(fillResult.indexes))
			fillResult.avgCreatedAt = (fillResult.avgCreatedAt*indexesCount + current.CreatedAt) / (indexesCount + 1)
			fillResult.indexes = append(fillResult.indexes, current)
			results = append(results, fillResult)
		}
	}

	// 3. Other combinations not including the current index.
	results = append(results, groupIndexes(others, required)...)

	return results
}

type Matchmaker interface {
	Pause()
	Resume()
	Stop()
	OnMatchedEntries(fn func(entries [][]*MatchmakerEntry))
	Add(ctx context.Context, presences []*MatchmakerPresence, sessionID, partyId, query string, minCount, maxCount, countMultiple int, stringProperties map[string]string, numericProperties map[string]float64) (string, int64, error)
	Insert(extracts []*MatchmakerExtract) error
	Extract() []*MatchmakerExtract
	RemoveSession(sessionID, ticket string) error
	RemoveSessionAll(sessionID string) error
	RemoveParty(partyID, ticket string) error
	RemovePartyAll(partyID string) error
	RemoveAll(node string)
	Remove(tickets []string)
}

type LocalMatchmaker struct {
	sync.Mutex
	logger  *zap.Logger
	node    string
	config  Config
	router  MessageRouter
	metrics Metrics
	runtime *Runtime

	active      *atomic.Uint32
	stopped     *atomic.Bool
	ctx         context.Context
	ctxCancelFn context.CancelFunc

	matchedEntriesFn func([][]*MatchmakerEntry)
	batch            *index.Batch
	indexWriter      *bluge.Writer
	// All tickets for a session ID.
	sessionTickets map[string]map[string]struct{}
	// All tickets for a party ID.
	partyTickets map[string]map[string]struct{}
	// All entries for a given ticket.
	entries map[string][]*MatchmakerEntry
	// Index for each ticket.
	indexes map[string]*MatchmakerIndex
	// Indexes that have not yet reached their max interval count.
	activeIndexes map[string]*MatchmakerIndex
	// Reverse lookup cache for mutual matching.
	revCache       map[string]map[string]bool
	revThresholdFn func() *time.Timer
}

func NewLocalMatchmaker(logger, startupLogger *zap.Logger, config Config, router MessageRouter, metrics Metrics, runtime *Runtime) Matchmaker {
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
		metrics: metrics,
		runtime: runtime,

		active:      atomic.NewUint32(1),
		stopped:     atomic.NewBool(false),
		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,

		batch:          bluge.NewBatch(),
		indexWriter:    indexWriter,
		sessionTickets: make(map[string]map[string]struct{}),
		partyTickets:   make(map[string]map[string]struct{}),
		entries:        make(map[string][]*MatchmakerEntry),
		indexes:        make(map[string]*MatchmakerIndex),
		activeIndexes:  make(map[string]*MatchmakerIndex),
		revCache:       make(map[string]map[string]bool),
	}

	if revThreshold := m.config.GetMatchmaker().RevThreshold; revThreshold > 0 && m.config.GetMatchmaker().RevPrecision {
		m.revThresholdFn = func() *time.Timer {
			return time.NewTimer(time.Duration(m.config.GetMatchmaker().IntervalSec*revThreshold) * time.Second)
		}
	}

	go func() {
		ticker := time.NewTicker(time.Duration(config.GetMatchmaker().IntervalSec) * time.Second)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.Process()
			}
		}
	}()

	return m
}

func (m *LocalMatchmaker) Pause() {
	m.active.Store(0)
}

func (m *LocalMatchmaker) Resume() {
	m.active.Store(1)
}

func (m *LocalMatchmaker) Stop() {
	m.stopped.Store(true)
	m.ctxCancelFn()
}

func (m *LocalMatchmaker) OnMatchedEntries(fn func(entries [][]*MatchmakerEntry)) {
	m.matchedEntriesFn = fn
}

func (m *LocalMatchmaker) Process() {
	matchedEntries := make([][]*MatchmakerEntry, 0, 5)

	startTime := time.Now()

	m.Lock()

	activeIndexCount := len(m.activeIndexes)
	indexCount := len(m.indexes)

	defer func() {
		m.metrics.Matchmaker(float64(indexCount), float64(activeIndexCount), time.Now().Sub(startTime))
	}()

	// No active matchmaking tickets, the pool may be non-empty but there are no new tickets to check/query with.
	if activeIndexCount == 0 {
		m.Unlock()
		return
	}

	var threshold bool
	var timer *time.Timer
	if m.revThresholdFn != nil {
		timer = m.revThresholdFn()
		defer timer.Stop()
	}

	for ticket, index := range m.activeIndexes {
		if !threshold && timer != nil {
			select {
			case <-timer.C:
				threshold = true
			default:
			}
		}

		index.Intervals++
		lastInterval := index.Intervals >= m.config.GetMatchmaker().MaxIntervals || index.MinCount == index.MaxCount
		if lastInterval {
			// Drop from active indexes if it has reached its max intervals, or if its min/max counts are equal. In the
			// latter case keeping it active would have the same result as leaving it in the pool, so this saves work.
			delete(m.activeIndexes, ticket)
		}

		if m.active.Load() != 1 {
			continue
		}

		indexQuery := bluge.NewBooleanQuery()

		// Results must match the query string.
		indexQuery.AddMust(index.ParsedQuery)

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

		for idx, hit := range blugeMatches.Hits {
			if hit.ID == ticket {
				// Remove the current ticket.
				blugeMatches.Hits = append(blugeMatches.Hits[:idx], blugeMatches.Hits[idx+1:]...)
				break
			}
		}

		// Form possible combinations, in case multiple matches might be suitable.
		entryCombos := make([][]*MatchmakerEntry, 0, 5)
		lastHitCounter := len(blugeMatches.Hits) - 1
		for hitCounter, hit := range blugeMatches.Hits {
			hitIndex, ok := m.indexes[hit.ID]
			if !ok {
				// Ticket did not exist, should not happen.
				m.logger.Warn("matchmaker process missing index", zap.String("ticket", hit.ID))
				continue
			}

			if !threshold && m.config.GetMatchmaker().RevPrecision {
				outerMutualMatch, err := validateMatch(m, indexReader, hitIndex.ParsedQuery, hit.ID, ticket)
				if err != nil {
					m.logger.Error("error validating mutual match", zap.Error(err))
					continue
				} else if !outerMutualMatch {
					// This search hit is not a mutual match with the outer ticket.
					continue
				}
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
						if !threshold && m.config.GetMatchmaker().RevPrecision {
							entryMatchesSearchHitQuery, err := validateMatch(m, indexReader, hitIndex.ParsedQuery, hit.ID, entry.Ticket)
							if err != nil {
								mutualMatchConflict = true
								m.logger.Error("error validating mutual match", zap.Error(err))
								break
							} else if !entryMatchesSearchHitQuery {
								mutualMatchConflict = true
								// This search hit is not a mutual match with the outer ticket.
								break
							}
							// MatchmakerEntry does not have the query, read it out of indexes.
							if entriesIndexEntry, ok := m.indexes[entry.Ticket]; ok {
								searchHitMatchesEntryQuery, err := validateMatch(m, indexReader, entriesIndexEntry.ParsedQuery, entry.Ticket, hit.ID)
								if err != nil {
									mutualMatchConflict = true
									m.logger.Error("error validating mutual match", zap.Error(err))
									break
								} else if !searchHitMatchesEntryQuery {
									mutualMatchConflict = true
									// This search hit is not a mutual match with the outer ticket.
									break
								}
							} else {
								m.logger.Warn("matchmaker missing index entry for entry combo")
							}
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
			// Either processing first hit, or current hit entries combined with previous hits may tip over index.MaxCount.
			if foundCombo == nil {
				entryCombo := make([]*MatchmakerEntry, len(entries))
				copy(entryCombo, entries)
				entryCombos = append(entryCombos, entryCombo)

				foundCombo = entryCombo
				foundComboIdx = len(entryCombos) - 1
			}

			// The combo is considered match-worthy if either the max count has been satisfied, or ALL of these conditions are met:
			// * It is the last interval for this active index.
			// * The combo at least satisfies the min count.
			// * The combo does not exceed the max count.
			// * There are no more hits that may further fill the found combo, so we get as close as possible to the max count.
			if l := len(foundCombo) + index.Count; l == index.MaxCount || (lastInterval && l >= index.MinCount && l <= index.MaxCount && hitCounter >= lastHitCounter) {
				if rem := l % index.CountMultiple; rem != 0 {
					// The size of the combination being considered does not satisfy the count multiple.
					// Attempt to adjust the combo by removing the smallest possible number of entries.
					// Prefer keeping entries that have been in the matchmaker the longest, if possible.
					eligibleIndexesUniq := make(map[*MatchmakerIndex]struct{}, len(foundCombo))
					for _, e := range foundCombo {
						// Only tickets individually less <= the removable size are considered.
						// For example removing a party of 3 when we're only looking to remove 2 is not allowed.
						if foundIndex, ok := m.indexes[e.Ticket]; ok && foundIndex.Count <= rem {
							eligibleIndexesUniq[foundIndex] = struct{}{}
						}
					}

					eligibleIndexes := make([]*MatchmakerIndex, 0, len(eligibleIndexesUniq))
					for idx := range eligibleIndexesUniq {
						eligibleIndexes = append(eligibleIndexes, idx)
					}

					eligibleGroups := groupIndexes(eligibleIndexes, rem)
					if len(eligibleGroups) <= 0 {
						// No possible combination to remove, unlikely but guard.
						continue
					}
					// Sort to ensure we keep as many of the longest-waiting tickets as possible.
					sort.Slice(eligibleGroups, func(i, j int) bool {
						return eligibleGroups[i].avgCreatedAt < eligibleGroups[j].avgCreatedAt
					})
					// The most eligible group is removed from the combo.
					for _, egIndex := range eligibleGroups[0].indexes {
						for i := 0; i < len(foundCombo); i++ {
							if egIndex.Ticket == foundCombo[i].Ticket {
								foundCombo[i] = foundCombo[len(foundCombo)-1]
								foundCombo[len(foundCombo)-1] = nil
								foundCombo = foundCombo[:len(foundCombo)-1]
								i--
							}
						}
					}

					// We've removed something, update the known size of the currently considered combo.
					l = len(foundCombo) + index.Count

					if l%index.CountMultiple != 0 {
						// Removal was insufficient, the combo is still not valid for the required multiple.
						continue
					}
				}

				// Check that ALL of these conditions are true for ALL matched entries:
				// * The found combo size satisfies the minimum count.
				// * The found combo size satisfies the maximum count.
				// * The found combo size satisfies the count multiple.
				// For any condition failures it does not matter which specific condition is not met.
				var conditionFailed bool
				for _, e := range foundCombo {
					if foundIndex, ok := m.indexes[e.Ticket]; ok && (foundIndex.MinCount > l || foundIndex.MaxCount < l || l%foundIndex.CountMultiple != 0) {
						conditionFailed = true
						break
					}
				}
				if conditionFailed {
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
						m.batch.Delete(bluge.Identifier(entry.Ticket))
						ticketsToDelete[entry.Ticket] = struct{}{}
					}
					delete(m.entries, entry.Ticket)
					delete(m.indexes, entry.Ticket)
					delete(m.activeIndexes, entry.Ticket)
					delete(m.revCache, entry.Ticket)
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
				if err := m.indexWriter.Batch(m.batch); err != nil {
					m.logger.Error("error deleting matchmaker process entries batch", zap.Error(err))
				}
				m.batch.Reset()

				break
			}
		}
	}

	m.Unlock()

	if matchedEntriesCount := len(matchedEntries); matchedEntriesCount > 0 {
		wg := &sync.WaitGroup{}
		wg.Add(matchedEntriesCount)
		for _, entries := range matchedEntries {
			go func(entries []*MatchmakerEntry) {
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
				wg.Done()
			}(entries)
		}
		wg.Wait()
		if m.matchedEntriesFn != nil {
			go m.matchedEntriesFn(matchedEntries)
		}
	}
}

func (m *LocalMatchmaker) Add(ctx context.Context, presences []*MatchmakerPresence, sessionID, partyId, query string, minCount, maxCount, countMultiple int, stringProperties map[string]string, numericProperties map[string]float64) (string, int64, error) {
	// Check if the matchmaker has been stopped.
	if m.stopped.Load() {
		return "", 0, runtime.ErrMatchmakerNotAvailable
	}

	parsedQuery, err := ParseQueryString(query)
	if err != nil {
		return "", 0, runtime.ErrMatchmakerQueryInvalid
	}
	if parsedQuery, ok := parsedQuery.(ValidatableQuery); ok {
		if parsedQuery.Validate() != nil {
			return "", 0, runtime.ErrMatchmakerQueryInvalid
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
			return "", 0, runtime.ErrMatchmakerDuplicateSession
		}
		sessionIDs[presence.SessionId] = struct{}{}
	}
	// Prepare index data.
	createdAt := time.Now().UTC().UnixNano()
	index := &MatchmakerIndex{
		Ticket:     ticket,
		Properties: properties,
		MinCount:   minCount,
		MaxCount:   maxCount,
		PartyId:    partyId,
		CreatedAt:  createdAt,

		Query:             query,
		Count:             len(presences),
		CountMultiple:     countMultiple,
		SessionID:         sessionID,
		Intervals:         0,
		SessionIDs:        sessionIDs,
		Node:              m.node,
		StringProperties:  stringProperties,
		NumericProperties: numericProperties,
		ParsedQuery:       parsedQuery,
	}

	m.Lock()

	select {
	case <-ctx.Done():
		m.Unlock()
		return "", 0, nil
	default:
	}

	// Check if all presences are allowed to create more tickets.
	for _, presence := range presences {
		if existingTickets := m.sessionTickets[presence.SessionId]; len(existingTickets) >= m.config.GetMatchmaker().MaxTickets {
			m.Unlock()
			return "", 0, runtime.ErrMatchmakerTooManyTickets
		}
	}
	// Check if party is allowed to create more tickets.
	if partyId != "" {
		if existingTickets := m.partyTickets[partyId]; len(existingTickets) >= m.config.GetMatchmaker().MaxTickets {
			m.Unlock()
			return "", 0, runtime.ErrMatchmakerTooManyTickets
		}
	}

	matchmakerIndexDoc, err := MapMatchmakerIndex(ticket, index)
	if err != nil {
		m.Unlock()
		m.logger.Error("error mapping matchmaker index document", zap.Error(err))
		return "", 0, runtime.ErrMatchmakerIndex
	}

	if err := m.indexWriter.Update(bluge.Identifier(ticket), matchmakerIndexDoc); err != nil {
		m.Unlock()
		m.logger.Error("error indexing matchmaker entries", zap.Error(err))
		return "", 0, runtime.ErrMatchmakerIndex
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
	return ticket, createdAt, nil
}

func (m *LocalMatchmaker) Insert(extracts []*MatchmakerExtract) error {
	if m.stopped.Load() {
		return nil
	}
	if len(extracts) == 0 {
		return nil
	}

	batch := bluge.NewBatch()
	indexes := make(map[string]*MatchmakerIndex, len(extracts))
	entries := make(map[string][]*MatchmakerEntry, len(extracts))

	for _, extract := range extracts {
		parsedQuery, err := ParseQueryString(extract.Query)
		if err != nil {
			m.logger.Error("error parsing matchmaker query", zap.Error(err), zap.String("query", extract.Query))
			continue
		}
		if parsedQuery, ok := parsedQuery.(ValidatableQuery); ok {
			if parsedQuery.Validate() != nil {
				m.logger.Error("error validating matchmaker query", zap.String("query", extract.Query))
				continue
			}
		}

		properties := make(map[string]interface{}, len(extract.StringProperties)+len(extract.NumericProperties))
		for k, v := range extract.StringProperties {
			properties[k] = v
		}
		for k, v := range extract.NumericProperties {
			properties[k] = v
		}

		sessionIDs := make(map[string]struct{}, len(extract.Presences))
		for _, presence := range extract.Presences {
			if _, found := sessionIDs[presence.SessionId]; found {
				m.logger.Error("error checking matchmaker session duplicates", zap.String("session_id", presence.SessionId))
				continue
			}
			sessionIDs[presence.SessionId] = struct{}{}
		}

		index := &MatchmakerIndex{
			Ticket:     extract.Ticket,
			Properties: properties,
			MinCount:   extract.MinCount,
			MaxCount:   extract.MaxCount,
			PartyId:    extract.PartyId,
			CreatedAt:  extract.CreatedAt,

			Query:             extract.Query,
			Count:             len(extract.Presences),
			CountMultiple:     extract.CountMultiple,
			SessionID:         extract.SessionID,
			Intervals:         extract.Intervals,
			SessionIDs:        sessionIDs,
			Node:              extract.Node,
			StringProperties:  extract.StringProperties,
			NumericProperties: extract.NumericProperties,
			ParsedQuery:       parsedQuery,
		}

		matchmakerIndexDoc, err := MapMatchmakerIndex(extract.Ticket, index)
		if err != nil {
			m.logger.Error("error mapping matchmaker index document", zap.Error(err))
			continue
		}

		batch.Insert(matchmakerIndexDoc)

		extractEntries := make([]*MatchmakerEntry, 0, len(extract.Presences))
		for _, presence := range extract.Presences {
			extractEntries = append(extractEntries, &MatchmakerEntry{
				Ticket:            extract.Ticket,
				Presence:          presence,
				Properties:        properties,
				PartyId:           extract.PartyId,
				StringProperties:  extract.StringProperties,
				NumericProperties: extract.NumericProperties,
			})
		}
		entries[extract.Ticket] = extractEntries
		indexes[extract.Ticket] = index
	}

	m.Lock()

	if err := m.indexWriter.Batch(batch); err != nil {
		m.Unlock()
		m.logger.Error("error indexing matchmaker entries", zap.Error(err))
		return runtime.ErrMatchmakerIndex
	}
	for ticket, index := range indexes {
		m.indexes[ticket] = index
		if index.Intervals < m.config.GetMatchmaker().MaxIntervals {
			m.activeIndexes[ticket] = index
		}
		if index.PartyId != "" {
			if _, ok := m.partyTickets[index.PartyId]; ok {
				m.partyTickets[index.PartyId][ticket] = struct{}{}
			} else {
				m.partyTickets[index.PartyId] = map[string]struct{}{ticket: {}}
			}
		}
	}
	for ticket, ticketEntries := range entries {
		m.entries[ticket] = ticketEntries
		for _, entry := range ticketEntries {
			if _, ok := m.sessionTickets[entry.Presence.SessionId]; ok {
				m.sessionTickets[entry.Presence.SessionId][ticket] = struct{}{}
			} else {
				m.sessionTickets[entry.Presence.SessionId] = map[string]struct{}{ticket: {}}
			}
		}
	}

	m.Unlock()

	return nil
}

func (m *LocalMatchmaker) Extract() []*MatchmakerExtract {
	if m.stopped.Load() {
		return nil
	}

	extracts := make([]*MatchmakerExtract, 0, 100)
	m.Lock()

	for ticket, index := range m.indexes {
		if index.Node != m.node {
			continue
		}
		entries, ok := m.entries[ticket]
		if !ok {
			m.logger.Warn("matchmaker extract found ticket with no entries", zap.String("ticket", ticket))
			continue
		}

		extract := &MatchmakerExtract{
			Presences:         make([]*MatchmakerPresence, 0, len(entries)),
			SessionID:         index.SessionID,
			PartyId:           index.PartyId,
			Query:             index.Query,
			MinCount:          index.MinCount,
			MaxCount:          index.MaxCount,
			CountMultiple:     index.CountMultiple,
			StringProperties:  index.StringProperties,
			NumericProperties: index.NumericProperties,
			Ticket:            ticket,
			Count:             index.Count,
			Intervals:         index.Intervals,
			CreatedAt:         index.CreatedAt,
			Node:              index.Node,
		}
		for _, entry := range entries {
			extract.Presences = append(extract.Presences, entry.Presence)
		}

		extracts = append(extracts, extract)
	}

	m.Unlock()

	return extracts
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
		m.logger.Warn("matchmaker remove session found ticket with no entries", zap.String("ticket", ticket))
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
	delete(m.revCache, ticket)

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
			m.logger.Warn("matchmaker remove session all found ticket with no index", zap.String("ticket", ticket))
			continue
		}
		delete(m.indexes, ticket)

		delete(m.activeIndexes, ticket)
		delete(m.revCache, ticket)

		entries, ok := m.entries[ticket]
		if !ok {
			m.logger.Warn("matchmaker remove session all found ticket with no entries", zap.String("ticket", ticket))
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
		m.logger.Warn("matchmaker remove party found ticket with no entries", zap.String("ticket", ticket))
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
	delete(m.revCache, ticket)

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
			m.logger.Warn("matchmaker remove party all found ticket with no index", zap.String("ticket", ticket))
			continue
		}
		delete(m.indexes, ticket)

		delete(m.activeIndexes, ticket)
		delete(m.revCache, ticket)

		entries, ok := m.entries[ticket]
		if !ok {
			m.logger.Warn("matchmaker remove party all found ticket with no entries", zap.String("ticket", ticket))
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

func (m *LocalMatchmaker) RemoveAll(node string) {
	batch := bluge.NewBatch()

	m.Lock()

	for ticket, index := range m.indexes {
		if index.Node != node {
			continue
		}

		batch.Delete(bluge.Identifier(ticket))

		delete(m.indexes, ticket)

		delete(m.activeIndexes, ticket)
		delete(m.revCache, ticket)

		if index.PartyId != "" {
			partyTickets, ok := m.partyTickets[index.PartyId]
			if ok {
				if len(partyTickets) <= 1 {
					delete(m.partyTickets, index.PartyId)
				} else {
					delete(partyTickets, ticket)
				}
			}
		}

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
	}
}

func (m *LocalMatchmaker) Remove(tickets []string) {
	batch := bluge.NewBatch()

	m.Lock()

	for _, ticket := range tickets {
		index, found := m.indexes[ticket]
		if !found {
			continue
		}

		batch.Delete(bluge.Identifier(ticket))

		delete(m.indexes, ticket)

		delete(m.activeIndexes, ticket)
		delete(m.revCache, ticket)

		if index.PartyId != "" {
			partyTickets, ok := m.partyTickets[index.PartyId]
			if ok {
				if len(partyTickets) <= 1 {
					delete(m.partyTickets, index.PartyId)
				} else {
					delete(partyTickets, ticket)
				}
			}
		}

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
	}
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

func validateMatch(m *LocalMatchmaker, r *bluge.Reader, fromTicketQuery bluge.Query, fromTicket, toTicket string) (bool, error) {
	cache, found := m.revCache[fromTicket]
	if found {
		if cachedResult, seenBefore := cache[toTicket]; seenBefore {
			return cachedResult, nil
		}
	}

	idQuery := bluge.NewTermQuery(toTicket).SetField("_id")

	topQuery := bluge.NewBooleanQuery()
	topQuery.AddMust(idQuery, fromTicketQuery)

	req := bluge.NewTopNSearch(0, topQuery).WithStandardAggregations()
	dmi, err := r.Search(m.ctx, req)
	if err != nil {
		return false, err
	}

	valid := dmi.Aggregations().Count() == 1

	if found {
		cache[toTicket] = valid
	} else {
		m.revCache[fromTicket] = map[string]bool{toTicket: valid}
	}

	return valid, nil
}
