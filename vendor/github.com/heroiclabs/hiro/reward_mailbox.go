// Copyright 2025 Heroic Labs & Contributors
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

var (
	ErrRewardMailboxEntryNotFound       = runtime.NewError("reward mailbox entry not found", 3)       // INVALID_ARGUMENT
	ErrRewardMailboxEntryAlreadyClaimed = runtime.NewError("reward mailbox entry already claimed", 3) // INVALID_ARGUMENT
)

type RewardMailboxConfig struct {
	MaxSize int `json:"max_size,omitempty"`
}

// A RewardMailboxSystem is a gameplay system representing a rewards mailbox for the player to claim from.
type RewardMailboxSystem interface {
	System

	// List the reward mailbox.
	List(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, limit int, cursor string) (mailboxList *RewardMailboxList, err error)

	// Claim a reward, and optionally remove it from the mailbox.
	Claim(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, id string, delete bool) (mailboxEntry *RewardMailboxEntry, err error)

	// Delete a reward from the mailbox, even if it is not yet claimed.
	Delete(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, ids []string) error

	// Grant a reward to the user's mailbox.
	Grant(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, reward *Reward) (mailboxEntry *RewardMailboxEntry, err error)

	// SetOnClaimReward sets a custom reward function which will run after a mailbox reward is rolled during claiming.
	SetOnClaimReward(fn OnReward[*RewardMailboxEntry])
}
