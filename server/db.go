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
	"go.uber.org/zap"
)

const (
	dbErrorUniqueViolation = "23505"
)

func Transact(logger *zap.Logger, db *sql.DB, txFunc func(*sql.Tx) error) (err error) {
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction", zap.Error(err))
		return
	}

	fnErr := txFunc(tx)

	if p := recover(); p != nil {
		if err = tx.Rollback(); err != nil {
			logger.Error("Could not rollback database transaction", zap.Error(err))
		}
	} else if fnErr != nil {
		if err = tx.Rollback(); err != nil {
			logger.Error("Could not rollback database transaction", zap.Error(err))
		}
	} else {
		if err = tx.Commit(); err != nil {
			logger.Error("Could not commit database transaction", zap.Error(err))
		}
	}
	return fnErr
}
