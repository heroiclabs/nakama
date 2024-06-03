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
)

func (s *ApiServer) ValidatePurchaseApple(ctx context.Context, in *api.ValidatePurchaseAppleRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseApple(); fn != nil {
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

	validation, err := ValidatePurchasesApple(ctx, s.logger, s.db, userID, s.config.GetIAP().Apple.SharedPassword, in.Receipt, persist)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseApple(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchaseGoogle(ctx context.Context, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseGoogle(); fn != nil {
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

	validation, err := ValidatePurchaseGoogle(ctx, s.logger, s.db, userID, s.config.GetIAP().Google, in.Purchase, persist)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseGoogle(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchaseHuawei(ctx context.Context, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseHuawei(); fn != nil {
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

	validation, err := ValidatePurchaseHuawei(ctx, s.logger, s.db, userID, s.config.GetIAP().Huawei, in.Purchase, in.Signature, persist)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseHuawei(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchaseFacebookInstant(ctx context.Context, in *api.ValidatePurchaseFacebookInstantRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseFacebookInstant(); fn != nil {
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

	if s.config.GetIAP().FacebookInstant.AppSecret == "" {
		return nil, status.Error(codes.FailedPrecondition, "Facebook Instant IAP is not configured.")
	}

	if len(in.SignedRequest) < 1 {
		return nil, status.Error(codes.InvalidArgument, "SignedRequest cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	validation, err := ValidatePurchaseFacebookInstant(ctx, s.logger, s.db, userID, s.config.GetIAP().FacebookInstant, in.SignedRequest, persist)
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseFacebookInstant(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}
