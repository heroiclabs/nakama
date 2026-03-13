package server

import (
	"context"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/stretchr/testify/assert"
	"go.uber.org/atomic"
)

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

	// Truncate endActiveDuration to whole seconds, removing sub-second precision. Both timers
	// target the same Unix second T, so this makes endActiveTimer fire up to ~999ms earlier than
	// expiryTimer — always within the same second — giving queueEndActiveElapse's Update() a
	// window to Stop() the expiry timer before it fires, reproducing the race.
	// leaderboardScheduler.(*LocalLeaderboardScheduler).testTruncateEndActiveDuration = true

	leaderboardScheduler.Start(rt)

	now := time.Now()
	nextMinutePlus10s := now.UTC().Add(time.Minute).Truncate(time.Minute).Add(10 * time.Second).Sub(now)
	time.Sleep(nextMinutePlus10s)

	assert.Equal(t, int32(leaderboardCount), leaderboardResetExecCount.Load())
	assert.Equal(t, int32(leaderboardCount), tournamentResetExecCount.Load())
	assert.Equal(t, int32(leaderboardCount), tournamentEndExecCount.Load())
}
