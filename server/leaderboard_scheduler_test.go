package server

import (
	"context"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/stretchr/testify/assert"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

func TestLeaderboardSchedulerEndedTournamentHidesLiveExpiry(t *testing.T) {
	// Tournament with an explicit end_time and no reset schedule, so its expiry is the end_time.
	const tournamentEnd int64 = 1_700_000_000

	hourly, err := cronexpr.Parse("0 * * * *")
	if err != nil {
		t.Fatal(err)
	}

	ls := &LocalLeaderboardScheduler{
		cache: &LocalLeaderboardCache{
			allList: []*Leaderboard{
				{Id: "ending-tournament", Duration: 3600, StartTime: tournamentEnd - 7200, EndTime: tournamentEnd},
				{Id: "hourly-leaderboard", ResetScheduleStr: "0 * * * *", ResetSchedule: hourly},
			},
		},
	}

	liveExpiry := hourly.Next(time.Unix(tournamentEnd, 0).UTC()).UTC().Unix()

	// A second before the boundary the tournament's final expiry is legitimately the next deadline.
	_, expiryTs, _, expiryIds := ls.computeNext(tournamentEnd - 1)
	assert.Equal(t, tournamentEnd, expiryTs)
	assert.Equal(t, []string{"ending-tournament"}, expiryIds)

	// scheduleLoop fires at tournamentEnd then recomputes inside the same second, where the ended
	// tournament must drop out or it wins the earliest-deadline reduction and hides every live expiry.
	_, expiryTs, _, expiryIds = ls.computeNext(tournamentEnd)
	assert.Equal(t, liveExpiry, expiryTs)
	assert.Equal(t, []string{"hourly-leaderboard"}, expiryIds)
}

func TestLeaderboardSchedulerEndedTournamentHidesSuccessorExpiry(t *testing.T) {
	// Consecutive 24h tournaments with no reset schedule, so endActive and expiry both land on end_time.
	const day1End int64 = 1_700_042_400
	const day2End int64 = day1End + 86400

	ls := &LocalLeaderboardScheduler{
		cache: &LocalLeaderboardCache{
			allList: []*Leaderboard{
				{Id: "day-1", Duration: 86400, StartTime: day1End - 86400, EndTime: day1End},
				{Id: "day-2", Duration: 86400, StartTime: day1End, EndTime: day2End},
			},
		},
	}

	// scheduleLoop fires both hooks at day1End, then recomputes inside that same second.
	endActiveTs, expiryTs, endActiveIds, expiryIds := ls.computeNext(day1End)

	assert.Equal(t, day2End, endActiveTs)
	assert.Equal(t, []string{"day-2"}, endActiveIds)

	// day-1's stale expiry must not win, or it is due again on every pass and day-2's reset hook never fires.
	assert.Equal(t, day2End, expiryTs)
	assert.Equal(t, []string{"day-2"}, expiryIds)
}

func TestLeaderboardSchedulerSkipsDeadlinesBeforeCreation(t *testing.T) {
	from := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC).Unix()

	minutely := cronexpr.MustParse("* * * * *")
	hourly := cronexpr.MustParse("0 * * * *")

	ls := &LocalLeaderboardScheduler{
		cache: &LocalLeaderboardCache{
			allList: []*Leaderboard{
				// Created at 12:01:30, after its 12:01 reset.
				{Id: "minutely-leaderboard", ResetScheduleStr: "* * * * *", ResetSchedule: minutely, CreateTime: from + 90},
				// Created at 12:33:20, after its 12:30 end.
				{Id: "hourly-tournament", ResetScheduleStr: "0 * * * *", ResetSchedule: hourly, Duration: 1800, StartTime: from - 86400, CreateTime: from + 2000},
			},
		},
	}

	// The loop computes from where it last looked, which can be before a leaderboard was created.
	endActiveTs, expiryTs, _, expiryIds := ls.computeNext(from)
	assert.Equal(t, int64(-1), endActiveTs)
	assert.Equal(t, from+120, expiryTs)
	assert.Equal(t, []string{"minutely-leaderboard"}, expiryIds)
}

func TestLeaderboardSchedulerFindsFirstCycleBeforeStart(t *testing.T) {
	friday := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC).Unix()
	monday := friday + 3*86400

	weekly := cronexpr.MustParse("0 0 * * 1")

	ls := &LocalLeaderboardScheduler{
		cache: &LocalLeaderboardCache{
			allList: []*Leaderboard{
				// Starts on a reset tick, which calculateTournamentDeadlines skips when asked before the start.
				{Id: "weekly", ResetScheduleStr: "0 0 * * 1", ResetSchedule: weekly, Duration: 86400, StartTime: monday, CreateTime: friday},
			},
		},
	}

	endActiveTs, expiryTs, _, _ := ls.computeNext(friday)
	assert.Equal(t, monday+86400, endActiveTs)
	assert.Equal(t, monday+7*86400, expiryTs)

	// Starts as an active period ends, so its first cycle is empty: no end hook at the start, only the reset after it.
	ls = &LocalLeaderboardScheduler{
		cache: &LocalLeaderboardCache{
			allList: []*Leaderboard{
				{Id: "empty-first-cycle", ResetScheduleStr: "0 * * * *", ResetSchedule: cronexpr.MustParse("0 * * * *"), Duration: 1800, StartTime: monday + 1800, CreateTime: friday},
			},
		},
	}

	endActiveTs, expiryTs, _, _ = ls.computeNext(friday)
	assert.Equal(t, int64(-1), endActiveTs)
	assert.Equal(t, monday+3600, expiryTs)

	// Without a reset schedule the start is ignored, so end_time == start_time still ends and resets at its start.
	ls = &LocalLeaderboardScheduler{
		cache: &LocalLeaderboardCache{
			allList: []*Leaderboard{
				{Id: "zero-length", Duration: 3600, StartTime: monday, EndTime: monday, CreateTime: friday},
			},
		},
	}

	endActiveTs, expiryTs, _, _ = ls.computeNext(friday)
	assert.Equal(t, monday, endActiveTs)
	assert.Equal(t, monday, expiryTs)
}

func TestLeaderboardSchedulerFiresEveryResetDuringUpdates(t *testing.T) {
	expr := cronexpr.MustParse("* * * * * * *")
	lb := &Leaderboard{Id: "every-second", ResetScheduleStr: "* * * * * * *", ResetSchedule: expr}
	cache := &LocalLeaderboardCache{leaderboards: map[string]*Leaderboard{lb.Id: lb}, allList: []*Leaderboard{lb}}

	var mu sync.Mutex
	fired := make(map[int64]int)
	rt := &Runtime{leaderboardResetFunction: func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
		mu.Lock()
		fired[reset]++
		mu.Unlock()
		return nil
	}}

	// One worker: each callback calls cronexpr.Last, which writes to the shared schedule and trips -race across workers.
	config := NewConfig(zap.NewNop())
	config.GetLeaderboard().CallbackQueueWorkers = 1
	ls := NewLocalLeaderboardScheduler(zap.NewNop(), nil, config, cache, &LocalLeaderboardRankCache{})
	ls.Start(rt)
	t.Cleanup(ls.Stop)

	// Constant Update() calls keep stopping the timer just before it fires.
	start := time.Now()
	for time.Since(start) < 4*time.Second {
		ls.Update()
		runtime.Gosched()
	}
	end := time.Now()
	time.Sleep(500 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	for boundary := expr.Next(start.Add(time.Second)); !boundary.After(end); boundary = expr.Next(boundary) {
		assert.Equal(t, 1, fired[boundary.Unix()], "reset at %v", boundary)
	}
	for reset, count := range fired {
		assert.Equal(t, 1, count, "reset at %v", time.Unix(reset, 0))
	}
}

func TestLeaderboardSchedulerSkipsResetsWhilePaused(t *testing.T) {
	expr := cronexpr.MustParse("* * * * * * *")
	lb := &Leaderboard{Id: "every-second", ResetScheduleStr: "* * * * * * *", ResetSchedule: expr}
	cache := &LocalLeaderboardCache{leaderboards: map[string]*Leaderboard{lb.Id: lb}, allList: []*Leaderboard{lb}}

	var mu sync.Mutex
	fired := make(map[int64]int)
	rt := &Runtime{leaderboardResetFunction: func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
		mu.Lock()
		fired[reset]++
		mu.Unlock()
		return nil
	}}

	// One worker: each callback calls cronexpr.Last, which writes to the shared schedule and trips -race across workers.
	config := NewConfig(zap.NewNop())
	config.GetLeaderboard().CallbackQueueWorkers = 1
	ls := NewLocalLeaderboardScheduler(zap.NewNop(), nil, config, cache, &LocalLeaderboardRankCache{})
	ls.Start(rt)
	t.Cleanup(ls.Stop)

	// Paused across exactly one boundary: it is skipped, not fired late on resume.
	boundary := time.Now().Truncate(time.Second).Add(time.Second)
	time.Sleep(time.Until(boundary.Add(200 * time.Millisecond)))
	ls.Pause()
	time.Sleep(time.Until(boundary.Add(1500 * time.Millisecond)))
	ls.Resume()
	time.Sleep(time.Until(boundary.Add(4700 * time.Millisecond)))

	mu.Lock()
	defer mu.Unlock()
	paused := boundary.Unix() + 1
	assert.Zero(t, fired[paused])
	assert.NotZero(t, fired[paused+1]+fired[paused+2]+fired[paused+3])
}

func TestLeaderboardScheduler(t *testing.T) {
	t.Skip("auxiliary test for scheduling logic, but too finicky to be part of the test suite")
	db := NewDB(t)
	ctx := t.Context()

	// Clean up any previously set up leaderboards.
	if _, err := db.ExecContext(ctx, "DELETE FROM leaderboard"); err != nil {
		t.Fatal(err)
	}

	leaderboardCache := NewLocalLeaderboardCache(ctx, logger, logger, db)
	leaderboardRankCache := NewLocalLeaderboardRankCache(ctx, logger, db, cfg.GetLeaderboard(), leaderboardCache)
	leaderboardScheduler := NewLocalLeaderboardScheduler(logger, db, cfg, leaderboardCache, leaderboardRankCache)

	rt, _, err := NewRuntime(ctx, logger, logger, db, protojsonMarshaler, protojsonUnmarshaler, cfg, "", nil, leaderboardCache, leaderboardRankCache, leaderboardScheduler, nil, nil, nil, nil, nil, nil, metrics, nil, &DummyMessageRouter{}, storageIdx, nil)
	if err != nil {
		t.Fatal(err)
	}

	nk := &RuntimeGoNakamaModule{
		logger:               logger,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		config:               cfg,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		leaderboardScheduler: leaderboardScheduler,
		metrics:              metrics,
	}

	leaderboardResetExecCount := atomic.NewInt32(0)
	tournamentResetExecCount := atomic.NewInt32(0)
	tournamentEndExecCount := atomic.NewInt32(0)

	rt.leaderboardResetFunction = func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
		_ = nk.LeaderboardCreate(ctx, uuid.Must(uuid.NewV4()).String(), true, "desc", "best", "* * * * *", nil, false)
		leaderboardResetExecCount.Inc()
		return nil
	}

	rt.tournamentResetFunction = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
		_ = nk.TournamentCreate(ctx, uuid.Must(uuid.NewV4()).String(), true, "desc", "best", "* * * * *", nil, "", "", 0, 0, 0, 60, 0, 0, false, false)
		tournamentResetExecCount.Inc()
		return nil
	}

	rt.tournamentEndFunction = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
		_ = nk.TournamentCreate(ctx, uuid.Must(uuid.NewV4()).String(), true, "desc", "best", "* * * * *", nil, "", "", 0, 0, 0, 60, 0, 0, false, false)
		tournamentEndExecCount.Inc()
		return nil
	}

	// Create a number of leaderboards and tournaments with the same endTime and/or expiryTime
	const leaderboardCount = 3
	for range leaderboardCount {
		err = nk.LeaderboardCreate(ctx, uuid.Must(uuid.NewV4()).String(), true, "desc", "best", "* * * * *", nil, false)
		if err != nil {
			t.Fatal(err)
		}
	}
	duration := int(time.Now().Add(time.Minute).Truncate(time.Minute).UTC().Unix())
	for range leaderboardCount {
		err := nk.TournamentCreate(ctx, uuid.Must(uuid.NewV4()).String(), true, "desc", "best", "* * * * *", nil, "", "", 0, 0, 0, duration, 0, 0, false, false)
		if err != nil {
			t.Fatal(err)
		}
	}

	leaderboardScheduler.Start(rt)

	now := time.Now()
	nextMinutePlus10s := now.UTC().Add(time.Minute).Truncate(time.Minute).Add(10 * time.Second).Sub(now)
	time.Sleep(nextMinutePlus10s)

	assert.Equal(t, int32(leaderboardCount), leaderboardResetExecCount.Load())
	assert.Equal(t, int32(leaderboardCount), tournamentResetExecCount.Load())
	assert.Equal(t, int32(leaderboardCount), tournamentEndExecCount.Load())
}
