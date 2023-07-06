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
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type LeaderboardSchedulerCallback struct {
	id          string
	leaderboard *Leaderboard
	ts          int64
	t           time.Time
}

type LeaderboardScheduler interface {
	Start(runtime *Runtime)
	Pause()
	Resume()
	Stop()
	Update()
}

type LocalLeaderboardScheduler struct {
	sync.Mutex
	logger    *zap.Logger
	db        *sql.DB
	config    Config
	cache     LeaderboardCache
	rankCache LeaderboardRankCache

	fnLeaderboardReset RuntimeLeaderboardResetFunction
	fnTournamentReset  RuntimeTournamentResetFunction
	fnTournamentEnd    RuntimeTournamentEndFunction

	endActiveTimer *time.Timer
	expiryTimer    *time.Timer
	lastEnd        int64
	lastExpiry     int64

	started bool
	queue   chan *LeaderboardSchedulerCallback
	active  *atomic.Uint32

	ctx         context.Context
	ctxCancelFn context.CancelFunc
}

func NewLocalLeaderboardScheduler(logger *zap.Logger, db *sql.DB, config Config, cache LeaderboardCache, rankCache LeaderboardRankCache) LeaderboardScheduler {
	ctx, ctxCancelFn := context.WithCancel(context.Background())
	s := &LocalLeaderboardScheduler{
		logger:    logger,
		db:        db,
		config:    config,
		cache:     cache,
		rankCache: rankCache,

		// endActiveTimer only initialized when needed.
		// expiryTimer only initialized when needed.
		// lastEnd only initialized when needed.
		// lastExpiry only initialized when needed.

		queue:  make(chan *LeaderboardSchedulerCallback, config.GetLeaderboard().CallbackQueueSize),
		active: atomic.NewUint32(1),

		ctx:         ctx,
		ctxCancelFn: ctxCancelFn,
	}

	// Ensure trimming of expired scores that don't have resets or functions attached.
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case t := <-ticker.C:
				s.rankCache.TrimExpired(t.Unix())
			}
		}
	}()

	return s
}

func (ls *LocalLeaderboardScheduler) Start(runtime *Runtime) {
	ls.logger.Info("Leaderboard scheduler start")
	ls.started = true

	// Capture callback references, if any are registered.
	ls.fnLeaderboardReset = runtime.LeaderboardReset()
	ls.fnTournamentReset = runtime.TournamentReset()
	ls.fnTournamentEnd = runtime.TournamentEnd()

	// Start the required number of callback workers.
	for i := 0; i < ls.config.GetLeaderboard().CallbackQueueWorkers; i++ {
		go ls.invokeCallback()
	}

	ls.Update()
}

func (ls *LocalLeaderboardScheduler) Pause() {
	ls.logger.Info("Leaderboard scheduler pause")

	if !ls.active.CompareAndSwap(1, 0) {
		// Already paused.
		return
	}

	ls.Lock()
	if ls.endActiveTimer != nil {
		if !ls.endActiveTimer.Stop() {
			select {
			case <-ls.endActiveTimer.C:
			default:
			}
		}
	}
	if ls.expiryTimer != nil {
		if !ls.expiryTimer.Stop() {
			select {
			case <-ls.expiryTimer.C:
			default:
			}
		}
	}
	ls.Unlock()
}

func (ls *LocalLeaderboardScheduler) Resume() {
	ls.logger.Info("Leaderboard scheduler resume")

	if !ls.active.CompareAndSwap(0, 1) {
		// Already active.
		return
	}

	ls.Update()
}

func (ls *LocalLeaderboardScheduler) Stop() {
	ls.Lock()
	ls.ctxCancelFn()
	if ls.endActiveTimer != nil {
		if !ls.endActiveTimer.Stop() {
			select {
			case <-ls.endActiveTimer.C:
			default:
			}
		}
	}
	if ls.expiryTimer != nil {
		if !ls.expiryTimer.Stop() {
			select {
			case <-ls.expiryTimer.C:
			default:
			}
		}
	}
	ls.Unlock()
}

func (ls *LocalLeaderboardScheduler) Update() {
	if !ls.started {
		// In case the update is called during runtime VM init, skip setting timers until ready.
		return
	}

	if ls.active.Load() != 1 {
		// Not active.
		return
	}

	now := time.Now().UTC()
	nowUnix := now.Unix()

	earliestEndActive := int64(-1)
	earliestExpiry := int64(-1)

	endActiveLeaderboardIds := make([]string, 0, 1)
	expiryLeaderboardIds := make([]string, 0, 1)

	// Grab the set of known leaderboards in batches, and process them looking for expiry and end active times.
	var cursor *LeaderboardAllCursor
	for {
		var leaderboards []*Leaderboard
		leaderboards, _, cursor = ls.cache.ListAll(1_000, false, cursor)

		for _, l := range leaderboards {
			if l.IsTournament() {
				// Tournament.
				_, endActive, expiry := calculateTournamentDeadlines(l.StartTime, l.EndTime, int64(l.Duration), l.ResetSchedule, now)

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

		if cursor == nil {
			break
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
	if ls.endActiveTimer != nil {
		if !ls.endActiveTimer.Stop() {
			select {
			case <-ls.endActiveTimer.C:
			default:
			}
		}
	}
	if ls.expiryTimer != nil {
		if !ls.expiryTimer.Stop() {
			select {
			case <-ls.expiryTimer.C:
			default:
			}
		}
	}
	if endActiveDuration > -1 {
		ls.logger.Debug("Setting timer to run end active function", zap.Duration("end_active", endActiveDuration), zap.Strings("ids", endActiveLeaderboardIds))
		ls.endActiveTimer = time.AfterFunc(endActiveDuration, func() {
			ls.queueEndActiveElapse(time.Unix(earliestEndActive, 0).UTC(), endActiveLeaderboardIds)
		})
	}
	if expiryDuration > -1 {
		ls.logger.Debug("Setting timer to run expiry function", zap.Duration("expiry", expiryDuration), zap.Strings("ids", expiryLeaderboardIds))
		ls.expiryTimer = time.AfterFunc(expiryDuration, func() {
			ls.queueExpiryElapse(time.Unix(earliestExpiry, 0).UTC(), expiryLeaderboardIds)
		})
	}
	ls.Unlock()

	ls.logger.Info("Leaderboard scheduler update", zap.Duration("end_active", endActiveDuration), zap.Int("end_active_count", len(endActiveLeaderboardIds)), zap.Duration("expiry", expiryDuration), zap.Int("expiry_count", len(expiryLeaderboardIds)))
}

func (ls *LocalLeaderboardScheduler) queueEndActiveElapse(t time.Time, ids []string) {
	if ls.active.Load() != 1 {
		// Not active.
		return
	}

	ts := t.Unix()
	tMinusOne := time.Unix(ts-1, 0).UTC()

	// Immediately schedule the next invocation to avoid any gaps caused by time spent processing below.
	ls.Update()

	// Skip processing if there is no tournament end callback registered.
	if ls.fnTournamentEnd == nil {
		return
	}

	ls.Lock()
	if ls.lastEnd != 0 && ls.lastEnd >= ts {
		// Avoid running duplicate or delayed scheduling.
		ls.Unlock()
		return
	}
	ls.lastEnd = ts
	ls.Unlock()

	ls.logger.Info("Leaderboard scheduler end active", zap.Int("count", len(ids)))

	go func() {
		// Process the current set of tournament ends.
		for _, id := range ids {
			currentId := id
			// Will block if the queue is full.
			ls.queue <- &LeaderboardSchedulerCallback{id: currentId, ts: ts, t: tMinusOne}
		}
	}()
}

func (ls *LocalLeaderboardScheduler) queueExpiryElapse(t time.Time, ids []string) {
	if ls.active.Load() != 1 {
		// Not active.
		return
	}

	ts := t.Unix()
	tMinusOne := time.Unix(ts-1, 0).UTC()

	// Immediately schedule the next invocation to avoid any gaps caused by time spent processing below.
	ls.rankCache.TrimExpired(ts)
	ls.Update()

	ls.Lock()
	if ls.lastExpiry != 0 && ls.lastExpiry >= ts {
		// Avoid running duplicate or delayed scheduling.
		ls.Unlock()
		return
	}
	ls.lastExpiry = ts
	ls.Unlock()

	ls.logger.Info("Leaderboard scheduler expiry reset", zap.Int("count", len(ids)))

	go func() {
		// Queue the current set of leaderboard and tournament resets.
		// Executes inside a goroutine to ensure further invocation timings are not skewed.
		for _, id := range ids {
			currentId := id
			leaderboard := ls.cache.Get(id)
			if leaderboard == nil {
				// Cached entry was deleted before it reached the scheduler here.
				continue
			}
			if !leaderboard.IsTournament() && ls.fnLeaderboardReset == nil {
				// Skip further processing if there is no leaderboard reset callback registered.
				// Tournaments have some processing to do even if no callback is registered.
				continue
			}
			// Will block if queue is full.
			ls.queue <- &LeaderboardSchedulerCallback{id: currentId, leaderboard: leaderboard, ts: ts, t: tMinusOne}
		}
	}()
}

func (ls *LocalLeaderboardScheduler) invokeCallback() {
	for {
		select {
		case <-ls.ctx.Done():
			return
		case callback := <-ls.queue:
			if callback.leaderboard != nil {
				if callback.leaderboard.IsTournament() {
					// Tournament, fetch most up to date info for size etc.
					// Some processing is needed even if there is no runtime callback registered for tournament reset.
					query := `SELECT
id, sort_order, operator, reset_schedule, metadata, create_time,
category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE id = $1`
					row := ls.db.QueryRowContext(ls.ctx, query, callback.id)
					tournament, err := parseTournament(row, callback.t)
					if err != nil {
						ls.logger.Error("Error retrieving tournament to invoke reset callback", zap.Error(err), zap.String("id", callback.id))
						continue
					}

					// Reset tournament size in DB to make it immediately usable for the next active period.
					if _, err := ls.db.ExecContext(ls.ctx, "UPDATE leaderboard SET size = 0 WHERE id = $1", callback.id); err != nil {
						ls.logger.Error("Could not reset leaderboard size", zap.Error(err), zap.String("id", callback.id))
					}

					if ls.fnTournamentReset != nil {
						if err := ls.fnTournamentReset(ls.ctx, tournament, int64(tournament.EndActive), int64(tournament.NextReset)); err != nil {
							ls.logger.Warn("Failed to invoke tournament reset callback", zap.Error(err))
						}
					}
				} else {
					// Leaderboard.
					// fnLeaderboardReset cannot be nil here, if it was the callback would not be queued at all.
					l := &api.Leaderboard{
						Id:            callback.leaderboard.Id,
						SortOrder:     uint32(callback.leaderboard.SortOrder),
						Operator:      OperatorIntToEnum[callback.leaderboard.Operator],
						PrevReset:     uint32(calculatePrevReset(callback.t, callback.leaderboard.StartTime, callback.leaderboard.ResetSchedule)),
						NextReset:     uint32(callback.leaderboard.ResetSchedule.Next(callback.t).UTC().Unix()),
						Metadata:      callback.leaderboard.Metadata,
						CreateTime:    &timestamppb.Timestamp{Seconds: callback.leaderboard.CreateTime},
						Authoritative: callback.leaderboard.Authoritative,
					}
					if err := ls.fnLeaderboardReset(ls.ctx, l, callback.ts); err != nil {
						ls.logger.Warn("Failed to invoke leaderboard reset callback", zap.Error(err))
					}
				}
			} else {
				query := `SELECT
id, sort_order, operator, reset_schedule, metadata, create_time,
category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE id = $1`
				row := ls.db.QueryRowContext(ls.ctx, query, callback.id)
				tournament, err := parseTournament(row, callback.t)
				if err != nil {
					if err != sql.ErrNoRows {
						// Do not log if tournament was deleted before it reached the scheduler here.
						ls.logger.Error("Error retrieving tournament to invoke end callback", zap.Error(err), zap.String("id", callback.id))
					}
					continue
				}

				// fnTournamentEnd cannot be nil here, if it was the callback would not be queued at all.
				if err := ls.fnTournamentEnd(ls.ctx, tournament, int64(tournament.EndActive), int64(tournament.NextReset)); err != nil {
					ls.logger.Warn("Failed to invoke tournament end callback", zap.Error(err))
				}
			}
		}
	}
}
