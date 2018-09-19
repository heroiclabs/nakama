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
	"io/ioutil"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/proto"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/runtime"
	"github.com/heroiclabs/nakama/social"
	"github.com/yuin/gopher-lua"
	"go.opencensus.io/stats"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc/codes"
)

const LTSentinel = lua.LValueType(-1)

type LSentinelType struct {
	lua.LNilType
}

func (s *LSentinelType) String() string       { return "" }
func (s *LSentinelType) Type() lua.LValueType { return LTSentinel }

var LSentinel = lua.LValue(&LSentinelType{})

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
	sync.Mutex
	logger               *zap.Logger
	db                   *sql.DB
	jsonpbMarshaler      *jsonpb.Marshaler
	jsonpbUnmarshaler    *jsonpb.Unmarshaler
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	sessionRegistry      *SessionRegistry
	matchRegistry        MatchRegistry
	tracker              Tracker
	router               MessageRouter
	stdLibs              map[string]lua.LGFunction

	once         *sync.Once
	poolCh       chan *RuntimeLua
	maxCount     int
	currentCount int
	newFn        func() *RuntimeLua

	statsCtx context.Context
}

func NewRuntimeProviderLua(logger, startupLogger *zap.Logger, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler *LeaderboardScheduler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, goMatchCreateFn RuntimeMatchCreateFunction, rootPath string, paths []string) ([]string, map[string]RuntimeRpcFunction, map[string]RuntimeBeforeRtFunction, map[string]RuntimeAfterRtFunction, *RuntimeBeforeReqFunctions, *RuntimeAfterReqFunctions, RuntimeMatchmakerMatchedFunction, RuntimeMatchCreateFunction, RuntimeTournamentEndFunction, RuntimeTournamentResetFunction, RuntimeLeaderboardResetFunction, error) {
	moduleCache := &RuntimeLuaModuleCache{
		Names:   make([]string, 0),
		Modules: make(map[string]*RuntimeLuaModule, 0),
	}
	modulePaths := make([]string, 0)

	// Override before Package library is invoked.
	lua.LuaLDir = rootPath
	lua.LuaPathDefault = lua.LuaLDir + string(os.PathSeparator) + "?.lua;" + lua.LuaLDir + string(os.PathSeparator) + "?" + string(os.PathSeparator) + "init.lua"
	os.Setenv(lua.LuaPath, lua.LuaPathDefault)

	startupLogger.Info("Initialising Lua runtime provider", zap.String("path", lua.LuaLDir))

	for _, path := range paths {
		if strings.ToLower(filepath.Ext(path)) != ".lua" {
			continue
		}

		// Load the file contents into memory.
		var content []byte
		var err error
		if content, err = ioutil.ReadFile(path); err != nil {
			startupLogger.Error("Could not read Lua module", zap.String("path", path), zap.Error(err))
			return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
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
	once := &sync.Once{}
	localCache := NewRuntimeLuaLocalCache()
	rpcFunctions := make(map[string]RuntimeRpcFunction, 0)
	beforeRtFunctions := make(map[string]RuntimeBeforeRtFunction, 0)
	afterRtFunctions := make(map[string]RuntimeAfterRtFunction, 0)
	beforeReqFunctions := &RuntimeBeforeReqFunctions{}
	afterReqFunctions := &RuntimeAfterReqFunctions{}
	var matchmakerMatchedFunction RuntimeMatchmakerMatchedFunction
	var tournamentEndFunction RuntimeTournamentEndFunction
	var tournamentResetFunction RuntimeTournamentResetFunction
	var leaderboardResetFunction RuntimeLeaderboardResetFunction

	allMatchCreateFn := func(logger *zap.Logger, id uuid.UUID, node string, name string, labelUpdateFn func(string)) (RuntimeMatchCore, error) {
		core, err := goMatchCreateFn(logger, id, node, name, labelUpdateFn)
		if err != nil {
			return nil, err
		}
		if core != nil {
			return core, nil
		}
		return NewRuntimeLuaMatchCore(logger, db, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, router, stdLibs, once, localCache, goMatchCreateFn, id, node, name, labelUpdateFn)
	}

	runtimeProviderLua := &RuntimeProviderLua{
		logger:               logger,
		db:                   db,
		jsonpbMarshaler:      jsonpbMarshaler,
		jsonpbUnmarshaler:    jsonpbUnmarshaler,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		sessionRegistry:      sessionRegistry,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		router:               router,
		stdLibs:              stdLibs,

		once:     once,
		poolCh:   make(chan *RuntimeLua, config.GetRuntime().MaxCount),
		maxCount: config.GetRuntime().MaxCount,
		// Set the current count assuming we'll warm up the pool in a moment.
		currentCount: config.GetRuntime().MinCount,
		newFn: func() *RuntimeLua {
			r, err := newRuntimeLuaVM(logger, db, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, router, stdLibs, moduleCache, once, localCache, allMatchCreateFn, nil)
			if err != nil {
				logger.Fatal("Failed to initialize Lua runtime", zap.Error(err))
			}
			return r
		},

		statsCtx: context.Background(),
	}

	startupLogger.Info("Evaluating Lua runtime modules")

	r, err := newRuntimeLuaVM(logger, db, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, router, stdLibs, moduleCache, once, localCache, allMatchCreateFn, func(execMode RuntimeExecutionMode, id string) {
		switch execMode {
		case RuntimeExecutionModeRPC:
			rpcFunctions[id] = func(queryParams map[string][]string, userID, username string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code) {
				return runtimeProviderLua.Rpc(id, queryParams, userID, username, expiry, sessionID, clientIP, clientPort, payload)
			}
		case RuntimeExecutionModeBefore:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				beforeRtFunctions[id] = func(logger *zap.Logger, userID, username string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
					return runtimeProviderLua.BeforeRt(id, logger, userID, username, expiry, sessionID, clientIP, clientPort, envelope)
				}
			} else if strings.HasPrefix(id, strings.ToLower(API_PREFIX)) {
				shortId := strings.TrimPrefix(id, strings.ToLower(API_PREFIX))
				switch shortId {
				case "getaccount":
					beforeReqFunctions.beforeGetAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) (*empty.Empty, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*empty.Empty), nil, 0
					}
				case "updateaccount":
					beforeReqFunctions.beforeUpdateAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.UpdateAccountRequest), nil, 0
					}
				case "authenticatecustom":
					beforeReqFunctions.beforeAuthenticateCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateCustomRequest), nil, 0
					}
				case "authenticatedevice":
					beforeReqFunctions.beforeAuthenticateDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateDeviceRequest), nil, 0
					}
				case "authenticateemail":
					beforeReqFunctions.beforeAuthenticateEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateEmailRequest), nil, 0
					}
				case "authenticatefacebook":
					beforeReqFunctions.beforeAuthenticateFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateFacebookRequest), nil, 0
					}
				case "authenticategamecenter":
					beforeReqFunctions.beforeAuthenticateGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateGameCenterRequest), nil, 0
					}
				case "authenticategoogle":
					beforeReqFunctions.beforeAuthenticateGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateGoogleRequest), nil, 0
					}
				case "authenticatesteam":
					beforeReqFunctions.beforeAuthenticateSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateSteamRequest), nil, 0
					}
				case "listchannelmessages":
					beforeReqFunctions.beforeListChannelMessagesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListChannelMessagesRequest), nil, 0
					}
				case "listfriends":
					beforeReqFunctions.beforeListFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) (*empty.Empty, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*empty.Empty), nil, 0
					}
				case "addfriends":
					beforeReqFunctions.beforeAddFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AddFriendsRequest), nil, 0
					}
				case "deletefriends":
					beforeReqFunctions.beforeDeleteFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteFriendsRequest), nil, 0
					}
				case "blockfriends":
					beforeReqFunctions.beforeBlockFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.BlockFriendsRequest), nil, 0
					}
				case "importfacebookfriends":
					beforeReqFunctions.beforeImportFacebookFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ImportFacebookFriendsRequest), nil, 0
					}
				case "creategroup":
					beforeReqFunctions.beforeCreateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.CreateGroupRequest), nil, 0
					}
				case "updategroup":
					beforeReqFunctions.beforeUpdateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.UpdateGroupRequest), nil, 0
					}
				case "deletegroup":
					beforeReqFunctions.beforeDeleteGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteGroupRequest), nil, 0
					}
				case "joingroup":
					beforeReqFunctions.beforeJoinGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.JoinGroupRequest), nil, 0
					}
				case "leavegroup":
					beforeReqFunctions.beforeLeaveGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LeaveGroupRequest), nil, 0
					}
				case "addgroupusers":
					beforeReqFunctions.beforeAddGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AddGroupUsersRequest), nil, 0
					}
				case "kickgroupusers":
					beforeReqFunctions.beforeKickGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.KickGroupUsersRequest), nil, 0
					}
				case "promotegroupusers":
					beforeReqFunctions.beforePromoteGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.PromoteGroupUsersRequest), nil, 0
					}
				case "listgroupusers":
					beforeReqFunctions.beforeListGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListGroupUsersRequest), nil, 0
					}
				case "listusergroups":
					beforeReqFunctions.beforeListUserGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListUserGroupsRequest), nil, 0
					}
				case "listgroups":
					beforeReqFunctions.beforeListGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListGroupsRequest), nil, 0
					}
				case "deleteleaderboardrecord":
					beforeReqFunctions.beforeDeleteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteLeaderboardRecordRequest), nil, 0
					}
				case "listleaderboardrecords":
					beforeReqFunctions.beforeListLeaderboardRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListLeaderboardRecordsRequest), nil, 0
					}
				case "writeleaderboardrecord":
					beforeReqFunctions.beforeWriteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteLeaderboardRecordRequest), nil, 0
					}
				case "listleaderboardrecordsaroundowner":
					beforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListLeaderboardRecordsAroundOwnerRequest), nil, 0
					}
				case "linkcustom":
					beforeReqFunctions.beforeLinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountCustom), nil, 0
					}
				case "linkdevice":
					beforeReqFunctions.beforeLinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountDevice), nil, 0
					}
				case "linkemail":
					beforeReqFunctions.beforeLinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountEmail), nil, 0
					}
				case "linkfacebook":
					beforeReqFunctions.beforeLinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LinkFacebookRequest), nil, 0
					}
				case "linkgamecenter":
					beforeReqFunctions.beforeLinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGameCenter), nil, 0
					}
				case "linkgoogle":
					beforeReqFunctions.beforeLinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGoogle), nil, 0
					}
				case "linksteam":
					beforeReqFunctions.beforeLinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountSteam), nil, 0
					}
				case "listmatches":
					beforeReqFunctions.beforeListMatchesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListMatchesRequest), nil, 0
					}
				case "listnotifications":
					beforeReqFunctions.beforeListNotificationsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListNotificationsRequest), nil, 0
					}
				case "deletenotification":
					beforeReqFunctions.beforeDeleteNotificationFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteNotificationsRequest), nil, 0
					}
				case "liststorageobjects":
					beforeReqFunctions.beforeListStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListStorageObjectsRequest), nil, 0
					}
				case "readstorageobjects":
					beforeReqFunctions.beforeReadStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ReadStorageObjectsRequest), nil, 0
					}
				case "writestorageobjects":
					beforeReqFunctions.beforeWriteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteStorageObjectsRequest), nil, 0
					}
				case "deletestorageobjects":
					beforeReqFunctions.beforeDeleteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteStorageObjectsRequest), nil, 0
					}
				case "jointournament":
					beforeReqFunctions.beforeJoinTournamentFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.JoinTournamentRequest), nil, 0
					}
				case "listtournamentrecords":
					beforeReqFunctions.beforeListTournamentRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentRecordsRequest), nil, 0
					}
				case "listtournaments":
					beforeReqFunctions.beforeListTournamentsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentsRequest), nil, 0
					}
				case "writetournamentrecord":
					beforeReqFunctions.beforeWriteTournamentRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteTournamentRecordRequest), nil, 0
					}
				case "listtournamentrecordsaroundowner":
					beforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentRecordsAroundOwnerRequest), nil, 0
					}
				case "unlinkcustom":
					beforeReqFunctions.beforeUnlinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountCustom), nil, 0
					}
				case "unlinkdevice":
					beforeReqFunctions.beforeUnlinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountDevice), nil, 0
					}
				case "unlinkemail":
					beforeReqFunctions.beforeUnlinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountEmail), nil, 0
					}
				case "unlinkfacebook":
					beforeReqFunctions.beforeUnlinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) (*api.AccountFacebook, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebook), nil, 0
					}
				case "unlinkgamecenter":
					beforeReqFunctions.beforeUnlinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGameCenter), nil, 0
					}
				case "unlinkgoogle":
					beforeReqFunctions.beforeUnlinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGoogle), nil, 0
					}
				case "unlinksteam":
					beforeReqFunctions.beforeUnlinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountSteam), nil, 0
					}
				case "getusers":
					beforeReqFunctions.beforeGetUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.GetUsersRequest) (*api.GetUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderLua.BeforeReq(id, logger, userID, username, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.GetUsersRequest), nil, 0
					}
				}
			}
		case RuntimeExecutionModeAfter:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				afterRtFunctions[id] = func(logger *zap.Logger, userID, username string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error {
					return runtimeProviderLua.AfterRt(id, logger, userID, username, expiry, sessionID, clientIP, clientPort, envelope)
				}
			} else if strings.HasPrefix(id, strings.ToLower(API_PREFIX)) {
				shortId := strings.TrimPrefix(id, strings.ToLower(API_PREFIX))
				switch shortId {
				case "getaccount":
					afterReqFunctions.afterGetAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Account) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "updateaccount":
					afterReqFunctions.afterUpdateAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticatecustom":
					afterReqFunctions.afterAuthenticateCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticatedevice":
					afterReqFunctions.afterAuthenticateDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticateemail":
					afterReqFunctions.afterAuthenticateEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticatefacebook":
					afterReqFunctions.afterAuthenticateFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticategamecenter":
					afterReqFunctions.afterAuthenticateGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticategoogle":
					afterReqFunctions.afterAuthenticateGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "authenticatesteam":
					afterReqFunctions.afterAuthenticateSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Session) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listchannelmessages":
					afterReqFunctions.afterListChannelMessagesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.ChannelMessageList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listfriends":
					afterReqFunctions.afterListFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Friends) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "addfriends":
					afterReqFunctions.afterAddFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "deletefriends":
					afterReqFunctions.afterDeleteFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "blockfriends":
					afterReqFunctions.afterBlockFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "importfacebookfriends":
					afterReqFunctions.afterImportFacebookFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "creategroup":
					afterReqFunctions.afterCreateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Group) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "updategroup":
					afterReqFunctions.afterUpdateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "deletegroup":
					afterReqFunctions.afterDeleteGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "joingroup":
					afterReqFunctions.afterJoinGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "leavegroup":
					afterReqFunctions.afterLeaveGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "addgroupusers":
					afterReqFunctions.afterAddGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "kickgroupusers":
					afterReqFunctions.afterKickGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "promotegroupusers":
					afterReqFunctions.afterPromoteGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listgroupusers":
					afterReqFunctions.afterListGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.GroupUserList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listusergroups":
					afterReqFunctions.afterListUserGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.UserGroupList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listgroups":
					afterReqFunctions.afterListGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.GroupList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "deleteleaderboardrecord":
					afterReqFunctions.afterDeleteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listleaderboardrecords":
					afterReqFunctions.afterListLeaderboardRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "writeleaderboardrecord":
					afterReqFunctions.afterWriteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listleaderboardrecordsaroundowner":
					afterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linkcustom":
					afterReqFunctions.afterLinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linkdevice":
					afterReqFunctions.afterLinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linkemail":
					afterReqFunctions.afterLinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linkfacebook":
					afterReqFunctions.afterLinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linkgamecenter":
					afterReqFunctions.afterLinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linkgoogle":
					afterReqFunctions.afterLinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "linksteam":
					afterReqFunctions.afterLinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listmatches":
					afterReqFunctions.afterListMatchesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.MatchList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listnotifications":
					afterReqFunctions.afterListNotificationsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.NotificationList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "deletenotification":
					afterReqFunctions.afterDeleteNotificationFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "liststorageobjects":
					afterReqFunctions.afterListStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.StorageObjectList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "readstorageobjects":
					afterReqFunctions.afterReadStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.StorageObjects) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "writestorageobjects":
					afterReqFunctions.afterWriteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.StorageObjectAcks) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "deletestorageobjects":
					afterReqFunctions.afterDeleteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "jointournament":
					afterReqFunctions.afterJoinTournamentFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listtournamentrecords":
					afterReqFunctions.afterListTournamentRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listtournaments":
					afterReqFunctions.afterListTournamentsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.TournamentList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "writetournamentrecord":
					afterReqFunctions.afterWriteTournamentRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "listtournamentrecordsaroundowner":
					afterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinkcustom":
					afterReqFunctions.afterUnlinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinkdevice":
					afterReqFunctions.afterUnlinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinkemail":
					afterReqFunctions.afterUnlinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinkfacebook":
					afterReqFunctions.afterUnlinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinkgamecenter":
					afterReqFunctions.afterUnlinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinkgoogle":
					afterReqFunctions.afterUnlinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "unlinksteam":
					afterReqFunctions.afterUnlinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *empty.Empty) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				case "getusers":
					afterReqFunctions.afterGetUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, out *api.Users) error {
						return runtimeProviderLua.AfterReq(id, logger, userID, username, expiry, clientIP, clientPort, out)
					}
				}
			}
		case RuntimeExecutionModeMatchmaker:
			matchmakerMatchedFunction = func(entries []*MatchmakerEntry) (string, bool, error) {
				return runtimeProviderLua.MatchmakerMatched(entries)
			}
		case RuntimeExecutionModeTournamentEnd:
			tournamentEndFunction = func(tournament *api.Tournament, end, reset int64) error {
				return runtimeProviderLua.TournamentEnd(tournament, end, reset)
			}
		case RuntimeExecutionModeTournamentReset:
			tournamentResetFunction = func(tournament *api.Tournament, end, reset int64) error {
				return runtimeProviderLua.TournamentReset(tournament, end, reset)
			}
		case RuntimeExecutionModeLeaderboardReset:
			leaderboardResetFunction = func(leaderboard runtime.Leaderboard, reset int64) error {
				return runtimeProviderLua.LeaderboardReset(leaderboard, reset)
			}
		}
	})
	if err != nil {
		return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
	}
	r.Stop()

	startupLogger.Info("Lua runtime modules loaded")

	// Warm up the pool.
	startupLogger.Info("Allocating minimum runtime pool", zap.Int("count", runtimeProviderLua.currentCount))
	if len(moduleCache.Names) > 0 {
		// Only if there are runtime modules to load.
		for i := 0; i < config.GetRuntime().MinCount; i++ {
			runtimeProviderLua.poolCh <- runtimeProviderLua.newFn()
		}
		stats.Record(runtimeProviderLua.statsCtx, MetricsRuntimeCount.M(int64(config.GetRuntime().MinCount)))
	}
	startupLogger.Info("Allocated minimum runtime pool")

	return modulePaths, rpcFunctions, beforeRtFunctions, afterRtFunctions, beforeReqFunctions, afterReqFunctions, matchmakerMatchedFunction, allMatchCreateFn, tournamentEndFunction, tournamentResetFunction, leaderboardResetFunction, nil
}

func (rp *RuntimeProviderLua) Rpc(id string, queryParams map[string][]string, userID, username string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code) {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeRPC, id)
	if lf == nil {
		rp.Put(runtime)
		return "", ErrRuntimeRPCNotFound, codes.NotFound
	}

	result, fnErr, code := runtime.InvokeFunction(RuntimeExecutionModeRPC, lf, queryParams, userID, username, expiry, sessionID, clientIP, clientPort, payload)
	rp.Put(runtime)

	if fnErr != nil {
		rp.logger.Error("Runtime RPC function caused an error", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !rp.logger.Core().Enabled(zapcore.InfoLevel) {
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
			return "", errors.New(msg), code
		} else {
			return "", fnErr, code
		}
	}

	if result == nil {
		return "", nil, 0
	}

	if payload, ok := result.(string); !ok {
		rp.logger.Warn("Lua runtime function returned invalid data", zap.Any("result", result))
		return "", errors.New("Runtime function returned invalid data - only allowed one return value of type String/Byte."), codes.Internal
	} else {
		return payload, nil, 0
	}
}

func (rp *RuntimeProviderLua) BeforeRt(id string, logger *zap.Logger, userID, username string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeBefore, id)
	if lf == nil {
		rp.Put(runtime)
		return nil, errors.New("Runtime Before function not found.")
	}

	envelopeJSON, err := rp.jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		rp.Put(runtime)
		logger.Error("Could not marshall envelope to JSON", zap.Any("envelope", envelope), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}
	var envelopeMap map[string]interface{}
	if err := json.Unmarshal([]byte(envelopeJSON), &envelopeMap); err != nil {
		rp.Put(runtime)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("envelope_json", envelopeJSON), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}

	result, fnErr, _ := runtime.InvokeFunction(RuntimeExecutionModeBefore, lf, nil, userID, username, expiry, sessionID, clientIP, clientPort, envelopeMap)
	rp.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !logger.Core().Enabled(zapcore.InfoLevel) {
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
			return nil, errors.New(msg)
		} else {
			return nil, fnErr
		}
	}

	if result == nil {
		return nil, nil
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshall result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function.")
	}

	if err = rp.jsonpbUnmarshaler.Unmarshal(strings.NewReader(string(resultJSON)), envelope); err != nil {
		logger.Error("Could not unmarshall result to envelope", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function.")
	}

	return envelope, nil
}

func (rp *RuntimeProviderLua) AfterRt(id string, logger *zap.Logger, userID, username string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeAfter, id)
	if lf == nil {
		rp.Put(runtime)
		return errors.New("Runtime After function not found.")
	}

	envelopeJSON, err := rp.jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		rp.Put(runtime)
		logger.Error("Could not marshall envelope to JSON", zap.Any("envelope", envelope), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	var envelopeMap map[string]interface{}
	if err := json.Unmarshal([]byte(envelopeJSON), &envelopeMap); err != nil {
		rp.Put(runtime)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("envelope_json", envelopeJSON), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	_, fnErr, _ := runtime.InvokeFunction(RuntimeExecutionModeAfter, lf, nil, userID, username, expiry, sessionID, clientIP, clientPort, envelopeMap)
	rp.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !logger.Core().Enabled(zapcore.InfoLevel) {
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
		} else {
			return fnErr
		}
	}

	return nil
}

func (rp *RuntimeProviderLua) BeforeReq(id string, logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, req interface{}) (interface{}, error, codes.Code) {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeBefore, id)
	if lf == nil {
		rp.Put(runtime)
		return nil, errors.New("Runtime Before function not found."), codes.NotFound
	}

	reqProto, ok := req.(proto.Message)
	if !ok {
		rp.Put(runtime)
		logger.Error("Could not cast request to message", zap.Any("request", req))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}
	reqJSON, err := rp.jsonpbMarshaler.MarshalToString(reqProto)
	if err != nil {
		rp.Put(runtime)
		logger.Error("Could not marshall request to JSON", zap.Any("request", reqProto), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}
	var reqMap map[string]interface{}
	if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
		rp.Put(runtime)
		logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}

	result, fnErr, code := runtime.InvokeFunction(RuntimeExecutionModeBefore, lf, nil, userID, username, expiry, "", clientIP, clientPort, reqMap)
	rp.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !logger.Core().Enabled(zapcore.InfoLevel) {
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
			return nil, errors.New(msg), code
		} else {
			return nil, fnErr, code
		}
	}

	if result == nil {
		return nil, nil, 0
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshall result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function."), codes.Internal
	}

	if err = rp.jsonpbUnmarshaler.Unmarshal(strings.NewReader(string(resultJSON)), reqProto); err != nil {
		logger.Error("Could not unmarshall result to request", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function."), codes.Internal
	}

	return req, nil, 0
}

func (rp *RuntimeProviderLua) AfterReq(id string, logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, req interface{}) error {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeAfter, id)
	if lf == nil {
		rp.Put(runtime)
		return errors.New("Runtime After function not found.")
	}

	reqProto, ok := req.(proto.Message)
	if !ok {
		rp.Put(runtime)
		logger.Error("Could not cast request to message", zap.Any("request", req))
		return errors.New("Could not run runtime After function.")
	}
	reqJSON, err := rp.jsonpbMarshaler.MarshalToString(reqProto)
	if err != nil {
		rp.Put(runtime)
		logger.Error("Could not marshall request to JSON", zap.Any("request", reqProto), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	var reqMap map[string]interface{}
	if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
		rp.Put(runtime)
		logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	_, fnErr, _ := runtime.InvokeFunction(RuntimeExecutionModeBefore, lf, nil, userID, username, expiry, "", clientIP, clientPort, reqMap)
	rp.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !logger.Core().Enabled(zapcore.InfoLevel) {
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
		} else {
			return fnErr
		}
	}

	return nil
}

func (rp *RuntimeProviderLua) MatchmakerMatched(entries []*MatchmakerEntry) (string, bool, error) {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeMatchmaker, "")
	if lf == nil {
		rp.Put(runtime)
		return "", false, errors.New("Runtime Matchmaker Matched function not found.")
	}

	ctx := NewRuntimeLuaContext(runtime.vm, runtime.luaEnv, RuntimeExecutionModeMatchmaker, nil, 0, "", "", "", "", "")

	entriesTable := runtime.vm.CreateTable(len(entries), 0)
	for i, entry := range entries {
		presenceTable := runtime.vm.CreateTable(0, 4)
		presenceTable.RawSetString("user_id", lua.LString(entry.Presence.UserId))
		presenceTable.RawSetString("session_id", lua.LString(entry.Presence.SessionId))
		presenceTable.RawSetString("username", lua.LString(entry.Presence.Username))
		presenceTable.RawSetString("node", lua.LString(entry.Presence.Node))

		propertiesTable := runtime.vm.CreateTable(0, len(entry.StringProperties)+len(entry.NumericProperties))
		for k, v := range entry.StringProperties {
			propertiesTable.RawSetString(k, lua.LString(v))
		}
		for k, v := range entry.NumericProperties {
			propertiesTable.RawSetString(k, lua.LNumber(v))
		}

		entryTable := runtime.vm.CreateTable(0, 2)
		entryTable.RawSetString("presence", presenceTable)
		entryTable.RawSetString("properties", propertiesTable)

		entriesTable.RawSetInt(i+1, entryTable)
	}

	retValue, err, _ := runtime.invokeFunction(runtime.vm, lf, ctx, entriesTable)
	rp.Put(runtime)
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

func (rp *RuntimeProviderLua) TournamentEnd(tournament *api.Tournament, end, reset int64) error {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeTournamentEnd, "")
	if lf == nil {
		rp.Put(runtime)
		return errors.New("Runtime Tournament End function not found.")
	}

	ctx := NewRuntimeLuaContext(runtime.vm, runtime.luaEnv, RuntimeExecutionModeTournamentEnd, nil, 0, "", "", "", "", "")

	tournamentTable := runtime.vm.CreateTable(0, 13)

	tournamentTable.RawSetString("id", lua.LString(tournament.Id))
	tournamentTable.RawSetString("title", lua.LString(tournament.Title))
	tournamentTable.RawSetString("description", lua.LString(tournament.Description))
	tournamentTable.RawSetString("category", lua.LNumber(tournament.Category))
	if tournament.SortOrder == LeaderboardSortOrderAscending {
		tournamentTable.RawSetString("sort_order", lua.LString("asc"))
	} else {
		tournamentTable.RawSetString("sort_order", lua.LString("desc"))
	}
	tournamentTable.RawSetString("size", lua.LNumber(tournament.Size))
	tournamentTable.RawSetString("max_size", lua.LNumber(tournament.MaxSize))
	tournamentTable.RawSetString("max_num_score", lua.LNumber(tournament.MaxNumScore))
	tournamentTable.RawSetString("can_enter", lua.LBool(tournament.CanEnter))
	tournamentTable.RawSetString("next_reset", lua.LNumber(tournament.NextReset))
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(runtime)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(runtime.vm, metadataMap)
	tournamentTable.RawSetString("metadata", metadataTable)
	tournamentTable.RawSetString("create_time", lua.LNumber(tournament.CreateTime.Seconds))
	tournamentTable.RawSetString("start_time", lua.LNumber(tournament.StartTime.Seconds))

	retValue, err, _ := runtime.invokeFunction(runtime.vm, lf, ctx, tournamentTable, lua.LNumber(end), lua.LNumber(reset))
	rp.Put(runtime)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament End hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament End hook, must be string or nil.")
}

func (rp *RuntimeProviderLua) TournamentReset(tournament *api.Tournament, end, reset int64) error {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeTournamentReset, "")
	if lf == nil {
		rp.Put(runtime)
		return errors.New("Runtime Tournament Reset function not found.")
	}

	ctx := NewRuntimeLuaContext(runtime.vm, runtime.luaEnv, RuntimeExecutionModeTournamentReset, nil, 0, "", "", "", "", "")

	tournamentTable := runtime.vm.CreateTable(0, 13)

	tournamentTable.RawSetString("id", lua.LString(tournament.Id))
	tournamentTable.RawSetString("title", lua.LString(tournament.Title))
	tournamentTable.RawSetString("description", lua.LString(tournament.Description))
	tournamentTable.RawSetString("category", lua.LNumber(tournament.Category))
	if tournament.SortOrder == LeaderboardSortOrderAscending {
		tournamentTable.RawSetString("sort_order", lua.LString("asc"))
	} else {
		tournamentTable.RawSetString("sort_order", lua.LString("desc"))
	}
	tournamentTable.RawSetString("size", lua.LNumber(tournament.Size))
	tournamentTable.RawSetString("max_size", lua.LNumber(tournament.MaxSize))
	tournamentTable.RawSetString("max_num_score", lua.LNumber(tournament.MaxNumScore))
	tournamentTable.RawSetString("can_enter", lua.LBool(tournament.CanEnter))
	tournamentTable.RawSetString("next_reset", lua.LNumber(tournament.NextReset))
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(runtime)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(runtime.vm, metadataMap)
	tournamentTable.RawSetString("metadata", metadataTable)
	tournamentTable.RawSetString("create_time", lua.LNumber(tournament.CreateTime.Seconds))
	tournamentTable.RawSetString("start_time", lua.LNumber(tournament.StartTime.Seconds))

	retValue, err, _ := runtime.invokeFunction(runtime.vm, lf, ctx, tournamentTable, lua.LNumber(end), lua.LNumber(reset))
	rp.Put(runtime)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament Reset hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament Reset hook, must be string or nil.")
}

func (rp *RuntimeProviderLua) LeaderboardReset(leaderboard runtime.Leaderboard, reset int64) error {
	runtime := rp.Get()
	lf := runtime.GetCallback(RuntimeExecutionModeLeaderboardReset, "")
	if lf == nil {
		rp.Put(runtime)
		return errors.New("Runtime Leaderboard Reset function not found.")
	}

	ctx := NewRuntimeLuaContext(runtime.vm, runtime.luaEnv, RuntimeExecutionModeLeaderboardReset, nil, 0, "", "", "", "", "")

	leaderboardTable := runtime.vm.CreateTable(0, 13)

	leaderboardTable.RawSetString("id", lua.LString(leaderboard.GetId()))
	leaderboardTable.RawSetString("authoritative", lua.LBool(leaderboard.GetAuthoritative()))
	leaderboardTable.RawSetString("sort_order", lua.LString(leaderboard.GetSortOrder()))
	leaderboardTable.RawSetString("operator", lua.LString(leaderboard.GetOperator()))
	leaderboardTable.RawSetString("reset", lua.LString(leaderboard.GetReset()))
	metadataTable := RuntimeLuaConvertMap(runtime.vm, leaderboard.GetMetadata())
	leaderboardTable.RawSetString("metadata", metadataTable)
	leaderboardTable.RawSetString("create_time", lua.LNumber(leaderboard.GetCreateTime()))

	retValue, err, _ := runtime.invokeFunction(runtime.vm, lf, ctx, leaderboardTable, lua.LNumber(reset))
	rp.Put(runtime)
	if err != nil {
		return fmt.Errorf("Error running runtime Leaderboard Reset hook: %v", err.Error())
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value needed.
		return nil
	}

	return errors.New("Unexpected return type from runtime Leaderboard Reset hook, must be string or nil.")
}

func (rp *RuntimeProviderLua) Get() *RuntimeLua {
	select {
	case r := <-rp.poolCh:
		// Ideally use an available idle runtime.
		return r
	default:
		// If there was no idle runtime, see if we can allocate a new one.
		rp.Lock()
		if rp.currentCount >= rp.maxCount {
			rp.Unlock()
			// If we've reached the max allowed allocation block on an available runtime.
			return <-rp.poolCh
		}
		// Inside the locked region now, last chance to use an available idle runtime.
		// Note: useful in case a runtime becomes available while waiting to acquire lock.
		select {
		case r := <-rp.poolCh:
			rp.Unlock()
			return r
		default:
			// Allocate a new runtime.
			rp.currentCount++
			rp.Unlock()
			stats.Record(rp.statsCtx, MetricsRuntimeCount.M(1))
			return rp.newFn()
		}
	}
}

func (rp *RuntimeProviderLua) Put(r *RuntimeLua) {
	select {
	case rp.poolCh <- r:
		// Runtime is successfully returned to the pool.
	default:
		// The pool is over capacity. Should never happen but guard anyway.
		// Safe to continue processing, the runtime is just discarded.
		rp.logger.Warn("Runtime pool full, discarding Lua runtime")
	}
}

type RuntimeLua struct {
	logger *zap.Logger
	vm     *lua.LState
	luaEnv *lua.LTable
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
		} else {
			r.vm.SetField(preload, module.Name, f)
			fns[module.Name] = f
		}
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

func (r *RuntimeLua) NewStateThread() (*lua.LState, context.CancelFunc) {
	return r.vm, nil
}

func (r *RuntimeLua) GetCallback(e RuntimeExecutionMode, key string) *lua.LFunction {
	cp := r.vm.Context().Value(RUNTIME_LUA_CALLBACKS).(*RuntimeLuaCallbacks)
	switch e {
	case RuntimeExecutionModeRPC:
		return cp.RPC[key]
	case RuntimeExecutionModeBefore:
		return cp.Before[key]
	case RuntimeExecutionModeAfter:
		return cp.After[key]
	case RuntimeExecutionModeMatchmaker:
		return cp.Matchmaker
	case RuntimeExecutionModeTournamentEnd:
		return cp.TournamentEnd
	case RuntimeExecutionModeTournamentReset:
		return cp.TournamentReset
	case RuntimeExecutionModeLeaderboardReset:
		return cp.LeaderboardReset
	}

	return nil
}

func (r *RuntimeLua) InvokeFunction(execMode RuntimeExecutionMode, fn *lua.LFunction, queryParams map[string][]string, uid string, username string, sessionExpiry int64, sid string, clientIP string, clientPort string, payload interface{}) (interface{}, error, codes.Code) {
	ctx := NewRuntimeLuaContext(r.vm, r.luaEnv, execMode, queryParams, sessionExpiry, uid, username, sid, clientIP, clientPort)
	var lv lua.LValue
	if payload != nil {
		lv = RuntimeLuaConvertValue(r.vm, payload)
	}

	retValue, err, code := r.invokeFunction(r.vm, fn, ctx, lv)
	if err != nil {
		return nil, err, code
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil, 0
	}

	return RuntimeLuaConvertLuaValue(retValue), nil, 0
}

func (r *RuntimeLua) invokeFunction(l *lua.LState, fn *lua.LFunction, ctx *lua.LTable, payloads ...lua.LValue) (lua.LValue, error, codes.Code) {
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
				return nil, err, codes.Internal
			case 1:
				apiError.Object = t.RawGetInt(1)
				return nil, err, codes.Internal
			default:
				// Ignore everything beyond the first 2 params, if there are more.
				apiError.Object = t.RawGetInt(1)
				code := codes.Internal
				if c := t.RawGetInt(2); c.Type() == lua.LTNumber {
					code = codes.Code(c.(lua.LNumber))
				}
				return nil, err, code
			}
		}

		return nil, err, codes.Internal
	}

	retValue := l.Get(-1)
	l.Pop(1)
	if retValue.Type() == LTSentinel {
		return nil, nil, 0
	}

	// Unwind the stack up to and including our sentinel value, effectively discarding any other returned parameters.
	for {
		v := l.Get(-1)
		l.Pop(1)
		if v.Type() == LTSentinel {
			break
		}
	}

	return retValue, nil, 0
}

func (r *RuntimeLua) Stop() {
	// Not necessarily required as it only does OS temp files cleanup, which we don't expose in the runtime.
	r.vm.Close()
}

func newRuntimeLuaVM(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler *LeaderboardScheduler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, moduleCache *RuntimeLuaModuleCache, once *sync.Once, localCache *RuntimeLuaLocalCache, matchCreateFn RuntimeMatchCreateFunction, announceCallback func(RuntimeExecutionMode, string)) (*RuntimeLua, error) {
	// Initialize a one-off runtime to ensure startup code runs and modules are valid.
	vm := lua.NewState(lua.Options{
		CallStackSize:       config.GetRuntime().CallStackSize,
		RegistrySize:        config.GetRuntime().RegistrySize,
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}
	nakamaModule := NewRuntimeLuaNakamaModule(logger, db, config, socialClient, leaderboardCache, rankCache, leaderboardScheduler, vm, sessionRegistry, matchRegistry, tracker, router, once, localCache, matchCreateFn, announceCallback)
	vm.PreloadModule("nakama", nakamaModule.Loader)
	r := &RuntimeLua{
		logger: logger,
		vm:     vm,
		luaEnv: RuntimeLuaConvertMapString(vm, config.GetRuntime().Environment),
	}

	return r, r.loadModules(moduleCache)
}
