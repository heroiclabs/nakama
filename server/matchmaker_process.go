// Copyright 2023 The Nakama Authors
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
	"math"
	"math/bits"
	"sort"
	"time"

	"github.com/blugelabs/bluge"
	"go.uber.org/zap"
)

func (m *LocalMatchmaker) processDefault(activeIndexCount int, activeIndexesCopy map[string]*MatchmakerIndex, indexCount int, indexesCopy map[string]*MatchmakerIndex) ([][]*MatchmakerEntry, []string) {
	matchedEntries := make([][]*MatchmakerEntry, 0, 5)
	expiredActiveIndexes := make([]string, 0, 10)

	var threshold bool
	var timer *time.Timer
	if m.active.Load() == 1 && m.revThresholdFn != nil {
		timer = m.revThresholdFn()
		defer timer.Stop()
	}

	selectedTickets := make(map[string]struct{}, activeIndexCount*2)
	for ticket, activeIndex := range activeIndexesCopy {
		if !threshold && timer != nil {
			select {
			case <-timer.C:
				threshold = true
			default:
			}
		}

		// This ticket may already have found a match in a previous iteration.
		if _, found := selectedTickets[activeIndex.Ticket]; found {
			continue
		}

		activeIndex.Intervals++
		lastInterval := activeIndex.Intervals >= m.config.GetMatchmaker().MaxIntervals || activeIndex.MinCount == activeIndex.MaxCount
		if lastInterval {
			// Drop from active indexes if it has reached its max intervals, or if its min/max counts are equal. In the
			// latter case keeping it active would have the same result as leaving it in the pool, so this saves work.
			expiredActiveIndexes = append(expiredActiveIndexes, ticket)
		}

		if m.active.Load() != 1 {
			continue
		}

		indexQuery := bluge.NewBooleanQuery()

		// Results must match the query string.
		indexQuery.AddMust(activeIndex.ParsedQuery)

		// Results must also have compatible min/max ranges, for example 2-4 must not match with 6-8.
		minCountRange := bluge.NewNumericRangeInclusiveQuery(
			float64(activeIndex.MinCount), math.Inf(1), true, true).
			SetField("min_count")
		indexQuery.AddMust(minCountRange)
		maxCountRange := bluge.NewNumericRangeInclusiveQuery(
			math.Inf(-1), float64(activeIndex.MaxCount), true, true).
			SetField("max_count")
		indexQuery.AddMust(maxCountRange)

		// Results must not include the current party, if any.
		if activeIndex.PartyId != "" {
			partyIdQuery := bluge.NewTermQuery(activeIndex.PartyId)
			partyIdQuery.SetField("party_id")
			indexQuery.AddMustNot(partyIdQuery)
		}

		searchRequest := bluge.NewTopNSearch(indexCount, indexQuery)
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

		for i := 0; i < len(blugeMatches.Hits); i++ {
			hitTicket := blugeMatches.Hits[i].ID
			if hitTicket == ticket {
				// Remove the current ticket.
				blugeMatches.Hits = append(blugeMatches.Hits[:i], blugeMatches.Hits[i+1:]...)
				if len(selectedTickets) == 0 {
					break
				}
				i--
			} else if _, found := selectedTickets[hitTicket]; found {
				// Ticket has already been selected for another match during this process iteration.
				blugeMatches.Hits = append(blugeMatches.Hits[:i], blugeMatches.Hits[i+1:]...)
				i--
			}
		}

		// Form possible combinations, in case multiple matches might be suitable.
		entryCombos := make([][]*MatchmakerEntry, 0, 5)
		lastHitCounter := len(blugeMatches.Hits) - 1
		for hitCounter, hit := range blugeMatches.Hits {
			hitIndex, ok := indexesCopy[hit.ID]
			if !ok {
				// Ticket did not exist, should not happen.
				m.logger.Warn("matchmaker process missing index", zap.String("ticket", hit.ID))
				continue
			}

			if !threshold && m.config.GetMatchmaker().RevPrecision {
				outerMutualMatch, err := validateMatch(m.ctx, m.revCache, indexReader, hitIndex.ParsedQuery, hit.ID, ticket)
				if err != nil {
					m.logger.Error("error validating mutual match", zap.Error(err))
					continue
				} else if !outerMutualMatch {
					// This search hit is not a mutual match with the outer ticket.
					continue
				}
			}

			if activeIndex.MaxCount < hitIndex.MaxCount && hitIndex.Intervals <= m.config.GetMatchmaker().MaxIntervals {
				// This match would be less than the search hit's preferred max, and they can still wait. Let them wait more.
				continue
			}

			// Check if there are overlapping session IDs, and if so these tickets are ineligible to match together.
			var sessionIdConflict bool
			for sessionID := range activeIndex.SessionIDs {
				if _, found := hitIndex.SessionIDs[sessionID]; found {
					sessionIdConflict = true
					break
				}
			}
			if sessionIdConflict {
				continue
			}

			var foundComboIdx int
			var foundCombo []*MatchmakerEntry
			for entryComboIdx, entryCombo := range entryCombos {
				if len(entryCombo)+len(hitIndex.Entries)+activeIndex.Count <= activeIndex.MaxCount {
					// There is room in this combo for these entries. Check if there are session ID or mutual match conflicts with current combo.
					var mutualMatchConflict bool
					for _, entry := range entryCombo {
						if _, found := hitIndex.SessionIDs[entry.Presence.SessionId]; found {
							sessionIdConflict = true
							break
						}
						if !threshold && m.config.GetMatchmaker().RevPrecision {
							entryMatchesSearchHitQuery, err := validateMatch(m.ctx, m.revCache, indexReader, hitIndex.ParsedQuery, hit.ID, entry.Ticket)
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
							if entriesIndexEntry, ok := indexesCopy[entry.Ticket]; ok {
								searchHitMatchesEntryQuery, err := validateMatch(m.ctx, m.revCache, indexReader, entriesIndexEntry.ParsedQuery, entry.Ticket, hit.ID)
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

					entryCombo = append(entryCombo, hitIndex.Entries...)
					entryCombos[entryComboIdx] = entryCombo

					foundCombo = entryCombo
					foundComboIdx = entryComboIdx
					break
				}
			}
			// Either processing first hit, or current hit entries combined with previous hits may tip over activeIndex.MaxCount.
			if foundCombo == nil {
				entryCombo := make([]*MatchmakerEntry, len(hitIndex.Entries))
				copy(entryCombo, hitIndex.Entries)
				entryCombos = append(entryCombos, entryCombo)

				foundCombo = entryCombo
				foundComboIdx = len(entryCombos) - 1
			}

			// The combo is considered match-worthy if either the max count has been satisfied, or ALL of these conditions are met:
			// * It is the last interval for this active index.
			// * The combo at least satisfies the min count.
			// * The combo does not exceed the max count.
			// * There are no more hits that may further fill the found combo, so we get as close as possible to the max count.
			if l := len(foundCombo) + activeIndex.Count; l == activeIndex.MaxCount || (lastInterval && l >= activeIndex.MinCount && l <= activeIndex.MaxCount && hitCounter >= lastHitCounter) {
				if rem := l % activeIndex.CountMultiple; rem != 0 {
					// The size of the combination being considered does not satisfy the count multiple.
					// Attempt to adjust the combo by removing the smallest possible number of entries.
					// Prefer keeping entries that have been in the matchmaker the longest, if possible.
					eligibleIndexesUniq := make(map[*MatchmakerIndex]struct{}, len(foundCombo))
					for _, e := range foundCombo {
						// Only tickets individually less <= the removable size are considered.
						// For example removing a party of 3 when we're only looking to remove 2 is not allowed.
						if foundIndex, ok := indexesCopy[e.Ticket]; ok && foundIndex.Count <= rem {
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
					l = len(foundCombo) + activeIndex.Count

					if l%activeIndex.CountMultiple != 0 {
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
					if foundIndex, ok := indexesCopy[e.Ticket]; ok && (foundIndex.MinCount > l || foundIndex.MaxCount < l || l%foundIndex.CountMultiple != 0) {
						conditionFailed = true
						break
					}
				}
				if conditionFailed {
					continue
				}

				// Found a suitable match.
				currentMatchedEntries := append(foundCombo, activeIndex.Entries...)

				// Remove the found combos from currently tracked list.
				entryCombos = append(entryCombos[:foundComboIdx], entryCombos[foundComboIdx+1:]...) //nolint:staticcheck

				matchedEntries = append(matchedEntries, currentMatchedEntries)

				var batchSize int
				batch := bluge.NewBatch()
				// Mark tickets as unavailable for further use in this process iteration.
				for _, currentMatchedEntry := range currentMatchedEntries {
					if _, found := selectedTickets[currentMatchedEntry.Ticket]; found {
						continue
					}
					selectedTickets[currentMatchedEntry.Ticket] = struct{}{}
					batchSize++
					batch.Delete(bluge.Identifier(currentMatchedEntry.Ticket))
				}
				if batchSize > 0 {
					if err := m.indexWriter.Batch(batch); err != nil {
						m.logger.Error("error deleting matchmaker process entries batch", zap.Error(err))
					}
				}

				break
			}
		}
		err = indexReader.Close()
		if err != nil {
			m.logger.Error("error closing index reader", zap.Error(err))
			continue
		}
	}

	return matchedEntries, expiredActiveIndexes
}

func (m *LocalMatchmaker) processCustom(activeIndexesCopy map[string]*MatchmakerIndex, indexCount int, indexesCopy map[string]*MatchmakerIndex) ([][]*MatchmakerEntry, []string) {
	matchedEntries := make([][]*MatchmakerEntry, 0, 5)
	expiredActiveIndexes := make([]string, 0, 10)

	var threshold bool
	var timer *time.Timer
	if m.revThresholdFn != nil {
		timer = m.revThresholdFn()
		defer timer.Stop()
	}

	// Update all interval counts at once.
	for _, index := range activeIndexesCopy {
		index.Intervals++
	}

	for ticket, index := range activeIndexesCopy {
		if !threshold && timer != nil {
			select {
			case <-timer.C:
				threshold = true
			default:
			}
		}

		lastInterval := index.Intervals >= m.config.GetMatchmaker().MaxIntervals || index.MinCount == index.MaxCount
		if lastInterval {
			// Drop from active indexes if it has reached its max intervals, or if its min/max counts are equal. In the
			// latter case keeping it active would have the same result as leaving it in the pool, so this saves work.
			expiredActiveIndexes = append(expiredActiveIndexes, ticket)
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

		searchRequest := bluge.NewTopNSearch(indexCount, indexQuery)
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

		hitIndexes := make([]*MatchmakerIndex, 0, len(blugeMatches.Hits))
		for _, hit := range blugeMatches.Hits {
			if hit.ID == ticket {
				// Remove the current ticket.
				continue
			}

			hitIndex, ok := indexesCopy[hit.ID]
			if !ok {
				// Ticket did not exist, should not happen.
				m.logger.Warn("matchmaker process missing index", zap.String("ticket", hit.ID))
				continue
			}

			if !threshold && m.config.GetMatchmaker().RevPrecision {
				outerMutualMatch, err := validateMatch(m.ctx, m.revCache, indexReader, hitIndex.ParsedQuery, hit.ID, ticket)
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

			hitIndexes = append(hitIndexes, hitIndex)
		}

		for hitIndexes := range combineIndexes(hitIndexes, index.MinCount-index.Count, index.MaxCount-index.Count) {
			// Check the min and max counts are met across the hit.
			var hitCount int
			for _, hitIndex := range hitIndexes {
				hitCount += hitIndex.Count
			}
			hitCount += index.Count
			if hitCount > index.MaxCount || hitCount < index.MinCount {
				continue
			}
			if hitCount%index.CountMultiple != 0 {
				continue
			}
			var reject bool
			for _, hitIndex := range hitIndexes {
				// Check hit max count.
				if hitCount > hitIndex.MaxCount || hitCount < hitIndex.MinCount {
					reject = true
					break
				}
				// Check if count multiple is satisfied for this hit.
				if hitCount%hitIndex.CountMultiple != 0 {
					reject = true
					break
				}
				// Check if the max is not met, but this hit has not reached its max intervals yet.
				if hitCount < hitIndex.MaxCount && hitIndex.Intervals <= m.config.GetMatchmaker().MaxIntervals {
					reject = true
					break
				}
			}
			if reject {
				continue
			}

			// Check for session ID or mutual match conflicts.
			var sessionIdConflict, mutualMatchConflict bool
			sessionIDs := make(map[string]struct{}, index.MaxCount-index.Count)
			parsedQueries := make(map[string]bluge.Query, index.MaxCount-index.Count)
			for _, hitIndex := range hitIndexes {
				for sessionID := range hitIndex.SessionIDs {
					// Check for session ID conflicts.
					if _, found := sessionIDs[sessionID]; found {
						sessionIdConflict = true
						break
					}
					sessionIDs[sessionID] = struct{}{}

					// Check for mutual match conflicts.
					if !threshold && m.config.GetMatchmaker().RevPrecision {
						for otherTicket, parsedQuery := range parsedQueries {
							entryMatchesSearchHitQuery, err := validateMatch(m.ctx, m.revCache, indexReader, hitIndex.ParsedQuery, hitIndex.Ticket, otherTicket)
							if err != nil {
								mutualMatchConflict = true
								m.logger.Error("error validating mutual match", zap.Error(err))
								break
							} else if !entryMatchesSearchHitQuery {
								mutualMatchConflict = true
								// This hit is not a mutual match with the other ticket.
								break
							}
							entryMatchesSearchHitQuery, err = validateMatch(m.ctx, m.revCache, indexReader, parsedQuery, otherTicket, hitIndex.Ticket)
							if err != nil {
								mutualMatchConflict = true
								m.logger.Error("error validating mutual match", zap.Error(err))
								break
							} else if !entryMatchesSearchHitQuery {
								mutualMatchConflict = true
								// This hit is not a mutual match with the other ticket.
								break
							}
						}
						if mutualMatchConflict {
							break
						}
						parsedQueries[hitIndex.Ticket] = hitIndex.ParsedQuery
					}
				}
				if sessionIdConflict || mutualMatchConflict {
					break
				}
			}
			if sessionIdConflict || mutualMatchConflict {
				continue
			}

			// Hit is valid, collect all its entries.
			matchedEntry := make([]*MatchmakerEntry, 0, hitCount)
			for _, hitIndex := range hitIndexes {
				matchedEntry = append(matchedEntry, hitIndex.Entries...)
			}
			// Include the active index that was the root of this potential match.
			matchedEntry = append(matchedEntry, index.Entries...)

			matchedEntries = append(matchedEntries, matchedEntry)
		}
	}

	if len(matchedEntries) == 0 {
		return matchedEntries, expiredActiveIndexes
	}

	// Allow the custom function to determine which of the matches should be formed. All others will be discarded.
	matchedEntries = m.runtime.matchmakerOverrideFunction(m.ctx, matchedEntries)

	var batchSize int
	var selectedTickets = map[string]string{}
	batch := bluge.NewBatch()
	// Mark tickets as unavailable for further use in this process iteration.
	for _, matchedEntry := range matchedEntries {
		for _, ticket := range matchedEntry {
			if _, found := selectedTickets[ticket.Ticket]; found {
				continue
			}
			selectedTickets[ticket.Ticket] = ticket.Ticket
			batchSize++
			batch.Delete(bluge.Identifier(ticket.Ticket))
		}
	}
	if batchSize > 0 {
		if err := m.indexWriter.Batch(batch); err != nil {
			m.logger.Error("error deleting matchmaker process entries batch", zap.Error(err))
		}
	}

	return matchedEntries, expiredActiveIndexes
}

func combineIndexes(from []*MatchmakerIndex, min, max int) <-chan []*MatchmakerIndex {
	c := make(chan []*MatchmakerIndex)

	go func() {
		defer close(c)
		length := uint(len(from))

		// Go through all possible combinations of from 1 (only first element in subset) to 2^length (all objects in subset)
		// and return those that contain between min and max elements.
	combination:
		for combinationBits := 1; combinationBits < (1 << length); combinationBits++ {
			count := bits.OnesCount(uint(combinationBits))
			if count > max {
				continue
			}

			combination := make([]*MatchmakerIndex, 0, count)
			entryCount := 0
			for element := uint(0); element < length; element++ {
				// Check if element should be contained in combination by checking if bit 'element' is set in combinationBits.
				if (combinationBits>>element)&1 == 1 {
					entryCount = entryCount + from[element].Count
					if entryCount > max {
						continue combination
					}
					combination = append(combination, from[element])
				}
			}
			if entryCount >= min {
				c <- combination
			}
		}
	}()
	return c
}
