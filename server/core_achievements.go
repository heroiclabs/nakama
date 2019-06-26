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
	"database/sql"
	"errors"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/api"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"golang.org/x/net/context"
)

var (
	ErrInvalidAchievementUUID = errors.New("Invalid Achievement UUID")
)

func GetAchievements(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) (*api.Achievements, error) {
	var query = `SELECT id, name, description, initial_state, type, repeatability, target_value, locked_image_url, unlocked_image_url, auxiliary_data FROM achievements`

	includingUserProgress := userID != uuid.Nil

	// Also query for achievement progresses by the current user
	if includingUserProgress {
		query = `
		select id,
			name, 
			description, 
			initial_state, 
			type, 
			repeatability, 
			target_value, 
			locked_image_url, 
			unlocked_image_url, 
			achievements.auxiliary_data,
			achievement_progress.achievement_id as progress_achievement_id,
			achievement_progress.user_id as progress_user_id,
			achievement_progress.achievement_state as progress_achievement_state,
			achievement_progress.progress as progress_progress,
			achievement_progress.created_at as progress_created_at,
			achievement_progress.updated_at as progress_updated_at,
			achievement_progress.awarded_at as progress_awarded_at,
			achievement_progress.auxiliary_data as progress_auxiliary_data
		from achievements
		left join achievement_progress
		on achievements.id=achievement_progress.achievement_id and achievement_progress.user_id=$1::UUID
		`
	}

	params := make([]interface{}, 0)

	if includingUserProgress {
		params = append(params, userID)
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving achievements.", zap.Error(err), zap.String("userID", userID.String()))
		return nil, err
	}
	defer rows.Close()

	res, err := convertAchievements(rows, includingUserProgress)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func GetAchievement(ctx context.Context, logger *zap.Logger, db *sql.DB, userID, achievementID uuid.UUID) (*api.Achievement, error) {
	var query = `SELECT id, name, description, initial_state, type, repeatability, target_value, locked_image_url, unlocked_image_url, auxiliary_data FROM achievements
	WHERE id=$1`

	includingUserProgress := userID != uuid.Nil

	// Also query for achievement progresses by the current user
	if includingUserProgress {
		query = `
		select id, 
			name, 
			description, 
			initial_state, 
			type, 
			repeatability, 
			target_value, 
			locked_image_url, 
			unlocked_image_url, 
			achievements.auxiliary_data,
			achievement_progress.achievement_id as progress_achievement_id,
			achievement_progress.user_id as progress_user_id,
			achievement_progress.achievement_state as progress_achievement_state,
			achievement_progress.progress as progress_progress,
			achievement_progress.created_at as progress_created_at,
			achievement_progress.updated_at as progress_updated_at,
			achievement_progress.awarded_at as progress_awarded_at,
			achievement_progress.auxiliary_data as progress_auxiliary_data
		from achievements
		left join achievement_progress
		on achievements.id=achievement_progress.achievement_id and achievement_progress.user_id=$2::UUID
		where achievements.id=$1::UUID
		`
	}

	params := make([]interface{}, 0)
	params = append(params, achievementID)

	if includingUserProgress {
		params = append(params, userID)
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error retrieving achievement.", zap.Error(err), zap.String("userID", userID.String()))
		return nil, err
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, ErrInvalidAchievementUUID
	}

	res, err := convertAchievement(rows, includingUserProgress)
	if err != nil {
		return nil, err
	}

	return res, nil
}

func RevealAchievement(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID) error {

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		achievement, err := GetAchievement(ctx, logger, db, userID, achievementID)

		if err != nil {
			return err
		}

		if achievement.CurrentProgress == nil {
			// Create a new achievement progress
			err := CreateAchievementProgress(ctx, logger, db, achievement, userID)
			if err != nil {
				return err
			}
		}

		// If we created a new progress or the current state is hidden, reveal the achievement.
		if achievement.CurrentProgress == nil || api.AchievementState(achievement.CurrentProgress.CurrentState.Value) == api.AchievementState_HIDDEN {
			err := SetAchievementProgressAchievementState(ctx, logger, db, achievementID, userID, api.AchievementState_REVEALED)
			if err != nil {
				return err
			}
		}

		return nil
	}); err != nil {
		return err
	}

	return nil
}

func SetAchievementProgressAchievementState(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID, newState api.AchievementState) error {
	query := `
	update achievement_progress
	set achievement_state = $1::int8, updated_at = now()
	where achievement_id = $2::UUID, user_id = $3::UUID`

	params := make([]interface{}, 0)
	params = append(params, int32(newState))
	params = append(params, achievementID)
	params = append(params, userID)

	_, err := db.ExecContext(ctx, query, params...)

	return err
}

func CreateAchievementProgress(ctx context.Context, logger *zap.Logger, db *sql.DB, achievement *api.Achievement, userID uuid.UUID) error {
	query := `
	insert into achievement_progress (achievement_id, user_id, achievement_state, progress, created_at, updated_at, awarded_at)
	values ($1::UUID, $2::UUID, $3::int8, $4::int8, now(), now(), null)`

	params := make([]interface{}, 0)

	if achievementUUID, err := uuid.FromString(achievement.Id); err == nil {
		params = append(params, achievementUUID)
	} else {
		return err
	}

	params = append(params, userID)
	params = append(params, achievement.InitialState.Value)

	if api.AchievementType(achievement.Type.Value) == api.AchievementType_PROGRESSIVE {
		params = append(params, 0)
	} else {
		params = append(params, nil)
	}

	_, err := db.ExecContext(ctx, query, params...)

	return err
}

func convertAchievements(rows *sql.Rows, includeUserProgress bool) (*api.Achievements, error) {
	var achievements = make([]*api.Achievement, 0)

	for rows.Next() {
		convertedAchievement, err := convertAchievement(rows, includeUserProgress)
		if err != nil {
			return nil, err
		}
		achievements = append(achievements, convertedAchievement)
	}

	return &api.Achievements{
		Achievements: achievements,
	}, nil
}

func convertAchievement(rows *sql.Rows, includeUserProgress bool) (*api.Achievement, error) {
	var id string
	var name sql.NullString
	var description sql.NullString
	var rawInitialState sql.NullInt64
	var rawAchievementType sql.NullInt64
	var rawRepeatability sql.NullInt64
	var targetValue sql.NullInt64
	var lockedImageURL sql.NullString
	var unlockedImageURL sql.NullString
	var auxiliaryData []byte
	var progressAchievementID sql.NullString
	var progressUserID sql.NullString
	var progressRawAchievementState sql.NullInt64
	var progressProgress sql.NullInt64
	var progressCreatedAt pgtype.Timestamptz
	var progressUpdatedAt pgtype.Timestamptz
	var progressAwardedAt pgtype.Timestamptz
	var progressAuxiliaryData []byte

	if includeUserProgress {
		err := rows.Scan(&id, &name, &description, &rawInitialState, &rawAchievementType, &rawRepeatability, &targetValue,
			&lockedImageURL, &unlockedImageURL, &auxiliaryData, &progressAchievementID, &progressUserID,
			&progressRawAchievementState, &progressProgress, &progressCreatedAt, &progressUpdatedAt, &progressAwardedAt,
			&progressAuxiliaryData)

		if err != nil {
			return nil, err
		}
	} else {
		err := rows.Scan(&id, &name, &description, &rawInitialState, &rawAchievementType, &rawRepeatability, &targetValue,
			&lockedImageURL, &unlockedImageURL, &auxiliaryData)
		if err != nil {
			return nil, err
		}
	}

	achievementUUID, err := uuid.FromString(id)
	if err != nil {
		return nil, err
	}

	var achievement = api.Achievement{
		Id:          achievementUUID.String(),
		Name:        name.String,
		Description: description.String,
		InitialState: &wrappers.Int32Value{
			Value: int32(rawInitialState.Int64),
		},
		Type: &wrappers.Int32Value{
			Value: int32(rawAchievementType.Int64),
		},
		Repeatability: &wrappers.Int32Value{
			Value: int32(rawRepeatability.Int64),
		},
		TargetValue:      targetValue.Int64,
		LockedImageUrl:   lockedImageURL.String,
		UnlockedImageUrl: unlockedImageURL.String,
		AuxiliaryData:    string(auxiliaryData),
	}

	if progressUserID.Valid {
		progressAchievementUUID, err := uuid.FromString(progressAchievementID.String)
		if err != nil {
			return nil, err
		}

		progressUserUUID, err := uuid.FromString(progressUserID.String)
		if err != nil {
			return nil, err
		}

		var ts *timestamp.Timestamp
		if progressAwardedAt.Status == pgtype.Present {
			ts = &timestamp.Timestamp{Seconds: progressAwardedAt.Time.Unix()}
		}

		var achievementProgress = api.AchievementProgress{
			AchievementId: progressAchievementUUID.String(),
			UserId:        progressUserUUID.String(),
			Progress:      progressProgress.Int64,
			CurrentState:  &wrappers.Int32Value{Value: int32(progressRawAchievementState.Int64)},
			CreatedAt:     &timestamp.Timestamp{Seconds: progressCreatedAt.Time.Unix()},
			UpdatedAt:     &timestamp.Timestamp{Seconds: progressUpdatedAt.Time.Unix()},
			AwardedAt:     ts,
			AuxiliaryData: string(progressAuxiliaryData),
		}

		achievement.CurrentProgress = &achievementProgress
	}

	return &achievement, nil
}
