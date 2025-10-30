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

	"github.com/heroiclabs/hiro"
	"github.com/heroiclabs/nakama/v3/console"
	"google.golang.org/protobuf/types/known/emptypb"
)

func (c *ConsoleServer) RegisteredExtensions(ctx context.Context, in *emptypb.Empty) (*console.Extensions, error) {
	hiroRegistered := false
	var hiroSystems *console.Extensions_HiroSystems
	if c.hiro != nil && c.hiro.hiro != nil {
		hiroRegistered = true
		hiroSystems = &console.Extensions_HiroSystems{
			EconomySystem:     c.hiro.hiro.GetEconomySystem().GetType() != hiro.SystemTypeUnknown,
			InventorySystem:   c.hiro.hiro.GetInventorySystem().GetType() != hiro.SystemTypeUnknown,
			ProgressionSystem: c.hiro.hiro.GetProgressionSystem().GetType() != hiro.SystemTypeUnknown,
			StatsSystem:       c.hiro.hiro.GetStatsSystem().GetType() != hiro.SystemTypeUnknown,
			EnergySystem:      c.hiro.hiro.GetEnergySystem().GetType() != hiro.SystemTypeUnknown,
		}
	}

	extensions := &console.Extensions{
		Hiro:        hiroRegistered,
		HiroSystems: hiroSystems,
		Satori:      c.satori != nil,
	}

	return extensions, nil
}
