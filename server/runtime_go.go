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
	"github.com/golang/protobuf/jsonpb"
	"go.uber.org/atomic"
	"path/filepath"
	"plugin"
	"strings"
	"sync"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v2/social"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
)

// No need for a stateful RuntimeProviderGo here.

type RuntimeGoInitializer struct {
	logger runtime.Logger
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

	eventFunctions        []RuntimeEventFunction
	sessionStartFunctions []RuntimeEventFunction
	sessionEndFunctions   []RuntimeEventFunction

	match     map[string]func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error)
	matchLock *sync.RWMutex
}

func (ri *RuntimeGoInitializer) RegisterEvent(fn func(ctx context.Context, logger runtime.Logger, evt *api.Event)) error {
	ri.eventFunctions = append(ri.eventFunctions, fn)
	return nil
}

func (ri *RuntimeGoInitializer) RegisterEventSessionStart(fn func(ctx context.Context, logger runtime.Logger, evt *api.Event)) error {
	ri.sessionStartFunctions = append(ri.sessionStartFunctions, fn)
	return nil
}

func (ri *RuntimeGoInitializer) RegisterEventSessionEnd(fn func(ctx context.Context, logger runtime.Logger, evt *api.Event)) error {
	ri.sessionEndFunctions = append(ri.sessionEndFunctions, fn)
	return nil
}

func (ri *RuntimeGoInitializer) RegisterRpc(id string, fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error)) error {
	id = strings.ToLower(id)
	ri.rpc[id] = func(ctx context.Context, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeRPC, queryParams, expiry, userID, username, vars, sessionID, clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, payload)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeRt(id string, fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, envelope *rtapi.Envelope) (*rtapi.Envelope, error)) error {
	id = strings.ToLower(RTAPI_PREFIX + id)
	ri.beforeRt[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, sessionID, clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, envelope)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterRt(id string, fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, envelope *rtapi.Envelope) error) error {
	id = strings.ToLower(RTAPI_PREFIX + id)
	ri.afterRt[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, sessionID, clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, envelope)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeGetAccount(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) error) error {
	ri.beforeReq.beforeGetAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		fnErr := fn(ctx, ri.logger, ri.db, ri.nk)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return runtimeErr, codes.Internal
				}
				return runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return fnErr, codes.Internal
		}
		return nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterGetAccount(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Account) error) error {
	ri.afterReq.afterGetAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Account) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUpdateAccount(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error)) error {
	ri.beforeReq.beforeUpdateAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUpdateAccount(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.UpdateAccountRequest) error) error {
	ri.afterReq.afterUpdateAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateCustom(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error)) error {
	ri.beforeReq.beforeAuthenticateCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateCustom(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateCustomRequest) error) error {
	ri.afterReq.afterAuthenticateCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateCustomRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateDevice(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error)) error {
	ri.beforeReq.beforeAuthenticateDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateDevice(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateDeviceRequest) error) error {
	ri.afterReq.afterAuthenticateDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateDeviceRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateEmail(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error)) error {
	ri.beforeReq.beforeAuthenticateEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateEmail(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateEmailRequest) error) error {
	ri.afterReq.afterAuthenticateEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateEmailRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateFacebook(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error)) error {
	ri.beforeReq.beforeAuthenticateFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateFacebook(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateFacebookRequest) error) error {
	ri.afterReq.afterAuthenticateFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateFacebookInstantGame(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateFacebookInstantGameRequest) (*api.AuthenticateFacebookInstantGameRequest, error)) error {
	ri.beforeReq.beforeAuthenticateFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookInstantGameRequest) (*api.AuthenticateFacebookInstantGameRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateFacebookInstantGame(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateFacebookInstantGameRequest) error) error {
	ri.afterReq.afterAuthenticateFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookInstantGameRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateGameCenter(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error)) error {
	ri.beforeReq.beforeAuthenticateGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateGameCenter(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateGameCenterRequest) error) error {
	ri.afterReq.afterAuthenticateGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGameCenterRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateGoogle(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error)) error {
	ri.beforeReq.beforeAuthenticateGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateGoogle(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateGoogleRequest) error) error {
	ri.afterReq.afterAuthenticateGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGoogleRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAuthenticateSteam(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error)) error {
	ri.beforeReq.beforeAuthenticateSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAuthenticateSteam(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Session, in *api.AuthenticateSteamRequest) error) error {
	ri.afterReq.afterAuthenticateSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateSteamRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListChannelMessages(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error)) error {
	ri.beforeReq.beforeListChannelMessagesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListChannelMessages(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.ChannelMessageList, in *api.ListChannelMessagesRequest) error) error {
	ri.afterReq.afterListChannelMessagesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ChannelMessageList, in *api.ListChannelMessagesRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListFriendsRequest) (*api.ListFriendsRequest, error)) error {
	ri.beforeReq.beforeListFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListFriendsRequest) (*api.ListFriendsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.FriendList) error) error {
	ri.afterReq.afterListFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.FriendList) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAddFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error)) error {
	ri.beforeReq.beforeAddFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAddFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AddFriendsRequest) error) error {
	ri.afterReq.afterAddFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeDeleteFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error)) error {
	ri.beforeReq.beforeDeleteFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterDeleteFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteFriendsRequest) error) error {
	ri.afterReq.afterDeleteFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeBlockFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error)) error {
	ri.beforeReq.beforeBlockFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterBlockFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.BlockFriendsRequest) error) error {
	ri.afterReq.afterBlockFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeImportFacebookFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error)) error {
	ri.beforeReq.beforeImportFacebookFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterImportFacebookFriends(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ImportFacebookFriendsRequest) error) error {
	ri.afterReq.afterImportFacebookFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeCreateGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error)) error {
	ri.beforeReq.beforeCreateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterCreateGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Group, in *api.CreateGroupRequest) error) error {
	ri.afterReq.afterCreateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Group, in *api.CreateGroupRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUpdateGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error)) error {
	ri.beforeReq.beforeUpdateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUpdateGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.UpdateGroupRequest) error) error {
	ri.afterReq.afterUpdateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeDeleteGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error)) error {
	ri.beforeReq.beforeDeleteGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterDeleteGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteGroupRequest) error) error {
	ri.afterReq.afterDeleteGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeJoinGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error)) error {
	ri.beforeReq.beforeJoinGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterJoinGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.JoinGroupRequest) error) error {
	ri.afterReq.afterJoinGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLeaveGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error)) error {
	ri.beforeReq.beforeLeaveGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLeaveGroup(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.LeaveGroupRequest) error) error {
	ri.afterReq.afterLeaveGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeAddGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error)) error {
	ri.beforeReq.beforeAddGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterAddGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AddGroupUsersRequest) error) error {
	ri.afterReq.afterAddGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeBanGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.BanGroupUsersRequest) (*api.BanGroupUsersRequest, error)) error {
	ri.beforeReq.beforeBanGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) (*api.BanGroupUsersRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterBanGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.BanGroupUsersRequest) error) error {
	ri.afterReq.afterBanGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeKickGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error)) error {
	ri.beforeReq.beforeKickGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterKickGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.KickGroupUsersRequest) error) error {
	ri.afterReq.afterKickGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforePromoteGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error)) error {
	ri.beforeReq.beforePromoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterPromoteGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.PromoteGroupUsersRequest) error) error {
	ri.afterReq.afterPromoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error)) error {
	ri.beforeReq.beforeListGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListGroupUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.GroupUserList, in *api.ListGroupUsersRequest) error) error {
	ri.afterReq.afterListGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupUserList, in *api.ListGroupUsersRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListUserGroups(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error)) error {
	ri.beforeReq.beforeListUserGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListUserGroups(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.UserGroupList, in *api.ListUserGroupsRequest) error) error {
	ri.afterReq.afterListUserGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.UserGroupList, in *api.ListUserGroupsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListGroups(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error)) error {
	ri.beforeReq.beforeListGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListGroups(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.GroupList, in *api.ListGroupsRequest) error) error {
	ri.afterReq.afterListGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupList, in *api.ListGroupsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeDeleteLeaderboardRecord(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error)) error {
	ri.beforeReq.beforeDeleteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterDeleteLeaderboardRecord(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteLeaderboardRecordRequest) error) error {
	ri.afterReq.afterDeleteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListLeaderboardRecords(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error)) error {
	ri.beforeReq.beforeListLeaderboardRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListLeaderboardRecords(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error) error {
	ri.afterReq.afterListLeaderboardRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeWriteLeaderboardRecord(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error)) error {
	ri.beforeReq.beforeWriteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterWriteLeaderboardRecord(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error) error {
	ri.afterReq.afterWriteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error)) error {
	ri.beforeReq.beforeListLeaderboardRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListLeaderboardRecordsAroundOwner(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error) error {
	ri.afterReq.afterListLeaderboardRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkCustom(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error)) error {
	ri.beforeReq.beforeLinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkCustom(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountCustom) error) error {
	ri.afterReq.afterLinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkDevice(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error)) error {
	ri.beforeReq.beforeLinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkDevice(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountDevice) error) error {
	ri.afterReq.afterLinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkEmail(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error)) error {
	ri.beforeReq.beforeLinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkEmail(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountEmail) error) error {
	ri.afterReq.afterLinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkFacebook(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error)) error {
	ri.beforeReq.beforeLinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkFacebook(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.LinkFacebookRequest) error) error {
	ri.afterReq.afterLinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkFacebookInstantGame(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error)) error {
	ri.beforeReq.beforeLinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkFacebookInstantGame(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebookInstantGame) error) error {
	ri.afterReq.afterLinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkGameCenter(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error)) error {
	ri.beforeReq.beforeLinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkGameCenter(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGameCenter) error) error {
	ri.afterReq.afterLinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkGoogle(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error)) error {
	ri.beforeReq.beforeLinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkGoogle(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGoogle) error) error {
	ri.afterReq.afterLinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeLinkSteam(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error)) error {
	ri.beforeReq.beforeLinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterLinkSteam(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountSteam) error) error {
	ri.afterReq.afterLinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListMatches(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error)) error {
	ri.beforeReq.beforeListMatchesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListMatches(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.MatchList, in *api.ListMatchesRequest) error) error {
	ri.afterReq.afterListMatchesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchList, in *api.ListMatchesRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListNotifications(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error)) error {
	ri.beforeReq.beforeListNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListNotifications(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.NotificationList, in *api.ListNotificationsRequest) error) error {
	ri.afterReq.afterListNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.NotificationList, in *api.ListNotificationsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeDeleteNotification(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error)) error {
	ri.beforeReq.beforeDeleteNotificationFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterDeleteNotification(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteNotificationsRequest) error) error {
	ri.afterReq.afterDeleteNotificationFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error)) error {
	ri.beforeReq.beforeListStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.StorageObjectList, in *api.ListStorageObjectsRequest) error) error {
	ri.afterReq.afterListStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectList, in *api.ListStorageObjectsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeReadStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error)) error {
	ri.beforeReq.beforeReadStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterReadStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.StorageObjects, in *api.ReadStorageObjectsRequest) error) error {
	ri.afterReq.afterReadStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjects, in *api.ReadStorageObjectsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeWriteStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error)) error {
	ri.beforeReq.beforeWriteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterWriteStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.StorageObjectAcks, in *api.WriteStorageObjectsRequest) error) error {
	ri.afterReq.afterWriteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectAcks, in *api.WriteStorageObjectsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeDeleteStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error)) error {
	ri.beforeReq.beforeDeleteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterDeleteStorageObjects(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.DeleteStorageObjectsRequest) error) error {
	ri.afterReq.afterDeleteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeJoinTournament(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error)) error {
	ri.beforeReq.beforeJoinTournamentFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterJoinTournament(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.JoinTournamentRequest) error) error {
	ri.afterReq.afterJoinTournamentFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListTournamentRecords(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error)) error {
	ri.beforeReq.beforeListTournamentRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListTournamentRecords(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.TournamentRecordList, in *api.ListTournamentRecordsRequest) error) error {
	ri.afterReq.afterListTournamentRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListTournaments(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error)) error {
	ri.beforeReq.beforeListTournamentsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListTournaments(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.TournamentList, in *api.ListTournamentsRequest) error) error {
	ri.afterReq.afterListTournamentsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentList, in *api.ListTournamentsRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeWriteTournamentRecord(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error)) error {
	ri.beforeReq.beforeWriteTournamentRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterWriteTournamentRecord(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.LeaderboardRecord, in *api.WriteTournamentRecordRequest) error) error {
	ri.afterReq.afterWriteTournamentRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteTournamentRecordRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error)) error {
	ri.beforeReq.beforeListTournamentRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterListTournamentRecordsAroundOwner(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.TournamentRecordList, in *api.ListTournamentRecordsAroundOwnerRequest) error) error {
	ri.afterReq.afterListTournamentRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsAroundOwnerRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkCustom(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountCustom) (*api.AccountCustom, error)) error {
	ri.beforeReq.beforeUnlinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkCustom(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountCustom) error) error {
	ri.afterReq.afterUnlinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkDevice(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountDevice) (*api.AccountDevice, error)) error {
	ri.beforeReq.beforeUnlinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkDevice(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountDevice) error) error {
	ri.afterReq.afterUnlinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkEmail(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountEmail) (*api.AccountEmail, error)) error {
	ri.beforeReq.beforeUnlinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkEmail(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountEmail) error) error {
	ri.afterReq.afterUnlinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkFacebook(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebook) (*api.AccountFacebook, error)) error {
	ri.beforeReq.beforeUnlinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) (*api.AccountFacebook, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkFacebook(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebook) error) error {
	ri.afterReq.afterUnlinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkFacebookInstantGame(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error)) error {
	ri.beforeReq.beforeUnlinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkFacebookInstantGame(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountFacebookInstantGame) error) error {
	ri.afterReq.afterUnlinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkGameCenter(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGameCenter) (*api.AccountGameCenter, error)) error {
	ri.beforeReq.beforeUnlinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkGameCenter(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGameCenter) error) error {
	ri.afterReq.afterUnlinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkGoogle(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGoogle) (*api.AccountGoogle, error)) error {
	ri.beforeReq.beforeUnlinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkGoogle(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountGoogle) error) error {
	ri.afterReq.afterUnlinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeUnlinkSteam(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountSteam) (*api.AccountSteam, error)) error {
	ri.beforeReq.beforeUnlinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterUnlinkSteam(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.AccountSteam) error) error {
	ri.afterReq.afterUnlinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeGetUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.GetUsersRequest) (*api.GetUsersRequest, error)) error {
	ri.beforeReq.beforeGetUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetUsersRequest) (*api.GetUsersRequest, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterGetUsers(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out *api.Users, in *api.GetUsersRequest) error) error {
	ri.afterReq.afterGetUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Users, in *api.GetUsersRequest) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, out, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterBeforeEvent(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.Event) (*api.Event, error)) error {
	ri.beforeReq.beforeEventFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) (*api.Event, error, codes.Code) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeBefore, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		result, fnErr := fn(ctx, ri.logger, ri.db, ri.nk, in)
		if fnErr != nil {
			if runtimeErr, ok := fnErr.(*runtime.Error); ok {
				if runtimeErr.Code <= 0 || runtimeErr.Code >= 17 {
					// If error is present but code is invalid then default to 13 (Internal) as the error code.
					return result, runtimeErr, codes.Internal
				}
				return result, runtimeErr, codes.Code(runtimeErr.Code)
			}
			// Not a runtime error that contains a code.
			return result, fnErr, codes.Internal
		}
		return result, nil, codes.OK
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterAfterEvent(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, in *api.Event) error) error {
	ri.afterReq.afterEventFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeAfter, nil, expiry, userID, username, vars, "", clientIP, clientPort)
		return fn(ctx, ri.logger, ri.db, ri.nk, in)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterMatchmakerMatched(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error)) error {
	ri.matchmakerMatched = func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error) {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeMatchmaker, nil, 0, "", "", nil, "", "", "")
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

func (ri *RuntimeGoInitializer) RegisterTournamentEnd(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, tournament *api.Tournament, end, reset int64) error) error {
	ri.tournamentEnd = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeTournamentEnd, nil, 0, "", "", nil, "", "", "")
		return fn(ctx, ri.logger, ri.db, ri.nk, tournament, end, reset)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterTournamentReset(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, tournament *api.Tournament, end, reset int64) error) error {
	ri.tournamentReset = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeTournamentReset, nil, 0, "", "", nil, "", "", "")
		return fn(ctx, ri.logger, ri.db, ri.nk, tournament, end, reset)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterLeaderboardReset(fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, leaderboard runtime.Leaderboard, reset int64) error) error {
	ri.leaderboardReset = func(ctx context.Context, leaderboard runtime.Leaderboard, reset int64) error {
		ctx = NewRuntimeGoContext(ctx, ri.env, RuntimeExecutionModeLeaderboardReset, nil, 0, "", "", nil, "", "", "")
		return fn(ctx, ri.logger, ri.db, ri.nk, leaderboard, reset)
	}
	return nil
}

func (ri *RuntimeGoInitializer) RegisterMatch(name string, fn func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error)) error {
	ri.matchLock.Lock()
	ri.match[name] = fn
	ri.matchLock.Unlock()
	return nil
}

func NewRuntimeProviderGo(logger, startupLogger *zap.Logger, db *sql.DB, jsonpbMarshaler *jsonpb.Marshaler, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, streamManager StreamManager, router MessageRouter, rootPath string, paths []string, eventQueue *RuntimeEventQueue) ([]string, map[string]RuntimeRpcFunction, map[string]RuntimeBeforeRtFunction, map[string]RuntimeAfterRtFunction, *RuntimeBeforeReqFunctions, *RuntimeAfterReqFunctions, RuntimeMatchmakerMatchedFunction, RuntimeMatchCreateFunction, RuntimeTournamentEndFunction, RuntimeTournamentResetFunction, RuntimeLeaderboardResetFunction, *RuntimeEventFunctions, func(RuntimeMatchCreateFunction), func() []string, error) {
	runtimeLogger := NewRuntimeGoLogger(logger)
	env := config.GetRuntime().Environment
	nk := NewRuntimeGoNakamaModule(logger, db, jsonpbMarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, leaderboardScheduler, sessionRegistry, matchRegistry, tracker, streamManager, router)

	match := make(map[string]func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule) (runtime.Match, error), 0)
	matchLock := &sync.RWMutex{}
	matchCreateFn := func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
		matchLock.RLock()
		fn, ok := match[name]
		matchLock.RUnlock()
		if !ok {
			// Not a Go match.
			return nil, nil
		}

		ctx = NewRuntimeGoContext(ctx, env, RuntimeExecutionModeMatchCreate, nil, 0, "", "", nil, "", "", "")
		match, err := fn(ctx, runtimeLogger, db, nk)
		if err != nil {
			return nil, err
		}

		return NewRuntimeGoMatchCore(logger, matchRegistry, router, id, node, stopped, db, env, nk, match)
	}
	nk.SetMatchCreateFn(matchCreateFn)
	matchNamesListFn := func() []string {
		matchLock.RLock()
		matchNames := make([]string, 0, len(match))
		for name := range match {
			matchNames = append(matchNames, name)
		}
		matchLock.RUnlock()
		return matchNames
	}

	initializer := &RuntimeGoInitializer{
		logger: runtimeLogger,
		db:     db,
		env:    env,
		nk:     nk,

		rpc: make(map[string]RuntimeRpcFunction, 0),

		beforeRt: make(map[string]RuntimeBeforeRtFunction, 0),
		afterRt:  make(map[string]RuntimeAfterRtFunction, 0),

		beforeReq: &RuntimeBeforeReqFunctions{},
		afterReq:  &RuntimeAfterReqFunctions{},

		eventFunctions:        make([]RuntimeEventFunction, 0),
		sessionStartFunctions: make([]RuntimeEventFunction, 0),
		sessionEndFunctions:   make([]RuntimeEventFunction, 0),

		match:     match,
		matchLock: matchLock,
	}

	// The baseline context that will be passed to all InitModule calls.
	ctx := NewRuntimeGoContext(context.Background(), env, RuntimeExecutionModeRunOnce, nil, 0, "", "", nil, "", "", "")

	startupLogger.Info("Initialising Go runtime provider", zap.String("path", rootPath))

	modulePaths := make([]string, 0)
	for _, path := range paths {
		// Skip everything except shared object files.
		if strings.ToLower(filepath.Ext(path)) != ".so" {
			continue
		}

		// Open the plugin, and look up the required initialisation function.
		relPath, name, fn, err := openGoModule(startupLogger, rootPath, path)
		if err != nil {
			// Errors are already logged in the function above.
			return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
		}

		// Run the initialisation.
		if err = fn(ctx, runtimeLogger, db, nk, initializer); err != nil {
			startupLogger.Fatal("Error returned by InitModule function in Go module", zap.String("name", name), zap.Error(err))
			return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, errors.New("error returned by InitModule function in Go module")
		}
		modulePaths = append(modulePaths, relPath)
	}

	startupLogger.Info("Go runtime modules loaded")

	events := &RuntimeEventFunctions{}
	if len(initializer.eventFunctions) > 0 {
		events.eventFunction = func(ctx context.Context, evt *api.Event) {
			eventQueue.Queue(func() {
				for _, fn := range initializer.eventFunctions {
					fn(ctx, initializer.logger, evt)
				}
			})
		}
		nk.SetEventFn(events.eventFunction)
	}
	if len(initializer.sessionStartFunctions) > 0 {
		events.sessionStartFunction = func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, evtTimeSec int64) {
			ctx := NewRuntimeGoContext(context.Background(), initializer.env, RuntimeExecutionModeEvent, nil, expiry, userID, username, vars, sessionID, clientIP, clientPort)
			evt := &api.Event{
				Name:      "session_start",
				Timestamp: &timestamp.Timestamp{Seconds: evtTimeSec},
			}
			eventQueue.Queue(func() {
				for _, fn := range initializer.sessionStartFunctions {
					fn(ctx, initializer.logger, evt)
				}
			})
		}
	}
	if len(initializer.sessionEndFunctions) > 0 {
		events.sessionEndFunction = func(userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, evtTimeSec int64, reason string) {
			ctx := NewRuntimeGoContext(context.Background(), initializer.env, RuntimeExecutionModeEvent, nil, expiry, userID, username, vars, sessionID, clientIP, clientPort)
			evt := &api.Event{
				Name:       "session_end",
				Properties: map[string]string{"reason": reason},
				Timestamp:  &timestamp.Timestamp{Seconds: evtTimeSec},
			}
			eventQueue.Queue(func() {
				for _, fn := range initializer.sessionEndFunctions {
					fn(ctx, initializer.logger, evt)
				}
			})
		}
	}

	return modulePaths, initializer.rpc, initializer.beforeRt, initializer.afterRt, initializer.beforeReq, initializer.afterReq, initializer.matchmakerMatched, matchCreateFn, initializer.tournamentEnd, initializer.tournamentReset, initializer.leaderboardReset, events, nk.SetMatchCreateFn, matchNamesListFn, nil
}

func CheckRuntimeProviderGo(logger *zap.Logger, rootPath string, paths []string) error {
	for _, path := range paths {
		// Skip everything except shared object files.
		if strings.ToLower(filepath.Ext(path)) != ".so" {
			continue
		}

		// Open the plugin, and look up the required initialisation function.
		// The function isn't used here, all we need is a type/signature check.
		_, _, _, err := openGoModule(logger, rootPath, path)
		if err != nil {
			// Errors are already logged in the function above.
			return err
		}
	}

	return nil
}

func openGoModule(logger *zap.Logger, rootPath, path string) (string, string, func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, runtime.Initializer) error, error) {
	relPath, _ := filepath.Rel(rootPath, path)
	name := strings.TrimSuffix(relPath, filepath.Ext(relPath))

	// Open the plugin.
	p, err := plugin.Open(path)
	if err != nil {
		logger.Error("Could not open Go module", zap.String("path", path), zap.Error(err))
		return "", "", nil, err
	}

	// Look up the required initialisation function.
	f, err := p.Lookup("InitModule")
	if err != nil {
		logger.Fatal("Error looking up InitModule function in Go module", zap.String("name", name))
		return "", "", nil, err
	}

	// Ensure the function has the correct signature.
	fn, ok := f.(func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, runtime.Initializer) error)
	if !ok {
		logger.Fatal("Error reading InitModule function in Go module", zap.String("name", name))
		return "", "", nil, errors.New("error reading InitModule function in Go module")
	}

	return relPath, name, fn, nil
}
