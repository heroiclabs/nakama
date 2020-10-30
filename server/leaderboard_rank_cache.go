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
	"sync"
	"time"

	"github.com/heroiclabs/nakama/v2/internal/skiplist"

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

type LeaderboardWithExpiry struct {
	LeaderboardId string
	Expiry        int64
}

type RankAsc struct {
	OwnerId  uuid.UUID
	Score    int64
	Subscore int64
}

func (r *RankAsc) Less(other interface{}) bool {
	ro := other.(*RankAsc)
	if r.Score < ro.Score {
		return true
	}
	if r.Score > ro.Score {
		return false
	}
	if r.Subscore < ro.Subscore {
		return true
	}
	if r.Subscore > ro.Subscore {
		return false
	}
	return r.OwnerId.String() < ro.OwnerId.String()
}

type RankDesc struct {
	OwnerId  uuid.UUID
	Score    int64
	Subscore int64
}

func (r *RankDesc) Less(other interface{}) bool {
	ro := other.(*RankDesc)
	if ro.Score < r.Score {
		return true
	}
	if ro.Score > r.Score {
		return false
	}
	if ro.Subscore < r.Subscore {
		return true
	}
	if ro.Subscore > r.Subscore {
		return false
	}
	return ro.OwnerId.String() < r.OwnerId.String()
}

type RankCache struct {
	sync.RWMutex
	owners map[uuid.UUID]skiplist.Interface
	cache  *skiplist.SkipList
}

type LocalLeaderboardRankCache struct {
	sync.RWMutex
	blacklistAll bool
	blacklistIds map[string]struct{}
	cache        map[LeaderboardWithExpiry]*RankCache
}

var _ LeaderboardRankCache = &LocalLeaderboardRankCache{}

func NewLocalLeaderboardRankCache(startupLogger *zap.Logger, db *sql.DB, config *LeaderboardConfig, leaderboardCache LeaderboardCache) LeaderboardRankCache {
	cache := &LocalLeaderboardRankCache{
		blacklistIds: make(map[string]struct{}, len(config.BlacklistRankCache)),
		blacklistAll: len(config.BlacklistRankCache) == 1 && config.BlacklistRankCache[0] == "*",
		cache:        make(map[LeaderboardWithExpiry]*RankCache, 0),
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
		rankCache := &RankCache{
			owners: make(map[uuid.UUID]skiplist.Interface),
			cache:  skiplist.New(),
		}
		key := LeaderboardWithExpiry{LeaderboardId: leaderboard.Id, Expiry: expiryUnix}
		cache.cache[key] = rankCache

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
			var ownerIDStr string
			var score int64
			var subscore int64

			if err = rows.Scan(&ownerIDStr, &score, &subscore); err != nil {
				startupLogger.Fatal("Failed to scan leaderboard rank data", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
				return nil
			}
			ownerID, err := uuid.FromString(ownerIDStr)
			if err != nil {
				startupLogger.Fatal("Failed to parse scanned leaderboard rank data", zap.String("leaderboard_id", leaderboard.Id), zap.String("owner_id", ownerIDStr), zap.Error(err))
				return nil
			}

			// Prepare new rank data for this leaderboard entry.
			var rankData skiplist.Interface
			if leaderboard.SortOrder == LeaderboardSortOrderDescending {
				rankData = &RankDesc{
					OwnerId:  ownerID,
					Score:    score,
					Subscore: subscore,
				}
			} else {
				rankData = &RankAsc{
					OwnerId:  ownerID,
					Score:    score,
					Subscore: subscore,
				}
			}

			rankCache.owners[ownerID] = rankData
			rankCache.cache.Insert(rankData)
		}
		_ = rows.Close()
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
	rankCache, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		return 0
	}

	// Find rank data for this owner.
	rankCache.RLock()
	rankData, ok := rankCache.owners[ownerID]
	if !ok {
		rankCache.RUnlock()
		return 0
	}
	rank := rankCache.cache.GetRank(rankData)
	rankCache.RUnlock()

	return int64(rank)
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
	rankCache, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		return
	}

	// Find rank data for each owner.
	rankCache.RLock()
	for _, record := range records {
		ownerID, err := uuid.FromString(record.OwnerId)
		if err != nil {
			continue
		}
		rankData, ok := rankCache.owners[ownerID]
		if !ok {
			continue
		}
		record.Rank = int64(rankCache.cache.GetRank(rankData))
	}
	rankCache.RUnlock()
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

	// No existing rank map for this leaderboard/expiry pair, prepare to create a new one.
	key := LeaderboardWithExpiry{LeaderboardId: leaderboardId, Expiry: expiryUnix}
	l.RLock()
	rankCache, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		newRankCache := &RankCache{
			owners: make(map[uuid.UUID]skiplist.Interface),
			cache:  skiplist.New(),
		}
		l.Lock()
		// Last check if rank map was created by another writer just after last read.
		rankCache, ok = l.cache[key]
		if !ok {
			rankCache = newRankCache
			l.cache[key] = rankCache
		}
		l.Unlock()
	}

	// Prepare new rank data for this leaderboard entry.
	var rankData skiplist.Interface
	if sortOrder == LeaderboardSortOrderDescending {
		rankData = &RankDesc{
			OwnerId:  ownerID,
			Score:    score,
			Subscore: subscore,
		}
	} else {
		rankData = &RankAsc{
			OwnerId:  ownerID,
			Score:    score,
			Subscore: subscore,
		}
	}

	// Check for and remove any previous rank entry, then insert the new rank data and get its rank.
	rankCache.Lock()
	if oldRankData, ok := rankCache.owners[ownerID]; ok {
		rankCache.cache.Delete(oldRankData)
	}
	rankCache.owners[ownerID] = rankData
	rankCache.cache.Insert(rankData)
	rank := rankCache.cache.GetRank(rankData)
	rankCache.Unlock()

	return int64(rank)
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
	rankCache, ok := l.cache[key]
	l.RUnlock()
	if !ok {
		// No rank cache for this leaderboard and expiry combination.
		return true
	}

	// Remove any existing rank entry.
	rankCache.Lock()
	rankData, ok := rankCache.owners[ownerID]
	if !ok {
		rankCache.Unlock()
		return true
	}
	delete(rankCache.owners, ownerID)
	rankCache.cache.Delete(rankData)
	rankCache.Unlock()

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
		if k.Expiry != 0 && k.Expiry <= nowUnix {
			delete(l.cache, k)
		}
	}
	l.Unlock()

	return true
}
