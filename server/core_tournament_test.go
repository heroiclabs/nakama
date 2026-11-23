// Copyright 2023 The Nakama Authors
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
	"fmt"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/stretchr/testify/require"
)

func TestTournamentEveryFourteenDaysFromFirst(t *testing.T) {
	sched, err := cronexpr.Parse("0 9 */14 * *")
	if err != nil {
		t.Fatal("Invalid cron schedule", err)
		return
	}

	var now int64 = 1692608400       // 21 August 2023, 11:00:00
	var startTime int64 = 1692090000 // 15 August 2023, 9:00:00
	var duration int64 = 1202400     // ~2 Weeks

	nowUnix := time.Unix(now, 0).UTC()
	startActiveUnix, endActiveUnix, _ := calculateTournamentDeadlines(startTime, 0, duration, sched, nowUnix)
	nextResetUnix := sched.Next(nowUnix).Unix()

	// 15 August 2023, 9:00:00
	require.Equal(t, int64(1692090000), startActiveUnix, "Start active times should be equal.")
	// 29 August 2023, 7:00:00
	require.Equal(t, int64(1693292400), endActiveUnix, "End active times should be equal.")
	// 29 August 2023, 9:00:00
	require.Equal(t, int64(1693299600), nextResetUnix, "Next reset times should be equal.")
}

func TestTournamentEveryDayMonThruFri(t *testing.T) {
	sched, err := cronexpr.Parse("0 22 * * 1-5")
	if err != nil {
		t.Fatal("Invalid cron schedule", err)
		return
	}

	var now int64 = 1692615600       // 21 August 2023, 11:00:00 (Monday)
	var startTime int64 = 1692090000 // 15 August 2023, 9:00:00
	var duration int64 = 7200        // 2 Hours

	nowUnix := time.Unix(now, 0).UTC()
	startActiveUnix, endActiveUnix, _ := calculateTournamentDeadlines(startTime, 0, duration, sched, nowUnix)
	nextResetUnix := sched.Next(nowUnix).Unix()

	// 18 August 2023, 22:00:00 (Friday)
	require.Equal(t, int64(1692396000), startActiveUnix, "Start active times should be equal.")
	// 19 August 2023, 0:00:00
	require.Equal(t, int64(1692403200), endActiveUnix, "End active times should be equal.")
	// 21 August 2023, 22:00:00
	require.Equal(t, int64(1692655200), nextResetUnix, "Next reset times should be equal.")
}

func TestTournamentNowIsResetTime(t *testing.T) {
	sched, err := cronexpr.Parse("0 9 14 * *")
	if err != nil {
		t.Fatal("Invalid cron schedule", err)
		return
	}

	var now int64 = 1692003600       // 14 August 2023, 9:00:00
	var startTime int64 = 1692003600 // 14 August 2023, 9:00:00
	var duration int64 = 604800      // 1 Week

	nowUnix := time.Unix(now, 0).UTC()
	startActiveUnix, endActiveUnix, _ := calculateTournamentDeadlines(startTime, 0, duration, sched, nowUnix)
	nextResetUnix := sched.Next(nowUnix).Unix()

	// 14 August 2023, 9:00:00
	require.Equal(t, int64(1692003600), startActiveUnix, "Start active times should be equal.")
	// 21 August 2023, 9:00:00
	require.Equal(t, int64(1692608400), endActiveUnix, "End active times should be equal.")
	// 14 September 2023, 9:00:00
	require.Equal(t, int64(1694682000), nextResetUnix, "Next reset times should be equal.")
}

func TestTournamentNowIsBeforeStart(t *testing.T) {
	sched, err := cronexpr.Parse("0 9 14 * *")
	if err != nil {
		t.Fatal("Invalid cron schedule", err)
		return
	}

	var now int64 = 1692003600       // 14 August 2023, 9:00:00
	var startTime int64 = 1693558800 // 1 September 2023, 9:00:00
	var duration int64 = 604800 * 4  // 4 Weeks

	nowUnix := time.Unix(now, 0).UTC()
	startActiveUnix, endActiveUnix, _ := calculateTournamentDeadlines(startTime, 0, duration, sched, nowUnix)

	// 14 September 2023, 9:00:00
	require.Equal(t, int64(1694682000), startActiveUnix, "Start active times should be equal.")
	// 12 October 2023, 9:00:00
	require.Equal(t, int64(1697101200), endActiveUnix, "End active times should be equal.")
}

func TestDisableTournamentRanksPreservesTournamentState(t *testing.T) {
	ctx := context.Background()
	db := NewDB(t)
	defer db.Close()

	lbCache := NewLocalLeaderboardCache(ctx, logger, logger, db)
	rankCache := NewLocalLeaderboardRankCache(ctx, logger, db, cfg.GetLeaderboard(), lbCache)
	sched := NewLocalLeaderboardScheduler(logger, db, cfg, lbCache, rankCache)
	defer sched.Stop()

	tournamentID := uuid.Must(uuid.NewV4()).String()
	startTime := int(time.Now().UTC().Add(-10 * time.Minute).Unix())
	endTime := startTime + 7200

	err := TournamentCreate(ctx, logger, lbCache, sched, tournamentID, false, LeaderboardSortOrderDescending, LeaderboardOperatorBest, "", `{"tier":"gold"}`, "Weekly Cup", "Tournament description", 3, startTime, endTime, 3600, 50, 5, true, true)
	require.NoError(t, err)
	defer func() {
		_ = TournamentDelete(ctx, lbCache, rankCache, sched, tournamentID)
	}()

	userID := uuid.Must(uuid.NewV4())
	InsertUser(t, db, userID)
	require.NoError(t, TournamentJoin(ctx, logger, db, lbCache, rankCache, userID, "player1", tournamentID))
	rec, err := TournamentRecordWrite(ctx, logger, db, lbCache, rankCache, userID, tournamentID, userID, "player1", 100, 0, "", 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), rec.Rank)

	require.NoError(t, DisableTournamentRanks(ctx, logger, db, lbCache, rankCache, tournamentID))

	cached := lbCache.Get(tournamentID)
	require.NotNil(t, cached)
	require.True(t, cached.IsTournament(), "cached entry must remain a tournament after disabling ranks")
	require.False(t, cached.EnableRanks, "ranks must be disabled in cache")
	require.Equal(t, "Weekly Cup", cached.Title)
	require.Equal(t, "Tournament description", cached.Description)
	require.Equal(t, 3, cached.Category)
	require.Equal(t, 3600, cached.Duration)
	require.Equal(t, int64(startTime), cached.StartTime)
	require.Equal(t, int64(endTime), cached.EndTime)
	require.Equal(t, 50, cached.MaxSize)
	require.Equal(t, 5, cached.MaxNumScore)
	require.True(t, cached.JoinRequired)

	tournaments, err := TournamentsGet(ctx, logger, db, lbCache, []string{tournamentID})
	require.NoError(t, err)
	require.Len(t, tournaments, 1)
	require.Equal(t, tournamentID, tournaments[0].Id)

	list, err := TournamentList(ctx, logger, db, lbCache, 3, 3, -1, -1, 100, nil)
	require.NoError(t, err)
	foundInList := false
	for _, trn := range list.Tournaments {
		if trn.Id == tournamentID {
			foundInList = true
			require.Equal(t, "Weekly Cup", trn.Title)
			require.True(t, trn.JoinRequired)
		}
	}
	require.True(t, foundInList, "tournament must remain visible with updated entry in TournamentList")

	recAfter, err := TournamentRecordWrite(ctx, logger, db, lbCache, rankCache, userID, tournamentID, userID, "player1", 200, 0, "", 0)
	require.NoError(t, err)
	require.Equal(t, int64(0), recAfter.Rank, "rank must be 0 once tournament ranks are disabled")
}

func TestRuntimeLuaTournamentRanksDisable(t *testing.T) {
	tournamentID := uuid.Must(uuid.NewV4()).String()
	leaderboardID := uuid.Must(uuid.NewV4()).String()
	startTime := time.Now().UTC().Add(-5 * time.Minute).Unix()

	modules := map[string]string{
		"trn_ranks_disable": fmt.Sprintf(`
local nk = require("nakama")

nk.tournament_create(%q, false, "desc", "best", 3600, "", {}, "Cup", "Desc", 1, %d, 0, 10, 3, true, true)
nk.tournament_ranks_disable(%q)

local got = nk.tournaments_get_id({%q})
assert(#got == 1, "expected tournament to still exist after tournament_ranks_disable, got " .. tostring(#got))
assert(got[1].title == "Cup", "expected title to be preserved")

nk.leaderboard_create(%q, false, "desc", "best", "", {}, true)
local ok = pcall(nk.tournament_ranks_disable, %q)
assert(not ok, "expected tournament_ranks_disable on a non-tournament leaderboard to fail")

nk.tournament_delete(%q)
nk.leaderboard_delete(%q)
`, tournamentID, startTime, tournamentID, tournamentID, leaderboardID, leaderboardID, tournamentID, leaderboardID),
	}

	_, _, err := runtimeWithModules(t, modules)
	require.NoError(t, err)
}

