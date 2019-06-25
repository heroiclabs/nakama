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
	"github.com/pkg/errors"
	"golang.org/x/net/context"
)

func (s *ApiServer) ListAchievements(ctx context.Context, in *api.ListAchievementsRequest) (*api.Achievements, error) {

	var userID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	if in.UserId != "" {
		decodedUserID, err := uuid.FromString(in.UserId)
		if err != nil {
			return nil, err
		}

		if userExists, err := UserExists(ctx, s.db, decodedUserID); err != nil {
			return nil, err
		} else if !userExists {
			return nil, errors.New("No user found for this UUID")
		}

		userID = decodedUserID
	}

	achievements, err := GetAchievements(ctx, s.logger, s.db, userID)

	if err != nil {
		return nil, err
	}

	return achievements, nil
}

func (s *ApiServer) GetAchievement(ctx context.Context, in *api.AchievementRequest) (*api.Achievement, error) {
	var testAchievement = api.Achievement{
		Id:          in.AchievementId,
		Name:        "Test Achievement",
		Description: "Test Description",
	}

	return &testAchievement, nil
}

func (s *ApiServer) SetAchievementProgress(ctx context.Context, in *api.AchievementProgress) (*empty.Empty, error) {

	return &empty.Empty{}, nil
}

func (s *ApiServer) UpdateAchievementProgress(ctx context.Context, in *api.AchievementProgressUpdate) (*empty.Empty, error) {

	return &empty.Empty{}, nil
}
