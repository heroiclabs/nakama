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
	ErrAchievementAlreadyEarned = errors.New("Updating achievement progress failed; achievement is already earned.")
	ErrUnauthorized             = errors.New("You may not update achievements of other players.")
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
	auxiliary_data,
	coalesce(times_awarded, 0) as times_awarded,
	progress_id, 
	progress_achievement_id,
	progress_user_id,
	progress_achievement_state,
	progress_progress,
	progress_awarded_at,
	progress_auxiliary_data
from achievements
left join
	(with rankedprogress as (
		select id, 
			achievement_id, 
			user_id, 
			achievement_state, 
			progress, 
			awarded_at, 
			auxiliary_data, 
			rank() over (partition by achievement_id, user_id order by coalesce(awarded_at, '9999-01-01 12:00:00') desc) as rnk
		from achievement_progress
		where user_id=$1::UUID)
	select 
		id as progress_id, 
		achievement_id as progress_achievement_id,
		user_id as progress_user_id,
		achievement_state as progress_achievement_state,
		progress as progress_progress,
		awarded_at as progress_awarded_at,
		auxiliary_data as progress_auxiliary_data,
		times_awarded
	from rankedprogress
	inner join (
		select achievement_id as count_achievement_id, user_id as count_user_id, count(if(awarded_at is null, if(achievement_state=2, 1, null), 1)) as times_awarded from achievement_progress
		where user_id=$1::UUID
		group by achievement_id, user_id
	)
	on achievement_id = count_achievement_id and user_id = count_user_id
	
	where
		rankedprogress.rnk=1) as newestprogress
on achievements.id=newestprogress.progress_achievement_id
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

func convertAchievements(rows *sql.Rows, includeUserProgress bool) (*api.Achievements, error) {
	var achievements = make([]*api.Achievement, 0)

	for rows.Next() {
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
		var timesAwarded sql.NullInt64
		var progressID sql.NullString
		var progressAchievementID sql.NullString
		var progressUserID sql.NullString
		var progressRawAchievementState sql.NullInt64
		var progressProgress sql.NullInt64
		var progressAwardedAt pgtype.Timestamptz
		var progressAuxiliaryData []byte

		if includeUserProgress {
			err := rows.Scan(&id, &name, &description, &rawInitialState, &rawAchievementType, &rawRepeatability, &targetValue,
				&lockedImageURL, &unlockedImageURL, &auxiliaryData, &timesAwarded, &progressID, &progressAchievementID, &progressUserID,
				&progressRawAchievementState, &progressProgress, &progressAwardedAt, &progressAuxiliaryData)

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

		if progressID.Valid {
			achievement.TimesAwarded = timesAwarded.Int64

			progressUUID, err := uuid.FromString(progressID.String)
			if err != nil {
				return nil, err
			}

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
				Id:            progressUUID.String(),
				AchievementId: progressAchievementUUID.String(),
				UserId:        progressUserUUID.String(),
				Progress:      progressProgress.Int64,
				CurrentState: &wrappers.Int32Value{
					Value: int32(progressRawAchievementState.Int64),
				},
				AwardedAt:     ts,
				AuxiliaryData: string(progressAuxiliaryData),
			}

			achievement.CurrentProgress = &achievementProgress
		}

		achievements = append(achievements, &achievement)
	}

	return &api.Achievements{
		Achievements: achievements,
	}, nil
}
