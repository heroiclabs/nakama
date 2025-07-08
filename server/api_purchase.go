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
	"fmt"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/iap"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// // hit from validatepurchase rpc - should i just include the paramters for each platform in the validate purchase request struct
func (s *ApiServer) ValidatePurchase(ctx context.Context, in *api.ValidatePurchaseRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	// should i just use one before hook for all the validate purchase calls
	//if fn := s.runtime.BeforeValidatePurchase(); fn != nil {
	//	beforeFn := func(clientIP, clientPort string) error {
	//		result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
	//		if err != nil {
	//			return status.Error(code, err.Error())
	//		}
	//		if result == nil {
	//			// If result is nil, requested resource is disabled.
	//			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
	//			return status.Error(codes.NotFound, "Requested resource was not found.")
	//		}
	//		in = result
	//		return nil
	//	}
	//
	//	// Execute the before function lambda wrapped in a trace for stats measurement.
	//	err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
	//	if err != nil {
	//		return nil, err
	//	}
	//}

	// still need to handle this for every platform
	// create a validate inputs based on platform func
	//if s.config.GetIAP().Apple.SharedPassword == "" {
	//	return nil, status.Error(codes.FailedPrecondition, "Apple IAP is not configured.")
	//}

	// receipt can be empty for steam
	if len(in.Receipt) < 1 {
		return nil, status.Error(codes.InvalidArgument, "Receipt cannot be empty.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	purchaseProvider, err := iap.GetPurchaseProvider(in.Platform, s.runtime.purchaseProviders)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to get purchase provider")
	}

	validation, err := purchaseProvider.PurchaseValidate(ctx, s.logger, s.db, in.Receipt, userID, persist, s.config.GetIAP())
	if err != nil {
		return nil, err
	}

	// After hook.
	// should i just use one after hook for all the validate purchase calls
	//
	//if fn := s.runtime.AfterValidatePurchaseApple(); fn != nil {
	//	afterFn := func(clientIP, clientPort string) error {
	//		return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
	//	}
	//
	//	// Execute the after function lambda wrapped in a trace for stats measurement.
	//	traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	//}

	return validation, err
}

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

func (s *ApiServer) ValidatePurchaseXbox(ctx context.Context, in *api.ValidatePurchaseXboxRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchaseXbox(); fn != nil {
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

	if s.config.GetIAP().Xbox.Token == "" {
		return nil, status.Error(codes.FailedPrecondition, "Xbox IAP is not configured.")
	}

	if len(in.ProductId) < 1 {
		return nil, status.Error(codes.InvalidArgument, "ProductId required.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	provider, err := iap.GetPurchaseProvider("xbox", s.runtime.purchaseProviders)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	if provider == nil {
		s.logger.Info(fmt.Sprintf("Xbox provider not found for purchase provider"))
		return nil, status.Error(codes.NotFound, "Purchase provider not found.")
	}

	validation, err := provider.PurchaseValidate(ctx, s.logger, s.db, in.ProductId, userID, persist, s.config.GetIAP())
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterValidatePurchaseXbox(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

func (s *ApiServer) ValidatePurchasePlaystation(ctx context.Context, in *api.ValidatePurchasePlaystationRequest) (*api.ValidatePurchaseResponse, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeValidatePurchasePlaystation(); fn != nil {
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

	if s.config.GetIAP().Playstation.Token == "" {
		return nil, status.Error(codes.FailedPrecondition, "Xbox IAP is not configured.")
	}

	if len(in.EntitlementLabel) < 1 {
		return nil, status.Error(codes.InvalidArgument, "EntitlementLabel required.")
	}

	persist := true
	if in.Persist != nil {
		persist = in.Persist.GetValue()
	}

	validation, err := s.runtime.purchaseProviders["playstation"].PurchaseValidate(ctx, s.logger, s.db, in.EntitlementLabel, userID, persist, s.config.GetIAP())
	if err != nil {
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterValidatePurchasePlaystation(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return validation, err
}

//func (s *ApiServer) ValidatePurchaseEpic(ctx context.Context, in *api.ValidatePurchaseEpicRequest) (*api.ValidatePurchaseResponse, error) {
//	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
//
//	// Before hook.
//	if fn := s.runtime.BeforeValidatePurchaseEpic(); fn != nil {
//		beforeFn := func(clientIP, clientPort string) error {
//			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
//			if err != nil {
//				return status.Error(code, err.Error())
//			}
//			if result == nil {
//				// If result is nil, requested resource is disabled.
//				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
//				return status.Error(codes.NotFound, "Requested resource was not found.")
//			}
//			in = result
//			return nil
//		}
//
//		// Execute the before function lambda wrapped in a trace for stats measurement.
//		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
//		if err != nil {
//			return nil, err
//		}
//	}
//
//	if s.config.GetIAP().Xbox.Token == "" {
//		return nil, status.Error(codes.FailedPrecondition, "Xbox IAP is not configured.")
//	}
//
//	if len(in.NsCatalogItemId) < 1 {
//		return nil, status.Error(codes.InvalidArgument, "NsCatalogItemId required.")
//	}
//
//	persist := true
//	if in.Persist != nil {
//		persist = in.Persist.GetValue()
//	}
//
//	epicConfig := s.config.GetIAP().Playstation
//	validation, err := s.runtime.iapPlaystationManager.PurchaseValidate(ctx, s.logger, s.db, "", "", "", "", in.NsCatalogItemId, "", userID, persist)
//	if err != nil {
//		return nil, err
//	}
//
//	// After hook.
//	if fn := s.runtime.AfterValidatePurchasePlaystation(); fn != nil {
//		afterFn := func(clientIP, clientPort string) error {
//			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, validation, in)
//		}
//
//		// Execute the after function lambda wrapped in a trace for stats measurement.
//		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
//	}
//
//	return validation, err
//}
