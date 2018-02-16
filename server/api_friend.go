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
	"golang.org/x/net/context"
	"github.com/heroiclabs/nakama/api"
	"github.com/golang/protobuf/ptypes/empty"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"github.com/satori/go.uuid"
)

func (s *ApiServer) AddFriends(ctx context.Context, in *api.AddFriendsRequest) (*empty.Empty, error) {
	if len(in.GetIds()) == 0 && len(in.GetUsernames()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "Specify at least one ID or Username.")
	}

	userID := ctx.Value(ctxUserIDKey{})
	if err := AddFriends(s.logger, s.db, userID.(uuid.UUID), in.Ids, in.Usernames); err != nil {
		return nil, status.Error(codes.Internal, "Error while trying to add friends.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) BlockFriends(ctx context.Context, in *api.BlockFriendsRequest) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) DeleteFriends(ctx context.Context, in *api.DeleteFriendsRequest) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) ListFriends(ctx context.Context, in *empty.Empty) (*api.Friends, error) {
	return nil, nil
}

func (s *ApiServer) ImportFacebookFriends(ctx context.Context, in *api.ImportFacebookFriendsRequest) (*empty.Empty, error) {
	return nil, nil
}
