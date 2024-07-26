// Copyright 2018 The Nakama Authors
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
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const LTSentinel = lua.LValueType(-1)

type LSentinelType struct {
	lua.LNilType
}

func (s *LSentinelType) String() string       { return "" }
func (s *LSentinelType) Type() lua.LValueType { return LTSentinel }

var LSentinel = lua.LValue(&LSentinelType{})

type RuntimeLuaCallbacks struct {
	RPC                            *MapOf[string, *lua.LFunction]
	Before                         *MapOf[string, *lua.LFunction]
	After                          *MapOf[string, *lua.LFunction]
	Matchmaker                     *lua.LFunction
	TournamentEnd                  *lua.LFunction
	TournamentReset                *lua.LFunction
	LeaderboardReset               *lua.LFunction
	Shutdown                       *lua.LFunction
	PurchaseNotificationApple      *lua.LFunction
	SubscriptionNotificationApple  *lua.LFunction
	PurchaseNotificationGoogle     *lua.LFunction
	SubscriptionNotificationGoogle *lua.LFunction
	StorageIndexFilter             *MapOf[string, *lua.LFunction]
}

type RuntimeLuaModule struct {
	Name    string
	Path    string
	Content []byte
}

type RuntimeLuaModuleCache struct {
	Names   []string
	Modules map[string]*RuntimeLuaModule
}

func (mc *RuntimeLuaModuleCache) Add(m *RuntimeLuaModule) {
	mc.Names = append(mc.Names, m.Name)
	mc.Modules[m.Name] = m

	// Ensure modules will be listed in ascending order of names.
	sort.Strings(mc.Names)
}

type RuntimeProviderLua struct {
	logger               *zap.Logger
	db                   *sql.DB
	protojsonMarshaler   *protojson.MarshalOptions
	protojsonUnmarshaler *protojson.UnmarshalOptions
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	storageIndex         StorageIndex
	sessionRegistry      SessionRegistry
	matchRegistry        MatchRegistry
	tracker              Tracker
	metrics              Metrics
	router               MessageRouter
	stdLibs              map[string]lua.LGFunction

	once         *sync.Once
	poolCh       chan *RuntimeLua
	maxCount     uint32
	currentCount *atomic.Uint32
	newFn        func() *RuntimeLua

	statsCtx context.Context
}

func NewRuntimeProviderLua(ctx context.Context, logger, startupLogger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, eventFn RuntimeEventCustomFunction, rootPath string, paths []string, matchProvider *MatchProvider, storageIndex StorageIndex) ([]string, map[string]RuntimeRpcFunction, map[string]RuntimeBeforeRtFunction, map[string]RuntimeAfterRtFunction, *RuntimeBeforeReqFunctions, *RuntimeAfterReqFunctions, RuntimeMatchmakerMatchedFunction, RuntimeTournamentEndFunction, RuntimeTournamentResetFunction, RuntimeLeaderboardResetFunction, RuntimeShutdownFunction, RuntimePurchaseNotificationAppleFunction, RuntimeSubscriptionNotificationAppleFunction, RuntimePurchaseNotificationGoogleFunction, RuntimeSubscriptionNotificationGoogleFunction, map[string]RuntimeStorageIndexFilterFunction, error) {
	startupLogger.Info("Initialising Lua runtime provider", zap.String("path", rootPath))

	// Load Lua modules into memory by reading the file contents. No evaluation/execution at this stage.
	moduleCache, modulePaths, stdLibs, err := openLuaModules(startupLogger, rootPath, paths)
	if err != nil {
		// Errors already logged in the function call above.
		return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
	}

	once := &sync.Once{}
	localCache := NewRuntimeLuaLocalCache(ctx)
	rpcFunctions := make(map[string]RuntimeRpcFunction, 0)
	beforeRtFunctions := make(map[string]RuntimeBeforeRtFunction, 0)
	afterRtFunctions := make(map[string]RuntimeAfterRtFunction, 0)
	beforeReqFunctions := &RuntimeBeforeReqFunctions{}
	afterReqFunctions := &RuntimeAfterReqFunctions{}
	var matchmakerMatchedFunction RuntimeMatchmakerMatchedFunction
	var tournamentEndFunction RuntimeTournamentEndFunction
	var tournamentResetFunction RuntimeTournamentResetFunction
	var leaderboardResetFunction RuntimeLeaderboardResetFunction
	var shutdownFunction RuntimeShutdownFunction
	var purchaseNotificationAppleFunction RuntimePurchaseNotificationAppleFunction
	var subscriptionNotificationAppleFunction RuntimeSubscriptionNotificationAppleFunction
	var purchaseNotificationGoogleFunction RuntimePurchaseNotificationGoogleFunction
	var subscriptionNotificationGoogleFunction RuntimeSubscriptionNotificationGoogleFunction
	storageIndexFilterFunctions := make(map[string]RuntimeStorageIndexFilterFunction, 0)

	var sharedReg *lua.LTable
	var sharedGlobals *lua.LTable

	runtimeProviderLua := &RuntimeProviderLua{
		logger:               logger,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		storageIndex:         storageIndex,
		sessionRegistry:      sessionRegistry,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		metrics:              metrics,
		router:               router,
		stdLibs:              stdLibs,

		once:     once,
		poolCh:   make(chan *RuntimeLua, config.GetRuntime().GetLuaMaxCount()),
		maxCount: uint32(config.GetRuntime().GetLuaMaxCount()),
		// Set the current count assuming we'll warm up the pool in a moment.
		currentCount: atomic.NewUint32(uint32(config.GetRuntime().GetLuaMinCount())),

		statsCtx: context.Background(),
	}

	matchProvider.RegisterCreateFn("lua",
		func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
			return NewRuntimeLuaMatchCore(logger, name, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, stdLibs, once, localCache, eventFn, nil, nil, id, node, stopped, name, matchProvider, storageIndex)
		},
	)

	r, err := newRuntimeLuaVM(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, stdLibs, moduleCache, once, localCache, storageIndex, matchProvider.CreateMatch, eventFn, func(execMode RuntimeExecutionMode, id string) {
		switch execMode {
		case RuntimeExecutionModeRPC:
			rpcFunctions[id] = func(ctx context.Context, headers, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang, payload string) (string, error, codes.Code) {
				return runtimeProviderLua.Rpc(ctx, id, headers, queryParams, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, payload)
			}
		case RuntimeExecutionModeBefore:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				beforeRtFunctions[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
					return runtimeProviderLua.BeforeRt(ctx, id, logger, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, envelope)
				}
			} else if strings.HasPrefix(id, strings.ToLower(API_PREFIX)) {
				shortID := strings.TrimPrefix(id, strings.ToLower(API_PREFIX))
				switch shortID {
				case "getaccount":
					beforeReqFunctions.beforeGetAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code) {
						_, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil)
						if err != nil {
							return err, code
						}
						return nil, 0
					}
				case "getmatchmakerstats":
					beforeReqFunctions.beforeGetMatchmakerStatsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code) {
						_, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil)
						if err != nil {
							return err, code
						}
						return nil, 0
					}
				case "updateaccount":
					beforeReqFunctions.beforeUpdateAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.UpdateAccountRequest), nil, 0
					}
				case "deleteaccount":
					beforeReqFunctions.beforeDeleteAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code) {
						_, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil)
						if err != nil {
							return err, code
						}
						return nil, 0
					}
				case "sessionrefresh":
					beforeReqFunctions.beforeSessionRefreshFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionRefreshRequest) (*api.SessionRefreshRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.SessionRefreshRequest), nil, 0
					}
				case "sessionlogout":
					beforeReqFunctions.beforeSessionLogoutFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionLogoutRequest) (*api.SessionLogoutRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.SessionLogoutRequest), nil, 0
					}
				case "authenticateapple":
					beforeReqFunctions.beforeAuthenticateAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateAppleRequest) (*api.AuthenticateAppleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateAppleRequest), nil, 0
					}
				case "authenticatecustom":
					beforeReqFunctions.beforeAuthenticateCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateCustomRequest), nil, 0
					}
				case "authenticatedevice":
					beforeReqFunctions.beforeAuthenticateDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateDeviceRequest), nil, 0
					}
				case "authenticateemail":
					beforeReqFunctions.beforeAuthenticateEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateEmailRequest), nil, 0
					}
				case "authenticatefacebook":
					beforeReqFunctions.beforeAuthenticateFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateFacebookRequest), nil, 0
					}
				case "authenticatefacebookinstantgame":
					beforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookInstantGameRequest) (*api.AuthenticateFacebookInstantGameRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateFacebookInstantGameRequest), nil, 0
					}
				case "authenticategamecenter":
					beforeReqFunctions.beforeAuthenticateGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateGameCenterRequest), nil, 0
					}
				case "authenticategoogle":
					beforeReqFunctions.beforeAuthenticateGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateGoogleRequest), nil, 0
					}
				case "authenticatesteam":
					beforeReqFunctions.beforeAuthenticateSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateSteamRequest), nil, 0
					}
				case "listchannelmessages":
					beforeReqFunctions.beforeListChannelMessagesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListChannelMessagesRequest), nil, 0
					}
				case "listfriends":
					beforeReqFunctions.beforeListFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListFriendsRequest) (*api.ListFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListFriendsRequest), nil, 0
					}
				case "listfriendsoffriends":
					beforeReqFunctions.beforeListFriendsOfFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListFriendsOfFriendsRequest) (*api.ListFriendsOfFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListFriendsOfFriendsRequest), nil, 0
					}
				case "addfriends":
					beforeReqFunctions.beforeAddFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AddFriendsRequest), nil, 0
					}
				case "deletefriends":
					beforeReqFunctions.beforeDeleteFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteFriendsRequest), nil, 0
					}
				case "blockfriends":
					beforeReqFunctions.beforeBlockFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.BlockFriendsRequest), nil, 0
					}
				case "importfacebookfriends":
					beforeReqFunctions.beforeImportFacebookFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ImportFacebookFriendsRequest), nil, 0
					}
				case "creategroup":
					beforeReqFunctions.beforeCreateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.CreateGroupRequest), nil, 0
					}
				case "updategroup":
					beforeReqFunctions.beforeUpdateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.UpdateGroupRequest), nil, 0
					}
				case "deletegroup":
					beforeReqFunctions.beforeDeleteGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteGroupRequest), nil, 0
					}
				case "joingroup":
					beforeReqFunctions.beforeJoinGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.JoinGroupRequest), nil, 0
					}
				case "leavegroup":
					beforeReqFunctions.beforeLeaveGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LeaveGroupRequest), nil, 0
					}
				case "addgroupusers":
					beforeReqFunctions.beforeAddGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AddGroupUsersRequest), nil, 0
					}
				case "bangroupusers":
					beforeReqFunctions.beforeBanGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) (*api.BanGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.BanGroupUsersRequest), nil, 0
					}
				case "kickgroupusers":
					beforeReqFunctions.beforeKickGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.KickGroupUsersRequest), nil, 0
					}
				case "promotegroupusers":
					beforeReqFunctions.beforePromoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.PromoteGroupUsersRequest), nil, 0
					}
				case "demotegroupusers":
					beforeReqFunctions.beforeDemoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DemoteGroupUsersRequest) (*api.DemoteGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DemoteGroupUsersRequest), nil, 0
					}
				case "listgroupusers":
					beforeReqFunctions.beforeListGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListGroupUsersRequest), nil, 0
					}
				case "listusergroups":
					beforeReqFunctions.beforeListUserGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListUserGroupsRequest), nil, 0
					}
				case "listgroups":
					beforeReqFunctions.beforeListGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListGroupsRequest), nil, 0
					}
				case "deleteleaderboardrecord":
					beforeReqFunctions.beforeDeleteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteLeaderboardRecordRequest), nil, 0
					}
				case "listleaderboardrecords":
					beforeReqFunctions.beforeListLeaderboardRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListLeaderboardRecordsRequest), nil, 0
					}
				case "writeleaderboardrecord":
					beforeReqFunctions.beforeWriteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteLeaderboardRecordRequest), nil, 0
					}
				case "listleaderboardrecordsaroundowner":
					beforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListLeaderboardRecordsAroundOwnerRequest), nil, 0
					}
				case "linkapple":
					beforeReqFunctions.beforeLinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) (*api.AccountApple, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountApple), nil, 0
					}
				case "linkcustom":
					beforeReqFunctions.beforeLinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountCustom), nil, 0
					}
				case "linkdevice":
					beforeReqFunctions.beforeLinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountDevice), nil, 0
					}
				case "linkemail":
					beforeReqFunctions.beforeLinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountEmail), nil, 0
					}
				case "linkfacebook":
					beforeReqFunctions.beforeLinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LinkFacebookRequest), nil, 0
					}
				case "linkfacebookinstantgame":
					beforeReqFunctions.beforeLinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebookInstantGame), nil, 0
					}
				case "linkgamecenter":
					beforeReqFunctions.beforeLinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGameCenter), nil, 0
					}
				case "linkgoogle":
					beforeReqFunctions.beforeLinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGoogle), nil, 0
					}
				case "linksteam":
					beforeReqFunctions.beforeLinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkSteamRequest) (*api.LinkSteamRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LinkSteamRequest), nil, 0
					}
				case "listmatches":
					beforeReqFunctions.beforeListMatchesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListMatchesRequest), nil, 0
					}
				case "listnotifications":
					beforeReqFunctions.beforeListNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListNotificationsRequest), nil, 0
					}
				case "deletenotifications":
					beforeReqFunctions.beforeDeleteNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteNotificationsRequest), nil, 0
					}
				case "liststorageobjects":
					beforeReqFunctions.beforeListStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListStorageObjectsRequest), nil, 0
					}
				case "readstorageobjects":
					beforeReqFunctions.beforeReadStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ReadStorageObjectsRequest), nil, 0
					}
				case "writestorageobjects":
					beforeReqFunctions.beforeWriteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteStorageObjectsRequest), nil, 0
					}
				case "deletestorageobjects":
					beforeReqFunctions.beforeDeleteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteStorageObjectsRequest), nil, 0
					}
				case "jointournament":
					beforeReqFunctions.beforeJoinTournamentFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.JoinTournamentRequest), nil, 0
					}
				case "listtournamentrecords":
					beforeReqFunctions.beforeListTournamentRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentRecordsRequest), nil, 0
					}
				case "listtournaments":
					beforeReqFunctions.beforeListTournamentsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentsRequest), nil, 0
					}
				case "writetournamentrecord":
					beforeReqFunctions.beforeWriteTournamentRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteTournamentRecordRequest), nil, 0
					}
				case "listtournamentrecordsaroundowner":
					beforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentRecordsAroundOwnerRequest), nil, 0
					}
				case "unlinkapple":
					beforeReqFunctions.beforeUnlinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) (*api.AccountApple, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountApple), nil, 0
					}
				case "unlinkcustom":
					beforeReqFunctions.beforeUnlinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountCustom), nil, 0
					}
				case "unlinkdevice":
					beforeReqFunctions.beforeUnlinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountDevice), nil, 0
					}
				case "unlinkemail":
					beforeReqFunctions.beforeUnlinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountEmail), nil, 0
					}
				case "unlinkfacebook":
					beforeReqFunctions.beforeUnlinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) (*api.AccountFacebook, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebook), nil, 0
					}
				case "unlinkfacebookinstantgame":
					beforeReqFunctions.beforeUnlinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebookInstantGame), nil, 0
					}
				case "unlinkgamecenter":
					beforeReqFunctions.beforeUnlinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGameCenter), nil, 0
					}
				case "unlinkgoogle":
					beforeReqFunctions.beforeUnlinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGoogle), nil, 0
					}
				case "unlinksteam":
					beforeReqFunctions.beforeUnlinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountSteam), nil, 0
					}
				case "getusers":
					beforeReqFunctions.beforeGetUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetUsersRequest) (*api.GetUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.GetUsersRequest), nil, 0
					}
				case "validatepurchaseapple":
					beforeReqFunctions.beforeValidatePurchaseAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseAppleRequest) (*api.ValidatePurchaseAppleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseAppleRequest), nil, 0
					}
				case "validatepurchasegoogle":
					beforeReqFunctions.beforeValidatePurchaseGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseGoogleRequest), nil, 0
					}
				case "validatepurchasehuawei":
					beforeReqFunctions.beforeValidatePurchaseHuaweiFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseHuaweiRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseHuaweiRequest), nil, 0
					}
				case "validatepurchasefacebookinstant":
					beforeReqFunctions.beforeValidatePurchaseFacebookInstantFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseFacebookInstantRequest) (*api.ValidatePurchaseFacebookInstantRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseFacebookInstantRequest), nil, 0
					}
				case "validatesubscriptionapple":
					beforeReqFunctions.beforeValidateSubscriptionAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidateSubscriptionAppleRequest) (*api.ValidateSubscriptionAppleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidateSubscriptionAppleRequest), nil, 0
					}
				case "validatesubscriptiongoogle":
					beforeReqFunctions.beforeValidateSubscriptionGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidateSubscriptionGoogleRequest) (*api.ValidateSubscriptionGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidateSubscriptionGoogleRequest), nil, 0
					}
				case "getsubscription":
					beforeReqFunctions.beforeGetSubscriptionFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetSubscriptionRequest) (*api.GetSubscriptionRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.GetSubscriptionRequest), nil, 0
					}
				case "listsubscriptions":
					beforeReqFunctions.beforeListSubscriptionsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListSubscriptionsRequest) (*api.ListSubscriptionsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListSubscriptionsRequest), nil, 0
					}
				case "event":
					beforeReqFunctions.beforeEventFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) (*api.Event, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.Event), nil, 0
					}
				}
			}
		case RuntimeExecutionModeAfter:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				afterRtFunctions[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, out, in *rtapi.Envelope) error {
					return runtimeProviderLua.AfterRt(ctx, id, logger, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, out, in)
				}
			} else if strings.HasPrefix(id, strings.ToLower(API_PREFIX)) {
				shortID := strings.TrimPrefix(id, strings.ToLower(API_PREFIX))
				switch shortID {
				case "getaccount":
					afterReqFunctions.afterGetAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Account) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, nil)
					}
				case "getmatchmakerstats":
					afterReqFunctions.afterGetMatchmakerStatsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchmakerStats) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, nil)
					}
				case "updateaccount":
					afterReqFunctions.afterUpdateAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "deleteaccount":
					afterReqFunctions.afterDeleteAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, nil)
					}
				case "sessionrefresh":
					afterReqFunctions.afterSessionRefreshFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.SessionRefreshRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "sessionlogout":
					afterReqFunctions.afterSessionLogoutFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionLogoutRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "authenticateapple":
					afterReqFunctions.afterAuthenticateAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateAppleRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatecustom":
					afterReqFunctions.afterAuthenticateCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateCustomRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatedevice":
					afterReqFunctions.afterAuthenticateDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateDeviceRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticateemail":
					afterReqFunctions.afterAuthenticateEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateEmailRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatefacebook":
					afterReqFunctions.afterAuthenticateFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatefacebookinstantgame":
					afterReqFunctions.afterAuthenticateFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookInstantGameRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticategamecenter":
					afterReqFunctions.afterAuthenticateGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGameCenterRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticategoogle":
					afterReqFunctions.afterAuthenticateGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGoogleRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatesteam":
					afterReqFunctions.afterAuthenticateSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateSteamRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listchannelmessages":
					afterReqFunctions.afterListChannelMessagesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ChannelMessageList, in *api.ListChannelMessagesRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listfriends":
					afterReqFunctions.afterListFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.FriendList) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, nil)
					}
				case "listfriendsoffriends":
					afterReqFunctions.afterListFriendsOfFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.FriendsOfFriendsList) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, nil)
					}
				case "addfriends":
					afterReqFunctions.afterAddFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "deletefriends":
					afterReqFunctions.afterDeleteFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "blockfriends":
					afterReqFunctions.afterBlockFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "importfacebookfriends":
					afterReqFunctions.afterImportFacebookFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "creategroup":
					afterReqFunctions.afterCreateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Group, in *api.CreateGroupRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "updategroup":
					afterReqFunctions.afterUpdateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "deletegroup":
					afterReqFunctions.afterDeleteGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "joingroup":
					afterReqFunctions.afterJoinGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "leavegroup":
					afterReqFunctions.afterLeaveGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "addgroupusers":
					afterReqFunctions.afterAddGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "bangroupusers":
					afterReqFunctions.afterBanGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "kickgroupusers":
					afterReqFunctions.afterKickGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "promotegroupusers":
					afterReqFunctions.afterPromoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "demotegroupusers":
					afterReqFunctions.afterDemoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DemoteGroupUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listgroupusers":
					afterReqFunctions.afterListGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupUserList, in *api.ListGroupUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listusergroups":
					afterReqFunctions.afterListUserGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.UserGroupList, in *api.ListUserGroupsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listgroups":
					afterReqFunctions.afterListGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupList, in *api.ListGroupsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "deleteleaderboardrecord":
					afterReqFunctions.afterDeleteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listleaderboardrecords":
					afterReqFunctions.afterListLeaderboardRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "writeleaderboardrecord":
					afterReqFunctions.afterWriteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listleaderboardrecordsaroundowner":
					afterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "linkapple":
					afterReqFunctions.afterLinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkcustom":
					afterReqFunctions.afterLinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkdevice":
					afterReqFunctions.afterLinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkemail":
					afterReqFunctions.afterLinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkfacebook":
					afterReqFunctions.afterLinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkfacebookinstantgame":
					afterReqFunctions.afterLinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkgamecenter":
					afterReqFunctions.afterLinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkgoogle":
					afterReqFunctions.afterLinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linksteam":
					afterReqFunctions.afterLinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkSteamRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listmatches":
					afterReqFunctions.afterListMatchesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchList, in *api.ListMatchesRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listnotifications":
					afterReqFunctions.afterListNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.NotificationList, in *api.ListNotificationsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "deletenotifications":
					afterReqFunctions.afterDeleteNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "liststorageobjects":
					afterReqFunctions.afterListStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectList, in *api.ListStorageObjectsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "readstorageobjects":
					afterReqFunctions.afterReadStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjects, in *api.ReadStorageObjectsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "writestorageobjects":
					afterReqFunctions.afterWriteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectAcks, in *api.WriteStorageObjectsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "deletestorageobjects":
					afterReqFunctions.afterDeleteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "jointournament":
					afterReqFunctions.afterJoinTournamentFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listtournamentrecords":
					afterReqFunctions.afterListTournamentRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listtournaments":
					afterReqFunctions.afterListTournamentsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentList, in *api.ListTournamentsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "writetournamentrecord":
					afterReqFunctions.afterWriteTournamentRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteTournamentRecordRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listtournamentrecordsaroundowner":
					afterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsAroundOwnerRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "unlinkapple":
					afterReqFunctions.afterUnlinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkcustom":
					afterReqFunctions.afterUnlinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkdevice":
					afterReqFunctions.afterUnlinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkemail":
					afterReqFunctions.afterUnlinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkfacebook":
					afterReqFunctions.afterUnlinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkfacebookinstantgame":
					afterReqFunctions.afterUnlinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkgamecenter":
					afterReqFunctions.afterUnlinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkgoogle":
					afterReqFunctions.afterUnlinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinksteam":
					afterReqFunctions.afterUnlinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "getusers":
					afterReqFunctions.afterGetUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Users, in *api.GetUsersRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchaseapple":
					afterReqFunctions.afterValidatePurchaseAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseAppleRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchasegoogle":
					afterReqFunctions.afterValidatePurchaseGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseGoogleRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchasehuawei":
					afterReqFunctions.afterValidatePurchaseHuaweiFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseHuaweiRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchasefacebookinstant":
					afterReqFunctions.afterValidatePurchaseFacebookInstantFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseFacebookInstantRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatesubscriptionapple":
					afterReqFunctions.afterValidateSubscriptionAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionAppleRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatesubscriptiongoogle":
					afterReqFunctions.afterValidateSubscriptionAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionAppleRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "getsubscription":
					afterReqFunctions.afterGetSubscriptionFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatedSubscription, in *api.GetSubscriptionRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listsubscriptions":
					afterReqFunctions.afterListSubscriptionsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.SubscriptionList, in *api.ListSubscriptionsRequest) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "event":
					afterReqFunctions.afterEventFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) error {
						return runtimeProviderLua.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				}
			}
		case RuntimeExecutionModeMatchmaker:
			matchmakerMatchedFunction = func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error) {
				return runtimeProviderLua.MatchmakerMatched(ctx, entries)
			}
		case RuntimeExecutionModeTournamentEnd:
			tournamentEndFunction = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
				return runtimeProviderLua.TournamentEnd(ctx, tournament, end, reset)
			}
		case RuntimeExecutionModeTournamentReset:
			tournamentResetFunction = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
				return runtimeProviderLua.TournamentReset(ctx, tournament, end, reset)
			}
		case RuntimeExecutionModeLeaderboardReset:
			leaderboardResetFunction = func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
				return runtimeProviderLua.LeaderboardReset(ctx, leaderboard, reset)
			}
		case RuntimeExecutionModeShutdown:
			shutdownFunction = func(ctx context.Context) {
				runtimeProviderLua.Shutdown(ctx)
			}
		case RuntimeExecutionModePurchaseNotificationApple:
			purchaseNotificationAppleFunction = func(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
				return runtimeProviderLua.PurchaseNotificationApple(ctx, purchase, providerPayload)
			}
		case RuntimeExecutionModeSubscriptionNotificationApple:
			subscriptionNotificationAppleFunction = func(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
				return runtimeProviderLua.SubscriptionNotificationApple(ctx, subscription, providerPayload)
			}
		case RuntimeExecutionModePurchaseNotificationGoogle:
			purchaseNotificationGoogleFunction = func(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
				return runtimeProviderLua.PurchaseNotificationGoogle(ctx, purchase, providerPayload)
			}
		case RuntimeExecutionModeSubscriptionNotificationGoogle:
			subscriptionNotificationGoogleFunction = func(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
				return runtimeProviderLua.SubscriptionNotificationGoogle(ctx, subscription, providerPayload)
			}
		case RuntimeExecutionModeStorageIndexFilter:
			storageIndexFilterFunctions[id] = func(ctx context.Context, write *StorageOpWrite) (bool, error) {
				return runtimeProviderLua.StorageIndexFilter(ctx, id, write)
			}
		}
	})
	if err != nil {
		return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
	}

	if config.GetRuntime().GetLuaReadOnlyGlobals() {
		// Capture shared globals from reference state.
		sharedGlobals = r.vm.NewTable()
		sharedGlobals.RawSetString("__index", r.vm.Get(lua.GlobalsIndex))
		sharedGlobals.SetReadOnlyRecursive()
		sharedReg = r.vm.NewTable()
		sharedReg.RawSetString("__index", r.vm.Get(lua.RegistryIndex))
		sharedReg.SetReadOnlyRecursive()
		callbacksGlobals := r.callbacks

		r.Stop()

		runtimeProviderLua.newFn = func() *RuntimeLua {
			vm := lua.NewState(lua.Options{
				CallStackSize:       config.GetRuntime().GetLuaCallStackSize(),
				RegistrySize:        config.GetRuntime().GetLuaRegistrySize(),
				SkipOpenLibs:        true,
				IncludeGoStackTrace: true,
			})
			vm.SetContext(context.Background())

			vm.Get(lua.GlobalsIndex).(*lua.LTable).Metatable = sharedGlobals

			stateRegistry := vm.Get(lua.RegistryIndex).(*lua.LTable)
			stateRegistry.Metatable = sharedReg

			loadedTable := vm.NewTable()
			loadedTable.Metatable = vm.GetField(stateRegistry, "_LOADED")
			vm.SetField(stateRegistry, "_LOADED", loadedTable)

			// Metatable for literal string object.
			vm.Push(vm.NewFunction(lua.OpenString))
			vm.Push(lua.LString(lua.StringLibName))
			vm.Call(1, 0)

			r := &RuntimeLua{
				logger:    logger,
				node:      config.GetName(),
				version:   version,
				vm:        vm,
				luaEnv:    RuntimeLuaConvertMapString(vm, config.GetRuntime().Environment),
				callbacks: callbacksGlobals,
			}
			return r
		}
	} else {
		r.Stop()

		runtimeProviderLua.newFn = func() *RuntimeLua {
			r, err := newRuntimeLuaVM(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, stdLibs, moduleCache, once, localCache, storageIndex, matchProvider.CreateMatch, eventFn, nil)
			if err != nil {
				logger.Fatal("Failed to initialize Lua runtime", zap.Error(err))
			}
			return r
		}
	}

	startupLogger.Info("Lua runtime modules loaded")

	// Warm up the pool.
	startupLogger.Info("Allocating minimum Lua runtime pool", zap.Int("count", config.GetRuntime().GetLuaMinCount()))
	if len(moduleCache.Names) > 0 {
		// Only if there are runtime modules to load.
		for i := 0; i < config.GetRuntime().GetLuaMinCount(); i++ {
			runtimeProviderLua.poolCh <- runtimeProviderLua.newFn()
		}
		runtimeProviderLua.metrics.GaugeLuaRuntimes(float64(config.GetRuntime().GetLuaMinCount()))
	}
	startupLogger.Info("Allocated minimum Lua runtime pool")

	return modulePaths, rpcFunctions, beforeRtFunctions, afterRtFunctions, beforeReqFunctions, afterReqFunctions, matchmakerMatchedFunction, tournamentEndFunction, tournamentResetFunction, leaderboardResetFunction, shutdownFunction, purchaseNotificationAppleFunction, subscriptionNotificationAppleFunction, purchaseNotificationGoogleFunction, subscriptionNotificationGoogleFunction, storageIndexFilterFunctions, nil
}

func CheckRuntimeProviderLua(logger *zap.Logger, config Config, version string, paths []string) error {
	// Load Lua modules into memory by reading the file contents. No evaluation/execution at this stage.
	moduleCache, _, stdLibs, err := openLuaModules(logger, config.GetRuntime().Path, paths)
	if err != nil {
		// Errors already logged in the function call above.
		return err
	}

	// Evaluate (but do not execute) available Lua modules.
	err = checkRuntimeLuaVM(logger, config, version, stdLibs, moduleCache)
	if err != nil {
		// Errors already logged in the function call above.
		return err
	}

	return nil
}

func openLuaModules(logger *zap.Logger, rootPath string, paths []string) (*RuntimeLuaModuleCache, []string, map[string]lua.LGFunction, error) {
	moduleCache := &RuntimeLuaModuleCache{
		Names:   make([]string, 0),
		Modules: make(map[string]*RuntimeLuaModule, 0),
	}
	modulePaths := make([]string, 0)

	// Override before Package library is invoked.
	lua.LuaLDir = rootPath
	lua.LuaPathDefault = lua.LuaLDir + string(os.PathSeparator) + "?.lua;" + lua.LuaLDir + string(os.PathSeparator) + "?" + string(os.PathSeparator) + "init.lua"
	if err := os.Setenv(lua.LuaPath, lua.LuaPathDefault); err != nil {
		logger.Error("Could not set Lua module path", zap.Error(err))
		return nil, nil, nil, err
	}

	for _, path := range paths {
		if strings.ToLower(filepath.Ext(path)) != ".lua" {
			continue
		}

		// Load the file contents into memory.
		var content []byte
		var err error
		if content, err = os.ReadFile(path); err != nil {
			logger.Error("Could not read Lua module", zap.String("path", path), zap.Error(err))
			return nil, nil, nil, err
		}

		relPath, _ := filepath.Rel(rootPath, path)
		name := strings.TrimSuffix(relPath, filepath.Ext(relPath))
		// Make paths Lua friendly.
		name = strings.Replace(name, string(os.PathSeparator), ".", -1)

		moduleCache.Add(&RuntimeLuaModule{
			Name:    name,
			Path:    path,
			Content: content,
		})
		modulePaths = append(modulePaths, relPath)
	}

	stdLibs := map[string]lua.LGFunction{
		lua.LoadLibName:   OpenPackage(moduleCache),
		lua.BaseLibName:   lua.OpenBase,
		lua.TabLibName:    lua.OpenTable,
		lua.OsLibName:     OpenOs,
		lua.StringLibName: lua.OpenString,
		lua.MathLibName:   lua.OpenMath,
		Bit32LibName:      OpenBit32,
	}

	return moduleCache, modulePaths, stdLibs, nil
}

func (rp *RuntimeProviderLua) Rpc(ctx context.Context, id string, headers, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang, payload string) (string, error, codes.Code) {
	r, err := rp.Get(ctx)
	if err != nil {
		return "", err, codes.Internal
	}
	lf := r.GetCallback(RuntimeExecutionModeRPC, id)
	if lf == nil {
		rp.Put(r)
		return "", ErrRuntimeRPCNotFound, codes.NotFound
	}

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"rpc_id": id})
	r.vm.SetContext(vmCtx)
	result, fnErr, code, isCustomErr := r.InvokeFunction(RuntimeExecutionModeRPC, lf, headers, queryParams, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, payload)
	r.vm.SetContext(context.Background())

	if fnErr != nil {
		if !isCustomErr {
			// Errors triggered with `error({msg, code})` could only have come directly from custom runtime code.
			// Assume they've been fully handled (logged etc) before that error is invoked.
			rp.logger.Error("Runtime RPC function caused an error", zap.String("id", id), zap.Error(fnErr))
		}

		if code <= 0 || code >= 17 {
			// If error is present but code is invalid then default to 13 (Internal) as the error code.
			code = 13
		}

		err = clearFnError(fnErr, rp, lf)
		rp.Put(r) // don't return VM until error originated in that VM is processed
		return "", err, code
	}
	rp.Put(r)

	if result == nil {
		return "", nil, 0
	}

	payload, ok := result.(string)
	if !ok {
		rp.logger.Warn("Lua runtime function returned invalid data", zap.Any("result", result))
		return "", errors.New("Runtime function returned invalid data - only allowed one return value of type String/Byte."), codes.Internal
	}
	return payload, nil, 0
}

func (rp *RuntimeProviderLua) BeforeRt(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
	r, err := rp.Get(ctx)
	if err != nil {
		return nil, err
	}
	lf := r.GetCallback(RuntimeExecutionModeBefore, id)
	if lf == nil {
		rp.Put(r)
		return nil, errors.New("Runtime Before function not found.")
	}

	envelopeJSON, err := rp.protojsonMarshaler.Marshal(envelope)
	if err != nil {
		rp.Put(r)
		logger.Error("Could not marshall envelope to JSON", zap.Any("envelope", envelope), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}
	var envelopeMap map[string]interface{}
	if err := json.Unmarshal([]byte(envelopeJSON), &envelopeMap); err != nil {
		rp.Put(r)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("envelope_json", envelopeJSON), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"api_id": strings.TrimPrefix(id, RTAPI_PREFIX_LOWERCASE), "mode": RuntimeExecutionModeBefore.String()})
	r.vm.SetContext(vmCtx)
	result, fnErr, _, isCustomErr := r.InvokeFunction(RuntimeExecutionModeBefore, lf, nil, nil, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, envelopeMap)
	r.vm.SetContext(context.Background())

	if fnErr != nil {
		if !isCustomErr {
			// Errors triggered with `error({msg, code})` could only have come directly from custom runtime code.
			// Assume they've been fully handled (logged etc) before that error is invoked.
			logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		}

		err = clearFnError(fnErr, rp, lf)
		rp.Put(r) // don't return VM until error originated in that VM is processed
		return nil, err
	}
	rp.Put(r)

	if result == nil {
		return nil, nil
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshal result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function.")
	}

	if err = rp.protojsonUnmarshaler.Unmarshal(resultJSON, envelope); err != nil {
		logger.Error("Could not unmarshal result to envelope", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function.")
	}

	return envelope, nil
}

func (rp *RuntimeProviderLua) AfterRt(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, out, in *rtapi.Envelope) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeAfter, id)
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime After function not found.")
	}

	var outMap map[string]interface{}
	if out != nil {
		outJSON, err := rp.protojsonMarshaler.Marshal(out)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall envelope to JSON", zap.Any("out", out), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
		if err := json.Unmarshal([]byte(outJSON), &outMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall envelope to interface{}", zap.Any("out_json", outJSON), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
	}

	inJSON, err := rp.protojsonMarshaler.Marshal(in)
	if err != nil {
		rp.Put(r)
		logger.Error("Could not marshall envelope to JSON", zap.Any("in", in), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	var inMap map[string]interface{}
	if err := json.Unmarshal([]byte(inJSON), &inMap); err != nil {
		rp.Put(r)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("in_json", inJSON), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"api_id": strings.TrimPrefix(id, RTAPI_PREFIX_LOWERCASE), "mode": RuntimeExecutionModeAfter.String()})
	r.vm.SetContext(vmCtx)
	_, fnErr, _, isCustomErr := r.InvokeFunction(RuntimeExecutionModeAfter, lf, nil, nil, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, outMap, inMap)
	r.vm.SetContext(context.Background())

	if fnErr != nil {
		if !isCustomErr {
			// Errors triggered with `error({msg, code})` could only have come directly from custom runtime code.
			// Assume they've been fully handled (logged etc) before that error is invoked.
			logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		}

		err = clearFnError(fnErr, rp, lf)
		rp.Put(r) // don't return VM until error originated in that VM is processed
		return err
	}
	rp.Put(r)

	return nil
}

func (rp *RuntimeProviderLua) BeforeReq(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, req interface{}) (interface{}, error, codes.Code) {
	r, err := rp.Get(ctx)
	if err != nil {
		return nil, err, codes.Internal
	}
	lf := r.GetCallback(RuntimeExecutionModeBefore, id)
	if lf == nil {
		rp.Put(r)
		return nil, errors.New("Runtime Before function not found."), codes.NotFound
	}

	var reqMap map[string]interface{}
	var reqProto proto.Message
	if req != nil {
		// Req may be nil for requests that carry no input body.
		var ok bool
		reqProto, ok = req.(proto.Message)
		if !ok {
			rp.Put(r)
			logger.Error("Could not cast request to message", zap.Any("request", req))
			return nil, errors.New("Could not run runtime Before function."), codes.Internal
		}
		reqJSON, err := rp.protojsonMarshaler.Marshal(reqProto)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall request to JSON", zap.Any("request", reqProto), zap.Error(err))
			return nil, errors.New("Could not run runtime Before function."), codes.Internal
		}
		if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
			return nil, errors.New("Could not run runtime Before function."), codes.Internal
		}
	}

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"api_id": strings.TrimPrefix(id, API_PREFIX_LOWERCASE), "mode": RuntimeExecutionModeBefore.String()})
	r.vm.SetContext(vmCtx)
	result, fnErr, code, isCustomErr := r.InvokeFunction(RuntimeExecutionModeBefore, lf, nil, nil, userID, username, vars, expiry, "", clientIP, clientPort, "", reqMap)
	r.vm.SetContext(context.Background())

	if fnErr != nil {
		if !isCustomErr {
			// Errors triggered with `error({msg, code})` could only have come directly from custom runtime code.
			// Assume they've been fully handled (logged etc) before that error is invoked.
			logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		}

		err = clearFnError(fnErr, rp, lf)
		rp.Put(r) // don't return VM until error originated in that VM is processed
		return nil, err, code
	}
	rp.Put(r)

	if result == nil || reqMap == nil {
		// There was no return value, or a return value was not expected (no input to override).
		return nil, nil, 0
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshall result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function."), codes.Internal
	}

	if err = rp.protojsonUnmarshaler.Unmarshal(resultJSON, reqProto); err != nil {
		logger.Error("Could not unmarshall result to request", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function."), codes.Internal
	}

	return req, nil, 0
}

func (rp *RuntimeProviderLua) AfterReq(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, res interface{}, req interface{}) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeAfter, id)
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime After function not found.")
	}

	var resMap map[string]interface{}
	if res != nil {
		// Res may be nil if there is no response body.
		resProto, ok := res.(proto.Message)
		if !ok {
			rp.Put(r)
			logger.Error("Could not cast response to message", zap.Any("response", res))
			return errors.New("Could not run runtime After function.")
		}
		resJSON, err := rp.protojsonMarshaler.Marshal(resProto)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall response to JSON", zap.Any("response", resProto), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}

		if err := json.Unmarshal([]byte(resJSON), &resMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall response to interface{}", zap.Any("response_json", resJSON), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
	}

	var reqMap map[string]interface{}
	if req != nil {
		// Req may be nil if there is no request body.
		reqProto, ok := req.(proto.Message)
		if !ok {
			rp.Put(r)
			logger.Error("Could not cast request to message", zap.Any("request", req))
			return errors.New("Could not run runtime After function.")
		}
		reqJSON, err := rp.protojsonMarshaler.Marshal(reqProto)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall request to JSON", zap.Any("request", reqProto), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}

		if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
	}

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"api_id": strings.TrimPrefix(id, API_PREFIX_LOWERCASE), "mode": RuntimeExecutionModeAfter.String()})
	r.vm.SetContext(vmCtx)
	_, fnErr, _, isCustomErr := r.InvokeFunction(RuntimeExecutionModeAfter, lf, nil, nil, userID, username, vars, expiry, "", clientIP, clientPort, "", resMap, reqMap)
	r.vm.SetContext(context.Background())

	if fnErr != nil {
		if !isCustomErr {
			// Errors triggered with `error({msg, code})` could only have come directly from custom runtime code.
			// Assume they've been fully handled (logged etc) before that error is invoked.
			logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		}

		err = clearFnError(fnErr, rp, lf)
		rp.Put(r) // don't return VM until error originated in that VM is processed
		return err
	}
	rp.Put(r)

	return nil
}

func (rp *RuntimeProviderLua) MatchmakerMatched(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error) {
	r, err := rp.Get(ctx)
	if err != nil {
		return "", false, err
	}
	lf := r.GetCallback(RuntimeExecutionModeMatchmaker, "")
	if lf == nil {
		rp.Put(r)
		return "", false, errors.New("Runtime Matchmaker Matched function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeMatchmaker, nil, nil, 0, "", "", nil, "", "", "", "")

	entriesTable := r.vm.CreateTable(len(entries), 0)
	for i, entry := range entries {
		presenceTable := r.vm.CreateTable(0, 4)
		presenceTable.RawSetString("user_id", lua.LString(entry.Presence.UserId))
		presenceTable.RawSetString("session_id", lua.LString(entry.Presence.SessionId))
		presenceTable.RawSetString("username", lua.LString(entry.Presence.Username))
		presenceTable.RawSetString("node", lua.LString(entry.Presence.Node))

		propertiesTable := r.vm.CreateTable(0, len(entry.StringProperties)+len(entry.NumericProperties))
		for k, v := range entry.StringProperties {
			propertiesTable.RawSetString(k, lua.LString(v))
		}
		for k, v := range entry.NumericProperties {
			propertiesTable.RawSetString(k, lua.LNumber(v))
		}

		entryTable := r.vm.CreateTable(0, 3)
		entryTable.RawSetString("presence", presenceTable)
		entryTable.RawSetString("properties", propertiesTable)

		if entry.PartyId != "" {
			entryTable.RawSetString("party_id", lua.LString(entry.PartyId))
		}

		entriesTable.RawSetInt(i+1, entryTable)
	}

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeMatchmaker.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, entriesTable)
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return "", false, fmt.Errorf("Error running runtime Matchmaker Matched hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value or hook decided not to return an authoritative match ID.
		return "", false, nil
	}

	if retValue.Type() == lua.LTString {
		// Hook (maybe) returned an authoritative match ID.
		matchIDString := retValue.String()

		// Validate the match ID.
		matchIDComponents := strings.SplitN(matchIDString, ".", 2)
		if len(matchIDComponents) != 2 {
			return "", false, errors.New("Invalid return value from runtime Matchmaker Matched hook, not a valid match ID.")
		}
		_, err = uuid.FromString(matchIDComponents[0])
		if err != nil {
			return "", false, errors.New("Invalid return value from runtime Matchmaker Matched hook, not a valid match ID.")
		}

		return matchIDString, true, nil
	}

	return "", false, errors.New("Unexpected return type from runtime Matchmaker Matched hook, must be string or nil.")
}

func (rp *RuntimeProviderLua) TournamentEnd(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeTournamentEnd, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Tournament End function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeTournamentEnd, nil, nil, 0, "", "", nil, "", "", "", "")

	tournamentTable := r.vm.CreateTable(0, 18)

	tournamentTable.RawSetString("id", lua.LString(tournament.Id))
	tournamentTable.RawSetString("title", lua.LString(tournament.Title))
	tournamentTable.RawSetString("description", lua.LString(tournament.Description))
	tournamentTable.RawSetString("category", lua.LNumber(tournament.Category))
	tournamentTable.RawSetString("sort_order", lua.LString(strconv.FormatUint(uint64(tournament.SortOrder), 10)))
	tournamentTable.RawSetString("size", lua.LNumber(tournament.Size))
	tournamentTable.RawSetString("max_size", lua.LNumber(tournament.MaxSize))
	tournamentTable.RawSetString("max_num_score", lua.LNumber(tournament.MaxNumScore))
	tournamentTable.RawSetString("duration", lua.LNumber(tournament.Duration))
	tournamentTable.RawSetString("start_active", lua.LNumber(tournament.StartActive))
	tournamentTable.RawSetString("end_active", lua.LNumber(tournament.EndActive))
	tournamentTable.RawSetString("can_enter", lua.LBool(tournament.CanEnter))
	if tournament.NextReset != 0 {
		tournamentTable.RawSetString("next_reset", lua.LNumber(tournament.NextReset))
	} else {
		tournamentTable.RawSetString("next_reset", lua.LNil)
	}
	if tournament.PrevReset != 0 {
		tournamentTable.RawSetString("prev_reset", lua.LNumber(tournament.PrevReset))
	} else {
		tournamentTable.RawSetString("prev_reset", lua.LNil)
	}

	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(r.vm, metadataMap)
	tournamentTable.RawSetString("metadata", metadataTable)
	tournamentTable.RawSetString("create_time", lua.LNumber(tournament.CreateTime.Seconds))
	tournamentTable.RawSetString("start_time", lua.LNumber(tournament.StartTime.Seconds))
	if tournament.EndTime == nil {
		tournamentTable.RawSetString("end_time", lua.LNil)
	} else {
		tournamentTable.RawSetString("end_time", lua.LNumber(tournament.EndTime.Seconds))
	}
	tournamentTable.RawSetString("operator", lua.LString(strings.ToLower(tournament.Operator.String())))

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeTournamentEnd.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, tournamentTable, lua.LNumber(end), lua.LNumber(reset))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament End hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament End hook, must be nil.")
}

func (rp *RuntimeProviderLua) TournamentReset(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeTournamentReset, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Tournament Reset function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeTournamentReset, nil, nil, 0, "", "", nil, "", "", "", "")

	tournamentTable := r.vm.CreateTable(0, 18)

	tournamentTable.RawSetString("id", lua.LString(tournament.Id))
	tournamentTable.RawSetString("title", lua.LString(tournament.Title))
	tournamentTable.RawSetString("description", lua.LString(tournament.Description))
	tournamentTable.RawSetString("category", lua.LNumber(tournament.Category))
	tournamentTable.RawSetString("sort_order", lua.LString(strconv.FormatUint(uint64(tournament.SortOrder), 10)))
	tournamentTable.RawSetString("size", lua.LNumber(tournament.Size))
	tournamentTable.RawSetString("max_size", lua.LNumber(tournament.MaxSize))
	tournamentTable.RawSetString("max_num_score", lua.LNumber(tournament.MaxNumScore))
	tournamentTable.RawSetString("duration", lua.LNumber(tournament.Duration))
	tournamentTable.RawSetString("end_active", lua.LNumber(tournament.EndActive))
	tournamentTable.RawSetString("can_enter", lua.LBool(tournament.CanEnter))
	if tournament.NextReset != 0 {
		tournamentTable.RawSetString("next_reset", lua.LNumber(tournament.NextReset))
	} else {
		tournamentTable.RawSetString("next_reset", lua.LNil)
	}
	if tournament.PrevReset != 0 {
		tournamentTable.RawSetString("prev_reset", lua.LNumber(tournament.PrevReset))
	} else {
		tournamentTable.RawSetString("prev_reset", lua.LNil)
	}
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(r.vm, metadataMap)
	tournamentTable.RawSetString("metadata", metadataTable)
	tournamentTable.RawSetString("create_time", lua.LNumber(tournament.CreateTime.Seconds))
	tournamentTable.RawSetString("start_time", lua.LNumber(tournament.StartTime.Seconds))
	if tournament.EndTime == nil {
		tournamentTable.RawSetString("end_time", lua.LNil)
	} else {
		tournamentTable.RawSetString("end_time", lua.LNumber(tournament.EndTime.Seconds))
	}
	tournamentTable.RawSetString("operator", lua.LString(strings.ToLower(tournament.Operator.String())))

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeTournamentReset.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, tournamentTable, lua.LNumber(end), lua.LNumber(reset))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament Reset hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament Reset hook, must be nil.")
}

func (rp *RuntimeProviderLua) LeaderboardReset(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeLeaderboardReset, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Leaderboard Reset function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeLeaderboardReset, nil, nil, 0, "", "", nil, "", "", "", "")

	leaderboardTable := r.vm.CreateTable(0, 8)

	leaderboardTable.RawSetString("id", lua.LString(leaderboard.Id))
	leaderboardTable.RawSetString("authoritative", lua.LBool(leaderboard.Authoritative))
	leaderboardTable.RawSetString("sort_order", lua.LString(strconv.FormatUint(uint64(leaderboard.SortOrder), 10)))
	leaderboardTable.RawSetString("operator", lua.LString(strings.ToLower(leaderboard.Operator.String())))
	if leaderboard.PrevReset != 0 {
		leaderboardTable.RawSetString("prev_reset", lua.LString(strconv.FormatUint(uint64(leaderboard.PrevReset), 10)))
	}
	if leaderboard.NextReset != 0 {
		leaderboardTable.RawSetString("next_reset", lua.LString(strconv.FormatUint(uint64(leaderboard.NextReset), 10)))
	}
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(leaderboard.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(r.vm, metadataMap)
	leaderboardTable.RawSetString("metadata", metadataTable)
	leaderboardTable.RawSetString("create_time", lua.LNumber(leaderboard.CreateTime.Seconds))

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeLeaderboardReset.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, leaderboardTable, lua.LNumber(reset))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Leaderboard Reset hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Leaderboard Reset hook, must be nil.")
}

func (rp *RuntimeProviderLua) Shutdown(ctx context.Context) {
	r, err := rp.Get(ctx)
	if err != nil {
		return
	}
	lf := r.GetCallback(RuntimeExecutionModeShutdown, "")
	if lf == nil {
		rp.Put(r)
		rp.logger.Error("Runtime Shutdown function not found.")
		return
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeShutdown, nil, nil, 0, "", "", nil, "", "", "", "")

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeShutdown.String()})
	r.vm.SetContext(vmCtx)
	_, err, _, _ = r.invokeFunction(r.vm, lf, luaCtx)
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		rp.logger.Error(fmt.Sprintf("Error running runtime Shutdown hook: %v", err.Error()))
		return
	}
}

func (rp *RuntimeProviderLua) PurchaseNotificationApple(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModePurchaseNotificationApple, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Purchase Notification Apple function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModePurchaseNotificationApple, nil, nil, 0, "", "", nil, "", "", "", "")

	purchaseTable := purchaseToLuaTable(r.vm, purchase)

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModePurchaseNotificationApple.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, purchaseTable, lua.LString(providerPayload))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return errors.New("Could not run Purchase Notification Apple hook.")
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Purchase Notification Apple hook, must be nil.")
}

func (rp *RuntimeProviderLua) SubscriptionNotificationApple(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeSubscriptionNotificationApple, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Subscription Notification Apple function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeSubscriptionNotificationApple, nil, nil, 0, "", "", nil, "", "", "", "")

	subscriptionTable := subscriptionToLuaTable(r.vm, subscription)

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeSubscriptionNotificationApple.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, subscriptionTable, lua.LString(providerPayload))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return errors.New("Could not run Subscription Notification Apple hook.")
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Subscription Notification Apple hook, must be nil.")
}

func (rp *RuntimeProviderLua) PurchaseNotificationGoogle(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModePurchaseNotificationGoogle, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Purchase Notification Google function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModePurchaseNotificationGoogle, nil, nil, 0, "", "", nil, "", "", "", "")

	purchaseTable := purchaseToLuaTable(r.vm, purchase)

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModePurchaseNotificationGoogle.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, purchaseTable, lua.LString(providerPayload))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return errors.New("Could not run Purchase Notification Google hook.")
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Purchase Notification Google hook, must be nil.")
}

func (rp *RuntimeProviderLua) SubscriptionNotificationGoogle(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	lf := r.GetCallback(RuntimeExecutionModeSubscriptionNotificationGoogle, "")
	if lf == nil {
		rp.Put(r)
		return errors.New("Runtime Subscription Notification Google function not found.")
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeSubscriptionNotificationGoogle, nil, nil, 0, "", "", nil, "", "", "", "")

	subscriptionTable := subscriptionToLuaTable(r.vm, subscription)

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeSubscriptionNotificationGoogle.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, subscriptionTable, lua.LString(providerPayload))
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return errors.New("Could not run Subscription Notification Google hook.")
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Subscription Notification Google hook, must be nil.")
}

func (rp *RuntimeProviderLua) StorageIndexFilter(ctx context.Context, indexName string, write *StorageOpWrite) (bool, error) {
	r, err := rp.Get(ctx)
	if err != nil {
		return false, err
	}
	lf := r.GetCallback(RuntimeExecutionModeStorageIndexFilter, indexName)
	if lf == nil {
		rp.Put(r)
		return false, fmt.Errorf("Runtime Storage Index function not found for index: %q.", indexName)
	}

	luaCtx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, RuntimeExecutionModeStorageIndexFilter, nil, nil, 0, "", "", nil, "", "", "", "")

	//table, err := storageOpWritesToTable(r.vm, storageWrites)
	if err != nil {
		return false, fmt.Errorf("Error running runtime Storage Index Filter hook for %q index: %v", indexName, err.Error())
	}

	writeTable := r.vm.CreateTable(0, 7)
	writeTable.RawSetString("key", lua.LString(write.Object.Key))
	writeTable.RawSetString("collection", lua.LString(write.Object.Collection))
	if write.OwnerID != "" {
		writeTable.RawSetString("user_id", lua.LString(write.OwnerID))
	} else {
		writeTable.RawSetString("user_id", lua.LNil)
	}
	writeTable.RawSetString("version", lua.LString(write.Object.Version))
	writeTable.RawSetString("permission_read", lua.LNumber(write.Object.PermissionRead.GetValue()))
	writeTable.RawSetString("permission_write", lua.LNumber(write.Object.PermissionWrite.GetValue()))

	valueMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(write.Object.Value), &valueMap)
	if err != nil {
		return false, fmt.Errorf("failed to convert value to json: %s", err.Error())
	}
	valueTable := RuntimeLuaConvertMap(r.vm, valueMap)
	writeTable.RawSetString("value", valueTable)

	// Set context value used for logging
	vmCtx := context.WithValue(ctx, ctxLoggerFields{}, map[string]string{"mode": RuntimeExecutionModeStorageIndexFilter.String()})
	r.vm.SetContext(vmCtx)
	retValue, err, _, _ := r.invokeFunction(r.vm, lf, luaCtx, writeTable)
	r.vm.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return false, fmt.Errorf("Error running runtime Storage Index Filter hook for %q index: %v", indexName, err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		return false, errors.New("Invalid return type for Storage Index Filter function: bool expected")
	}

	if retValue.Type() != lua.LTBool {
		return false, fmt.Errorf("Error running runtime Storage Index Filter hook for %q index: failed to assert lua fn expected return type", indexName)
	}

	return lua.LVAsBool(retValue), nil
}

func (rp *RuntimeProviderLua) Get(ctx context.Context) (*RuntimeLua, error) {
	select {
	case <-ctx.Done():
		// Context cancelled
		return nil, ctx.Err()
	case r := <-rp.poolCh:
		// Ideally use an available idle runtime.
		return r, nil
	default:
		// If there was no idle runtime, see if we can allocate a new one.
		if rp.currentCount.Load() >= rp.maxCount {
			// No further runtime allocations allowed.
			break
		}
		currentCount := rp.currentCount.Inc()
		if currentCount > rp.maxCount {
			// When we've incremented see if we can still allocate or a concurrent operation has already done so up to the limit.
			// The current count value may go above max count value, but we will never over-allocate runtimes.
			// This discrepancy is allowed as it avoids a full mutex locking scenario.
			break
		}
		rp.metrics.GaugeLuaRuntimes(float64(currentCount))
		return rp.newFn(), nil
	}

	// If we reach here then we were unable to find an available idle runtime, and allocation was not allowed.
	// Wait as needed.
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-rp.poolCh:
		return r, nil
	}
}

func (rp *RuntimeProviderLua) Put(r *RuntimeLua) {
	select {
	case rp.poolCh <- r:
		// Runtime is successfully returned to the pool.
	default:
		// The pool is over capacity. Should never happen but guard anyway.
		// Safe to continue processing, the runtime is just discarded.
		rp.logger.Warn("Lua runtime pool full, discarding Lua runtime")
	}
}

type RuntimeLua struct {
	logger    *zap.Logger
	node      string
	version   string
	vm        *lua.LState
	luaEnv    *lua.LTable
	callbacks *RuntimeLuaCallbacks
}

func (r *RuntimeLua) loadModules(moduleCache *RuntimeLuaModuleCache) error {
	// `DoFile(..)` only parses and evaluates modules. Calling it multiple times, will load and eval the file multiple times.
	// So to make sure that we only load and evaluate modules once, regardless of whether there is dependency between files, we load them all into `preload`.
	// This is to make sure that modules are only loaded and evaluated once as `doFile()` does not (always) update _LOADED table.
	// Bear in mind two separate thoughts around the script runtime design choice:
	//
	// 1) This is only a problem if one module is dependent on another module.
	// This means that the global functions are evaluated once at system startup and then later on when the module is required through `require`.
	// We circumvent this by checking the _LOADED table to check if `require` had evaluated the module and avoiding double-eval.
	//
	// 2) Second item is that modules must be pre-loaded into the state for callback-func eval to work properly (in case of HTTP/RPC/etc invokes)
	// So we need to always load the modules into the system via `preload` so that they are always available in the LState.
	// We can't rely on `require` to have seen the module in case there is no dependency between the modules.

	//for _, mod := range r.modules {
	//	relPath, _ := filepath.Rel(r.luaPath, mod)
	//	moduleName := strings.TrimSuffix(relPath, filepath.Ext(relPath))
	//
	//	// check to see if this module was loaded by `require` before executing it
	//	loaded := l.GetField(l.Get(lua.RegistryIndex), "_LOADED")
	//	lv := l.GetField(loaded, moduleName)
	//	if lua.LVAsBool(lv) {
	//		// Already evaluated module via `require(..)`
	//		continue
	//	}
	//
	//	if err = l.DoFile(mod); err != nil {
	//		failedModules++
	//		r.logger.Error("Failed to evaluate module - skipping", zap.String("path", mod), zap.Error(err))
	//	}
	//}

	preload := r.vm.GetField(r.vm.GetField(r.vm.Get(lua.EnvironIndex), "package"), "preload")
	fns := make(map[string]*lua.LFunction)
	for _, name := range moduleCache.Names {
		module, ok := moduleCache.Modules[name]
		if !ok {
			r.logger.Fatal("Failed to find named module in cache", zap.String("name", name))
		}
		f, err := r.vm.Load(bytes.NewReader(module.Content), module.Path)
		if err != nil {
			r.logger.Error("Could not load module", zap.String("name", module.Path), zap.Error(err))
			return err
		}
		r.vm.SetField(preload, module.Name, f)
		fns[module.Name] = f
	}

	for _, name := range moduleCache.Names {
		fn, ok := fns[name]
		if !ok {
			r.logger.Fatal("Failed to find named module in prepared functions", zap.String("name", name))
		}
		loaded := r.vm.GetField(r.vm.Get(lua.RegistryIndex), "_LOADED")
		lv := r.vm.GetField(loaded, name)
		if lua.LVAsBool(lv) {
			// Already evaluated module via `require(..)`
			continue
		}

		r.vm.Push(fn)
		fnErr := r.vm.PCall(0, -1, nil)
		if fnErr != nil {
			r.logger.Error("Could not complete runtime invocation", zap.Error(fnErr))
			return fnErr
		}
	}

	return nil
}

func (r *RuntimeLua) GetCallback(e RuntimeExecutionMode, key string) *lua.LFunction {
	switch e {
	case RuntimeExecutionModeRPC:
		fn, found := r.callbacks.RPC.Load(key)
		if !found {
			return nil
		}
		return fn
	case RuntimeExecutionModeBefore:
		fn, found := r.callbacks.Before.Load(key)
		if !found {
			return nil
		}
		return fn
	case RuntimeExecutionModeAfter:
		fn, found := r.callbacks.After.Load(key)
		if !found {
			return nil
		}
		return fn
	case RuntimeExecutionModeMatchmaker:
		return r.callbacks.Matchmaker
	case RuntimeExecutionModeTournamentEnd:
		return r.callbacks.TournamentEnd
	case RuntimeExecutionModeTournamentReset:
		return r.callbacks.TournamentReset
	case RuntimeExecutionModeLeaderboardReset:
		return r.callbacks.LeaderboardReset
	case RuntimeExecutionModeShutdown:
		return r.callbacks.Shutdown
	case RuntimeExecutionModePurchaseNotificationApple:
		return r.callbacks.PurchaseNotificationApple
	case RuntimeExecutionModeSubscriptionNotificationApple:
		return r.callbacks.SubscriptionNotificationApple
	case RuntimeExecutionModePurchaseNotificationGoogle:
		return r.callbacks.PurchaseNotificationGoogle
	case RuntimeExecutionModeSubscriptionNotificationGoogle:
		return r.callbacks.SubscriptionNotificationGoogle
	case RuntimeExecutionModeStorageIndexFilter:
		fn, found := r.callbacks.StorageIndexFilter.Load(key)
		if !found {
			return nil
		}
		return fn
	}

	return nil
}

func (r *RuntimeLua) InvokeFunction(execMode RuntimeExecutionMode, fn *lua.LFunction, headers, queryParams map[string][]string, uid string, username string, vars map[string]string, sessionExpiry int64, sid string, clientIP, clientPort, lang string, payloads ...interface{}) (interface{}, error, codes.Code, bool) {
	ctx := NewRuntimeLuaContext(r.vm, r.node, r.version, r.luaEnv, execMode, headers, queryParams, sessionExpiry, uid, username, vars, sid, clientIP, clientPort, lang)
	lv := make([]lua.LValue, 0, len(payloads))
	for _, payload := range payloads {
		lv = append(lv, RuntimeLuaConvertValue(r.vm, payload))
	}

	retValue, err, code, isCustomErr := r.invokeFunction(r.vm, fn, ctx, lv...)
	if err != nil {
		return nil, err, code, isCustomErr
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil, 0, false
	}

	return RuntimeLuaConvertLuaValue(retValue), nil, 0, false
}

func (r *RuntimeLua) invokeFunction(l *lua.LState, fn *lua.LFunction, ctx *lua.LTable, payloads ...lua.LValue) (lua.LValue, error, codes.Code, bool) {
	l.Push(LSentinel)
	l.Push(fn)

	nargs := 1
	l.Push(ctx)

	for _, payload := range payloads {
		l.Push(payload)
		nargs++
	}

	err := l.PCall(nargs, lua.MultRet, nil)
	if err != nil {
		// Unwind the stack up to and including our sentinel value, effectively discarding any other returned parameters.
		for {
			v := l.Get(-1)
			l.Pop(1)
			if v.Type() == LTSentinel {
				break
			}
		}

		if apiError, ok := err.(*lua.ApiError); ok && apiError.Object.Type() == lua.LTTable {
			t := apiError.Object.(*lua.LTable)
			switch t.Len() {
			case 0:
				return nil, err, codes.Internal, false
			case 1:
				apiError.Object = t.RawGetInt(1)
				return nil, err, codes.Internal, false
			default:
				// Ignore everything beyond the first 2 params, if there are more.
				apiError.Object = t.RawGetInt(1)
				code := codes.Internal
				if c := t.RawGetInt(2); c.Type() == lua.LTNumber {
					code = codes.Code(c.(lua.LNumber))
				}
				return nil, err, code, true
			}
		}

		return nil, err, codes.Internal, false
	}

	retValue := l.Get(-1)
	l.Pop(1)
	if retValue.Type() == LTSentinel {
		return nil, nil, 0, false
	}

	// Unwind the stack up to and including our sentinel value, effectively discarding any other returned parameters.
	for {
		v := l.Get(-1)
		l.Pop(1)
		if v.Type() == LTSentinel {
			break
		}
	}

	return retValue, nil, 0, false
}

func (r *RuntimeLua) Stop() {
	// Not necessarily required as it only does OS temp files cleanup, which we don't expose in the runtime.
	r.vm.Close()
}

func clearFnError(fnErr error, rp *RuntimeProviderLua, lf *lua.LFunction) error {
	if apiErr, ok := fnErr.(*lua.ApiError); ok && !rp.config.GetRuntime().LuaApiStacktrace {
		msg := apiErr.Object.String()
		if strings.HasPrefix(msg, lf.Proto.SourceName) {
			msg = msg[len(lf.Proto.SourceName):]
			msgParts := strings.SplitN(msg, ": ", 2)
			if len(msgParts) == 2 {
				msg = msgParts[1]
			} else {
				msg = msgParts[0]
			}
		}
		return errors.New(msg)
	}

	// fnErr contains reference to the LuaVM we are about to return to pool,
	// create new error with same error message, but dropping any references
	// to the Lua VM objects
	return errors.New(fnErr.Error())
}

func checkRuntimeLuaVM(logger *zap.Logger, config Config, version string, stdLibs map[string]lua.LGFunction, moduleCache *RuntimeLuaModuleCache) error {
	vm := lua.NewState(lua.Options{
		CallStackSize:       config.GetRuntime().GetLuaCallStackSize(),
		RegistrySize:        config.GetRuntime().GetLuaRegistrySize(),
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	vm.SetContext(context.Background())
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}
	nakamaModule := NewRuntimeLuaNakamaModule(logger, nil, nil, nil, config, version, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	vm.PreloadModule("nakama", nakamaModule.Loader)

	preload := vm.GetField(vm.GetField(vm.Get(lua.EnvironIndex), "package"), "preload")
	for _, name := range moduleCache.Names {
		module, ok := moduleCache.Modules[name]
		if !ok {
			logger.Fatal("Failed to find named module in cache", zap.String("name", name))
		}

		f, err := vm.Load(bytes.NewReader(module.Content), module.Path)
		if err != nil {
			logger.Error("Could not load module", zap.String("name", module.Path), zap.Error(err))
			return err
		}
		vm.SetField(preload, module.Name, f)
	}

	return nil
}

func newRuntimeLuaVM(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, stdLibs map[string]lua.LGFunction, moduleCache *RuntimeLuaModuleCache, once *sync.Once, localCache *RuntimeLuaLocalCache, storageIndex StorageIndex, matchCreateFn RuntimeMatchCreateFunction, eventFn RuntimeEventCustomFunction, announceCallbackFn func(RuntimeExecutionMode, string)) (*RuntimeLua, error) {
	vm := lua.NewState(lua.Options{
		CallStackSize:       config.GetRuntime().GetLuaCallStackSize(),
		RegistrySize:        config.GetRuntime().GetLuaRegistrySize(),
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	vm.SetContext(context.Background())
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}
	callbacks := &RuntimeLuaCallbacks{
		RPC:                &MapOf[string, *lua.LFunction]{},
		Before:             &MapOf[string, *lua.LFunction]{},
		After:              &MapOf[string, *lua.LFunction]{},
		StorageIndexFilter: &MapOf[string, *lua.LFunction]{},
	}
	registerCallbackFn := func(e RuntimeExecutionMode, key string, fn *lua.LFunction) {
		switch e {
		case RuntimeExecutionModeRPC:
			callbacks.RPC.Store(key, fn)
		case RuntimeExecutionModeBefore:
			callbacks.Before.Store(key, fn)
		case RuntimeExecutionModeAfter:
			callbacks.After.Store(key, fn)
		case RuntimeExecutionModeMatchmaker:
			callbacks.Matchmaker = fn
		case RuntimeExecutionModeTournamentEnd:
			callbacks.TournamentEnd = fn
		case RuntimeExecutionModeTournamentReset:
			callbacks.TournamentReset = fn
		case RuntimeExecutionModeLeaderboardReset:
			callbacks.LeaderboardReset = fn
		case RuntimeExecutionModePurchaseNotificationApple:
			callbacks.PurchaseNotificationApple = fn
		case RuntimeExecutionModeSubscriptionNotificationApple:
			callbacks.SubscriptionNotificationApple = fn
		case RuntimeExecutionModePurchaseNotificationGoogle:
			callbacks.PurchaseNotificationGoogle = fn
		case RuntimeExecutionModeSubscriptionNotificationGoogle:
			callbacks.SubscriptionNotificationGoogle = fn
		case RuntimeExecutionModeStorageIndexFilter:
			callbacks.StorageIndexFilter.Store(key, fn)
		}
	}
	nakamaModule := NewRuntimeLuaNakamaModule(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, version, socialClient, leaderboardCache, rankCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, once, localCache, storageIndex, matchCreateFn, eventFn, registerCallbackFn, announceCallbackFn)
	vm.PreloadModule("nakama", nakamaModule.Loader)
	r := &RuntimeLua{
		logger:    logger,
		node:      config.GetName(),
		version:   version,
		vm:        vm,
		luaEnv:    RuntimeLuaConvertMapString(vm, config.GetRuntime().Environment),
		callbacks: callbacks,
	}

	return r, r.loadModules(moduleCache)
}
