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
	"strconv"

	"github.com/golang/protobuf/proto"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/console"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"golang.org/x/net/context"
)

var (
	ErrInvalidAchievementUUID         = errors.New("Invalid Achievement UUID")
	ErrMayNotProgressOnNonProgressive = errors.New("Cannot make progress on non-progressive achievement.")
	ErrMayNotManuallyAwardProgressive = errors.New("May not manually award a progressive achievement.")
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
	return CreateOrUpdateAchievementProgress(ctx, logger, db, achievementID, userID, func(achievement *api.Achievement) (*api.AchievementProgress, error) {
		newProgress := proto.Clone(achievement.CurrentProgress).(*api.AchievementProgress)

		oldState := api.AchievementState(achievement.CurrentProgress.CurrentState.Value)
		if oldState == api.AchievementState_HIDDEN {
			newProgress.CurrentState.Value = int32(api.AchievementState_REVEALED)
		}

		return newProgress, nil
	})
}

func AwardAchievement(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID) error {
	return CreateOrUpdateAchievementProgress(ctx, logger, db, achievementID, userID, func(achievement *api.Achievement) (*api.AchievementProgress, error) {
		if api.AchievementType(achievement.Type.Value) == api.AchievementType_PROGRESSIVE {
			return nil, ErrMayNotManuallyAwardProgressive
		}

		newProgress := proto.Clone(achievement.CurrentProgress).(*api.AchievementProgress)

		oldState := api.AchievementState(achievement.CurrentProgress.CurrentState.Value)
		if oldState == api.AchievementState_HIDDEN || oldState == api.AchievementState_REVEALED {
			newProgress.CurrentState.Value = int32(api.AchievementState_EARNED)
		}

		return newProgress, nil
	})
}

func SetAchievementProgressAuxiliaryData(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID, auxiliaryData string) error {
	return CreateOrUpdateAchievementProgress(ctx, logger, db, achievementID, userID, func(achievement *api.Achievement) (*api.AchievementProgress, error) {
		newProgress := proto.Clone(achievement.CurrentProgress).(*api.AchievementProgress)

		newProgress.AuxiliaryData = auxiliaryData

		return newProgress, nil
	})
}

func SetAchievementProgress(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID, newProgress int64) error {
	return CreateOrUpdateAchievementProgress(ctx, logger, db, achievementID, userID,
		SetProgressWithModifier(func(prev int64) int64 {
			return newProgress
		}))
}

func IncrementAchievementProgress(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID, increment int64) error {
	return CreateOrUpdateAchievementProgress(ctx, logger, db, achievementID, userID,
		SetProgressWithModifier(func(prev int64) int64 {
			return prev + increment
		}))
}

func SetProgressWithModifier(modifier func(int64) int64) func(achievement *api.Achievement) (*api.AchievementProgress, error) {
	return func(achievement *api.Achievement) (*api.AchievementProgress, error) {
		if api.AchievementType(achievement.Type.Value) != api.AchievementType_PROGRESSIVE {
			return nil, ErrMayNotProgressOnNonProgressive
		}

		newProgress := proto.Clone(achievement.CurrentProgress).(*api.AchievementProgress)

		newAchievementProgressProgress := modifier(achievement.CurrentProgress.Progress)

		newProgress.Progress = newAchievementProgressProgress

		if newProgress.Progress >= achievement.TargetValue {
			newProgress.CurrentState.Value = int32(api.AchievementState_EARNED)
		}

		return newProgress, nil
	}
}

func CreateAchievement(ctx context.Context, logger *zap.Logger, db *sql.DB, req *console.AchievementCreationRequest) (*api.Achievement, error) {
	query := `
	insert into achievements (name, description, initial_state, "type", repeatability, target_value, locked_image_url, unlocked_image_url, auxiliary_data)
	values ($1::text, $2::text, $3::int8, $4::int8, $5::int8, $6::int8, $7::text, $8::text, $9::JSONB)
	returning id, name, description, initial_state, "type", repeatability, target_value, locked_image_url, unlocked_image_url, auxiliary_data`

	params := make([]interface{}, 0)
	params = append(params, req.Name, req.Description, req.InitialState.Value, req.Type.Value, req.Repeatability.Value, req.TargetValue, req.LockedImageUrl,
		req.UnlockedImageUrl)

	if req.AuxiliaryData != "" {
		params = append(params, req.AuxiliaryData)
	} else {
		params = append(params, nil)
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, err
	}

	if !rows.Next() {
		return nil, errors.New("No rows returned in response to insert")
	}

	return convertAchievement(rows, false)
}

func UpdateAchievement(ctx context.Context, logger *zap.Logger, db *sql.DB, req *api.Achievement) (*api.Achievement, error) {
	if req.Id == "" {
		return nil, ErrInvalidAchievementUUID
	}

	achievementUUID, err := uuid.FromString(req.Id)
	if err != nil {
		return nil, ErrInvalidAchievementUUID
	}

	if req.Name == "" {
		return nil, errors.New("Invalid Achievement name")
	}

	query := `
	update achievements set name = $1::text, description = $2::text, initial_state = $3::int8, "type" = $4::int8, repeatability = $5::int8, 
	target_value = $6::int8, locked_image_url = $7::text, unlocked_image_url = $8::text, auxiliary_data = $9::JSONB
	where id=$10::UUID
	returning id, name, description, initial_state, "type", repeatability, target_value, locked_image_url, unlocked_image_url, auxiliary_data
	`

	params := make([]interface{}, 0)
	params = append(params, req.Name, req.Description, req.InitialState.Value, req.Type.Value, req.Repeatability.Value, req.TargetValue,
		req.LockedImageUrl, req.UnlockedImageUrl)

	if req.AuxiliaryData != "" {
		params = append(params, req.AuxiliaryData, achievementUUID)
	} else {
		params = append(params, nil, achievementUUID)
	}

	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, err
	}

	if !rows.Next() {
		return nil, errors.New("No rows returned in response to update")
	}

	return convertAchievement(rows, false)
}

func CreateOrUpdateAchievementProgress(ctx context.Context, logger *zap.Logger, db *sql.DB, achievementID, userID uuid.UUID, computeNewValue func(*api.Achievement) (*api.AchievementProgress, error)) error {
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
			createdProgress, err := CreateAchievementProgress(ctx, logger, db, achievement, userID)
			if err != nil {
				return err
			}

			achievement.CurrentProgress = createdProgress
		}

		newAchievementProgress, err := computeNewValue(achievement)

		if err != nil {
			return err
		}

		// write differences to db.
		UpdateAchievementProgress(ctx, logger, db, achievement, newAchievementProgress)

		return nil
	}); err != nil {
		return err
	}

	return nil
}

func UpdateAchievementProgress(ctx context.Context, logger *zap.Logger, db *sql.DB, achievement *api.Achievement, newProgress *api.AchievementProgress) error {
	// Fields that are ignored / overridden are created_at, updated_at and awarded_at

	counter := 1
	params := make([]interface{}, 0)
	query := "update achievement_progress set updated_at = now()"

	if achievement.CurrentProgress.CurrentState.Value != newProgress.CurrentState.Value {
		query += ", achievement_state = $" + strconv.Itoa(counter) + "::int8"
		params = append(params, newProgress.CurrentState.Value)
		counter++

		if api.AchievementState(newProgress.CurrentState.Value) == api.AchievementState_EARNED {
			query += ", awarded_at = now()"
		}
	}

	if achievement.CurrentProgress.Progress != newProgress.Progress {
		query += ", progress = $" + strconv.Itoa(counter) + "::int8"
		params = append(params, newProgress.Progress)
		counter++
	}

	if achievement.CurrentProgress.AuxiliaryData != newProgress.AuxiliaryData {
		query += ", auxiliary_data = $" + strconv.Itoa(counter) + "::JSONB"
		params = append(params, newProgress.AuxiliaryData)
		counter++
	}

	query = query + " where achievement_id = $" + strconv.Itoa(counter) + "::UUID and user_id = $" + strconv.Itoa(counter+1) + "::UUID"
	params = append(params, achievement.CurrentProgress.AchievementId)
	params = append(params, achievement.CurrentProgress.UserId)
	counter += 2

	_, err := db.ExecContext(ctx, query, params...)

	return err
}

func CreateAchievementProgress(ctx context.Context, logger *zap.Logger, db *sql.DB, achievement *api.Achievement, userID uuid.UUID) (*api.AchievementProgress, error) {
	query := `
	insert into achievement_progress (achievement_id, user_id, achievement_state, progress, created_at, updated_at, awarded_at)
	values ($1::UUID, $2::UUID, $3::int8, $4::int8, now(), now(), null) 
	returning achievement_id, user_id, achievement_state, progress, created_at, updated_at, awarded_at`

	params := make([]interface{}, 0)

	if achievementUUID, err := uuid.FromString(achievement.Id); err == nil {
		params = append(params, achievementUUID)
	} else {
		return nil, err
	}

	params = append(params, userID)
	params = append(params, achievement.InitialState.Value)
	params = append(params, 0)

	result, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, err
	}

	var id string
	var insertedUserID string
	var currentState int64
	var progress int64
	var createdAt *pgtype.Timestamptz
	var updatedAt *pgtype.Timestamptz
	var awardedAt *pgtype.Timestamptz
	var auxiliaryData sql.NullString

	if !result.Next() {
		return nil, errors.New("For some reason the insert did complete but returned no rows.")
	}

	err = result.Scan(&id, &insertedUserID, &currentState, &progress, &createdAt, &updatedAt, &awardedAt, &auxiliaryData)
	if err != nil {
		return nil, err
	}

	var awardedAtTimestamp *timestamp.Timestamp

	if awardedAt != nil {
		awardedAtTimestamp = &timestamp.Timestamp{Seconds: awardedAt.Time.Unix()}
	}

	var auxiliaryDataString = ""
	if auxiliaryData.Valid {
		auxiliaryDataString = auxiliaryData.String
	}

	return &api.AchievementProgress{
		AchievementId: id,
		UserId:        insertedUserID,
		CurrentState: &wrappers.Int32Value{
			Value: int32(currentState),
		},
		Progress:      progress,
		CreatedAt:     &timestamp.Timestamp{Seconds: createdAt.Time.Unix()},
		UpdatedAt:     &timestamp.Timestamp{Seconds: updatedAt.Time.Unix()},
		AwardedAt:     awardedAtTimestamp,
		AuxiliaryData: auxiliaryDataString,
	}, nil
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
