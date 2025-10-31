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

// TutorialsConfig is the data definition for the TutorialsSystem type.
type TutorialsConfig struct {
	Tutorials map[string]*TutorialsConfigTutorial `json:"tutorials,omitempty"`
}

type TutorialsConfigTutorial struct {
	StartStep            int               `json:"start_step,omitempty"`
	MaxStep              int               `json:"max_step,omitempty"`
	AdditionalProperties map[string]string `json:"additional_properties,omitempty"`
}

// The TutorialsSystem is a gameplay system which records progress made through tutorials.
type TutorialsSystem interface {
	System

	// Get returns all tutorials defined and progress made by the user towards them.
	Get(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string) (tutorials map[string]*Tutorial, err error)

	// Accept marks a tutorial as accepted by the user.
	Accept(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, tutorialID string, userID string) (tutorial *Tutorial, err error)

	// Decline marks a tutorial as declined by the user.
	Decline(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, tutorialID string, userID string) (tutorial *Tutorial, err error)

	// Abandon marks the tutorial as abandoned by the user.
	Abandon(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, tutorialID string, userID string) (tutorial *Tutorial, err error)

	// Update modifies a tutorial by its ID to step through it for the user by ID.
	Update(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, tutorialID string, step int) (tutorial map[string]*Tutorial, err error)

	// Reset wipes all known state for the given tutorial identifier(s).
	Reset(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, tutorialIDs []string) (tutorials map[string]*Tutorial, err error)

	// SetOnStepCompleted registers a hook that fires on tutorial step completions.
	SetOnStepCompleted(func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, tutorialID string, config *TutorialsConfigTutorial, resetCount, step int, prevStep *int))
}
