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
	"errors"
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
	logger    *zap.Logger
	db        *sql.DB
	config    Config
	cache     LeaderboardCache
	rankCache LeaderboardRankCache

	fnLeaderboardReset RuntimeLeaderboardResetFunction
	fnTournamentReset  RuntimeTournamentResetFunction
	fnTournamentEnd    RuntimeTournamentEndFunction

	started bool
	active  *atomic.Uint32
	queue   chan *LeaderboardSchedulerCallback

	updateCh chan struct{}

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

		queue:    make(chan *LeaderboardSchedulerCallback, config.GetLeaderboard().CallbackQueueSize),
		active:   atomic.NewUint32(1),
		updateCh: make(chan struct{}, 1),

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

	ls.fnLeaderboardReset = runtime.LeaderboardReset()
	ls.fnTournamentReset = runtime.TournamentReset()
	ls.fnTournamentEnd = runtime.TournamentEnd()

	for i := 0; i < ls.config.GetLeaderboard().CallbackQueueWorkers; i++ {
		go ls.invokeCallback()
	}

	go ls.scheduleLoop()

	ls.Update()
}

func (ls *LocalLeaderboardScheduler) Pause() {
	ls.logger.Info("Leaderboard scheduler pause")
	if !ls.active.CompareAndSwap(1, 0) {
		return
	}
	// Wake the scheduling loop so it sees the paused state immediately.
	select {
	case ls.updateCh <- struct{}{}:
	default:
	}
}

func (ls *LocalLeaderboardScheduler) Resume() {
	ls.logger.Info("Leaderboard scheduler resume")
	if !ls.active.CompareAndSwap(0, 1) {
		return
	}
	ls.Update()
}

func (ls *LocalLeaderboardScheduler) Stop() {
	ls.ctxCancelFn()
}

// Update signals the scheduling loop to recompute its next wake time.
func (ls *LocalLeaderboardScheduler) Update() {
	if !ls.started {
		return
	}
	select {
	case ls.updateCh <- struct{}{}:
	default:
	}
}

func (ls *LocalLeaderboardScheduler) scheduleLoop() {
	var lastFireUnix int64
	for {
		// While paused, block until a signal arrives.
		if ls.active.Load() == 0 {
			select {
			case <-ls.ctx.Done():
				return
			case <-ls.updateCh:
			}
			continue
		}

		now := time.Now().UTC()
		endActiveTs, expiryTs, endActiveIds, expiryIds := ls.computeNext(now)

		// Filter out any events already processed in a previous iteration to
		// guard against re-queuing hooks within the same second as the last fire.
		if endActiveTs > 0 && endActiveTs <= lastFireUnix {
			endActiveTs = -1
			endActiveIds = nil
		}
		if expiryTs > 0 && expiryTs <= lastFireUnix {
			expiryTs = -1
			expiryIds = nil
		}

		// Pick the earlier of the two deadlines as the next wake time.
		wakeTs := int64(-1)
		if endActiveTs > 0 {
			wakeTs = endActiveTs
		}
		if expiryTs > 0 && (wakeTs < 0 || expiryTs < wakeTs) {
			wakeTs = expiryTs
		}

		ls.logger.Info("Leaderboard scheduler update",
			zap.Int64("end_active_ts", endActiveTs),
			zap.Int("end_active_count", len(endActiveIds)),
			zap.Int64("expiry_ts", expiryTs),
			zap.Int("expiry_count", len(expiryIds)),
		)

		if wakeTs < 0 {
			// Nothing to schedule, block until Update() signals or context is cancelled.
			select {
			case <-ls.ctx.Done():
				return
			case <-ls.updateCh:
				continue
			}
		}

		delay := time.Unix(wakeTs, 0).UTC().Sub(now)
		if delay < 0 {
			delay = 0
		}

		timer := time.NewTimer(delay)
		select {
		case <-ls.ctx.Done():
			timer.Stop()
			return

		case <-ls.updateCh:
			// Update() called while waiting for next hook execution, recompute schedules.
			select {
			case t := <-timer.C:
				// Timer fired at the same time as an Update() call, process hooks.
				lastFireUnix = t.Unix()
				ls.processHooks(t, endActiveTs, expiryTs, endActiveIds, expiryIds)
			default:
				// Update() was called, stop timer and recalculate new wake time.
				timer.Stop()
			}
		case t := <-timer.C:
			lastFireUnix = t.Unix()
			ls.processHooks(t, endActiveTs, expiryTs, endActiveIds, expiryIds)
		}
	}
}

func (ls *LocalLeaderboardScheduler) processHooks(ts time.Time, endActiveTs, expiryTs int64, endActiveIds, expiryIds []string) {
	fireUnix := ts.Unix()
	if endActiveTs > 0 && endActiveTs <= fireUnix {
		ls.processEndActive(time.Unix(endActiveTs, 0).UTC(), endActiveIds)
	}
	if expiryTs > 0 && expiryTs <= fireUnix {
		ls.rankCache.TrimExpired(expiryTs)
		ls.processExpiry(time.Unix(expiryTs, 0).UTC(), expiryIds)
	}
}

func (ls *LocalLeaderboardScheduler) computeNext(now time.Time) (endActiveTs, expiryTs int64, endActiveIds []string, expiryIds []string) {
	endActiveTs = -1
	expiryTs = -1
	nowUnix := now.Unix()

	var cursor *LeaderboardAllCursor
	for {
		var leaderboards []*Leaderboard
		leaderboards, _, cursor = ls.cache.ListAll(1_000, false, cursor)

		for _, l := range leaderboards {
			if l.IsTournament() {
				_, endActive, expiry := calculateTournamentDeadlines(l.StartTime, l.EndTime, int64(l.Duration), l.ResetSchedule, now)

				if l.EndTime > 0 && l.EndTime < nowUnix {
					// Tournament has ended permanently.
					continue
				}

				if endActive > 0 && nowUnix < endActive {
					if endActiveTs < 0 || endActive < endActiveTs {
						endActiveTs = endActive
						endActiveIds = []string{l.Id}
					} else if endActive == endActiveTs {
						endActiveIds = append(endActiveIds, l.Id)
					}
				}

				if expiry > 0 {
					if expiryTs < 0 || expiry < expiryTs {
						expiryTs = expiry
						expiryIds = []string{l.Id}
					} else if expiry == expiryTs {
						expiryIds = append(expiryIds, l.Id)
					}
				}
			} else {
				// Leaderboards don't end, only check for expiry.
				if l.ResetSchedule != nil {
					expiry := l.ResetSchedule.Next(now).UTC().Unix()
					if expiryTs < 0 || expiry < expiryTs {
						expiryTs = expiry
						expiryIds = []string{l.Id}
					} else if expiry == expiryTs {
						expiryIds = append(expiryIds, l.Id)
					}
				}
			}
		}

		if cursor == nil {
			break
		}
	}
	return
}

func (ls *LocalLeaderboardScheduler) processEndActive(t time.Time, ids []string) {
	if ls.fnTournamentEnd == nil {
		return
	}

	ts := t.Unix()
	tMinusOne := time.Unix(ts-1, 0).UTC()

	ls.logger.Info("Leaderboard scheduler end active", zap.Int("count", len(ids)))

	go func() {
		for _, id := range ids {
			select {
			case ls.queue <- &LeaderboardSchedulerCallback{id: id, ts: ts, t: tMinusOne}:
			case <-ls.ctx.Done():
				return
			}
		}
	}()
}

func (ls *LocalLeaderboardScheduler) processExpiry(t time.Time, ids []string) {
	ts := t.Unix()
	tMinusOne := time.Unix(ts-1, 0).UTC()

	ls.logger.Info("Leaderboard scheduler expiry reset", zap.Int("count", len(ids)))

	go func() {
		// Queue the current set of leaderboard and tournament resets.
		// Executes inside a goroutine to ensure further invocation timings are not skewed.
		for _, id := range ids {
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
			select {
			case ls.queue <- &LeaderboardSchedulerCallback{id: id, leaderboard: leaderboard, ts: ts, t: tMinusOne}:
			case <-ls.ctx.Done():
				return
			}
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
					// Tournament, fetch most up-to-date info for size etc.
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
					if !errors.Is(err, sql.ErrNoRows) {
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
