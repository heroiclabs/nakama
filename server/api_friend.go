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
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListFriends(ctx context.Context, in *empty.Empty) (*api.Friends, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	friends, err := GetFriends(s.logger, s.db, s.tracker, userID)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to list friends.")
	}

	return friends, nil
}

func (s *ApiServer) AddFriends(ctx context.Context, in *api.AddFriendsRequest) (*empty.Empty, error) {
	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot add self as friend.")
		}
		if _, err := uuid.FromString(id); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	for _, u := range in.GetUsernames() {
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot add self as friend.")
		}
	}

	userIDs, err := fetchUserID(s.db, in.GetUsernames())
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

	if err := AddFriends(s.logger, s.db, s.router, userID, username, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to add friends.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) DeleteFriends(ctx context.Context, in *api.DeleteFriendsRequest) (*empty.Empty, error) {
	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot delete self.")
		}
		if _, err := uuid.FromString(id); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	username := ctx.Value(ctxUsernameKey{}).(string)
	for _, u := range in.GetUsernames() {
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot delete self.")
		}
	}

	userIDs, err := fetchUserID(s.db, in.GetUsernames())
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

	if err := DeleteFriends(s.logger, s.db, userID, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to delete friends.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) BlockFriends(ctx context.Context, in *api.BlockFriendsRequest) (*empty.Empty, error) {
	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return &empty.Empty{}, nil
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	for _, id := range in.GetIds() {
		if userID.String() == id {
			return nil, status.Error(codes.InvalidArgument, "Cannot block self.")
		}
		if _, err := uuid.FromString(id); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID '"+id+"'.")
		}
	}

	username := ctx.Value(ctxUsernameKey{}).(string)
	for _, u := range in.GetUsernames() {
		if username == u {
			return nil, status.Error(codes.InvalidArgument, "Cannot block self.")
		}
	}

	userIDs, err := fetchUserID(s.db, in.GetUsernames())
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

	if err := BlockFriends(s.logger, s.db, userID, allIDs); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to block friends.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ImportFacebookFriends(ctx context.Context, in *api.ImportFacebookFriendsRequest) (*empty.Empty, error) {
	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Facebook token is required.")
	}

	err := importFacebookFriends(s.logger, s.db, s.router, s.socialClient, ctx.Value(ctxUserIDKey{}).(uuid.UUID), ctx.Value(ctxUsernameKey{}).(string), in.Account.Token, in.Reset_ != nil && in.Reset_.Value)
	if err != nil {
		// Already logged inside the core importFacebookFriends function.
		return nil, err
	}

	return &empty.Empty{}, nil
}
