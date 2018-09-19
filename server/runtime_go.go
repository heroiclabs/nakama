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
	"context"
	"database/sql"
	"errors"
	"log"
	"path/filepath"
	"plugin"
	"strings"
	"sync"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/runtime"
	"github.com/heroiclabs/nakama/social"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
)

// No need for a stateful RuntimeProviderGo here.

type RuntimeGoInitialiser struct {
	logger *log.Logger
	db     *sql.DB
	env    map[string]string
	nk     runtime.NakamaModule

	rpc               map[string]RuntimeRpcFunction
	beforeRt          map[string]RuntimeBeforeRtFunction
	afterRt           map[string]RuntimeAfterRtFunction
	beforeReq         *RuntimeBeforeReqFunctions
	afterReq          *RuntimeAfterReqFunctions
	matchmakerMatched RuntimeMatchmakerMatchedFunction
	tournamentEnd     RuntimeTournamentEndFunction
	tournamentReset   RuntimeTournamentResetFunction
	leaderboardReset  RuntimeLeaderboardResetFunction

	match     map[string]func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error)
	matchLock *sync.RWMutex
}

func (ri *RuntimeGoInitialiser) RegisterRpc(id string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error, int)) error {
	id = strings.ToLower(id)
	ri.rpc[id] = func(queryParams map[string][]string, userID, username string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeRPC, queryParams, expiry, userID, username, sessionID, clientIP, clientPort)
		result, fnErr, code := fn(ctx, ri.logger, ri.db, ri.nk, payload)
		return result, fnErr, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeRt(id string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error)) error {
	id = strings.ToLower(RTAPI_PREFIX + id)
	ri.beforeRt[id] = func(logger *zap.Logger, userID, username string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, sessionID, clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, envelope)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterRt(id string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, envelope *rtapi.Envelope) error) error {
	id = strings.ToLower(RTAPI_PREFIX + id)
	ri.afterRt[id] = func(logger *zap.Logger, userID, username string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, sessionID, clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, envelope)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeGetAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *empty.Empty) (*empty.Empty, error, int)) error {
	ri.beforeReq.beforeGetAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) (*empty.Empty, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterGetAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Account) error) error {
	ri.afterReq.afterGetAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Account) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUpdateAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, int)) error {
	ri.beforeReq.beforeUpdateAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUpdateAccount(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUpdateAccountFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAuthenticateSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, int)) error {
	ri.beforeReq.beforeAuthenticateSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAuthenticateSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session) error) error {
	ri.afterReq.afterAuthenticateSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Session) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListChannelMessages(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, int)) error {
	ri.beforeReq.beforeListChannelMessagesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListChannelMessages(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.ChannelMessageList) error) error {
	ri.afterReq.afterListChannelMessagesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ChannelMessageList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *empty.Empty) (*empty.Empty, error, int)) error {
	ri.beforeReq.beforeListFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) (*empty.Empty, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Friends) error) error {
	ri.afterReq.afterListFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Friends) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAddFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, int)) error {
	ri.beforeReq.beforeAddFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAddFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterAddFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeDeleteFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, int)) error {
	ri.beforeReq.beforeDeleteFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterDeleteFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterDeleteFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeBlockFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, int)) error {
	ri.beforeReq.beforeBlockFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterBlockFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterBlockFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeImportFacebookFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, int)) error {
	ri.beforeReq.beforeImportFacebookFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterImportFacebookFriends(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterImportFacebookFriendsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeCreateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, int)) error {
	ri.beforeReq.beforeCreateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterCreateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Group) error) error {
	ri.afterReq.afterCreateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Group) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUpdateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, int)) error {
	ri.beforeReq.beforeUpdateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUpdateGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUpdateGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeDeleteGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, int)) error {
	ri.beforeReq.beforeDeleteGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterDeleteGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterDeleteGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeJoinGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, int)) error {
	ri.beforeReq.beforeJoinGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterJoinGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterJoinGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLeaveGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, int)) error {
	ri.beforeReq.beforeLeaveGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLeaveGroup(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLeaveGroupFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeAddGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, int)) error {
	ri.beforeReq.beforeAddGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterAddGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterAddGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeKickGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, int)) error {
	ri.beforeReq.beforeKickGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterKickGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterKickGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforePromoteGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, int)) error {
	ri.beforeReq.beforePromoteGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterPromoteGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterPromoteGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, int)) error {
	ri.beforeReq.beforeListGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListGroupUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.GroupUserList) error) error {
	ri.afterReq.afterListGroupUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.GroupUserList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListUserGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, int)) error {
	ri.beforeReq.beforeListUserGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListUserGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.UserGroupList) error) error {
	ri.afterReq.afterListUserGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.UserGroupList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, int)) error {
	ri.beforeReq.beforeListGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListGroups(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.GroupList) error) error {
	ri.afterReq.afterListGroupsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.GroupList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeDeleteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, int)) error {
	ri.beforeReq.beforeDeleteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterDeleteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterDeleteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListLeaderboardRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, int)) error {
	ri.beforeReq.beforeListLeaderboardRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListLeaderboardRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecordList) error) error {
	ri.afterReq.afterListLeaderboardRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LeaderboardRecordList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeWriteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, int)) error {
	ri.beforeReq.beforeWriteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterWriteLeaderboardRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecord) error) error {
	ri.afterReq.afterWriteLeaderboardRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LeaderboardRecord) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, int)) error {
	ri.beforeReq.beforeListLeaderboardRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecordList) error) error {
	ri.afterReq.afterListLeaderboardRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LeaderboardRecordList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error, int)) error {
	ri.beforeReq.beforeLinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error, int)) error {
	ri.beforeReq.beforeLinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error, int)) error {
	ri.beforeReq.beforeLinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, int)) error {
	ri.beforeReq.beforeLinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error, int)) error {
	ri.beforeReq.beforeLinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error, int)) error {
	ri.beforeReq.beforeLinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeLinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error, int)) error {
	ri.beforeReq.beforeLinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterLinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterLinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListMatches(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, int)) error {
	ri.beforeReq.beforeListMatchesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListMatches(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.MatchList) error) error {
	ri.afterReq.afterListMatchesFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.MatchList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListNotifications(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, int)) error {
	ri.beforeReq.beforeListNotificationsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListNotifications(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.NotificationList) error) error {
	ri.afterReq.afterListNotificationsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.NotificationList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeDeleteNotification(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, int)) error {
	ri.beforeReq.beforeDeleteNotificationFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterDeleteNotification(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterDeleteNotificationFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, int)) error {
	ri.beforeReq.beforeListStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.StorageObjectList) error) error {
	ri.afterReq.afterListStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.StorageObjectList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeReadStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, int)) error {
	ri.beforeReq.beforeReadStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterReadStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.StorageObjects) error) error {
	ri.afterReq.afterReadStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.StorageObjects) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeWriteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, int)) error {
	ri.beforeReq.beforeWriteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterWriteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.StorageObjectAcks) error) error {
	ri.afterReq.afterWriteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.StorageObjectAcks) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeDeleteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, int)) error {
	ri.beforeReq.beforeDeleteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterDeleteStorageObjects(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterDeleteStorageObjectsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeJoinTournament(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, int)) error {
	ri.beforeReq.beforeJoinTournamentFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterJoinTournament(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterJoinTournamentFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListTournamentRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, int)) error {
	ri.beforeReq.beforeListTournamentRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListTournamentRecords(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.TournamentRecordList) error) error {
	ri.afterReq.afterListTournamentRecordsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.TournamentRecordList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListTournaments(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, int)) error {
	ri.beforeReq.beforeListTournamentsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListTournaments(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.TournamentList) error) error {
	ri.afterReq.afterListTournamentsFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.TournamentList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeWriteTournamentRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, int)) error {
	ri.beforeReq.beforeWriteTournamentRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterWriteTournamentRecord(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecord) error) error {
	ri.afterReq.afterWriteTournamentRecordFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.LeaderboardRecord) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, int)) error {
	ri.beforeReq.beforeListTournamentRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.TournamentRecordList) error) error {
	ri.afterReq.afterListTournamentRecordsAroundOwnerFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.TournamentRecordList) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error, int)) error {
	ri.beforeReq.beforeUnlinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkCustom(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkCustomFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error, int)) error {
	ri.beforeReq.beforeUnlinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkDevice(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkDeviceFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error, int)) error {
	ri.beforeReq.beforeUnlinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkEmail(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkEmailFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebook) (*api.AccountFacebook, error, int)) error {
	ri.beforeReq.beforeUnlinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) (*api.AccountFacebook, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkFacebook(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkFacebookFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error, int)) error {
	ri.beforeReq.beforeUnlinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkGameCenter(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkGameCenterFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error, int)) error {
	ri.beforeReq.beforeUnlinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkGoogle(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkGoogleFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeUnlinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error, int)) error {
	ri.beforeReq.beforeUnlinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterUnlinkSteam(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *empty.Empty) error) error {
	ri.afterReq.afterUnlinkSteamFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *empty.Empty) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterBeforeGetUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.GetUsersRequest) (*api.GetUsersRequest, error, int)) error {
	ri.beforeReq.beforeGetUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.GetUsersRequest) (*api.GetUsersRequest, error, codes.Code) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, "", clientIP, clientPort)
		result, err, code := fn(ctx, ri.logger, ri.db, ri.nk, in)
		return result, err, codes.Code(code)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterAfterGetUsers(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Users) error) error {
	ri.afterReq.afterGetUsersFunction = func(logger *zap.Logger, userID, username string, expiry int64, clientIP, clientPort string, in *api.Users) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterMatchmakerMatched(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error)) error {
	ri.matchmakerMatched = func(entries []*MatchmakerEntry) (string, bool, error) {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeMatchmaker, nil, 0, "", "", "", "", "")
		runtimeEntries := make([]runtime.MatchmakerEntry, len(entries))
		for i, entry := range entries {
			runtimeEntries[i] = runtime.MatchmakerEntry(entry)
		}
		matchID, err := fn(ctx, ri.logger, ri.db, ri.nk, runtimeEntries)
		if err != nil {
			return "", false, err
		}
		return matchID, matchID != "", nil
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterTournamentEnd(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, tournament *api.Tournament, end, reset int64) error) error {
	ri.tournamentEnd = func(tournament *api.Tournament, end, reset int64) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeTournamentEnd, nil, 0, "", "", "", "", "")
		return fn(ctx, ri.logger, ri.db, ri.nk, tournament, end, reset)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterTournamentReset(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, tournament *api.Tournament, end, reset int64) error) error {
	ri.tournamentReset = func(tournament *api.Tournament, end, reset int64) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeTournamentReset, nil, 0, "", "", "", "", "")
		return fn(ctx, ri.logger, ri.db, ri.nk, tournament, end, reset)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterLeaderboardReset(fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule, leaderboard runtime.Leaderboard, reset int64) error) error {
	ri.leaderboardReset = func(leaderboard runtime.Leaderboard, reset int64) error {
		ctx := NewRuntimeGoContext(ri.env, RuntimeExecutionModeLeaderboardReset, nil, 0, "", "", "", "", "")
		return fn(ctx, ri.logger, ri.db, ri.nk, leaderboard, reset)
	}
	return nil
}

func (ri *RuntimeGoInitialiser) RegisterMatch(name string, fn func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error)) error {
	ri.matchLock.Lock()
	ri.match[name] = fn
	ri.matchLock.Unlock()
	return nil
}

func NewRuntimeProviderGo(logger, startupLogger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler *LeaderboardScheduler, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, rootPath string, paths []string) ([]string, map[string]RuntimeRpcFunction, map[string]RuntimeBeforeRtFunction, map[string]RuntimeAfterRtFunction, *RuntimeBeforeReqFunctions, *RuntimeAfterReqFunctions, RuntimeMatchmakerMatchedFunction, RuntimeMatchCreateFunction, RuntimeTournamentEndFunction, RuntimeTournamentResetFunction, RuntimeLeaderboardResetFunction, func(RuntimeMatchCreateFunction), func() []string, error) {
	stdLogger := zap.NewStdLog(logger)
	env := config.GetRuntime().Environment
	nk := NewRuntimeGoNakamaModule(logger, db, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, router)

	match := make(map[string]func(ctx context.Context, logger *log.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error), 0)
	matchLock := &sync.RWMutex{}
	matchCreateFn := func(logger *zap.Logger, id uuid.UUID, node string, name string, labelUpdateFn func(string)) (RuntimeMatchCore, error) {
		matchLock.RLock()
		fn, ok := match[name]
		matchLock.RUnlock()
		if !ok {
			// Not a Go match.
			return nil, nil
		}

		ctx := NewRuntimeGoContext(env, RuntimeExecutionModeMatchCreate, nil, 0, "", "", "", "", "")
		match, err := fn(ctx, stdLogger, db, nk)
		if err != nil {
			return nil, err
		}

		return NewRuntimeGoMatchCore(logger, matchRegistry, tracker, router, id, node, labelUpdateFn, stdLogger, db, env, nk, match)
	}
	nk.SetMatchCreateFn(matchCreateFn)
	matchNamesListFn := func() []string {
		matchLock.RLock()
		matchNames := make([]string, 0, len(match))
		for name, _ := range match {
			matchNames = append(matchNames, name)
		}
		matchLock.RUnlock()
		return matchNames
	}

	initializer := &RuntimeGoInitialiser{
		logger: stdLogger,
		db:     db,
		env:    env,
		nk:     nk,

		rpc: make(map[string]RuntimeRpcFunction, 0),

		beforeRt: make(map[string]RuntimeBeforeRtFunction, 0),
		afterRt:  make(map[string]RuntimeAfterRtFunction, 0),

		beforeReq: &RuntimeBeforeReqFunctions{},
		afterReq:  &RuntimeAfterReqFunctions{},

		match:     match,
		matchLock: matchLock,
	}

	modulePaths := make([]string, 0)
	for _, path := range paths {
		if strings.ToLower(filepath.Ext(path)) != ".so" {
			continue
		}

		relPath, _ := filepath.Rel(rootPath, path)
		name := strings.TrimSuffix(relPath, filepath.Ext(relPath))

		// Open the plugin.
		p, err := plugin.Open(path)
		if err != nil {
			startupLogger.Error("Could not open Go module", zap.String("path", path), zap.Error(err))
			return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
		}

		// Look up the required initialisation function.
		f, err := p.Lookup("InitModule")
		if err != nil {
			startupLogger.Fatal("Error looking up InitModule function in Go module", zap.String("name", name))
			return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
		}

		// Ensure the function has the correct signature.
		fn, ok := f.(func(context.Context, *log.Logger, *sql.DB, runtime.NakamaModule, runtime.Initializer))
		if !ok {
			startupLogger.Fatal("Error reading InitModule function in Go module", zap.String("name", name))
			return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, errors.New("error reading InitModule function in Go module")
		}

		// Run the initialisation.
		fn(context.Background(), stdLogger, db, nk, initializer)
		modulePaths = append(modulePaths, relPath)
	}

	return modulePaths, initializer.rpc, initializer.beforeRt, initializer.afterRt, initializer.beforeReq, initializer.afterReq, initializer.matchmakerMatched, matchCreateFn, initializer.tournamentEnd, initializer.tournamentReset, initializer.leaderboardReset, nk.SetMatchCreateFn, matchNamesListFn, nil
}
