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

// EnergyConfig is the data definition for the EnergySystem type.
type EnergyConfig struct {
	Energies map[string]*EnergyConfigEnergy `json:"energies,omitempty"`
}

type EnergyConfigEnergy struct {
	StartCount           int32                `json:"start_count,omitempty"`
	MaxCount             int32                `json:"max_count,omitempty"`
	MaxOverfill          int32                `json:"max_overfill,omitempty"`
	RefillCount          int32                `json:"refill_count,omitempty"`
	RefillTimeSec        int64                `json:"refill_time_sec,omitempty"`
	Implicit             bool                 `json:"implicit,omitempty"`
	Reward               *EconomyConfigReward `json:"reward,omitempty"`
	AdditionalProperties map[string]string    `json:"additional_properties,omitempty"`
}

// The EnergySystem provides a gameplay system for Energy timers.
//
// An energy is a gameplay mechanic used to reward or limit progress which a player can make through the gameplay
// content.
type EnergySystem interface {
	System

	// Get returns all energies defined and the values a user currently owns by ID.
	Get(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string) (energies map[string]*Energy, err error)

	// Spend will deduct the amounts from each energy for a user by ID.
	Spend(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, amounts map[string]int32) (energies map[string]*Energy, reward *Reward, err error)

	// Grant will add the amounts to each energy (while applying any energy modifiers) for a user by ID.
	Grant(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, amounts map[string]int32, modifiers []*RewardEnergyModifier) (energies map[string]*Energy, err error)

	// SetOnSpendReward sets a custom reward function which will run after an energy reward's value has been rolled.
	SetOnSpendReward(fn OnReward[*EnergyConfigEnergy])
}
