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
	"sort"
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/api"

	"github.com/gofrs/uuid"
	"go.uber.org/zap"
)

type LeaderboardRankCache interface {
	Get(leaderboardId string, expiryUnix int64, ownerID uuid.UUID) int64
	Fill(leaderboardId string, expiryUnix int64, records []*api.LeaderboardRecord)
	Insert(leaderboardId string, expiryUnix int64, sortOrder int, ownerID uuid.UUID, score, subscore int64) int64
	Delete(leaderboardId string, expiryUnix int64, ownerID uuid.UUID) bool
	DeleteLeaderboard(leaderboardId string, expiryUnix int64) bool
	TrimExpired(nowUnix int64) bool
}

type RankData struct {
	OwnerId  uuid.UUID
	Score    int64
	Subscore int64
	Rank     int64
}

type RankMap struct {
	sync.RWMutex
	Ranks     []*RankData
	Haystack  map[uuid.UUID]*RankData
	SortOrder int
}

func (r *RankMap) Len() int {
	return len(r.Ranks)
}
func (r *RankMap) Swap(i, j int) {
	rank1 := r.Ranks[i]
	rank2 := r.Ranks[j]
	r.Ranks[i], r.Ranks[j] = rank2, rank1
	rank1.Rank, rank2.Rank = rank2.Rank, rank1.Rank
}
func (r *RankMap) Less(i, j int) bool {
	rank1 := r.Ranks[i]
	rank2 := r.Ranks[j]
	if r.SortOrder == LeaderboardSortOrderDescending {
		rank1, rank2 = rank2, rank1
	}

	if rank1.Score < rank2.Score {
		return true
	} else if rank2.Score < rank1.Score {
		return false
	}

	return rank1.Subscore <= rank2.Subscore
}

type LeaderboardWithExpiry struct {
	LeaderboardId string
	Expiry        int64
}

type LocalLeaderboardRankCache struct {
	sync.RWMutex
	cache        map[LeaderboardWithExpiry]*RankMap
	blacklistAll bool
	blacklistIds map[string]struct{}
}

func NewLocalLeaderboardRankCache(startupLogger *zap.Logger, db *sql.DB, config *LeaderboardConfig, leaderboardCache LeaderboardCache) LeaderboardRankCache {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, len(config.BlacklistRankCache)),
		blacklistAll: len(config.BlacklistRankCache) == 1 && config.BlacklistRankCache[0] == "*",
		cache:        make(map[LeaderboardWithExpiry]*RankMap, 0),
	}

	// If caching is disabled completely do not preload any records.
	if cache.blacklistAll {
		startupLogger.Info("Skipping leaderboard rank cache initialization")
		return cache
	}

	startupLogger.Info("Initializing leaderboard rank cache")

	skippedLeaderboards := make([]string, 0)
	cachedLeaderboards := make([]string, 0)

	nowTime := time.Now().UTC()

	leaderboards := leaderboardCache.GetAllLeaderboards()
	for _, leaderboard := range leaderboards {
		if _, ok := cache.blacklistIds[leaderboard.Id]; ok {
			startupLogger.Debug("Skip caching leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id))
			skippedLeaderboards = append(skippedLeaderboards, leaderboard.Id)
			continue
		}

		cachedLeaderboards = append(cachedLeaderboards, leaderboard.Id)
		startupLogger.Debug("Caching leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id))

		// Current expiry for this leaderboard.
		// This matches calculateTournamentDeadlines
		var expiryUnix int64
		if leaderboard.ResetSchedule != nil {
			expiryUnix = leaderboard.ResetSchedule.Next(nowTime).UTC().Unix()
			if leaderboard.EndTime > 0 && expiryUnix > leaderboard.EndTime {
				expiryUnix = leaderboard.EndTime
			}
		} else {
			expiryUnix = leaderboard.EndTime
		}

		// Prepare structure to receive rank data.
		rankEntries := &RankMap{
			Ranks:     make([]*RankData, 0),
			Haystack:  make(map[uuid.UUID]*RankData),
			SortOrder: leaderboard.SortOrder,
		}
		key := LeaderboardWithExpiry{LeaderboardId: leaderboard.Id, Expiry: expiryUnix}
		cache.cache[key] = rankEntries

		// Look up all active records for this leaderboard.
		query := `
SELECT owner_id, score, subscore
FROM leaderboard_record
WHERE leaderboard_id = $1 AND expiry_time = $2`
		rows, err := db.Query(query, leaderboard.Id, time.Unix(expiryUnix, 0).UTC())
		if err != nil {
			startupLogger.Fatal("Failed to caching leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
			return nil
		}

		// Process the records.
		for rows.Next() {
			var ownerID string
			rankData := &RankData{Rank: int64(len(rankEntries.Ranks) + 1)}

			if err = rows.Scan(&ownerID, &rankData.Score, &rankData.Subscore); err != nil {
				startupLogger.Fatal("Failed to scan leaderboard rank data", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
				return nil
			}

			rankData.OwnerId = uuid.Must(uuid.FromString(ownerID))

			rankEntries.Ranks = append(rankEntries.Ranks, rankData)
			rankEntries.Haystack[rankData.OwnerId] = rankData
		}
		rows.Close()
	}

	for k, v := range cache.cache {
		startupLogger.Debug("Sorting leaderboard ranks", zap.String("leaderboard_id", k.LeaderboardId), zap.Int("count", len(v.Ranks)))
		sort.Sort(v)
	}

	startupLogger.Info("Leaderboard rank cache initialization completed successfully", zap.Strings("cached", cachedLeaderboards), zap.Strings("skipped", skippedLeaderboards))
	return cache
}

func (l *LocalLeaderboardRankCache) Get(leaderboardId string, expiryUnix int64, ownerID uuid.UUID) int64 {
	if l.blacklistAll {
		// If all rank caching is disabled.
		return 0
	}
	if _, ok := l.blacklistIds[leaderboardId]; ok {
		// If rank caching is disabled for this particular leaderboard.
		return 0
	}

	// Find rank map for this leaderboard/expiry pair.
	key := LeaderboardWithExpiry{LeaderboardId: leaderboardId, Expiry: expiryUnix}
	l.RLock()
	rankMap, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		return 0
	}

	// Find rank data for this owner.
	rankMap.RLock()
	rankData, ok := rankMap.Haystack[ownerID]
	if !ok {
		rankMap.RUnlock()
		return 0
	}
	rank := rankData.Rank
	rankMap.RUnlock()
	return rank
}

func (l *LocalLeaderboardRankCache) Fill(leaderboardId string, expiryUnix int64, records []*api.LeaderboardRecord) {
	if l.blacklistAll {
		// If all rank caching is disabled.
		return
	}
	if _, ok := l.blacklistIds[leaderboardId]; ok {
		// If rank caching is disabled for this particular leaderboard.
		return
	}

	if len(records) == 0 {
		// Nothing to do.
		return
	}

	// Find rank map for this leaderboard/expiry pair.
	key := LeaderboardWithExpiry{LeaderboardId: leaderboardId, Expiry: expiryUnix}
	l.RLock()
	rankMap, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		return
	}

	// Find rank data for each owner.
	rankMap.RLock()
	for _, record := range records {
		rankData, ok := rankMap.Haystack[uuid.Must(uuid.FromString(record.OwnerId))]
		if ok {
			record.Rank = rankData.Rank
		}
	}
	rankMap.RUnlock()
}

func (l *LocalLeaderboardRankCache) Insert(leaderboardId string, expiryUnix int64, sortOrder int, ownerID uuid.UUID, score, subscore int64) int64 {
	if l.blacklistAll {
		// If all rank caching is disabled.
		return 0
	}
	if _, ok := l.blacklistIds[leaderboardId]; ok {
		// If rank caching is disabled for this particular leaderboard.
		return 0
	}

	// Find the rank map for this leaderboard/expiry pair.
	key := LeaderboardWithExpiry{LeaderboardId: leaderboardId, Expiry: expiryUnix}
	l.RLock()
	rankMap, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		// No existing rank map for this leaderboard/expiry pair, prepare to create a new one.
		newRankMap := &RankMap{
			Ranks:     make([]*RankData, 0),
			Haystack:  make(map[uuid.UUID]*RankData),
			SortOrder: sortOrder,
		}
		l.Lock()
		// Last check if rank map was created by another writer just after last read.
		rankMap, ok = l.cache[key]
		if !ok {
			rankMap = newRankMap
			l.cache[key] = rankMap
		}
		l.Unlock()
	}

	// Insert or update the score.
	rankMap.Lock()
	rankData, ok := rankMap.Haystack[ownerID]
	if !ok {
		rankData = &RankData{
			OwnerId:  ownerID,
			Score:    score,
			Subscore: subscore,
			Rank:     int64(len(rankMap.Ranks) + 1),
		}
		rankMap.Haystack[ownerID] = rankData
		rankMap.Ranks = append(rankMap.Ranks, rankData)
	} else {
		rankData.Score = score
		rankData.Subscore = subscore
	}

	// Re-sort the rank map then check the rank number assigned.
	sort.Sort(rankMap)
	rank := rankData.Rank
	rankMap.Unlock()

	return rank
}

func (l *LocalLeaderboardRankCache) Delete(leaderboardId string, expiryUnix int64, ownerID uuid.UUID) bool {
	if l.blacklistAll {
		// If all rank caching is disabled.
		return false
	}
	if _, ok := l.blacklistIds[leaderboardId]; ok {
		// If rank caching is disabled for this particular leaderboard.
		return false
	}

	// Find the rank map for this leaderboard/expiry pair.
	key := LeaderboardWithExpiry{LeaderboardId: leaderboardId, Expiry: expiryUnix}

	l.RLock()
	rankMap, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		// No rank map.
		return true
	}

	// Delete rank data for this owner.
	rankMap.Lock()
	rankData, ok := rankMap.Haystack[ownerID]
	if !ok {
		// No rank data.
		rankMap.Unlock()
		return true
	}

	delete(rankMap.Haystack, ownerID)

	rank := rankData.Rank
	totalRanks := len(rankMap.Ranks)
	switch {
	case rank == 1:
		// Dropping the first rank.
		rankMap.Ranks = rankMap.Ranks[1:]
	case rank == int64(totalRanks):
		// Dropping the last rank.
		rankMap.Ranks = rankMap.Ranks[:rank-1]

		// No need to reshuffle ranks.
		rankMap.Unlock()
		return true
	default:
		// Dropping a rank somewhere in the middle.
		rankMap.Ranks = append(rankMap.Ranks[:rank-1], rankMap.Ranks[rank:]...)
	}

	// Shift ranks that were after the deleted record down by one rank number to fill the gap.
	for i := int(rank) - 1; i < totalRanks-1; i++ {
		rankMap.Ranks[i].Rank--
	}
	// No need to sort, ranks are still in order.
	rankMap.Unlock()

	return true
}

func (l *LocalLeaderboardRankCache) DeleteLeaderboard(leaderboardId string, expiryUnix int64) bool {
	if l.blacklistAll {
		// If all rank caching is disabled.
		return false
	}
	if _, ok := l.blacklistIds[leaderboardId]; ok {
		// If rank caching is disabled for this particular leaderboard.
		return false
	}

	// Delete the rank map for this leaderboard/expiry pair.
	key := LeaderboardWithExpiry{LeaderboardId: leaderboardId, Expiry: expiryUnix}

	l.Lock()
	delete(l.cache, key)
	l.Unlock()

	return true
}

func (l *LocalLeaderboardRankCache) TrimExpired(nowUnix int64) bool {
	if l.blacklistAll {
		// If all rank caching is disabled.
		return false
	}

	// Used for the timer.
	l.Lock()
	for k := range l.cache {
		if k.Expiry <= nowUnix {
			delete(l.cache, k)
		}
	}
	l.Unlock()

	return true
}
