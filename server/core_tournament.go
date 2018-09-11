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
	"fmt"

	"go.uber.org/zap"
)

func TournamentCreate(logger *zap.Logger, cache LeaderboardCache, leaderboardId string, sortOrder, operator int, resetSchedule, metadata,
	description, title string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {
	/*
	  val current_time = now()
	  val expiry_time = cronexpr(“”, current_time)
	  val next_expiry_time = expiry_time.next()
	  val start_time = expiry_time - (next_expiry_time - expiry_time) (edited)

	  val submittable_time = (start_time + duration)
	  val issubmittable = (submittable_time - current_time) > 0
	*/

	leaderboard, err := cache.CreateTournament(leaderboardId, sortOrder, operator, resetSchedule, metadata,
		description, title, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired)

	if err != nil {
		return err
	}

	if leaderboard != nil {
		// TODO(mo, zyro) setup scheduled job for tournament
		logger.Info("Tournament created", zap.String("id", leaderboard.Id))
	}

	return nil
}

func TournamentDelete(logger *zap.Logger, cache LeaderboardCache, leaderboardId string) error {
	if err := cache.Delete(leaderboardId); err != nil {
		return err
	}

	// TODO(mo, zyro) delete scheduled job for tournament
	return nil
}

func TournamentAddAttempt(logger *zap.Logger, db *sql.DB, leaderboardId string, owner string, count int) error {
	if count <= 0 {
		return fmt.Errorf("max attempt count must be greater than zero")
	}

	query := `UPDATE leaderboard_record SET max_num_score=$1 WHERE leaderboard_id = $2 AND owner = $3`
	_, err := db.Exec(query, count, leaderboardId, owner)
	if err != nil {
		logger.Error("Could not increment max attempt counter", zap.Error(err))
	} else {
		logger.Info("Max attempt count was increased", zap.Int("new_count", count), zap.String("owner", owner), zap.String("leaderboard_id", leaderboardId))
	}
	return nil
}

func TournamentJoin(logger *zap.Logger, db *sql.DB, cache LeaderboardCache, owner, username, tournamentId string) error {
	leaderboard := cache.Get(tournamentId)
	if leaderboard == nil {
		return fmt.Errorf("tournament not found: %s", tournamentId)
	}

	if !leaderboard.JoinRequired {
		return nil
	}

	query := `INSERT INTO leaderboard_record 
(leaderboard_id, owner_id, username, num_score) 
VALUES 
($1, $2, $3, $4)
ON CONFLICT DO NOTHING`
	_, err := db.Exec(query, tournamentId, owner, username, 0)
	if err != nil {
		logger.Error("Could not join tournament.", zap.Error(err))
	}

	return err
}
