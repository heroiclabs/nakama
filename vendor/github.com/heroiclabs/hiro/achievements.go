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

	"github.com/heroiclabs/nakama-common/runtime"
)

// AchievementsConfig is the data definition for the TutorialsSystem type.
type AchievementsConfig struct {
	Achievements map[string]*AchievementsConfigAchievement `json:"achievements,omitempty"`
}

type AchievementsConfigAchievement struct {
	AutoClaim            bool                                         `json:"auto_claim,omitempty"`
	AutoClaimTotal       bool                                         `json:"auto_claim_total,omitempty"`
	AutoReset            bool                                         `json:"auto_reset,omitempty"`
	Category             string                                       `json:"category,omitempty"`
	Count                int64                                        `json:"count,omitempty"`
	Description          string                                       `json:"description,omitempty"`
	StartTimeSec         int64                                        `json:"start_time_sec,omitempty"`
	EndTimeSec           int64                                        `json:"end_time_sec,omitempty"`
	ResetCronexpr        string                                       `json:"reset_cronexpr,omitempty"`
	DurationSec          int64                                        `json:"duration_sec,omitempty"`
	MaxCount             int64                                        `json:"max_count,omitempty"`
	Name                 string                                       `json:"name,omitempty"`
	PreconditionIDs      []string                                     `json:"precondition_ids,omitempty"`
	Reward               *EconomyConfigReward                         `json:"reward,omitempty"`
	TotalReward          *EconomyConfigReward                         `json:"total_reward,omitempty"`
	SubAchievements      map[string]*AchievementsConfigSubAchievement `json:"sub_achievements,omitempty"`
	AdditionalProperties map[string]string                            `json:"additional_properties,omitempty"`
}

type AchievementsConfigSubAchievement struct {
	AutoClaim            bool                 `json:"auto_claim,omitempty"`
	AutoReset            bool                 `json:"auto_reset,omitempty"`
	Category             string               `json:"category,omitempty"`
	Count                int64                `json:"count,omitempty"`
	Description          string               `json:"description,omitempty"`
	ResetCronexpr        string               `json:"reset_cronexpr,omitempty"`
	DurationSec          int64                `json:"duration_sec,omitempty"`
	MaxCount             int64                `json:"max_count,omitempty"`
	Name                 string               `json:"name,omitempty"`
	PreconditionIDs      []string             `json:"precondition_ids,omitempty"`
	Reward               *EconomyConfigReward `json:"reward,omitempty"`
	AdditionalProperties map[string]string    `json:"additional_properties,omitempty"`
}

// An AchievementsSystem is a gameplay system which represents one-off, repeat, preconditioned, and sub-achievements.
type AchievementsSystem interface {
	System

	// ClaimAchievements when one or more achievements whose progress has completed by their IDs.
	ClaimAchievements(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, achievementIDs []string, claimTotal bool) (achievements map[string]*Achievement, repeatAchievements map[string]*Achievement, err error)

	// GetAchievements returns all achievements available to the user and progress on them.
	GetAchievements(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string) (achievements map[string]*Achievement, repeatAchievements map[string]*Achievement, err error)

	// UpdateAchievements updates progress on one or more achievements by the same amount.
	UpdateAchievements(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, achievementUpdates map[string]int64) (achievements map[string]*Achievement, repeatAchievements map[string]*Achievement, err error)

	// SetOnAchievementReward sets a custom reward function which will run after an achievement's reward is rolled.
	SetOnAchievementReward(fn OnReward[*AchievementsConfigAchievement])

	// SetOnSubAchievementReward sets a custom reward function which will run after a sub-achievement's reward is
	// rolled.
	SetOnSubAchievementReward(fn OnReward[*AchievementsConfigSubAchievement])

	// SetOnAchievementTotalReward sets a custom reward function which will run after an achievement's total reward is
	// rolled.
	SetOnAchievementTotalReward(fn OnReward[*AchievementsConfigAchievement])
}
