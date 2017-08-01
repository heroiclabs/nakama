// Copyright 2017 The Nakama Authors
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
	"encoding/json"

	"database/sql"
	"errors"

	"github.com/gorhill/cronexpr"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func leaderboardCreate(logger *zap.Logger, db *sql.DB, id, sortOrder, resetSchedule, metadata string, authoritative bool) ([]byte, error) {
	query := `INSERT INTO leaderboard (id, authoritative, sort_order, reset_schedule, metadata)
	VALUES ($1, $2, $3, $4, $5)`
	params := []interface{}{}

	// ID.
	if id == "" {
		params = append(params, uuid.NewV4().Bytes())
	} else {
		params = append(params, []byte(id))
	}

	// Authoritative.
	params = append(params, authoritative)

	// Sort order.
	if sortOrder == "asc" {
		params = append(params, 0)
	} else if sortOrder == "desc" {
		params = append(params, 1)
	} else {
		logger.Warn("Invalid sort value, must be 'asc' or 'desc'.", zap.String("sort", sortOrder))
		return nil, errors.New("Invalid sort value, must be 'asc' or 'desc'.")
	}

	// Count is hardcoded in the INSERT above.

	// Reset schedule.
	if resetSchedule != "" {
		_, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			logger.Warn("Failed to parse reset schedule", zap.String("reset", resetSchedule), zap.Error(err))
			return nil, err
		}
		params = append(params, resetSchedule)
	} else {
		params = append(params, nil)
	}

	// Metadata.
	metadataBytes := []byte(metadata)
	var maybeJSON map[string]interface{}
	if err := json.Unmarshal(metadataBytes, &maybeJSON); err != nil {
		logger.Warn("Failed to unmarshall metadata", zap.String("metadata", metadata), zap.Error(err))
		return nil, err
	}
	params = append(params, metadataBytes)

	res, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Error creating leaderboard", zap.Error(err))
		return nil, err
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
		logger.Error("Error creating leaderboard, unexpected insert result")
		return nil, errors.New("Error creating leaderboard, unexpected insert result")
	}

	return params[0].([]byte), nil
}

func leaderboardSubmit(logger *zap.Logger, db *sql.DB, clientSubmit bool, leaderboardID uuid.UUID, ownerID uuid.UUID, handle string, lang string, op string, value int64, location string, timezone string, metadata []byte) (*LeaderboardRecord, error) {
	var authoritative bool
	var sortOrder int64
	var resetSchedule sql.NullString
	query := "SELECT authoritative, sort_order, reset_schedule FROM leaderboard WHERE id = $1"
	logger.Debug("Leaderboard lookup", zap.String("query", query), zap.String("leaderboard_id", leaderboardID.String()))
	err := db.QueryRow(query, leaderboardID.Bytes()).
		Scan(&authoritative, &sortOrder, &resetSchedule)
	if err != nil {
		logger.Error("Could not execute leaderboard record write metadata query", zap.Error(err))
		return nil, errors.New("Error writing leaderboard record")
	}

	now := now()
	updatedAt := timeToMs(now)
	expiresAt := int64(0)
	if resetSchedule.Valid {
		expr, err := cronexpr.Parse(resetSchedule.String)
		if err != nil {
			logger.Error("Could not parse leaderboard reset schedule query", zap.Error(err))
			return nil, errors.New("Error writing leaderboard record")
		}
		expiresAt = timeToMs(expr.Next(now))
	}

	if authoritative == true && clientSubmit {
		return nil, errors.New("Cannot submit to authoritative leaderboard")
	}

	var scoreOpSql string
	var scoreDelta int64
	var scoreAbs int64
	switch op {
	case "incr":
		scoreOpSql = "score = leaderboard_record.score + $17::BIGINT"
		scoreDelta = value
		scoreAbs = value
	case "decr":
		scoreOpSql = "score = leaderboard_record.score - $17::BIGINT"
		scoreDelta = value
		scoreAbs = 0 - value
	case "set":
		scoreOpSql = "score = $17::BIGINT"
		scoreDelta = value
		scoreAbs = value
	case "best":
		if sortOrder == 0 {
			// Lower score is better.
			scoreOpSql = "score = ((leaderboard_record.score + $17::BIGINT - abs(leaderboard_record.score - $17::BIGINT)) / 2)::BIGINT"
		} else {
			// Higher score is better.
			scoreOpSql = "score = ((leaderboard_record.score + $17::BIGINT + abs(leaderboard_record.score - $17::BIGINT)) / 2)::BIGINT"
		}
		scoreDelta = value
		scoreAbs = value
	default:
		return nil, errors.New("Unknown leaderboard record write operator")
	}

	params := []interface{}{uuid.NewV4().Bytes(), leaderboardID.Bytes(), ownerID.Bytes(), handle, lang}
	if location != "" {
		params = append(params, location)
	} else {
		params = append(params, nil)
	}
	if timezone != "" {
		params = append(params, timezone)
	} else {
		params = append(params, nil)
	}
	params = append(params, 0, scoreAbs, 1)
	if len(metadata) != 0 {
		params = append(params, metadata)
	} else {
		params = append(params, nil)
	}
	params = append(params, 0, updatedAt, invertMs(updatedAt), expiresAt, 0, scoreDelta)

	query = `INSERT INTO leaderboard_record (id, leaderboard_id, owner_id, handle, lang, location, timezone,
				rank_value, score, num_score, metadata, ranked_at, updated_at, updated_at_inverse, expires_at, banned_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, '{}'), $12, $13, $14, $15, $16)
			ON CONFLICT (leaderboard_id, expires_at, owner_id)
			DO UPDATE SET handle = $4, lang = $5, location = COALESCE($6, leaderboard_record.location),
			  timezone = COALESCE($7, leaderboard_record.timezone), ` + scoreOpSql + `, num_score = leaderboard_record.num_score + 1,
			  metadata = COALESCE($11, leaderboard_record.metadata), updated_at = $13`
	logger.Debug("Leaderboard record write", zap.String("query", query))
	res, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboard record write query", zap.Error(err))
		return nil, errors.New("Error writing leaderboard record")
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		logger.Error("Unexpected row count from leaderboard record write query")
		return nil, errors.New("Error writing leaderboard record")
	}

	record, err := leaderboardQueryRecords(logger, db, leaderboardID, ownerID, handle, lang, expiresAt, updatedAt)
	if err != nil {
		return nil, errors.New("Error writing leaderboard record")
	}
	return record, nil
}

func leaderboardQueryRecords(logger *zap.Logger, db *sql.DB, leaderboardID uuid.UUID, ownerID uuid.UUID, handle string, lang string, expiresAt int64, updatedAt int64) (*LeaderboardRecord, error) {
	var location sql.NullString
	var timezone sql.NullString
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var bannedAt int64
	query := `SELECT location, timezone, rank_value, score, num_score, metadata, ranked_at, banned_at
		FROM leaderboard_record
		WHERE leaderboard_id = $1
		AND expires_at = $2
		AND owner_id = $3`
	logger.Debug("Leaderboard record read", zap.String("query", query))
	err := db.QueryRow(query, leaderboardID.Bytes(), expiresAt, ownerID.Bytes()).
		Scan(&location, &timezone, &rankValue, &score, &numScore, &metadata, &rankedAt, &bannedAt)
	if err != nil {
		logger.Error("Could not execute leaderboard record read query", zap.Error(err))
		return nil, err
	}

	return &LeaderboardRecord{
		LeaderboardId: leaderboardID.Bytes(),
		OwnerId:       ownerID.Bytes(),
		Handle:        handle,
		Lang:          lang,
		Location:      location.String,
		Timezone:      timezone.String,
		Rank:          rankValue,
		Score:         score,
		NumScore:      numScore,
		Metadata:      metadata,
		RankedAt:      rankedAt,
		UpdatedAt:     updatedAt,
		ExpiresAt:     expiresAt,
	}, nil
}
