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

// The Personalizer describes an intermediate server or service which can be used to personalize the base data
// definitions defined for the gameplay systems.
type Personalizer interface {
	// GetValue returns a config which has been modified for a gameplay system,
	// or nil if the config is not being adjusted by this personalizer.
	GetValue(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, system System, identity string) (config any, err error)
}
