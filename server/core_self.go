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
	"database/sql"
	"encoding/json"
	"errors"
	"go.uber.org/zap"
	"strconv"
	"strings"
)

type SelfUpdateOp struct {
	UserId    string
	Handle    string
	Fullname  string
	Timezone  string
	Location  string
	Lang      string
	Metadata  []byte
	AvatarUrl string
}

func SelfUpdate(logger *zap.Logger, db *sql.DB, updates []*SelfUpdateOp) (Error_Code, error) {
	// Use same timestamp for all updates in this batch.
	ts := nowMs()

	// Start a transaction.
	tx, e := db.Begin()
	if e != nil {
		logger.Error("Could not update user profile, transaction error", zap.Error(e))
		return RUNTIME_EXCEPTION, errors.New("Could not update user profile")
	}

	var code Error_Code
	var err error
	defer func() {
		if err != nil {
			if rollbackErr := tx.Rollback(); rollbackErr != nil { // don't override value of err
				logger.Error("Could not update user profile, rollback error", zap.Error(rollbackErr))
			}
		} else {
			if e := tx.Commit(); e != nil {
				logger.Error("Could not update user profile, commit error", zap.Error(e))
				code = RUNTIME_EXCEPTION
				err = errors.New("Could not update user profile")
			}
		}
	}()

	for _, update := range updates {
		index := 1
		statements := make([]string, 0)
		params := make([]interface{}, 0)
		if update.Handle != "" {
			if len(update.Handle) > 128 {
				code = BAD_INPUT
				err = errors.New("Handle must be 1-128 characters long")
				return code, err
			}
			statements = append(statements, "handle = $"+strconv.Itoa(index))
			params = append(params, update.Handle)
			index++
		}
		if update.Fullname != "" {
			statements = append(statements, "fullname = $"+strconv.Itoa(index))
			params = append(params, update.Fullname)
			index++
		}
		if update.Timezone != "" {
			statements = append(statements, "timezone = $"+strconv.Itoa(index))
			params = append(params, update.Timezone)
			index++
		}
		if update.Location != "" {
			statements = append(statements, "location = $"+strconv.Itoa(index))
			params = append(params, update.Location)
			index++
		}
		if update.Lang != "" {
			statements = append(statements, "lang = $"+strconv.Itoa(index))
			params = append(params, update.Lang)
			index++
		}
		if len(update.Metadata) != 0 {
			// Make this `var js interface{}` if we want to allow top-level JSON arrays.
			var maybeJSON map[string]interface{}
			if json.Unmarshal(update.Metadata, &maybeJSON) != nil {
				code = BAD_INPUT
				err = errors.New("Metadata must be a valid JSON object")
				return code, err
			}

			statements = append(statements, "metadata = $"+strconv.Itoa(index))
			params = append(params, update.Metadata)
			index++
		}
		if update.AvatarUrl != "" {
			statements = append(statements, "avatar_url = $"+strconv.Itoa(index))
			params = append(params, update.AvatarUrl)
			index++
		}

		if len(statements) == 0 {
			code = BAD_INPUT
			err = errors.New("No fields to update")
			return code, err
		}

		params = append(params, ts, update.UserId)

		res, err := tx.Exec(
			"UPDATE users SET updated_at = $"+strconv.Itoa(index)+", "+strings.Join(statements, ", ")+" WHERE id = $"+strconv.Itoa(index+1),
			params...)

		if err != nil {
			if strings.HasSuffix(err.Error(), "violates unique constraint \"users_handle_key\"") {
				code = USER_HANDLE_INUSE
				err = errors.New("Handle is in use")
			} else {
				logger.Warn("Could not update user profile, update error", zap.Error(err))
				code = RUNTIME_EXCEPTION
				err = errors.New("Could not update user profile")
			}
			return code, err
		} else if count, _ := res.RowsAffected(); count == 0 {
			logger.Warn("Could not update user profile, rows affected error")
			code = RUNTIME_EXCEPTION
			err = errors.New("Failed to update user profile")
			return code, err
		}
	}

	return code, err
}
