// Copyright 2019 The Nakama Authors
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
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/console"
)

func (s *ConsoleServer) ListAchievements(ctx context.Context, empty *empty.Empty) (*api.Achievements, error) {
	return GetAchievements(ctx, s.logger, s.db, uuid.Nil)
}

func (s *ConsoleServer) GetAchievement(ctx context.Context, in *console.GetAchievementRequest) (*api.Achievement, error) {
	achievementID, err := uuid.FromString(in.AchievementId)

	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	return GetAchievement(ctx, s.logger, s.db, uuid.Nil, achievementID)
}

func (s *ConsoleServer) CreateAchievement(ctx context.Context, in *console.AchievementCreationRequest) (*api.Achievement, error) {
	return CreateAchievement(ctx, s.logger, s.db, in)
}

func (s *ConsoleServer) ModifyAchievement(ctx context.Context, in *api.Achievement) (*api.Achievement, error) {
	// TODO: Check that achievement being updated actually exists.
	return UpdateAchievement(ctx, s.logger, s.db, in)
}

func (s *ConsoleServer) DeleteAchievement(ctx context.Context, in *api.Achievement) (*empty.Empty, error) {
	err := DeleteAchievement(ctx, s.logger, s.db, in)
	if err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) SetUserAchievementProgress(ctx context.Context, in *api.AchievementProgress) (*empty.Empty, error) {

	achievementUUID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	userUUID, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, ErrUserNotFound
	}

	exists, err := UserExists(ctx, s.db, userUUID)
	if !exists || err != nil {
		return nil, ErrUserNotFound
	}

	err = CreateOrUpdateAchievementProgress(ctx, s.logger, s.db, achievementUUID, userUUID, func(achievement *api.Achievement) (*api.AchievementProgress, error) {
		return in, nil
	}, true)
	if err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}
