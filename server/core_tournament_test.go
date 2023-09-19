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
	"testing"
	"time"

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
