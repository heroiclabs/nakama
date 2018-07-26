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
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) GetUsers(ctx context.Context, in *api.GetUsersRequest) (*api.Users, error) {
	if in.GetIds() == nil && in.GetUsernames() == nil && in.GetFacebookIds() == nil {
		return &api.Users{}, nil
	}

	ids := make([]string, 0)
	usernames := make([]string, 0)
	facebookIDs := make([]string, 0)

	if in.GetIds() != nil {
		for _, id := range in.GetIds() {
			if _, uuidErr := uuid.FromString(id); uuidErr != nil {
				return nil, status.Error(codes.InvalidArgument, "ID '"+id+"' is not a valid system ID.")
			}

			ids = append(ids, id)
		}
	}

	if in.GetUsernames() != nil {
		usernames = in.GetUsernames()
	}

	if in.GetFacebookIds() != nil {
		facebookIDs = in.GetFacebookIds()
	}

	users, err := GetUsers(s.logger, s.db, s.tracker, ids, usernames, facebookIDs)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error retrieving user accounts.")
	}

	return users, nil
}
