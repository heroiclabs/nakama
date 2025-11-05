// Copyright 2025 The Nakama Authors
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
	"context"
	"strings"

	"github.com/heroiclabs/nakama/v3/console"
	"google.golang.org/protobuf/types/known/emptypb"
)

func (s *ConsoleServer) RegisteredExtensions(ctx context.Context, in *emptypb.Empty) (*console.Extensions, error) {
	var hiroRegistered bool
	var hiroSystems *console.Extensions_HiroSystems
	for _, handler := range s.runtime.consoleHttpHandlers {
		if handler == nil {
			continue
		}
		if !hiroRegistered && strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/") {
			hiroRegistered = true
		}
		if (hiroSystems == nil || !hiroSystems.EconomySystem) && strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/economy/") {
			if hiroSystems == nil {
				hiroSystems = &console.Extensions_HiroSystems{}
			}
			hiroSystems.EconomySystem = true
		}
		if (hiroSystems == nil || !hiroSystems.InventorySystem) && strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/inventory/") {
			if hiroSystems == nil {
				hiroSystems = &console.Extensions_HiroSystems{}
			}
			hiroSystems.InventorySystem = true
		}
		if (hiroSystems == nil || !hiroSystems.ProgressionSystem) && strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/progression/") {
			if hiroSystems == nil {
				hiroSystems = &console.Extensions_HiroSystems{}
			}
			hiroSystems.ProgressionSystem = true
		}
		if (hiroSystems == nil || !hiroSystems.StatsSystem) && strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/stats/") {
			if hiroSystems == nil {
				hiroSystems = &console.Extensions_HiroSystems{}
			}
			hiroSystems.StatsSystem = true
		}
		if (hiroSystems == nil || !hiroSystems.EnergySystem) && strings.HasPrefix(handler.PathPattern, "/v2/console/hiro/energy/") {
			if hiroSystems == nil {
				hiroSystems = &console.Extensions_HiroSystems{}
			}
			hiroSystems.EnergySystem = true
		}
	}

	extensions := &console.Extensions{
		Hiro:        hiroRegistered,
		HiroSystems: hiroSystems,
		Satori:      s.satori != nil,
	}

	return extensions, nil
}
