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

func CreateTournament(logger *zap.Logger, db *sql.DB, cache LeaderboardCache, leaderboardId string, sortOrder, operator int, resetSchedule, metadata,
	description, title string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {
	/*
	  val current_time = now()
	  val expiry_time = cronexpr(“”, current_time)
	  val next_expiry_time = expiry_time.next()
	  val start_time = expiry_time - (next_expiry_time - expiry_time) (edited)

	  val submittable_time = (start_time + duration)
	  val issubmittable = (submittable_time - current_time) > 0
	*/

	if err := cache.CreateTournament(leaderboardId, sortOrder, operator, resetSchedule, metadata,
		description, title, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired); err != nil {
		logger.Error("Error while creating tournament", zap.Error(err))
		return err
	}

	return nil
}
