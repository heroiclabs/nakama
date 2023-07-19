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
	"database/sql"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/internal/skiplist"
	"go.uber.org/zap"
)

type LeaderboardRankCache interface {
	Get(leaderboardId string, sortOrder int, score, subscore, expiryUnix int64, ownerID uuid.UUID) int64
	Fill(leaderboardId string, sortOrder int, expiryUnix int64, records []*api.LeaderboardRecord) int64
	Insert(leaderboardId string, sortOrder int, score, subscore int64, oldScore, oldSubscore *int64, expiryUnix int64, ownerID uuid.UUID) int64
	Delete(leaderboardId string, sortOrder int, score, subscore, expiryUnix int64, ownerID uuid.UUID) bool
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

func (r RankAsc) Less(other interface{}) bool {
	ro := other.(RankAsc)
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

func (r RankDesc) Less(other interface{}) bool {
	ro := other.(RankDesc)
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
	cache *skiplist.SkipList
}

type LocalLeaderboardRankCache struct {
	sync.RWMutex
	blacklistAll bool
	blacklistIds map[string]struct{}
	cache        map[LeaderboardWithExpiry]*RankCache
}

var _ LeaderboardRankCache = &LocalLeaderboardRankCache{}

func NewLocalLeaderboardRankCache(ctx context.Context, startupLogger *zap.Logger, db *sql.DB, config *LeaderboardConfig, leaderboardCache LeaderboardCache) LeaderboardRankCache {
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

	nowTime := time.Now().UTC()

	go func() {
		skippedLeaderboards := make([]string, 0, 10)
		cachedLeaderboards := make([]string, 0, 100)

		wg := &sync.WaitGroup{}
		wg.Add(config.RankCacheWorkers)
		lbChan := make(chan *Leaderboard, config.RankCacheWorkers)
		mu := &sync.Mutex{}
		iter := uint64(0)

		// Start workers
		for i := 0; i < config.RankCacheWorkers; i++ {
			go leaderboardCacheInitWorker(
				ctx,
				wg,
				&iter,
				cache,
				db,
				startupLogger,
				lbChan,
				nowTime,
				&cachedLeaderboards,
				mu)
		}

		// Load all leaderboards
		var leaderboards []*Leaderboard
		var cursor *LeaderboardAllCursor
		cachedLeaderboardsMap := make(map[string]struct{}, 100)
		for {
			leaderboards, _, cursor = leaderboardCache.ListAll(1_000, false, cursor)

			for _, leaderboard := range leaderboards {
				if _, ok := cache.blacklistIds[leaderboard.Id]; ok {
					startupLogger.Debug("Skip caching leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id))

					skippedLeaderboards = append(skippedLeaderboards, leaderboard.Id)
					continue
				}

				if _, found := cachedLeaderboardsMap[leaderboard.Id]; found {
					continue
				}

				cachedLeaderboardsMap[leaderboard.Id] = struct{}{}
				lbChan <- leaderboard
			}

			if cursor == nil {
				break
			}
		}

		close(lbChan)
		// Wait for workers
		wg.Wait()

		startupLogger.Info("Leaderboard rank cache initialization completed successfully", zap.Strings("cached", cachedLeaderboards), zap.Strings("skipped", skippedLeaderboards), zap.Duration("duration", time.Since(nowTime)))
	}()

	return cache
}

func (l *LocalLeaderboardRankCache) Get(leaderboardId string, sortOrder int, score, subscore, expiryUnix int64, ownerID uuid.UUID) int64 {
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
	rankData := newRank(sortOrder, score, subscore, ownerID)
	rankCache.RLock()
	rank := rankCache.cache.GetRank(rankData)
	rankCache.RUnlock()

	return int64(rank)
}

func (l *LocalLeaderboardRankCache) Fill(leaderboardId string, sortOrder int, expiryUnix int64, records []*api.LeaderboardRecord) int64 {
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

	rankCache.RLock()
	count := rankCache.cache.Len()

	if len(records) == 0 {
		// Nothing more to do.
		rankCache.RUnlock()
		return int64(count)
	}

	// Find rank data for each owner.
	for _, record := range records {
		ownerID, err := uuid.FromString(record.OwnerId)
		if err != nil {
			continue
		}
		rankData := newRank(sortOrder, record.Score, record.Subscore, ownerID)
		record.Rank = int64(rankCache.cache.GetRank(rankData))
	}
	rankCache.RUnlock()

	return int64(count)
}

func (l *LocalLeaderboardRankCache) Insert(leaderboardId string, sortOrder int, score, subscore int64, oldScore, oldSubscore *int64, expiryUnix int64, ownerID uuid.UUID) int64 {
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
			cache: skiplist.New(),
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
	rankData := newRank(sortOrder, score, subscore, ownerID)
	var oldRankData skiplist.Interface

	// We need old scores in order to locate and the remove the existing record
	if oldScore != nil && oldSubscore != nil {
		oldRankData = newRank(sortOrder, *oldScore, *oldSubscore, ownerID)
	}

	// Check for and remove any previous rank entry, then insert the new rank data and get its rank.
	rankCache.Lock()
	if oldRankData != nil {
		rankCache.cache.Delete(oldRankData)
	}
	rankCache.cache.Insert(rankData)
	rank := rankCache.cache.GetRank(rankData)
	rankCache.Unlock()

	return int64(rank)
}

func (l *LocalLeaderboardRankCache) Delete(leaderboardId string, sortOrder int, score, subscore, expiryUnix int64, ownerID uuid.UUID) bool {
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
	rankData := newRank(sortOrder, score, subscore, ownerID)
	rankCache.Lock()
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

func leaderboardCacheInitWorker(
	ctx context.Context,
	wg *sync.WaitGroup,
	iter *uint64,
	cache *LocalLeaderboardRankCache,
	db *sql.DB,
	startupLogger *zap.Logger,
	ch <-chan *Leaderboard,
	nowTime time.Time,
	cachedLeaderboards *[]string,
	mu *sync.Mutex) {

	defer wg.Done()

	batchSize := uint64(10_000)
	batchSizeStr := fmt.Sprintf("%d", batchSize)

	// Look up all active records for this leaderboard.
	for leaderboard := range ch {
		var score int64
		var subscore int64
		var ownerIDStr string

		mu.Lock()
		*cachedLeaderboards = append(*cachedLeaderboards, leaderboard.Id)
		mu.Unlock()

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

		if expiryUnix != 0 && expiryUnix <= nowTime.Unix() {
			// Last scores for this leaderboard have expired, do not cache them.
			continue
		}

		// Prepare structure to receive rank data.
		key := LeaderboardWithExpiry{LeaderboardId: leaderboard.Id, Expiry: expiryUnix}
		cache.Lock()
		rankCache, found := cache.cache[key]
		if !found {
			rankCache = &RankCache{
				cache: skiplist.New(),
			}
			cache.cache[key] = rankCache
		}
		cache.Unlock()

		expiryTime := time.Unix(expiryUnix, 0).UTC()
		startupLogger.Debug("Caching leaderboard ranks",
			zap.String("leaderboard_id", leaderboard.Id))

		for {
			ranks := make(map[uuid.UUID]skiplist.Interface, batchSize)

			query := "SELECT owner_id, score, subscore FROM leaderboard_record WHERE leaderboard_id = $1 AND expiry_time = $2"
			params := []interface{}{leaderboard.Id, expiryTime}
			if ownerIDStr != "" {
				query += " AND (leaderboard_id, expiry_time, score, subscore, owner_id) > ($1, $2, $3, $4, $5)"
				params = append(params, score, subscore, ownerIDStr)
			}
			// Does not need to be in leaderboard order, sorting is done in the rank cache structure anyway.
			query += " ORDER BY leaderboard_id ASC, expiry_time ASC, score ASC, subscore ASC, owner_id ASC LIMIT " + batchSizeStr

			rows, err := db.QueryContext(ctx, query, params...)

			if err != nil {
				startupLogger.Error("Failed to cache leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
				if err == context.Canceled {
					// All further queries will fail, no need to continue looping through leaderboards.
					return
				}

				break
			}

			// Read score information.
			for rows.Next() {
				if err = rows.Scan(&ownerIDStr, &score, &subscore); err != nil {
					startupLogger.Error("Failed to scan leaderboard rank data", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
					break
				}

				ownerID, err := uuid.FromString(ownerIDStr)
				if err != nil {
					startupLogger.Error("Failed to parse scanned leaderboard rank data", zap.String("leaderboard_id", leaderboard.Id), zap.String("owner_id", ownerIDStr), zap.Error(err))
					break
				}

				// Prepare new rank data for this leaderboard entry.
				rankData := newRank(leaderboard.SortOrder, score, subscore, ownerID)
				ranks[ownerID] = rankData
			}
			_ = rows.Close()

			// Explicitly run GC every N batches to minimize accumulating
			// temporary cruft from db reading, parsing etc.
			// Doing this more often can result in a smoother inuse memory curve
			// but at the cost of increased CPU usage.
			if atomic.AddUint64(iter, batchSize)%(batchSize*30) == 0 {
				runtime.GC()
			}

			rankCount := uint64(len(ranks))
			if rankCount == 0 {
				// Empty batch of results, end pagination for this leaderboard.
				break
			}

			// Insert into rank cache in batches.
			rankCache.Lock()
			for _, rankData := range ranks {
				if oldRankData := rankCache.cache.Find(rankData); oldRankData != nil {
					continue
				}
				rankCache.cache.Insert(rankData)
			}
			rankCache.Unlock()

			// Stop pagination when reaching the last (incomplete) page.
			if rankCount < batchSize {
				break
			}
		}
	}
}

func newRank(sortOrder int, score, subscore int64, ownerID uuid.UUID) skiplist.Interface {

	if sortOrder == LeaderboardSortOrderDescending {
		return RankDesc{
			OwnerId:  ownerID,
			Score:    score,
			Subscore: subscore,
		}
	} else {
		return RankAsc{
			OwnerId:  ownerID,
			Score:    score,
			Subscore: subscore,
		}
	}
}
