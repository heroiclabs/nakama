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

func NewLeaderboardScheduler(logger *zap.Logger, db *sql.DB, cache LeaderboardCache, rankCache LeaderboardRankCache) *LeaderboardScheduler {
	return &LeaderboardScheduler{
		logger:    logger,
		db:        db,
		cache:     cache,
		rankCache: rankCache,
	}
}

func (ls *LeaderboardScheduler) Start(runtime *Runtime) {
	ls.runtime = runtime
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
	if ls.runtime == nil {
		// In case the update is called during runtime VM init, skip setting timers until ready.
		return
	}

	now := time.Now().UTC()
	nowUnix := now.Unix()

	// Grab the set of known leaderboards.
	leaderboards := ls.cache.GetAllLeaderboards()

	earliestEndActive := int64(-1)
	earliestExpiry := int64(-1)

	endActiveLeaderboardIds := make([]string, 0)
	expiryLeaderboardIds := make([]string, 0)

	for _, l := range leaderboards {
		if l.Duration > 0 {
			// Tournament.
			_, endActive, expiry := calculateTournamentDeadlines(l, now)

			if l.EndTime > 0 && l.EndTime < nowUnix {
				// Tournament has ended permanently.
				continue
			}

			// Check tournament end.
			if endActive > 0 && nowUnix < endActive {
				if earliestEndActive == -1 || endActive < earliestEndActive {
					earliestEndActive = endActive
					endActiveLeaderboardIds = []string{l.Id}
				} else if endActive == earliestEndActive {
					endActiveLeaderboardIds = append(endActiveLeaderboardIds, l.Id)
				}
			}

			// Check tournament expiry.
			if expiry > 0 {
				if earliestExpiry == -1 || expiry < earliestExpiry {
					earliestExpiry = expiry
					expiryLeaderboardIds = []string{l.Id}
				} else if expiry == earliestExpiry {
					expiryLeaderboardIds = append(expiryLeaderboardIds, l.Id)
				}
			}
		} else {
			// Leaderboard.
			if l.ResetSchedule != nil {
				// Leaderboards don't end, only check for expiry.
				expiry := l.ResetSchedule.Next(now).UTC().Unix()

				if earliestExpiry == -1 || expiry < earliestExpiry {
					earliestExpiry = expiry
					expiryLeaderboardIds = []string{l.Id}
				} else if expiry == earliestExpiry {
					expiryLeaderboardIds = append(expiryLeaderboardIds, l.Id)
				}
			}
		}
	}

	endActiveDuration := time.Duration(-1)
	if earliestEndActive > -1 {
		endActiveDuration = time.Unix(earliestEndActive, 0).UTC().Sub(now)
	}

	expiryDuration := time.Duration(-1)
	if earliestExpiry > -1 {
		expiryDuration = time.Unix(earliestExpiry, 0).UTC().Sub(now)
	}

	// Replace IDs earmarked for end and expiry, and restart timers as needed.
	ls.Lock()
	ls.nearEndActiveIds = endActiveLeaderboardIds
	ls.nearExpiryIds = expiryLeaderboardIds

	if ls.endActiveTimer != nil {
		ls.endActiveTimer.Stop()
	}
	if ls.expiryTimer != nil {
		ls.expiryTimer.Stop()
	}
	if endActiveDuration > -1 {
		ls.logger.Debug("Setting timer to run end active function", zap.Duration("end_active", endActiveDuration), zap.Strings("ids", ls.nearEndActiveIds))
		ls.endActiveTimer = time.AfterFunc(endActiveDuration, func() {
			ls.invokeEndActiveElapse(time.Unix(earliestEndActive, 0).UTC())
		})
	}
	if expiryDuration > -1 {
		ls.logger.Debug("Setting timer to run expiry function", zap.Duration("expiry", expiryDuration), zap.Strings("ids", ls.nearExpiryIds))
		ls.expiryTimer = time.AfterFunc(expiryDuration, func() {
			ls.invokeExpiryElapse(time.Unix(earliestExpiry, 0).UTC())
		})
	}
	ls.Unlock()
}

func (ls *LeaderboardScheduler) invokeEndActiveElapse(t time.Time) {
	// Skip processing if there is no tournament end callback registered.
	fn := ls.runtime.TournamentEnd()
	if fn == nil {
		return
	}

	ls.Lock()
	ids := ls.nearEndActiveIds
	ls.Unlock()

	// Immediately schedule the next invocation to avoid any gaps caused by time spent processing below.
	ls.Update()

	// Process the current set of tournament ends.
	for _, id := range ids {
		query := `SELECT 
id, sort_order, reset_schedule, metadata, create_time, 
category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE id = $1`
		row := ls.db.QueryRow(query, id)
		tournament, err := parseTournament(row, t)
		if err != nil {
			ls.logger.Error("Error retrieving tournament to invoke end callback", zap.Error(err), zap.String("id", id))
			continue
		}

		// Trigger callback on a goroutine so any extended processing does not block future scheduling.
		go func() {
			if err := fn(tournament, int64(tournament.EndActive), int64(tournament.NextReset)); err != nil {
				ls.logger.Warn("Failed to invoke tournament end callback", zap.Error(err))
			}
		}()
	}
}

func (ls *LeaderboardScheduler) invokeExpiryElapse(t time.Time) {
	fnLeaderboardReset := ls.runtime.LeaderboardReset()
	fnTournamentReset := ls.runtime.TournamentReset()

	ls.Lock()
	ids := ls.nearEndActiveIds
	ls.Unlock()

	// Immediately schedule the next invocation to avoid any gaps caused by time spent processing below.
	ls.rankCache.TrimExpired(t.Unix())
	ls.Update()

	// Process the current set of leaderboard and tournament resets.
	for _, id := range ids {
		leaderboardOrTournament := ls.cache.Get(id)
		if leaderboardOrTournament.IsTournament() {
			// Tournament, fetch most up to date info for size etc.
			// Some processing is needed even if there is no runtime callback registered for tournament reset.
			query := `SELECT 
id, sort_order, reset_schedule, metadata, create_time, 
category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE id = $1`
			row := ls.db.QueryRow(query, id)
			tournament, err := parseTournament(row, t)
			if err != nil {
				ls.logger.Error("Error retrieving tournament to invoke reset callback", zap.Error(err), zap.String("id", id))
				continue
			}

			// Reset tournament size in DB to make it immediately usable for the next active period.
			if _, err := ls.db.Exec("UPDATE leaderboard SET size = 0 WHERE id = $1", id); err != nil {
				ls.logger.Error("Could not reset leaderboard size", zap.Error(err), zap.String("id", id))
			}

			if fnTournamentReset != nil {
				// Trigger callback on a goroutine so any extended processing does not block future scheduling.
				go func() {
					if err := fnTournamentReset(tournament, int64(tournament.EndActive), int64(tournament.NextReset)); err != nil {
						ls.logger.Warn("Failed to invoke tournament reset callback", zap.Error(err))
					}
				}()
			}
		} else {
			// Leaderboard.
			if fnLeaderboardReset != nil {
				nextReset := int64(0)
				if leaderboardOrTournament.ResetSchedule != nil {
					nextReset = leaderboardOrTournament.ResetSchedule.Next(t).UTC().Unix()
				}

				// Trigger callback on a goroutine so any extended processing does not block future scheduling.
				go func() {
					if err := fnLeaderboardReset(leaderboardOrTournament, nextReset); err != nil {
						ls.logger.Warn("Failed to invoke leaderboard reset callback", zap.Error(err))
					}
				}()
			}
		}
	}
}
