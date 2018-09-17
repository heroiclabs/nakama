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

	"go.uber.org/zap"
)

type LeaderboardScheduler struct {
	sync.Mutex
	logger           *zap.Logger
	db               *sql.DB
	cache            LeaderboardCache
	rankCache        LeaderboardRankCache
	runtime          *Runtime
	endActiveTimer   *time.Timer
	expiryTimer      *time.Timer
	nearEndActiveIds []string
	nearExpiryIds    []string
}

func NewLeaderboardScheduler(logger *zap.Logger, db *sql.DB, cache LeaderboardCache, rankCache LeaderboardRankCache, runtime *Runtime) *LeaderboardScheduler {
	return &LeaderboardScheduler{
		logger:    logger,
		db:        db,
		cache:     cache,
		rankCache: rankCache,
		runtime:   runtime,
	}
}

func (ls *LeaderboardScheduler) Start() {
	ls.Update()
}

func (ls *LeaderboardScheduler) Stop() {
	ls.Lock()
	if ls.endActiveTimer != nil {
		ls.endActiveTimer.Stop()
	}
	if ls.expiryTimer != nil {
		ls.expiryTimer.Stop()
	}
	ls.Unlock()
}

func (ls *LeaderboardScheduler) Update() {
	endActive, endActiveIds, expiry, expiryIds := ls.findEndActiveAndExpiry()

	ls.Lock()
	ls.nearEndActiveIds = endActiveIds
	ls.nearExpiryIds = expiryIds

	if ls.endActiveTimer != nil {
		ls.endActiveTimer.Stop()
	}
	if ls.expiryTimer != nil {
		ls.expiryTimer.Stop()
	}
	if endActive > -1 {
		ls.endActiveTimer = time.AfterFunc(endActive, ls.invokeDurationElapse)
	}
	if expiry > -1 {
		ls.expiryTimer = time.AfterFunc(expiry, ls.invokeExpiryElapse)
	}
	ls.Unlock()
}

func (ls *LeaderboardScheduler) findEndActiveAndExpiry() (time.Duration, []string, time.Duration, []string) {
	leaderboards := ls.cache.GetAllLeaderboards()
	now := time.Now().UTC()

	earliestEndActive := int64(-1)
	earliestExpiry := int64(-1)

	endActiveLeaderboardIds := make([]string, 0)
	expiryLeaderboardIds := make([]string, 0)

	for _, l := range leaderboards {
		if l.Duration > 0 { // a tournament
			endActive, expiry := calculateTournamentDeadlines(l, now)
			if earliestEndActive == -1 || endActive < earliestEndActive {
				earliestEndActive = endActive

				endActiveLeaderboardIds = []string{l.Id}
			} else if endActive == earliestEndActive {
				endActiveLeaderboardIds = append(endActiveLeaderboardIds, l.Id)
			}

			if earliestExpiry == -1 || expiry < earliestExpiry {
				earliestExpiry = expiry
			}
		} else {
			expiry := calculateLeaderboardExpiry(l, now)
			if earliestExpiry == -1 || expiry < earliestExpiry {
				earliestExpiry = expiry
			}
		}
	}

	endActiveDuration := time.Duration(-1)
	expiryDuration := time.Duration(-1)
	if earliestEndActive > -1 {
		earliestEndActiveTime := time.Unix(earliestEndActive, 0).UTC()
		endActiveDuration = earliestEndActiveTime.Sub(now)
	}

	if earliestExpiry > -1 {
		earliestExpiryTime := time.Unix(earliestExpiry, 0).UTC()
		expiryDuration = earliestExpiryTime.Sub(now)
	}
	return endActiveDuration, endActiveLeaderboardIds, expiryDuration, expiryLeaderboardIds
}

func (ls *LeaderboardScheduler) invokeDurationElapse() {
	ls.Lock()
	for _, id := range ls.nearEndActiveIds {
		// TODO (zyro) - call win func
		// ls.runtime...

		// TODO - remove the following line
		ls.logger.Info("Duration elapsed for", zap.String("tournament_id", id))
	}
	ls.Unlock()
	ls.Update()
}

func (ls *LeaderboardScheduler) invokeExpiryElapse() {
	ls.Lock()
	resetTournamentSize(ls.logger, ls.db, ls.nearExpiryIds)
	ls.Unlock()

	ls.rankCache.TrimExpired()
	ls.Update()
}
