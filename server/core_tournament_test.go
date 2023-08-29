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

func TestCalculateTournamentDeadlines(t *testing.T) {
	mockSched, err := cronexpr.Parse("0 9 */14 * *")
	if err != nil {
		t.Fatal("Invalid cron schedule", err)
		return
	}

	const layout = "2 January 2006, 3:04:05 PM"
	mockNowString := "21 August 2023, 11:00:00 AM"
	mockNow, err := time.Parse(layout, mockNowString)
	if err != nil {
		t.Fatal("Invalid time", err)
		return
	}
	var startTime int64 = 1692090000 // Sunday, 15 August 2023, 9:00:00 AM
	var duration int64 = 1202400     // ~2 Weeks
	startActiveUnix, endActiveUnix, _ := calculateTournamentDeadlines(startTime, 0, duration, mockSched, mockNow)
	nextResetUnix := mockSched.Next(mockNow).Unix()

	// Start Time: Sunday, 15 August 2023, 9:00:00 AM
	require.Equal(t, int64(1692090000), startActiveUnix, "Start active times should be equal.")
	// End Active: Tues 29 August 2023 7:00:00 AM
	require.Equal(t, int64(1693292400), endActiveUnix, "End active times should be equal.")
	// Next Reset: Tues 29 August 2023 9:00:00 AM
	require.Equal(t, int64(1693299600), nextResetUnix, "Next reset times should be equal.")
}
