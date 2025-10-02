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

type InventoryConfig struct {
	Items    map[string]*InventoryConfigItem `json:"items,omitempty"`
	Limits   *InventoryConfigLimits          `json:"limits,omitempty"`
	ItemSets map[string]map[string]bool      `json:"-"` // Auto-computed when the config is read or personalized.

	ConfigSource ConfigSource[*InventoryConfigItem] `json:"-"` // Not included in serialization, set dynamically.
}

type InventoryConfigItem struct {
	Name              string               `json:"name,omitempty"`
	Description       string               `json:"description,omitempty"`
	Category          string               `json:"category,omitempty"`
	ItemSets          []string             `json:"item_sets,omitempty"`
	MaxCount          int64                `json:"max_count,omitempty"`
	Stackable         bool                 `json:"stackable,omitempty"`
	Consumable        bool                 `json:"consumable,omitempty"`
	ConsumeReward     *EconomyConfigReward `json:"consume_reward,omitempty"`
	StringProperties  map[string]string    `json:"string_properties,omitempty"`
	NumericProperties map[string]float64   `json:"numeric_properties,omitempty"`
	Disabled          bool                 `json:"disabled,omitempty"`
	KeepZero          bool                 `json:"keep_zero,omitempty"`
}

type InventoryConfigLimits struct {
	Categories map[string]int64 `json:"categories,omitempty"`
	ItemSets   map[string]int64 `json:"item_sets,omitempty"`
}

// The InventorySystem provides a gameplay system which can manage a player's inventory.
//
// A player can have items added via economy rewards, or directly.
type InventorySystem interface {
	System

	// List will return the items defined as well as the computed item sets for the user by ID.
	List(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, category string) (items map[string]*InventoryConfigItem, itemSets map[string][]string, err error)

	// ListInventoryItems will return the items which are part of a user's inventory by ID.
	ListInventoryItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, category string) (inventory *Inventory, err error)

	// ConsumeItems will deduct the item(s) from the user's inventory and run the consume reward for each one, if defined.
	ConsumeItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, itemIDs, instanceIDs map[string]int64, overConsume bool) (updatedInventory *Inventory, rewards map[string][]*Reward, instanceRewards map[string][]*Reward, err error)

	// GrantItems will add the item(s) to a user's inventory by ID.
	GrantItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, itemIDs map[string]int64, ignoreLimits bool) (updatedInventory *Inventory, newItems map[string]*InventoryItem, updatedItems map[string]*InventoryItem, notGrantedItemIDs map[string]int64, err error)

	// UpdateItems will update the properties which are stored on each item by instance ID for a user.
	UpdateItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, instanceIDs map[string]*InventoryUpdateItemProperties) (updatedInventory *Inventory, err error)

	// SetOnConsumeReward sets a custom reward function which will run after an inventory items' consume reward is rolled.
	SetOnConsumeReward(fn OnReward[*InventoryConfigItem])

	// SetConfigSource sets a custom additional config lookup function.
	SetConfigSource(fn ConfigSource[*InventoryConfigItem])
}

// ConfigSource is a function which can be used to provide additional on-demand configuration data to a requesting system.
type ConfigSource[T any] func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, configID string) (T, error)
