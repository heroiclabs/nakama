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
  "database/sql"

  "github.com/heroiclabs/nakama-common/runtime"
)

var (
  ErrTeamNotFound        = runtime.NewError("team not found", 3)         // INVALID_ARGUMENT
  ErrTeamMaxSizeExceeded = runtime.NewError("team max size exceeded", 3) // INVALID_ARGUMENT
  ErrTeamAlreadyMember   = runtime.NewError("already part of a team", 3) // INVALID_ARGUMENT

  ErrTeamGiftsNotFound            = runtime.NewError("team gift not found", 3)                     // INVALID_ARGUMENT
  ErrTeamGiftsNotActive           = runtime.NewError("team gift not active", 3)                    // INVALID_ARGUMENT
  ErrTeamGiftsMaxCount            = runtime.NewError("team gift max count reached", 3)             // INVALID_ARGUMENT
  ErrTeamGiftsMaxContributorCount = runtime.NewError("team gift max contributor count reached", 3) // INVALID_ARGUMENT
)

// TeamsConfig is the data definition for a TeamsSystem type.
type TeamsConfig struct {
  InitialMaxTeamSize int  `json:"initial_max_team_size,omitempty"`
  MaxTeamSize        int  `json:"max_team_size,omitempty"`
  AllowMultipleTeams bool `json:"allow_multiple_teams,omitempty"`

  Wallet            *TeamsWalletConfig                     `json:"wallet,omitempty"`
  StoreItems        map[string]*TeamEconomyConfigStoreItem `json:"store_items,omitempty"`
  Stats             *TeamsStatsConfig                      `json:"stats,omitempty"`
  Inventory         *TeamsInventoryConfig                  `json:"inventory,omitempty"`
  Achievements      *TeamsAchievementsConfig               `json:"achievements,omitempty"`
  EventLeaderboards *TeamEventLeaderboardsConfig           `json:"event_leaderboards,omitempty"`
  RewardMailbox     *TeamRewardMailboxConfig               `json:"reward_mailbox,omitempty"`
  Gifts             *TeamGiftsConfig                       `json:"gifts,omitempty"`
}

type TeamEconomyConfigStoreItem struct {
  Category             string                          `json:"category,omitempty"`
  Cost                 *TeamEconomyConfigStoreItemCost `json:"cost,omitempty"`
  Description          string                          `json:"description,omitempty"`
  Name                 string                          `json:"name,omitempty"`
  Reward               *EconomyConfigReward            `json:"reward,omitempty"`
  AdditionalProperties map[string]string               `json:"additional_properties,omitempty"`
  Disabled             bool                            `json:"disabled,omitempty"`
  Unavailable          bool                            `json:"unavailable,omitempty"`
}

type TeamEconomyConfigStoreItemCost struct {
  Currencies map[string]int64 `json:"currencies,omitempty"`
}

type TeamsWalletConfig struct {
  Currencies map[string]int64 `json:"currencies,omitempty"`
}

type TeamsStatsConfig struct {
  StatsPublic  map[string]*StatsConfigStat `json:"stats_public,omitempty"`
  StatsPrivate map[string]*StatsConfigStat `json:"stats_private,omitempty"`
}

type TeamsInventoryConfig struct {
  Items    map[string]*InventoryConfigItem `json:"items,omitempty"`
  Limits   *InventoryConfigLimits          `json:"limits,omitempty"`
  ItemSets map[string]map[string]bool      `json:"-"` // Auto-computed when the config is read or personalized.

  ConfigSource ConfigSource[*InventoryConfigItem] `json:"-"` // Not included in serialization, set dynamically.
}

type TeamsAchievementsConfig struct {
  Achievements map[string]*AchievementsConfigAchievement `json:"achievements,omitempty"`
}

type TeamEventLeaderboardsConfig struct {
  EventLeaderboards map[string]*EventLeaderboardsConfigLeaderboard `json:"event_leaderboards,omitempty"`
}

type TeamRewardMailboxConfig struct {
  MaxSize int `json:"max_size,omitempty"`
}

type TeamGiftsConfig struct {
  Gifts map[string]*TeamGiftsConfigGift `json:"gifts,omitempty"`
}

type TeamGiftsConfigGift struct {
  Name                 string                       `json:"name,omitempty"`
  Description          string                       `json:"description,omitempty"`
  Category             string                       `json:"category,omitempty"`
  ResetSchedule        string                       `json:"reset_schedule,omitempty"`
  DurationSec          int64                        `json:"duration_sec,omitempty"`
  MaxCount             int64                        `json:"max_count,omitempty"`
  MaxContributorCount  int64                        `json:"max_contributor_count,omitempty"`
  ContributionCost     *EconomyConfigReward         `json:"contribution_cost,omitempty"`
  ContributionReward   *EconomyConfigReward         `json:"contribution_reward,omitempty"`
  Rewards              []*TeamGiftsConfigGiftReward `json:"rewards,omitempty"`
  AdditionalProperties map[string]interface{}       `json:"additional_properties,omitempty"`
}

type TeamGiftsConfigGiftReward struct {
  MinCount             int64                `json:"min_count,omitempty"`
  ContributorReward    *EconomyConfigReward `json:"contributor_reward,omitempty"`
  NoncontributorReward *EconomyConfigReward `json:"noncontributor_reward,omitempty"`
}

// A TeamsSystem is a gameplay system which wraps the groups system in Nakama server.
type TeamsSystem interface {
  System

  // SetActivityCalculator specifies a function to use when calculating team activity score.
  SetActivityCalculator(fn TeamActivityCalculator)

  // Create makes a new team (i.e. Nakama group) with additional metadata which configures the team.
  Create(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, req *TeamCreateRequest) (team *Team, err error)

  // List will return a list of teams which the user can join.
  List(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, req *TeamListRequest) (teams *TeamList, err error)

  // Search for teams based on given criteria.
  Search(ctx context.Context, db *sql.DB, logger runtime.Logger, nk runtime.NakamaModule, req *TeamSearchRequest) (teams *TeamList, err error)

  // Update changes one or more properties of the team.
  Update(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, req *TeamUpdateRequest) (team *Team, err error)

  // Get a team by its identifier.
  Get(ctx context.Context, db *sql.DB, logger runtime.Logger, nk runtime.NakamaModule, req *TeamGetRequest) (*Team, error)

  // UserTeamsList fetches user accounts and their associated teams.
  UserTeamsList(ctx context.Context, db *sql.DB, logger runtime.Logger, nk runtime.NakamaModule, req *UserTeamsListRequest) (*UserTeamsList, error)

  // WriteChatMessage sends a message to the user's team even when they're not connected on a realtime socket.
  WriteChatMessage(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, req *TeamWriteChatMessageRequest) (resp *ChannelMessageAck, err error)

  // UpdateMaxSize sets a new maximum team size for the selected team.
  UpdateMaxSize(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, userID, teamID string, count int, delta bool) error

  // StoreList will get the defined store items available to the team.
  StoreList(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string) (storeItems map[string]*TeamEconomyConfigStoreItem, rewardModifiers []*ActiveRewardModifier, timestamp int64, err error)

  // StorePurchase will validate a purchase and give the user ID the appropriate rewards.
  StorePurchase(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, userID, teamID, itemID string) (updatedWallet map[string]int64, updatedInventory *Inventory, reward *Reward, err error)

  // SetOnPurchaseReward sets a custom reward function which will run after a team store item's reward is rolled.
  SetOnPurchaseReward(fn OnTeamReward[*TeamEconomyConfigStoreItem])

  // WalletGet fetches the wallet for a specified team.
  WalletGet(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string) (*TeamWallet, error)

  // WalletGrant grants currencies to the specified team's wallet.
  WalletGrant(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, currencies map[string]int64) (*TeamWallet, error)

  // InventoryList will return the items defined as well as the computed item sets for the team by ID.
  InventoryList(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, category string) (items map[string]*InventoryConfigItem, itemSets map[string][]string, err error)

  // InventoryListInventoryItems will return the items which are part of a team's inventory by ID.
  InventoryListInventoryItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, category string) (inventory *Inventory, err error)

  // InventoryConsumeItems will deduct the item(s) from the team's inventory and run the consume reward for each one, if defined.
  InventoryConsumeItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, itemIDs, instanceIDs map[string]int64, overConsume bool) (updatedInventory *Inventory, rewards map[string][]*Reward, instanceRewards map[string][]*Reward, err error)

  // InventoryGrantItems will add the item(s) to a team's inventory by ID.
  InventoryGrantItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, itemIDs map[string]int64, ignoreLimits bool) (updatedInventory *Inventory, newItems map[string]*InventoryItem, updatedItems map[string]*InventoryItem, notGrantedItemIDs map[string]int64, err error)

  // InventoryUpdateItems will update the properties which are stored on each item by instance ID for a team.
  InventoryUpdateItems(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, instanceIDs map[string]*InventoryUpdateItemProperties) (updatedInventory *Inventory, err error)

  // SetOnInventoryConsumeReward sets a custom reward function which will run after a team inventory item consume reward is rolled.
  SetOnInventoryConsumeReward(fn OnTeamReward[*InventoryConfigItem])

  // SetInventoryConfigSource sets a custom additional config lookup function.
  SetInventoryConfigSource(fn ConfigSource[*InventoryConfigItem])

  // ClaimAchievements when one or more achievements whose progress has completed by their IDs.
  ClaimAchievements(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, achievementIDs []string, claimTotal bool) (achievements map[string]*Achievement, repeatAchievements map[string]*Achievement, err error)

  // GetAchievements returns all achievements available to the user and progress on them.
  GetAchievements(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string) (achievements map[string]*Achievement, repeatAchievements map[string]*Achievement, err error)

  // UpdateAchievements updates progress on one or more achievements by the same amount.
  UpdateAchievements(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, achievementUpdates map[string]int64) (achievements map[string]*Achievement, repeatAchievements map[string]*Achievement, err error)

  // SetOnAchievementReward sets a custom reward function which will run after an achievement's reward is rolled.
  SetOnAchievementReward(fn OnTeamReward[*AchievementsConfigAchievement])

  // SetOnSubAchievementReward sets a custom reward function which will run after a sub-achievement's reward is rolled.
  SetOnSubAchievementReward(fn OnTeamReward[*AchievementsConfigSubAchievement])

  // SetOnAchievementTotalReward sets a custom reward function which will run after an achievement's total reward is rolled.
  SetOnAchievementTotalReward(fn OnTeamReward[*AchievementsConfigAchievement])

  // ListEventLeaderboard returns available event leaderboards for the team.
  ListEventLeaderboard(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, withScores bool, categories []string) (eventLeaderboards []*TeamEventLeaderboard, err error)

  // GetEventLeaderboard returns a specified event leaderboard's cohort for the team.
  GetEventLeaderboard(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, eventLeaderboardID string) (eventLeaderboard *TeamEventLeaderboard, err error)

  // RollEventLeaderboard places the team into a new cohort for the specified event leaderboard if possible.
  RollEventLeaderboard(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, eventLeaderboardID string, tier *int, matchmakerProperties map[string]interface{}, metadata map[string]interface{}) (eventLeaderboard *TeamEventLeaderboard, err error)

  // UpdateEventLeaderboard updates the team's score in the specified event leaderboard, and returns the team's updated cohort information.
  UpdateEventLeaderboard(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, userID, teamID, eventLeaderboardID string, score, subscore int64, metadata map[string]interface{}, conditionalMetadataUpdate bool) (eventLeaderboard *TeamEventLeaderboard, err error)

  // ClaimEventLeaderboard claims the team's reward for the given event leaderboard.
  ClaimEventLeaderboard(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, eventLeaderboardID string) (eventLeaderboard *TeamEventLeaderboard, err error)

  // SetOnEventLeaderboardsReward sets a custom reward function which will run after a team event leaderboard's reward is rolled.
  SetOnEventLeaderboardsReward(fn OnTeamReward[*EventLeaderboardsConfigLeaderboard])

  // SetOnEventLeaderboardCohortSelection sets a custom function that can replace the cohort or opponent selection feature of team event leaderboards.
  SetOnEventLeaderboardCohortSelection(fn OnTeamEventLeaderboardCohortSelection)

  // DebugFill fills the user's current cohort with dummy teams for all remaining available slots.
  DebugFill(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, eventLeaderboardID string, targetCount int) (eventLeaderboard *TeamEventLeaderboard, err error)

  // DebugRandomScores assigns random scores to the participants of the team's current cohort, except to the team itself.
  DebugRandomScores(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, eventLeaderboardID string, scoreMin, scoreMax, subscoreMin, subscoreMax int64, operator *int) (eventLeaderboard *TeamEventLeaderboard, err error)

  // RewardMailboxList lists the team reward mailbox, from most recent to oldest.
  RewardMailboxList(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, limit int, cursor string) (mailboxList *RewardMailboxList, err error)

  // RewardMailboxClaim claims a reward and optionally removes it from the team mailbox.
  RewardMailboxClaim(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, id string, delete bool) (mailboxEntry *RewardMailboxEntry, err error)

  // RewardMailboxDelete deletes a reward from the team mailbox, even if it is not yet claimed.
  RewardMailboxDelete(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, ids []string) error

  // RewardMailboxGrant grants a reward to the team's mailbox.
  RewardMailboxGrant(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, reward *Reward) (mailboxEntry *RewardMailboxEntry, err error)

  // SetOnRewardMailboxClaimReward sets a custom reward function which will run after a team mailbox reward is rolled during claiming.
  SetOnRewardMailboxClaimReward(fn OnTeamReward[*RewardMailboxEntry])

  // StatsList retrieves the full list of stats for the specified teams.
  StatsList(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, teamIDs []string) (stats map[string]*StatList, err error)

  // StatsUpdate updates public and private stats for the specified team.
  StatsUpdate(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string, publicStats []*StatUpdate, privateStats []*StatUpdate) (statList *StatList, err error)

  // GiftList lists available team gifts, including past gifts that still have valid rewards to claim.
  GiftList(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID string) (giftList *TeamGiftList, err error)

  // GiftContribute updates the specified gift with a given contribution amount.
  GiftContribute(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, giftID string, count int64) (ack *TeamGiftContributeAck, err error)

  // GiftClaim claims all pending rewards for a particular gift.
  GiftClaim(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, giftID string, endTimeSec int64) (ack *TeamGiftClaimAck, err error)

  // SetOnGiftContributeReward sets a custom reward function which will run after a team gift contribution reward is rolled.
  SetOnGiftContributeReward(fn OnTeamReward[*TeamGift])

  // SetOnGiftContributeCost sets a custom reward function which will run after a team gift contribution cost is rolled.
  SetOnGiftContributeCost(fn OnTeamReward[*TeamGift])

  // SetOnGiftClaimReward sets a custom reward function which will run after a team gift reward is rolled during claiming.
  SetOnGiftClaimReward(fn OnTeamReward[*TeamGift])
}

type OnTeamEventLeaderboardCohortSelection func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, storageIndex string, eventID string, config *EventLeaderboardsConfigLeaderboard, userID, teamID string, tier int, matchmakerProperties map[string]interface{}) (cohortID string, cohortUserIDs []string, newCohort *EventLeaderboardCohortConfig, err error)

// TeamActivityCalculator specifies a function used to resolve an activity score for a given team.
// Implementations may inspect the team members list to use individual activity scores as part of
// the calculation. Higher activity values should generally be used to indicate more active teams.
type TeamActivityCalculator func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, team *Team) int64
