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
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"github.com/satori/go.uuid"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) GetAccount(ctx context.Context, in *empty.Empty) (*api.Account, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	user, err := GetAccount(s.db, s.logger, s.tracker, userID)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error retrieving user account.")
	}

	return user, nil
}

func (s *ApiServer) UpdateAccount(ctx context.Context, in *api.UpdateAccountRequest) (*empty.Empty, error) {
	username := in.GetUsername().GetValue()
	if in.GetUsername() != nil {
		if len(username) < 1 || len(username) > 128 {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
		}
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	err := UpdateAccount(s.db, s.logger, userID, username, in.GetDisplayName(), in.GetTimezone(), in.GetLocation(), in.GetLangTag(), in.GetAvatarUrl())

	if err != nil {
		if _, ok := err.(*pq.Error); ok {
			return nil, status.Error(codes.Internal, "Error while trying to update account.")
		}

		return nil, status.Error(codes.InvalidArgument, err.Error())
	}

	return &empty.Empty{}, nil
}
