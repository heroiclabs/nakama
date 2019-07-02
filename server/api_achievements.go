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
			return nil, ErrUserNotFound
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
	var userID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	if in.UserId != "" {
		decodedUserID, err := uuid.FromString(in.UserId)
		if err != nil {
			return nil, err
		}

		if userExists, err := UserExists(ctx, s.db, decodedUserID); err != nil {
			return nil, err
		} else if !userExists {
			return nil, ErrUserNotFound
		}

		userID = decodedUserID
	}

	if in.AchievementId == "" {
		return nil, ErrInvalidAchievementUUID
	}

	decodedAchievementID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	achievement, err := GetAchievement(ctx, s.logger, s.db, userID, decodedAchievementID)

	if err != nil {
		return nil, err
	}

	return achievement, nil
}

func (s *ApiServer) GetAchievementProgress(ctx context.Context, in *api.AchievementRequest) (*api.AchievementProgress, error) {
	var userID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	if in.UserId != "" {
		decodedUserID, err := uuid.FromString(in.UserId)
		if err != nil {
			return nil, err
		}

		if userExists, err := UserExists(ctx, s.db, decodedUserID); err != nil {
			return nil, err
		} else if !userExists {
			return nil, ErrUserNotFound
		}

		userID = decodedUserID
	}

	if in.AchievementId == "" {
		return nil, ErrInvalidAchievementUUID
	}

	decodedAchievementID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	achievement, err := GetAchievementProgress(ctx, s.logger, s.db, userID, decodedAchievementID)

	if err != nil {
		return nil, err
	}

	return achievement, nil
}

func (s *ApiServer) RevealAchievement(ctx context.Context, in *api.AchievementRequest) (*empty.Empty, error) {
	// Force the userID to be the one of the user making the request, so that they cannot affect
	// other users achievement progress.
	var userUUID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	achievementUUID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	if err := RevealAchievement(ctx, s.logger, s.db, achievementUUID, userUUID); err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) AwardAchievement(ctx context.Context, in *api.AchievementRequest) (*empty.Empty, error) {
	// Force the userID to be the one of the user making the request, so that they cannot affect
	// other users achievement progress.
	var userUUID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	achievementUUID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	if err := AwardAchievement(ctx, s.logger, s.db, achievementUUID, userUUID); err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) SetAchievementProgress(ctx context.Context, in *api.AchievementProgressUpdate) (*empty.Empty, error) {
	// Force the userID to be the one of the user making the request, so that they cannot affect
	// other users achievement progress.
	var userUUID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	achievementUUID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	if err := SetAchievementProgress(ctx, s.logger, s.db, achievementUUID, userUUID, in.Progress); err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) IncrementAchievementProgress(ctx context.Context, in *api.AchievementProgressUpdate) (*empty.Empty, error) {
	// Force the userID to be the one of the user making the request, so that they cannot affect
	// other users achievement progress.
	var userUUID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	achievementUUID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	if err := IncrementAchievementProgress(ctx, s.logger, s.db, achievementUUID, userUUID, in.Progress); err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) SetAchievementProgressAuxiliaryData(ctx context.Context, in *api.AchievementAuxiliaryDataUpdate) (*empty.Empty, error) {
	var userUUID = ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	achievementUUID, err := uuid.FromString(in.AchievementId)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	if err := SetAchievementProgressAuxiliaryData(ctx, s.logger, s.db, achievementUUID, userUUID, in.AuxiliaryData); err != nil {
		return nil, err
	}

	return &empty.Empty{}, nil
}
