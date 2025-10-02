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

type IncentivesConfig struct {
	Incentives map[string]*IncentivesConfigIncentive `json:"incentives,omitempty"`
}

type IncentivesConfigIncentive struct {
	Type                 IncentiveType          `json:"type,omitempty"`
	Name                 string                 `json:"name,omitempty"`
	Description          string                 `json:"description,omitempty"`
	MaxClaims            int                    `json:"max_claims,omitempty"`
	MaxGlobalClaims      int                    `json:"max_global_claims,omitempty"`
	MaxRecipientAgeSec   int64                  `json:"max_recipient_age_sec,omitempty"`
	RecipientReward      *EconomyConfigReward   `json:"recipient_reward,omitempty"`
	SenderReward         *EconomyConfigReward   `json:"sender_reward,omitempty"`
	MaxConcurrent        int                    `json:"max_concurrent,omitempty"`
	ExpiryDurationSec    int64                  `json:"expiry_duration_sec,omitempty"`
	AdditionalProperties map[string]interface{} `json:"additional_properties,omitempty"`
}

// The IncentivesSystem provides a gameplay system which can create and claim incentives and their associated rewards.
type IncentivesSystem interface {
	System

	SenderList(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string) (incentives []*Incentive, err error)

	SenderCreate(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, incentiveID string) (incentives []*Incentive, err error)

	SenderDelete(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, code string) (incentives []*Incentive, err error)

	SenderClaim(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, code string, claimantIDs []string) (incentives []*Incentive, err error)

	RecipientGet(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, code string) (incentive *IncentiveInfo, err error)

	RecipientClaim(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, code string) (incentive *IncentiveInfo, err error)

	// SetOnSenderReward sets a custom reward function which will run after an incentive sender's reward is rolled.
	SetOnSenderReward(fn OnReward[*IncentivesConfigIncentive])

	// SetOnRecipientReward sets a custom reward function which will run after an incentive recipient's reward is rolled.
	SetOnRecipientReward(fn OnReward[*IncentivesConfigIncentive])
}
