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

	"github.com/gofrs/uuid"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

type LeaderboardRankCache interface {
	Get(leaderboardId string, ownerId uuid.UUID) uint
	Insert(leaderboardId string, leaderboardExpiry int, ownerId uuid.UUID, score, subscore int) uint
	Delete(leaderboardId string, ownerId uuid.UUID)
	DeleteLeaderboard(leaderboardId string)
}

type RankData struct {
	ownerId  uuid.UUID
	score    int
	subscore int
	rank     uint
}

type RankMap struct {
	sync.RWMutex
	ranks    []*RankData
	haystack map[uuid.UUID]*RankData
}

type LeaderboardWithExpiry struct {
	leaderboardId string
	expiry        int
}

type LocalLeaderboardRankCache struct {
	sync.RWMutex
	cache  map[*LeaderboardWithExpiry]*RankMap
	timer  *time.Timer
	logger *zap.Logger
}

func NewLocalLeaderboardRankCache(logger, startupLogger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache) *LocalLeaderboardRankCache {
	cache := &LocalLeaderboardRankCache{
		logger: logger,
		cache:  make(map[*LeaderboardWithExpiry]*RankMap, 0),
	}

	// TODO config option to disable caching at start...
	if err := cache.Start(startupLogger, db, leaderboardCache); err != nil {
		startupLogger.Fatal("Could not cache leaderboard ranks at start.", zap.Error(err))
		return nil
	}

	// TODO setup timer

	return cache
}

func (l *LocalLeaderboardRankCache) Start(startupLogger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache) error {
	startupLogger.Info("Initializing leaderboard rank cache.")
	leaderboards := leaderboardCache.GetAllLeaderboards()
	for _, leaderboard := range leaderboards {
		startupLogger.Debug("Caching leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id))

		rankEntries := &RankMap{
			ranks:    make([]*RankData, 0),
			haystack: make(map[uuid.UUID]*RankData),
		}
		leaderboardWithExpiry := &LeaderboardWithExpiry{leaderboard.Id, 0}
		l.cache[leaderboardWithExpiry] = rankEntries

		query := `
SELECT owner_id, score, subscore, expiry_time
FROM leaderboard_record
WHERE leaderboard_id = $1 AND expiry_time > now()`
		rows, err := db.Query(query, leaderboard.Id)
		if err != nil {
			startupLogger.Debug("Failed to caching leaderboard ranks", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
			return err
		}

		for rows.Next() {
			var dbExpiry pq.NullTime
			var ownerId string
			rankData := &RankData{rank: uint(len(rankEntries.ranks))}

			if err = rows.Scan(&ownerId, &rankData.score, &rankData.subscore, &dbExpiry); err != nil {
				startupLogger.Debug("Failed to scan leaderboard rank data", zap.String("leaderboard_id", leaderboard.Id), zap.Error(err))
				return err
			}

			rankData.ownerId = uuid.Must(uuid.FromString(ownerId))
			if dbExpiry.Valid && dbExpiry.Time.UTC().Unix() != 0 {
				expiryTime := int(dbExpiry.Time.UTC().Unix())
				if leaderboardWithExpiry.expiry == 0 {
					leaderboardWithExpiry.expiry = expiryTime
				} else if leaderboardWithExpiry.expiry != expiryTime {
					startupLogger.Warn("Encountered a leaderboard record with same leaderboard ID but different expiry times.",
						zap.String("leaderboard_id", leaderboard.Id),
						zap.String("owner_id", ownerId),
						zap.Int("expiry_time", leaderboardWithExpiry.expiry),
						zap.Int("different_expiry_time", expiryTime))

					rankMap := &RankMap{
						ranks:    make([]*RankData, 0),
						haystack: make(map[uuid.UUID]*RankData),
					}
					leaderboardWithExpiry := &LeaderboardWithExpiry{leaderboard.Id, 0}
					l.cache[leaderboardWithExpiry] = rankMap
				}
			}

			rankEntries.ranks = append(rankEntries.ranks, rankData)
			rankEntries.haystack[rankData.ownerId] = rankData
		}
		rows.Close()
	}

	for k, v := range l.cache {
		startupLogger.Debug("Sorting leaderboard ranks", zap.String("leaderboard_id", k.leaderboardId), zap.Int("count", len(v.ranks)))
		l.sortRanks(v)
	}
	startupLogger.Info("Leaderboard rank cache initialization completed succesfully.")

	return nil
}

func (l *LocalLeaderboardRankCache) Get(leaderboardId string, ownerId uuid.UUID) uint {
	l.RLock()
	for k, rankMap := range l.cache {
		if k.leaderboardId == leaderboardId {
			rankMap.RLock()
			result := rankMap.haystack[ownerId].rank
			rankMap.RUnlock()
			return result
		}
	}
	l.RUnlock()
	return 0
}

func (l *LocalLeaderboardRankCache) Insert(leaderboardId string, leaderboardExpiry int, ownerId uuid.UUID, score, subscore int) uint {
	l.RLock()
	var rankMap *RankMap
	for k, v := range l.cache {
		if k.leaderboardId == leaderboardId && k.expiry == leaderboardExpiry {
			rankMap = v
		}
	}
	l.RUnlock()

	if rankMap == nil {
		// new leaderboard created after server start
		l.Lock()
		rankMap = &RankMap{
			ranks:    make([]*RankData, 0),
			haystack: make(map[uuid.UUID]*RankData),
		}
		leaderboardWithExpiry := &LeaderboardWithExpiry{leaderboardId, leaderboardExpiry}
		l.cache[leaderboardWithExpiry] = rankMap
		l.Unlock()
	}

	rankMap.Lock()
	rankData := rankMap.haystack[ownerId]
	if rankData != nil {
		rankData.score = score
		rankData.subscore = subscore
	} else {
		rankData = &RankData{
			ownerId:  ownerId,
			score:    score,
			subscore: subscore,
			rank:     uint(len(rankMap.ranks)),
		}
		rankMap.haystack[ownerId] = rankData
		rankMap.ranks = append(rankMap.ranks, rankData)
	}

	l.sortRanks(rankMap)
	rankMap.Unlock()

	return rankData.rank
}

func (l *LocalLeaderboardRankCache) Delete(leaderboardId string, ownerId uuid.UUID) {
	l.RLock()
	for k, rankMap := range l.cache {
		if k.leaderboardId == leaderboardId {
			rankMap.Lock()
			rankData := rankMap.haystack[ownerId]

			delete(rankMap.haystack, ownerId)
			rankMap.ranks = append(rankMap.ranks[:rankData.rank], rankMap.ranks[rankData.rank+1:]...)

			rankMap.Unlock()
		}
	}
	l.RUnlock()
}

func (l *LocalLeaderboardRankCache) DeleteLeaderboard(leaderboardId string) {
	l.RLock()
	for k := range l.cache {
		if k.leaderboardId == leaderboardId {
			delete(l.cache, k)
		}
	}
	l.RUnlock()
}

func (l *LocalLeaderboardRankCache) trimExpired() {
	// used for the timer
	l.Lock()
	currentTime := time.Now().UTC().Unix()
	for k := range l.cache {
		if k.expiry <= int(currentTime) {
			delete(l.cache, k)
		}
	}
	l.Unlock()
}

func (l *LocalLeaderboardRankCache) sortRanks(rankMap *RankMap) {
	// do not lock/unlock in this func
	// TODO do rank calculation
}
