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
	"github.com/heroiclabs/nakama/v3/server/plugins/iap/facebookinstant"
	"github.com/heroiclabs/nakama/v3/server/plugins/iap/samsung"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *ApiServer) ValidatePurchaseApple(ctx context.Context, in *api.ValidatePurchaseAppleRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseApple(); fn != nil {
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

	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	validated, err := ValidatePurchase(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID, traceID, "apple", map[string]any{"receipt": in.Receipt}, nil, persist)
	if err != nil {
		return nil, err
	}
	validation := &api.ValidatePurchaseResponse{ValidatedPurchases: validated.Purchase}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseApple(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchaseGoogle(ctx context.Context, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseGoogle(); fn != nil {
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

	if s.config.GetIAP().Google.ClientEmail == "" || s.config.GetIAP().Google.PrivateKey == "" {
		return nil, status.Error(codes.FailedPrecondition, "Google IAP is not configured.")
	}

	if len(in.Purchase) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Purchase cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	validated, err := ValidatePurchase(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID, traceID, "google", map[string]any{"purchase": in.Purchase}, nil, persist)
	if err != nil {
		return nil, err
	}
	validation := &api.ValidatePurchaseResponse{ValidatedPurchases: validated.Purchase}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseGoogle(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchaseHuawei(ctx context.Context, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseHuawei(); fn != nil {
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

	if s.config.GetIAP().Huawei.PublicKey == "" ||
		s.config.GetIAP().Huawei.ClientID == "" ||
		s.config.GetIAP().Huawei.ClientSecret == "" {
		return nil, status.Error(codes.FailedPrecondition, "Huawei IAP is not configured.")
	}

	if len(in.Purchase) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Purchase cannot be empty.")
	}

	if len(in.Signature) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Signature cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	validated, err := ValidatePurchase(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID, traceID, "huawei", map[string]any{"purchase": in.Purchase, "signature": in.Signature}, nil, persist)
	if err != nil {
		return nil, err
	}
	validation := &api.ValidatePurchaseResponse{ValidatedPurchases: validated.Purchase}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseHuawei(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchaseFacebookInstant(ctx context.Context, in *api.ValidatePurchaseFacebookInstantRequest) (*api.ValidatePurchaseResponse, error) {
	payload, err := structpb.NewStruct(map[string]any{"signed_request": in.SignedRequest})
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	validated, err := s.ValidatePurchase(ctx, &api.ValidateIAPPurchaseRequest{Provider: facebookinstant.Name, Payload: payload, Persist: in.Persist})
	if err != nil {
		return nil, err
	}
	return &api.ValidatePurchaseResponse{ValidatedPurchases: validated.Purchase}, nil
}

func (s *ApiServer) ValidatePurchaseSamsung(ctx context.Context, in *api.ValidatePurchaseSamsungRequest) (*api.ValidatePurchaseResponse, error) {
	payload, err := structpb.NewStruct(map[string]any{"purchase_id": in.PurchaseId})
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	validated, err := s.ValidatePurchase(ctx, &api.ValidateIAPPurchaseRequest{Provider: samsung.Name, Payload: payload, Persist: in.Persist})
	if err != nil {
		return nil, err
	}
	return &api.ValidatePurchaseResponse{ValidatedPurchases: validated.Purchase}, nil
}

func (s *ApiServer) ValidatePurchase(ctx context.Context, in *api.ValidateIAPPurchaseRequest) (*api.ValidateIAPPurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	logger, traceID := LoggerWithTraceId(ctx, s.logger)

	beforeHook := s.runtime.BeforeValidatePurchase()
	if provider := s.runtime.IAPProviderRegistry().Get(in.Provider); provider != nil && provider.beforeValidatePurchase != nil {
		beforeHook = provider.beforeValidatePurchase
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

	if len(in.Provider) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Provider cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	var payload map[string]any
	if in.Payload != nil {
		payload = in.Payload.AsMap()
	}

	validation, err := ValidatePurchase(ctx, logger, s.db, s.runtime.IAPProviderRegistry(), userID, traceID, in.Provider, payload, nil, persist)
	if err != nil {
		return nil, err
	}

	afterHook := s.runtime.AfterValidatePurchase()
	if provider := s.runtime.IAPProviderRegistry().Get(in.Provider); provider != nil && provider.afterValidatePurchase != nil {
		afterHook = provider.afterValidatePurchase
	}
	if afterHook != nil {
		afterFn := func(clientIP, clientPort string) error {
			return afterHook(ctx, logger, traceID, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		traceApiAfter(ctx, logger, s.config, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}
