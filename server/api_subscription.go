// Copyright 2022 The Nakama Authors
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
	"errors"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/server/plugins/iap/google"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *ApiServer) ValidateSubscriptionApple(ctx context.Context, in *api.ValidateSubscriptionAppleRequest) (*api.ValidateSubscriptionResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	// Before hook.
	if fn := s.runtime.BeforeValidateSubscriptionApple(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if s.config.GetIAP().Apple.SharedPassword == "" {
		return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	}

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	validated, err := ValidateSubscription(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID, traceID, "apple", map[string]any{"receipt": in.Receipt}, nil, persist)
	if err != nil {
		return nil, err
	}
	validation := &api.ValidateSubscriptionResponse{ValidatedSubscription: validated.Subscription}

	// After hook.
	if fn := s.runtime.AfterValidateSubscriptionApple(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, nil
}

func (s *ApiServer) ValidateSubscriptionGoogle(ctx context.Context, in *api.ValidateSubscriptionGoogleRequest) (*api.ValidateSubscriptionResponse, error) {
	payload, err := structpb.NewStruct(map[string]any{"receipt": in.Receipt})
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	validated, err := s.ValidateSubscription(ctx, &api.ValidateIAPSubscriptionRequest{Provider: google.Name, Payload: payload, Persist: in.Persist})
	if err != nil {
		return nil, err
	}
	return &api.ValidateSubscriptionResponse{ValidatedSubscription: validated.Subscription}, nil
}

func (s *ApiServer) ValidateSubscription(ctx context.Context, in *api.ValidateIAPSubscriptionRequest) (*api.ValidateIAPSubscriptionResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	beforeHook := s.runtime.BeforeValidateSubscription()
	if provider := s.runtime.IAPProviderRegistry().Get(in.Provider); provider != nil && provider.beforeValidateSubscription != nil {
		beforeHook = provider.beforeValidateSubscription
	}
	if beforeHook != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := beforeHook(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		err := traceApiBefore(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	var payload map[string]any
	if in.Payload != nil {
		payload = in.Payload.AsMap()
	}

	validation, err := ValidateSubscription(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID, traceID, in.Provider, payload, nil, persist)
	if err != nil {
		return nil, err
	}

	afterHook := s.runtime.AfterValidateSubscription()
	if provider := s.runtime.IAPProviderRegistry().Get(in.Provider); provider != nil && provider.afterValidateSubscription != nil {
		afterHook = provider.afterValidateSubscription
	}
	if afterHook != nil {
		afterFn := func(clientIP, clientPort string) error {
			return afterHook(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ListSubscriptions(ctx context.Context, in *api.ListSubscriptionsRequest) (*api.SubscriptionList, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	// Before hook.
	if fn := s.runtime.BeforeListSubscriptions(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	limit := 100
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 1000.")
		}
		limit = int(in.GetLimit().Value)
	}

	subscriptions, err := ListSubscriptions(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID.String(), limit, in.Cursor, time.Time{}, time.Time{}, nil)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterListSubscriptions(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, subscriptions, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return subscriptions, nil
}

func (s *ApiServer) GetSubscription(ctx context.Context, in *api.GetSubscriptionRequest) (*api.ValidatedSubscription, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	// Before hook.
	if fn := s.runtime.BeforeGetSubscription(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	sub, err := GetSubscriptionByProductId(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID.String(), in.ProductId)
	if err != nil {
		if errors.Is(err, ErrSubscriptionNotFound) {
			return nil, status.Error(codes.NotFound, err.Error())
		}
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterGetSubscription(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, sub, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return sub, nil
}
