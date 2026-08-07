package server

import (
	"context"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/stretchr/testify/assert"
	"go.uber.org/atomic"
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
	_, expiryTs, _, expiryIds := ls.computeNext(time.Unix(tournamentEnd-1, 0).UTC())
	assert.Equal(t, tournamentEnd, expiryTs)
	assert.Equal(t, []string{"ending-tournament"}, expiryIds)

	// scheduleLoop fires at tournamentEnd then recomputes inside the same second, where the ended
	// tournament must drop out or it wins the earliest-deadline reduction and hides every live expiry.
	_, expiryTs, _, expiryIds = ls.computeNext(time.Unix(tournamentEnd, 0).UTC())
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
	endActiveTs, expiryTs, endActiveIds, expiryIds := ls.computeNext(time.Unix(day1End, 0).UTC())

	assert.Equal(t, day2End, endActiveTs)
	assert.Equal(t, []string{"day-2"}, endActiveIds)

	// day-1's stale expiry must not win, or lastFireUnix filters it to -1 and day-2's reset hook never fires.
	assert.Equal(t, day2End, expiryTs)
	assert.Equal(t, []string{"day-2"}, expiryIds)
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
	for i := 0; i < leaderboardCount; i++ {
		err = nk.LeaderboardCreate(ctx, uuid.Must(uuid.NewV4()).String(), true, "desc", "best", "* * * * *", nil, false)
		if err != nil {
			t.Fatal(err)
		}
	}
	duration := int(time.Now().Add(time.Minute).Truncate(time.Minute).UTC().Unix())
	for i := 0; i < leaderboardCount; i++ {
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
