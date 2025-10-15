// Copyright 2023 Heroic Labs & Contributors
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

package hiro

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
)

// LeaderboardsConfig is the data definition for the LeaderboardsSystem type.
type LeaderboardsConfig struct {
	Leaderboards []*LeaderboardsConfigLeaderboard `json:"leaderboards,omitempty"`
}

type LeaderboardsConfigLeaderboard struct {
	Id            string   `json:"id,omitempty"`
	SortOrder     string   `json:"sort_order,omitempty"`
	Operator      string   `json:"operator,omitempty"`
	ResetSchedule string   `json:"reset_schedule,omitempty"`
	Authoritative bool     `json:"authoritative,omitempty"`
	Regions       []string `json:"regions,omitempty"`
}

// The LeaderboardsSystem defines a collection of leaderboards which can be defined as global or regional with Nakama
// server.
type LeaderboardsSystem interface {
	System
}

// ValidateWriteScoreFn is a function used to validate the leaderboard score input.
type ValidateWriteScoreFn func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, *api.WriteLeaderboardRecordRequest) *runtime.Error
