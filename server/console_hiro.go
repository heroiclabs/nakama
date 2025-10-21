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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/hiro"
	"github.com/heroiclabs/nakama/v3/console"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var ErrHiroNotRegistered = status.Error(codes.NotFound, "Hiro not registered")

func (s *ConsoleServer) HiroListInventoryItems(ctx context.Context, in *console.HiroInventoryListRequest) (*hiro.InventoryList, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error listing inventory items, user identifier required.")
	}

	inventorySystem := s.hiro.hiro.GetInventorySystem()

	items, _, err := inventorySystem.List(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.ItemCategory)
	if err != nil {
		return nil, err
	}

	inventoryList := &hiro.InventoryList{
		Items: make(map[string]*hiro.InventoryItem, len(items)),
	}

	for itemID, item := range items {
		inventoryList.Items[itemID] = &hiro.InventoryItem{
			Id:                      itemID,
			Name:                    item.Name,
			Description:             item.Description,
			Category:                item.Category,
			ItemSets:                item.ItemSets,
			MaxCount:                item.MaxCount,
			Stackable:               item.Stackable,
			Consumable:              item.Consumable,
			ConsumeAvailableRewards: rewardConfigToProto(item.ConsumeReward),
			StringProperties:        item.StringProperties,
			NumericProperties:       item.NumericProperties,
			OwnedTimeSec:            0,
			UpdateTimeSec:           0,
		}
	}

	return inventoryList, nil
}

func (s *ConsoleServer) HiroListUserInventoryItems(ctx context.Context, in *console.HiroInventoryListRequest) (*hiro.InventoryList, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error listing inventory items, user identifier required.")
	}

	inventorySystem := s.hiro.hiro.GetInventorySystem()

	inventory, err := inventorySystem.ListInventoryItems(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.ItemCategory)
	if err != nil {
		return nil, err
	}

	return &hiro.InventoryList{Items: inventory.Items}, nil
}

func (s *ConsoleServer) HiroAddUserInventoryItems(ctx context.Context, in *console.HiroGrantUserInventoryRequest) (*hiro.InventoryUpdateAck, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error adding inventory item, user identifier required.")
	}

	inventorySystem := s.hiro.hiro.GetInventorySystem()

	inventory, _, _, _, err := inventorySystem.GrantItems(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.Items, in.IgnoreLimits)
	if err != nil {
		return nil, err
	}

	return &hiro.InventoryUpdateAck{Inventory: inventory}, nil
}

func (s *ConsoleServer) HiroDeleteUserInventoryItems(ctx context.Context, in *console.HiroDeleteUserInventoryItemsRequest) (*hiro.InventoryUpdateAck, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error deleting inventory item, user identifier required.")
	}

	inventorySystem := s.hiro.hiro.GetInventorySystem()

	inventory, err := inventorySystem.DeleteItems(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.InstanceIds)
	if err != nil {
		return nil, err
	}

	return &hiro.InventoryUpdateAck{Inventory: inventory}, nil
}

func (s *ConsoleServer) HiroListProgressions(ctx context.Context, in *console.HiroProgressionsRequest) (*hiro.ProgressionList, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error listing progressions, user identifier required.")
	}

	progressionSystem := s.hiro.hiro.GetProgressionSystem()
	progressions, deltas, err := progressionSystem.Get(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.Progressions)
	if err != nil {
		return nil, err
	}

	out := &hiro.ProgressionList{
		Progressions: progressions,
		Deltas:       deltas,
	}

	return out, nil
}

func (s *ConsoleServer) HiroRegisteredSystems(ctx context.Context, in *emptypb.Empty) (*console.RegisteredSystems, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return &console.RegisteredSystems{
			Hiro: false,
		}, nil
	}

	registeredSystems := &console.RegisteredSystems{
		Hiro:              true,
		InventorySystem:   s.hiro.hiro.GetInventorySystem().GetType() != hiro.SystemTypeUnknown,
		ProgressionSystem: s.hiro.hiro.GetProgressionSystem().GetType() != hiro.SystemTypeUnknown,
	}

	return registeredSystems, nil
}

func (s *ConsoleServer) HiroResetProgressions(ctx context.Context, in *console.HiroResetProgressionsRequest) (*hiro.ProgressionList, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error resetting progressions, user identifier required.")
	}

	progressionSystem := s.hiro.hiro.GetProgressionSystem()
	progressions, err := progressionSystem.Reset(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.ProgressionIds)
	if err != nil {
		return nil, err
	}

	return &hiro.ProgressionList{Progressions: progressions}, nil
}

func (s *ConsoleServer) HiroUnlockProgressions(ctx context.Context, in *console.HiroUnlockProgressionsRequest) (*hiro.ProgressionList, error) {
	if s.hiro == nil || s.hiro.hiro == nil {
		return nil, ErrHiroNotRegistered
	}

	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Error unlocking progressions, user identifier required.")
	}

	progressionSystem := s.hiro.hiro.GetProgressionSystem()
	progressions, err := progressionSystem.Unlock(ctx, s.hiro.logger, s.hiro.nk, in.UserId, in.ProgressionIds)
	if err != nil {
		return nil, err
	}

	return &hiro.ProgressionList{Progressions: progressions}, nil
}

func rewardConfigToProto(rewardConfig *hiro.EconomyConfigReward) *hiro.AvailableRewards {
	if rewardConfig == nil {
		return nil
	}

	wireRewardConfig := &hiro.AvailableRewards{
		MaxRolls:       rewardConfig.MaxRolls,
		TotalWeight:    rewardConfig.TotalWeight,
		Guaranteed:     rewardConfigContentsToProto(rewardConfig.Guaranteed),
		Weighted:       make([]*hiro.AvailableRewardsContents, 0, len(rewardConfig.Weighted)),
		MaxRepeatRolls: rewardConfig.MaxRepeatRolls,
	}

	for _, weighted := range rewardConfig.Weighted {
		wireRewardConfig.Weighted = append(wireRewardConfig.Weighted, rewardConfigContentsToProto(weighted))
	}

	if rewardConfig.TeamReward != nil {
		wireRewardConfig.TeamReward = &hiro.AvailableTeamRewards{
			Guaranteed:         rewardConfigTeamContentsToProto(rewardConfig.TeamReward.Guaranteed),
			Weighted:           make([]*hiro.AvailableTeamRewardsContents, 0, len(rewardConfig.TeamReward.Weighted)),
			MaxRolls:           wireRewardConfig.TeamReward.MaxRolls,
			TotalWeight:        wireRewardConfig.TeamReward.TotalWeight,
			MaxRepeatRolls:     wireRewardConfig.TeamReward.MaxRepeatRolls,
			ToMailboxExpirySec: wireRewardConfig.TeamReward.ToMailboxExpirySec,
		}

		for _, weighted := range rewardConfig.TeamReward.Weighted {
			wireRewardConfig.TeamReward.Weighted = append(wireRewardConfig.TeamReward.Weighted, rewardConfigTeamContentsToProto(weighted))
		}

		if rewardConfig.TeamReward.MemberReward != nil {
			wireRewardConfig.TeamReward.MemberReward = &hiro.AvailableTeamMemberRewards{
				Guaranteed:     rewardConfigContentsToProto(rewardConfig.TeamReward.MemberReward.Guaranteed),
				Weighted:       make([]*hiro.AvailableRewardsContents, 0, len(rewardConfig.TeamReward.MemberReward.Weighted)),
				MaxRolls:       wireRewardConfig.TeamReward.MemberReward.MaxRolls,
				TotalWeight:    wireRewardConfig.TeamReward.MemberReward.TotalWeight,
				MaxRepeatRolls: wireRewardConfig.TeamReward.MemberReward.MaxRepeatRolls,
			}

			for _, weighted := range rewardConfig.TeamReward.MemberReward.Weighted {
				wireRewardConfig.TeamReward.MemberReward.Weighted = append(wireRewardConfig.TeamReward.MemberReward.Weighted, rewardConfigContentsToProto(weighted))
			}
		}
	}

	return wireRewardConfig
}

func rewardConfigContentsToProto(contents *hiro.EconomyConfigRewardContents) *hiro.AvailableRewardsContents {
	if contents == nil {
		return nil
	}

	proto := &hiro.AvailableRewardsContents{}
	proto.Weight = contents.Weight

	// Items
	proto.Items = make(map[string]*hiro.AvailableRewardsItem)
	for itemID, item := range contents.Items {
		protoItem := &hiro.AvailableRewardsItem{
			Count: &hiro.RewardRangeInt64{
				Min:      item.Min,
				Max:      item.Max,
				Multiple: item.Multiple,
			},
		}

		if len(item.NumericProperties) > 0 {
			protoItem.NumericProperties = make(map[string]*hiro.RewardRangeDouble)
			for numericPropertyID, value := range item.NumericProperties {
				protoItem.NumericProperties[numericPropertyID] = &hiro.RewardRangeDouble{
					Min:      value.Min,
					Max:      value.Max,
					Multiple: value.Multiple,
				}
			}
		}

		if len(item.StringProperties) > 0 {
			protoItem.StringProperties = make(map[string]*hiro.AvailableRewardsStringProperty)
			for stringPropertyID, stringProperty := range item.StringProperties {
				protoItem.StringProperties[stringPropertyID] = &hiro.AvailableRewardsStringProperty{
					Options:     make(map[string]*hiro.AvailableRewardsStringPropertyOption),
					TotalWeight: stringProperty.TotalWeight,
				}

				for optionID, option := range stringProperty.Options {
					protoItem.StringProperties[stringPropertyID].Options[optionID] = &hiro.AvailableRewardsStringPropertyOption{
						Weight: option.Weight,
					}
				}
			}
		}

		proto.Items[itemID] = protoItem
	}

	// Item Sets
	proto.ItemSets = make([]*hiro.AvailableRewardsItemSet, 0, len(contents.ItemSets))
	for _, itemSet := range contents.ItemSets {
		proto.ItemSets = append(proto.ItemSets, &hiro.AvailableRewardsItemSet{
			Count: &hiro.RewardRangeInt64{
				Min:      itemSet.Min,
				Max:      itemSet.Max,
				Multiple: itemSet.Multiple,
			},
			MaxRepeats: itemSet.MaxRepeats,
			Set:        itemSet.Set,
		})
	}

	// Currencies
	proto.Currencies = make(map[string]*hiro.AvailableRewardsCurrency)
	for currencyID, currency := range contents.Currencies {
		proto.Currencies[currencyID] = &hiro.AvailableRewardsCurrency{
			Count: &hiro.RewardRangeInt64{
				Min:      currency.Min,
				Max:      currency.Max,
				Multiple: currency.Multiple,
			},
		}
	}

	// Energies
	proto.Energies = make(map[string]*hiro.AvailableRewardsEnergy)
	for energyID, energy := range contents.Energies {
		proto.Energies[energyID] = &hiro.AvailableRewardsEnergy{
			Count: &hiro.RewardRangeInt32{
				Min:      energy.Min,
				Max:      energy.Max,
				Multiple: energy.Multiple,
			},
		}
	}

	// Energy Modifiers
	proto.EnergyModifiers = make([]*hiro.AvailableRewardsEnergyModifier, 0, len(contents.EnergyModifiers))
	for _, energyModifier := range contents.EnergyModifiers {
		proto.EnergyModifiers = append(proto.EnergyModifiers, &hiro.AvailableRewardsEnergyModifier{
			Id:       energyModifier.Id,
			Operator: energyModifier.Operator,
			Value: &hiro.RewardRangeInt64{
				Min:      energyModifier.Value.Min,
				Max:      energyModifier.Value.Max,
				Multiple: energyModifier.Value.Multiple,
			},
			DurationSec: &hiro.RewardRangeUInt64{
				Min:      energyModifier.DurationSec.Min,
				Max:      energyModifier.DurationSec.Max,
				Multiple: energyModifier.DurationSec.Multiple,
			},
		})
	}

	// Reward Modifiers
	proto.RewardModifiers = make([]*hiro.AvailableRewardsRewardModifier, 0, len(contents.RewardModifiers))
	for _, rewardModifier := range contents.RewardModifiers {
		proto.RewardModifiers = append(proto.RewardModifiers, &hiro.AvailableRewardsRewardModifier{
			Id:       rewardModifier.Id,
			Type:     rewardModifier.Type,
			Operator: rewardModifier.Operator,
			Value: &hiro.RewardRangeInt64{
				Min:      rewardModifier.Value.Min,
				Max:      rewardModifier.Value.Max,
				Multiple: rewardModifier.Value.Multiple,
			},
			DurationSec: &hiro.RewardRangeUInt64{
				Min:      rewardModifier.DurationSec.Min,
				Max:      rewardModifier.DurationSec.Max,
				Multiple: rewardModifier.DurationSec.Multiple,
			},
		})
	}

	return proto
}

func rewardConfigTeamContentsToProto(contents *hiro.EconomyConfigTeamRewardContents) *hiro.AvailableTeamRewardsContents {
	if contents == nil {
		return nil
	}

	proto := &hiro.AvailableTeamRewardsContents{}
	proto.Weight = contents.Weight

	// Items
	proto.Items = make(map[string]*hiro.AvailableRewardsItem)
	for itemID, item := range contents.Items {
		protoItem := &hiro.AvailableRewardsItem{
			Count: &hiro.RewardRangeInt64{
				Min:      item.Min,
				Max:      item.Max,
				Multiple: item.Multiple,
			},
		}

		if len(item.NumericProperties) > 0 {
			protoItem.NumericProperties = make(map[string]*hiro.RewardRangeDouble)
			for numericPropertyID, value := range item.NumericProperties {
				protoItem.NumericProperties[numericPropertyID] = &hiro.RewardRangeDouble{
					Min:      value.Min,
					Max:      value.Max,
					Multiple: value.Multiple,
				}
			}
		}

		if len(item.StringProperties) > 0 {
			protoItem.StringProperties = make(map[string]*hiro.AvailableRewardsStringProperty)
			for stringPropertyID, stringProperty := range item.StringProperties {
				protoItem.StringProperties[stringPropertyID] = &hiro.AvailableRewardsStringProperty{
					Options:     make(map[string]*hiro.AvailableRewardsStringPropertyOption),
					TotalWeight: stringProperty.TotalWeight,
				}

				for optionID, option := range stringProperty.Options {
					protoItem.StringProperties[stringPropertyID].Options[optionID] = &hiro.AvailableRewardsStringPropertyOption{
						Weight: option.Weight,
					}
				}
			}
		}

		proto.Items[itemID] = protoItem
	}

	// Item Sets
	proto.ItemSets = make([]*hiro.AvailableRewardsItemSet, 0, len(contents.ItemSets))
	for _, itemSet := range contents.ItemSets {
		proto.ItemSets = append(proto.ItemSets, &hiro.AvailableRewardsItemSet{
			Count: &hiro.RewardRangeInt64{
				Min:      itemSet.Min,
				Max:      itemSet.Max,
				Multiple: itemSet.Multiple,
			},
			MaxRepeats: itemSet.MaxRepeats,
			Set:        itemSet.Set,
		})
	}

	// Currencies
	proto.Currencies = make(map[string]*hiro.AvailableRewardsCurrency)
	for currencyID, currency := range contents.Currencies {
		proto.Currencies[currencyID] = &hiro.AvailableRewardsCurrency{
			Count: &hiro.RewardRangeInt64{
				Min:      currency.Min,
				Max:      currency.Max,
				Multiple: currency.Multiple,
			},
		}
	}

	//// Energies
	//proto.Energies = make(map[string]*hiro.AvailableRewardsEnergy)
	//for energyID, energy := range contents.Energies {
	//	proto.Energies[energyID] = &hiro.AvailableRewardsEnergy{
	//		Count: &hiro.RewardRangeInt32{
	//			Min:      energy.Min,
	//			Max:      energy.Max,
	//			Multiple: energy.Multiple,
	//		},
	//	}
	//}
	//
	//// Energy Modifiers
	//proto.EnergyModifiers = make([]*hiro.AvailableRewardsEnergyModifier, 0, len(contents.EnergyModifiers))
	//for _, energyModifier := range contents.EnergyModifiers {
	//	proto.EnergyModifiers = append(proto.EnergyModifiers, &hiro.AvailableRewardsEnergyModifier{
	//		Id:       energyModifier.Id,
	//		Operator: energyModifier.Operator,
	//		Value: &hiro.RewardRangeInt64{
	//			Min:      energyModifier.Value.Min,
	//			Max:      energyModifier.Value.Max,
	//			Multiple: energyModifier.Value.Multiple,
	//		},
	//		DurationSec: &hiro.RewardRangeUInt64{
	//			Min:      energyModifier.DurationSec.Min,
	//			Max:      energyModifier.DurationSec.Max,
	//			Multiple: energyModifier.DurationSec.Multiple,
	//		},
	//	})
	//}

	// Reward Modifiers
	proto.RewardModifiers = make([]*hiro.AvailableRewardsRewardModifier, 0, len(contents.RewardModifiers))
	for _, rewardModifier := range contents.RewardModifiers {
		proto.RewardModifiers = append(proto.RewardModifiers, &hiro.AvailableRewardsRewardModifier{
			Id:       rewardModifier.Id,
			Type:     rewardModifier.Type,
			Operator: rewardModifier.Operator,
			Value: &hiro.RewardRangeInt64{
				Min:      rewardModifier.Value.Min,
				Max:      rewardModifier.Value.Max,
				Multiple: rewardModifier.Value.Multiple,
			},
			DurationSec: &hiro.RewardRangeUInt64{
				Min:      rewardModifier.DurationSec.Min,
				Max:      rewardModifier.DurationSec.Max,
				Multiple: rewardModifier.DurationSec.Multiple,
			},
		})
	}

	return proto
}
