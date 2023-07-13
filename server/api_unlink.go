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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

func (s *ApiServer) UnlinkApple(ctx context.Context, in *api.AccountApple) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkApple(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkApple(ctx, s.logger, s.db, s.config, s.socialClient, userID, in.Token)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkApple(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkCustom(ctx context.Context, in *api.AccountCustom) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkCustom(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkCustom(ctx, s.logger, s.db, userID, in.Id)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkCustom(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkDevice(ctx context.Context, in *api.AccountDevice) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkDevice(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkDevice(ctx, s.logger, s.db, userID, in.Id)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkDevice(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkEmail(ctx context.Context, in *api.AccountEmail) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkEmail(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkEmail(ctx, s.logger, s.db, userID, in.Email)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkEmail(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkFacebook(ctx context.Context, in *api.AccountFacebook) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkFacebook(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkFacebook(ctx, s.logger, s.db, s.socialClient, s.config.GetSocial().FacebookLimitedLogin.AppId, userID, in.Token)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkFacebook(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkFacebookInstantGame(ctx context.Context, in *api.AccountFacebookInstantGame) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkFacebookInstantGame(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkFacebookInstantGame(ctx, s.logger, s.db, s.config, s.socialClient, userID, in.SignedPlayerInfo)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkFacebookInstantGame(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkGameCenter(ctx context.Context, in *api.AccountGameCenter) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkGameCenter(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkGameCenter(ctx, s.logger, s.db, s.socialClient, userID, in.PlayerId, in.BundleId, in.TimestampSeconds, in.Salt, in.Signature, in.PublicKeyUrl)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkGameCenter(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkGoogle(ctx context.Context, in *api.AccountGoogle) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkGoogle(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkGoogle(ctx, s.logger, s.db, s.socialClient, userID, in.Token)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkGoogle(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) UnlinkSteam(ctx context.Context, in *api.AccountSteam) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeUnlinkSteam(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	err := UnlinkSteam(ctx, s.logger, s.db, s.config, s.socialClient, userID, in.Token)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterUnlinkSteam(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}
