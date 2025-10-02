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

var (
	ErrProgressionNotFound             = runtime.NewError("progression not found", 3)                 // INVALID_ARGUMENT
	ErrProgressionNotAvailablePurchase = runtime.NewError("progression not available to purchase", 3) // INVALID_ARGUMENT
	ErrProgressionNotAvailableUpdate   = runtime.NewError("progression not available to update", 3)   // INVALID_ARGUMENT
	ErrProgressionNoCost               = runtime.NewError("progression no cost associated", 3)        // INVALID_ARGUMENT
	ErrProgressionNoCount              = runtime.NewError("progression no count associated", 3)       // INVALID_ARGUMENT
	ErrProgressionAlreadyUnlocked      = runtime.NewError("progression already unlocked", 3)          // INVALID_ARGUMENT
)

// ProgressionConfig is the data definition for a ProgressionSystem type.
type ProgressionConfig struct {
	Progressions map[string]*ProgressionConfigProgression `json:"progressions,omitempty"`
}

type ProgressionConfigProgression struct {
	Name                 string                         `json:"name,omitempty"`
	Description          string                         `json:"description,omitempty"`
	Category             string                         `json:"category,omitempty"`
	AdditionalProperties map[string]string              `json:"additional_properties,omitempty"`
	Preconditions        *ProgressionPreconditionsBlock `json:"preconditions,omitempty"`
	ResetSchedule        string                         `json:"reset_schedule,omitempty"`
	UnconditionalUpdates bool                           `json:"unconditional_updates,omitempty"`
	PermanentUnlock      bool                           `json:"permanent_unlock,omitempty"`
}

// A ProgressionSystem is a gameplay system which represents a sequence of progression steps.
type ProgressionSystem interface {
	System

	// Get returns all or an optionally-filtered set of progressions for the given user.
	Get(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, lastKnownProgressions map[string]*Progression) (progressions map[string]*Progression, deltas map[string]*ProgressionDelta, err error)

	// Purchase permanently unlocks a specified progression, if that progression supports this operation.
	Purchase(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, progressionID string) (progressions map[string]*Progression, err error)

	// Update a specified progression, if that progression supports this operation.
	Update(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, progressionID string, counts map[string]int64) (progressions map[string]*Progression, err error)

	// Reset one or more progressions to clear their progress. Only applies to progression counts and unlock costs.
	Reset(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, progressionIDs []string) (progressions map[string]*Progression, err error)
}
