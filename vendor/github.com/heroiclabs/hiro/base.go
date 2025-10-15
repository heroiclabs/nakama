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
	"errors"
	"plugin"

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"google.golang.org/protobuf/encoding/protojson"
)

var (
	ErrInternal           = runtime.NewError("internal error occurred", 13) // INTERNAL
	ErrBadInput           = runtime.NewError("bad input", 3)                // INVALID_ARGUMENT
	ErrFileNotFound       = runtime.NewError("file not found", 3)
	ErrNoSessionUser      = runtime.NewError("no user ID in session", 3)       // INVALID_ARGUMENT
	ErrNoSessionID        = runtime.NewError("no session ID in session", 3)    // INVALID_ARGUMENT
	ErrNoSessionUsername  = runtime.NewError("no username in session", 3)      // INVALID_ARGUMENT
	ErrPayloadDecode      = runtime.NewError("cannot decode json", 13)         // INTERNAL
	ErrPayloadEmpty       = runtime.NewError("payload should not be empty", 3) // INVALID_ARGUMENT
	ErrPayloadEncode      = runtime.NewError("cannot encode json", 13)         // INTERNAL
	ErrPayloadInvalid     = runtime.NewError("payload is invalid", 3)          // INVALID_ARGUMENT
	ErrSessionUser        = runtime.NewError("user ID in session", 3)          // INVALID_ARGUMENT
	ErrSystemNotAvailable = runtime.NewError("system not available", 13)       // INTERNAL
	ErrSystemNotFound     = runtime.NewError("system not found", 13)           // INTERNAL
)

// The BaseSystem provides various small features which aren't large enough to be in their own gameplay systems.
type BaseSystem interface {
	System

	// RateApp uses the SMTP configuration to receive feedback from players via email.
	RateApp(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, username string, score uint32, message string) (err error)

	// SetDevicePrefs sets push notification tokens on a user's account so push messages can be received.
	SetDevicePrefs(ctx context.Context, logger runtime.Logger, db *sql.DB, userID, deviceID, pushTokenAndroid, pushTokenIos string, preferences map[string]bool) (err error)

	// Sync processes an operation to update the server with offline state changes.
	Sync(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID string, req *SyncRequest) (resp *SyncResponse, err error)
}

// BaseSystemConfig is the data definition for the BaseSystem type.
type BaseSystemConfig struct {
	RateAppSmtpAddr          string `json:"rate_app_smtp_addr,omitempty"`            // "smtp.gmail.com"
	RateAppSmtpUsername      string `json:"rate_app_smtp_username,omitempty"`        // "email@domain"
	RateAppSmtpPassword      string `json:"rate_app_smtp_password,omitempty"`        // "password"
	RateAppSmtpEmailFrom     string `json:"rate_app_smtp_email_from,omitempty"`      // "gamename-server@mmygamecompany.com"
	RateAppSmtpEmailFromName string `json:"rate_app_smtp_email_from_name,omitempty"` // My Game Company
	RateAppSmtpEmailSubject  string `json:"rate_app_smtp_email_subject,omitempty"`   // "RateApp Feedback"
	RateAppSmtpEmailTo       string `json:"rate_app_smtp_email_to,omitempty"`        // "gamename-rateapp@mygamecompany.com"
	RateAppSmtpPort          int    `json:"rate_app_smtp_port,omitempty"`            // 587

	RateAppTemplate string `json:"rate_app_template"` // HTML email template
}

type AfterAuthenticateFn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, session *api.Session) error

type CollectionResolverFn func(ctx context.Context, systemType SystemType, collection string) (string, error)

// ActivityCalculator specifies a function used to resolve an activity score for some set of users.
// Users not in the returned map are assumed to have an activity score of 0. Higher activity values
// should generally be used to indicate more active users. Individual user activity scores may be
// used to compute a team activity score for any teams the user is part of.
type ActivityCalculator func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userIDs []string) map[string]int64

// Hiro provides a type which combines all gameplay systems.
type Hiro interface {
	// SetPersonalizer is deprecated in favor of AddPersonalizer function to compose a chain of configuration personalization.
	SetPersonalizer(Personalizer)
	AddPersonalizer(personalizer Personalizer)

	AddPublisher(publisher Publisher)

	SetAfterAuthenticate(fn AfterAuthenticateFn)

	// SetCollectionResolver sets a function that may change the storage collection target for Hiro systems. Not typically used.
	SetCollectionResolver(fn CollectionResolverFn)

	// SetActivityCalculator sets a function expected to return an activity score for
	// each of the requested users. Missing users are assumed to have a score of 0.
	SetActivityCalculator(fn ActivityCalculator)

	GetAchievementsSystem() AchievementsSystem
	GetBaseSystem() BaseSystem
	GetEconomySystem() EconomySystem
	GetEnergySystem() EnergySystem
	GetInventorySystem() InventorySystem
	GetLeaderboardsSystem() LeaderboardsSystem
	GetStatsSystem() StatsSystem
	GetTeamsSystem() TeamsSystem
	GetTutorialsSystem() TutorialsSystem
	GetUnlockablesSystem() UnlockablesSystem
	GetEventLeaderboardsSystem() EventLeaderboardsSystem
	GetProgressionSystem() ProgressionSystem
	GetIncentivesSystem() IncentivesSystem
	GetAuctionsSystem() AuctionsSystem
	GetStreaksSystem() StreaksSystem
	GetChallengesSystem() ChallengesSystem
	GetRewardMailboxSystem() RewardMailboxSystem
}

// The SystemType identifies each of the gameplay systems.
type SystemType uint

const (
	SystemTypeUnknown SystemType = iota
	SystemTypeBase
	SystemTypeEnergy
	SystemTypeUnlockables
	SystemTypeTutorials
	SystemTypeLeaderboards
	SystemTypeStats
	SystemTypeTeams
	SystemTypeInventory
	SystemTypeAchievements
	SystemTypeEconomy
	SystemTypeEventLeaderboards
	SystemTypeProgression
	SystemTypeIncentives
	SystemTypeAuctions
	SystemTypeStreaks
	SystemTypeChallenges
	SystemTypeRewardMailbox
)

// Init initializes a Hiro type with the configurations provided.
func Init(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, initializer runtime.Initializer, binPath string, licenseKey string, configs ...SystemConfig) (Hiro, error) {
	// Open the plugin.
	binFile, err := nk.ReadFile(binPath)
	if err != nil {
		return nil, err
	}
	//goland:noinspection GoUnhandledErrorResult
	defer binFile.Close()

	p, err := plugin.Open(binFile.Name())
	if err != nil {
		return nil, err
	}

	// Look up the required initialisation function.
	f, err := p.Lookup("Init")
	if err != nil {
		return nil, err
	}

	// Ensure the function has the correct types.
	fn, ok := f.(func(context.Context, runtime.Logger, runtime.NakamaModule, runtime.Initializer, *protojson.MarshalOptions, *protojson.UnmarshalOptions, string, ...SystemConfig) (Hiro, error))
	if !ok {
		return nil, errors.New("error reading hiro-gdk.Init function in Go module")
	}

	marshaler := &protojson.MarshalOptions{
		UseEnumNumbers:  true,
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	unmarshaler := &protojson.UnmarshalOptions{DiscardUnknown: false}

	return fn(ctx, logger, nk, initializer, marshaler, unmarshaler, licenseKey, configs...)
}

// The SystemConfig describes the configuration that each gameplay system must use to configure itself.
type SystemConfig interface {
	// GetType returns the runtime type of the gameplay system.
	GetType() SystemType

	// GetConfigFile returns the configuration file used for the data definitions in the gameplay system.
	GetConfigFile() string

	// GetRegister returns true if the gameplay system's RPCs should be registered with the game server.
	GetRegister() bool

	// GetExtra returns the extra parameter used to configure the gameplay system.
	GetExtra() any
}

var _ SystemConfig = &systemConfig{}

type systemConfig struct {
	systemType SystemType
	configFile string
	register   bool

	extra any
}

func (sc *systemConfig) GetType() SystemType {
	return sc.systemType
}
func (sc *systemConfig) GetConfigFile() string {
	return sc.configFile
}
func (sc *systemConfig) GetRegister() bool {
	return sc.register
}
func (sc *systemConfig) GetExtra() any {
	return sc.extra
}

// OnReward is a function that can be used by each gameplay system to provide an override reward.
type OnReward[T any] func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, sourceID string, source T, rewardConfig *EconomyConfigReward, reward *Reward) (*Reward, error)

// OnTeamReward is a function that can be used by the teams system to provide an override reward.
type OnTeamReward[T any] func(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, userID, teamID, sourceID string, source T, rewardConfig *EconomyConfigReward, reward *Reward) (*Reward, error)

// A System is a base type for a gameplay system.
type System interface {
	// GetType provides the runtime type of the gameplay system.
	GetType() SystemType

	// GetConfig returns the configuration type of the gameplay system.
	GetConfig() any
}

// UsernameOverrideFn can be used to provide a different username generation strategy from the default in Nakama server.
// Requested username indicates what the username would otherwise be set to, if the incoming request specified a value.
// The function is always expected to return a value, and returning "" defers to Nakama's built-in behaviour.
type UsernameOverrideFn func(requestedUsername string) string

// WithAchievementsSystem configures an AchievementsSystem type and optionally registers its RPCs with the game server.
func WithAchievementsSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeAchievements,
		configFile: configFile,
		register:   register,
	}
}

// WithBaseSystem configures a BaseSystem type and optionally registers its RPCs with the game server.
func WithBaseSystem(configFile string, register bool, usernameOverride ...UsernameOverrideFn) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeBase,
		configFile: configFile,
		register:   register,

		extra: usernameOverride,
	}
}

// WithEconomySystem configures an EconomySystem type and optionally registers its RPCs with the game server.
func WithEconomySystem(configFile string, register bool, ironSrcPrivKey ...string) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeEconomy,
		configFile: configFile,
		register:   register,

		extra: ironSrcPrivKey,
	}
}

// WithEnergySystem configures an EnergySystem type and optionally registers its RPCs with the game server.
func WithEnergySystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeEnergy,
		configFile: configFile,
		register:   register,
	}
}

// WithInventorySystem configures an InventorySystem type and optionally registers its RPCs with the game server.
func WithInventorySystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeInventory,
		configFile: configFile,
		register:   register,
	}
}

// WithLeaderboardsSystem configures a LeaderboardsSystem type.
func WithLeaderboardsSystem(configFile string, register bool, validateWriteScore ...ValidateWriteScoreFn) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeLeaderboards,
		configFile: configFile,
		register:   register,

		extra: validateWriteScore,
	}
}

// WithStatsSystem configures a StatsSystem type and optionally registers its RPCs with the game server.
func WithStatsSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeStats,
		configFile: configFile,
		register:   register,
	}
}

// WithTeamsSystem configures a TeamsSystem type and optionally registers its RPCs with the game server.
func WithTeamsSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeTeams,
		configFile: configFile,
		register:   register,
	}
}

// WithTutorialsSystem configures a TutorialsSystem type and optionally registers its RPCs with the game server.
func WithTutorialsSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeTutorials,
		configFile: configFile,
		register:   register,
	}
}

// WithUnlockablesSystem configures an UnlockablesSystem type and optionally registers its RPCs with the game server.
func WithUnlockablesSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeUnlockables,
		configFile: configFile,
		register:   register,
	}
}

// WithEventLeaderboardsSystem configures an EventLeaderboardsSystem type and optionally registers its RPCs with the game server.
func WithEventLeaderboardsSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeEventLeaderboards,
		configFile: configFile,
		register:   register,
	}
}

// WithProgressionSystem configures a ProgressionSystem type and optionally registers its RPCs with the game server.
func WithProgressionSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeProgression,
		configFile: configFile,
		register:   register,
	}
}

// WithIncentivesSystem configures a IncentivesSystem type and optionally registers its RPCs with the game server.
func WithIncentivesSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeIncentives,
		configFile: configFile,
		register:   register,
	}
}

// WithAuctionsSystem configures a AuctionsSystem type and optionally registers its RPCs with the game server.
func WithAuctionsSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeAuctions,
		configFile: configFile,
		register:   register,
	}
}

// WithStreaksSystem configures a StreaksSystem type and optionally registers its RPCs with the game server.
func WithStreaksSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeStreaks,
		configFile: configFile,
		register:   register,
	}
}

// WithChallengesSystem configures a ChallengesSystem type and optionally registers its RPCs with the game server.
func WithChallengesSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeChallenges,
		configFile: configFile,
		register:   register,
	}
}

// WithRewardMailboxSystem configures a RewardMailboxSystem type and optionally registers its RPCs with the game server.
func WithRewardMailboxSystem(configFile string, register bool) SystemConfig {
	return &systemConfig{
		systemType: SystemTypeRewardMailbox,
		configFile: configFile,
		register:   register,
	}
}

// UnregisterRpc clears the implementation of one or more RPCs registered in Nakama by Hiro gameplay systems with a
// no-op version (http response 404). This is useful to remove individual RPCs which you do not want to be callable by
// game clients:
//
//	hiro.UnregisterRpc(initializer, hiro.RpcId_RPC_ID_ECONOMY_GRANT, hiro.RpcId_RPC_ID_INVENTORY_GRANT)
//
// The behaviour of `initializer.RegisterRpc` in Nakama is last registration wins. It's recommended to use UnregisterRpc
// only after `hiro.Init` has been executed.
func UnregisterRpc(initializer runtime.Initializer, ids ...RpcId) error {
	noopFn := func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string) (string, error) {
		return "", runtime.NewError("not found", 12) // GRPC - UNIMPLEMENTED
	}
	for _, id := range ids {
		if err := initializer.RegisterRpc(id.String(), noopFn); err != nil {
			return err
		}
	}
	return nil
}

// UnregisterDebugRpc clears the implementation of ALL debug RPCs registered in Nakama by Hiro gameplay systems with
// a no-op version (http response 404). This is useful to remove debug RPCs if you do not want them to be callable
// by game clients:
//
//	hiro.UnregisterDebugRpc(initializer)
//
// The behaviour of `initializer.RegisterRpc` in Nakama is last registration wins. It's recommended to use
// UnregisterDebugRpc only after `hiro.Init` has been executed.
func UnregisterDebugRpc(initializer runtime.Initializer) error {
	ids := []RpcId{
		RpcId_RPC_ID_EVENT_LEADERBOARD_DEBUG_FILL,
		RpcId_RPC_ID_EVENT_LEADERBOARD_DEBUG_RANDOM_SCORES,
		RpcId_RPC_ID_TEAMS_EVENT_LEADERBOARD_DEBUG_FILL,
		RpcId_RPC_ID_TEAMS_EVENT_LEADERBOARD_DEBUG_RANDOM_SCORES,
	}
	return UnregisterRpc(initializer, ids...)
}
