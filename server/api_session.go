// Copyright 2021 The Nakama Authors
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

	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) SessionRefresh(ctx context.Context, in *api.SessionRefreshRequest) (*api.Session, error) {
	// Before hook.
	if fn := s.runtime.BeforeSessionRefresh(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, "", "", nil, 0, clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)))
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

	if in.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Refresh token is required.")
	}

	userID, username, vars, err := SessionRefresh(ctx, s.logger, s.db, s.config, in.Token)
	if err != nil {
		return nil, err
	}

	// Use updated vars if they are provided, otherwise use existing ones from refresh token.
	useVars := in.Vars
	if useVars == nil {
		useVars = vars
	}

	token, exp := generateToken(s.config, userID, username, useVars)
	session := &api.Session{Created: false, Token: token, RefreshToken: in.Token}

	// After hook.
	if fn := s.runtime.AfterSessionRefresh(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID, username, useVars, exp, clientIP, clientPort, session, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return session, nil
}
