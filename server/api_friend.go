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
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListFriends(ctx context.Context, in *api.ListFriendsRequest) (*api.FriendList, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeListFriends(); fn != nil {
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
		err := traceApiBefore(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	limit := 100
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	state := in.GetState()
	if state != nil {
		if state := in.GetState().Value; state < 0 || state > 3 {
			return nil, status.Error(codes.InvalidArgument, "Invalid state - state must be between 0 and 3.")
		}
	}

	friends, err := ListFriends(ctx, s.logger, s.db, s.tracker, userID, limit, state, in.GetCursor())
	if err != nil {
		if err == ErrFriendInvalidCursor {
			return nil, status.Error(codes.InvalidArgument, "Cursor is invalid.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to list friends.")
	}

	// After hook.
	if fn := s.runtime.AfterListFriends(); fn != nil {
		afterFn := func(clientIP, clientPort string) {
			fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, friends)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return friends, nil
}

func (s *ApiServer) AddFriends(ctx context.Context, in *api.AddFriendsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeAddFriends(); fn != nil {
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
		err := traceApiBefore(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	username := ctx.Value(ctxUsernameKey{}).(string)

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot add self as friend.")
		}
		if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	for _, u := range in.GetUsernames() {
		if u == "" {
			return nil, status.Error(codes.InvalidArgument, "Username must not be empty.")
		}
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot add self as friend.")
		}
	}

	userIDs, err := fetchUserID(ctx, s.db, in.GetUsernames())
	if err != nil {
		s.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", in.GetUsernames()))
		return nil, status.Error(codes.Internal, "Error while trying to add friends.")
	}

	if len(userIDs)+len(in.GetIds()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "No valid ID or username was provided.")
	}

	allIDs := make([]string, 0, len(in.GetIds())+len(userIDs))
	allIDs = append(allIDs, in.GetIds()...)
	allIDs = append(allIDs, userIDs...)

	if err := AddFriends(ctx, s.logger, s.db, s.router, userID, username, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to add friends.")
	}

	// After hook.
	if fn := s.runtime.AfterAddFriends(); fn != nil {
		afterFn := func(clientIP, clientPort string) {
			fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) DeleteFriends(ctx context.Context, in *api.DeleteFriendsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeDeleteFriends(); fn != nil {
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
		err := traceApiBefore(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot delete self.")
		}
		if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	username := ctx.Value(ctxUsernameKey{}).(string)
	for _, u := range in.GetUsernames() {
		if u == "" {
			return nil, status.Error(codes.InvalidArgument, "Username must not be empty.")
		}
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot delete self.")
		}
	}

	userIDs, err := fetchUserID(ctx, s.db, in.GetUsernames())
	if err != nil {
		s.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", in.GetUsernames()))
		return nil, status.Error(codes.Internal, "Error while trying to delete friends.")
	}

	if len(userIDs)+len(in.GetIds()) == 0 {
		s.logger.Info("No valid ID or username was provided.")
		return &empty.Empty{}, nil
	}

	allIDs := make([]string, 0, len(in.GetIds())+len(userIDs))
	allIDs = append(allIDs, in.GetIds()...)
	allIDs = append(allIDs, userIDs...)

	if err := DeleteFriends(ctx, s.logger, s.db, userID, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to delete friends.")
	}

	// After hook.
	if fn := s.runtime.AfterDeleteFriends(); fn != nil {
		afterFn := func(clientIP, clientPort string) {
			fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) BlockFriends(ctx context.Context, in *api.BlockFriendsRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeBlockFriends(); fn != nil {
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
		err := traceApiBefore(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot block self.")
		}
		if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	username := ctx.Value(ctxUsernameKey{}).(string)
	for _, u := range in.GetUsernames() {
		if u == "" {
			return nil, status.Error(codes.InvalidArgument, "Username must not be empty.")
		}
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot block self.")
		}
	}

	userIDs, err := fetchUserID(ctx, s.db, in.GetUsernames())
	if err != nil {
		s.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", in.GetUsernames()))
		return nil, status.Error(codes.Internal, "Error while trying to block friends.")
	}

	if len(userIDs)+len(in.GetIds()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "No valid ID or username was provided.")
	}

	allIDs := make([]string, 0, len(in.GetIds())+len(userIDs))
	allIDs = append(allIDs, in.GetIds()...)
	allIDs = append(allIDs, userIDs...)

	if err := BlockFriends(ctx, s.logger, s.db, userID, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to block friends.")
	}

	// After hook.
	if fn := s.runtime.AfterBlockFriends(); fn != nil {
		afterFn := func(clientIP, clientPort string) {
			fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ImportFacebookFriends(ctx context.Context, in *api.ImportFacebookFriendsRequest) (*empty.Empty, error) {
	// Before hook.
	if fn := s.runtime.BeforeImportFacebookFriends(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Facebook token is required.")
	}

	err := importFacebookFriends(ctx, s.logger, s.db, s.router, s.socialClient, ctx.Value(ctxUserIDKey{}).(uuid.UUID), ctx.Value(ctxUsernameKey{}).(string), in.Account.Token, in.Reset_ != nil && in.Reset_.Value)
	if err != nil {
		// Already logged inside the core importFacebookFriends function.
		return nil, err
	}

	// After hook.
	if fn := s.runtime.AfterImportFacebookFriends(); fn != nil {
		afterFn := func(clientIP, clientPort string) {
			fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &empty.Empty{}, nil
}
