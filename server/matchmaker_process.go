package server

import (
	"github.com/blugelabs/bluge"
	"go.uber.org/zap"
	"math"
	"math/bits"
	"sort"
	"time"
)

func (m *LocalMatchmaker) processDefault() [][]*MatchmakerEntry {
	matchedEntries := make([][]*MatchmakerEntry, 0, 5)

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

	return matchedEntries
}

func (m *LocalMatchmaker) processCustom(customMatchingFn func([][]*MatchmakerEntry) [][]*MatchmakerEntry) [][]*MatchmakerEntry {
	matchedEntries := make([][]*MatchmakerEntry, 0, 5)

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

		indexEntries, found := m.entries[index.Ticket]
		if !found {
			// Ticket did not exist, should not happen.
			m.logger.Warn("matchmaker process missing entries", zap.String("ticket", index.Ticket))
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

		hitIndexes := make([]*MatchmakerIndex, 0, len(blugeMatches.Hits))
		for _, hit := range blugeMatches.Hits {
			if hit.ID == ticket {
				// Remove the current ticket.
				continue
			}

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

			hitIndexes = append(hitIndexes, hitIndex)
		}

		hitIndexesCombinations := combinationsMinMax(hitIndexes, 1, index.MaxCount-index.Count)
		for _, hitIndexes := range hitIndexesCombinations {
			// Check the min/max/multiple are acceptable across the hit.
			var hitCount int
			for _, hitIndex := range hitIndexes {
				hitCount += hitIndex.Count
			}
			hitCount += index.Count
			if hitCount > index.MaxCount {
				continue
			}
			if hitCount%index.CountMultiple != 0 {
				continue
			}
			var reject bool
			for _, hitIndex := range hitIndexes {
				if hitCount%hitIndex.CountMultiple != 0 {
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
				for sessionID, _ := range hitIndex.SessionIDs {
					// Check for session ID conflicts.
					if _, found := sessionIDs[sessionID]; found {
						sessionIdConflict = true
						break
					}
					sessionIDs[sessionID] = struct{}{}

					// Check for mutual match conflicts.
					if !threshold && m.config.GetMatchmaker().RevPrecision {
						for otherTicket, parsedQuery := range parsedQueries {
							entryMatchesSearchHitQuery, err := validateMatch(m, indexReader, hitIndex.ParsedQuery, hitIndex.Ticket, otherTicket)
							if err != nil {
								mutualMatchConflict = true
								m.logger.Error("error validating mutual match", zap.Error(err))
								break
							} else if !entryMatchesSearchHitQuery {
								mutualMatchConflict = true
								// This hit is not a mutual match with the other ticket.
								break
							}
							entryMatchesSearchHitQuery, err = validateMatch(m, indexReader, parsedQuery, otherTicket, hitIndex.Ticket)
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
			var entryFailure bool
			matchedEntry := make([]*MatchmakerEntry, 0, hitCount)
			for _, hitIndex := range hitIndexes {
				entries, found := m.entries[hitIndex.Ticket]
				if !found {
					// Ticket did not exist, should not happen.
					m.logger.Warn("matchmaker process missing entries", zap.String("ticket", hitIndex.Ticket))
					entryFailure = true
					break
				}
				matchedEntry = append(matchedEntry, entries...)
			}
			if entryFailure {
				continue
			}
			// Include the active index that was the root of this potential match.
			matchedEntry = append(matchedEntry, indexEntries...)

			matchedEntries = append(matchedEntries, matchedEntry)
		}
	}

	if len(matchedEntries) == 0 {
		return matchedEntries
	}

	// Allow the custom function to determine which of the matches should be formed. All others will be discarded.
	// TODO replace function.
	matchedEntries = customMatchingFn(matchedEntries)

	ticketsToDelete := make(map[string]struct{}, len(matchedEntries))
	finalMatchedEntries := make([][]*MatchmakerEntry, 0, len(matchedEntries))
	for _, matchedEntry := range matchedEntries {
		var conflict bool
		for _, entry := range matchedEntry {
			if _, found := m.entries[entry.Ticket]; !found {
				conflict = true
				break
			}
		}
		if conflict {
			continue
		}

		for _, entry := range matchedEntry {
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
		finalMatchedEntries = append(finalMatchedEntries, matchedEntry)
	}
	if len(ticketsToDelete) > 0 {
		if err := m.indexWriter.Batch(m.batch); err != nil {
			m.logger.Error("error deleting matchmaker process entries batch", zap.Error(err))
		}
		m.batch.Reset()
	}

	return finalMatchedEntries
}

func combinationsMinMax[T any](from []T, min, max int) (combinations [][]T) {
	length := uint(len(from))

	// Go through all possible combinations of from 1 (only first element in subset) to 2^length (all objects in subset)
	// and return those that contain between min and max elements.
	for combinationBits := 1; combinationBits < (1 << length); combinationBits++ {
		count := bits.OnesCount(uint(combinationBits))
		if count < min || count > max {
			continue
		}

		combination := make([]T, 0, count)
		for element := uint(0); element < length; element++ {
			// Check if element should be contained in combination by checking if bit 'element' is set in combinationBits.
			if (combinationBits>>element)&1 == 1 {
				combination = append(combination, from[element])
			}
		}
		combinations = append(combinations, combination)
	}
	return combinations
}
