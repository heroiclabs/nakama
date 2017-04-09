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

func createLeaderboard(logger *zap.Logger, db *sql.DB, id, sortOrder, resetSchedule, metadata string, authoritative bool) ([]byte, error) {
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
