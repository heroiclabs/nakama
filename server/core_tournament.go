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
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"fmt"
	"strconv"
	"time"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

type tournamentListCursor struct {
	// ID fields.
	LeaderboardId string
}

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

	//TODO increase leaderboard.size value?

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

func TournamentList(logger *zap.Logger, db *sql.DB, ownerId string, full bool, categoryStart, categoryEnd, startTime, endTime, limit int, cursor *tournamentListCursor) (*api.TournamentList, error) {
	params := make([]interface{}, 0)
	query := `
SELECT 
id, sort_order, reset_schedule, metadata, create_time, 
category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE 
`

	filter := ""
	if !full {
		filter += " size < max_size "
	}

	if categoryStart >= 0 {
		if filter != "" {
			filter += " AND "
		}
		params = append(params, categoryStart)
		filter += " category >= $" + strconv.Itoa(len(params))
	}

	if categoryEnd >= 0 {
		if filter != "" {
			filter += " AND "
		}
		params = append(params, categoryEnd)
		filter += " category <= $" + strconv.Itoa(len(params))
	}

	if startTime >= 0 {
		if filter != "" {
			filter += " AND "
		}
		stime := time.Unix(int64(startTime), 0).UTC()
		params = append(params, pq.FormatTimestamp(stime))
		filter += " startTime >= $" + strconv.Itoa(len(params))
	}

	if endTime >= 0 {
		if filter != "" {
			filter += " AND "
		}
		etime := time.Unix(int64(endTime), 0).UTC()
		params = append(params, pq.FormatTimestamp(etime))
		filter += " endTime <= $" + strconv.Itoa(len(params))
	}

	if cursor != nil {
		if filter != "" {
			filter += " AND "
		}
		params = append(params, cursor.LeaderboardId)
		filter += " id > $" + strconv.Itoa(len(params))
	}

	if ownerId != "" {
		if filter != "" {
			filter += " AND "
		}
		params = append(params, ownerId)
		params = append(params, pq.FormatTimestamp(time.Now().UTC())) //expiry time for a leaderboard record
		subquery := `SELECT leaderboard_id FROM leaderboard_record WHERE owner_id = $` + strconv.Itoa(len(params)-1) + ` AND expired_at > $` + strconv.Itoa(len(params))
		filter += " id IN (" + subquery + ")"
	}

	query += query + filter

	params = append(params, limit)
	query += " LIMIT $" + strconv.Itoa(len(params))

	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Could not retrieve tournaments", zap.Error(err))
		return nil, err
	}

	records := make([]*api.Tournament, 0)
	var newCursor *tournamentListCursor

	var dbId string
	var dbSortOrder int
	var dbResetSchedule string
	var dbMetadata string
	var dbCreateTime pq.NullTime
	var dbCategory int
	var dbDescription string
	var dbDuration int
	var dbEndTime pq.NullTime
	var dbMaxSize int
	var dbMaxNumScore int
	var dbTitle string
	var dbSize int
	var dbStartTime pq.NullTime
	for rows.Next() {
		if len(records) >= limit {
			newCursor = &tournamentListCursor{
				LeaderboardId: dbId,
			}
			break
		}

		err = rows.Scan(&dbId, &dbSortOrder, &dbResetSchedule, &dbMetadata, &dbCreateTime,
			&dbCategory, &dbDescription, &dbDuration, &dbEndTime, &dbMaxSize, &dbMaxNumScore, &dbTitle, &dbSize, dbStartTime)
		if err != nil {
			logger.Error("Error parsing listed tournament records", zap.Error(err))
			return nil, err
		}

		canEnter := true
		endActive := int64(0)
		nextReset := int64(0)

		if dbResetSchedule != "" {
			cron := cronexpr.MustParse(dbResetSchedule)
			schedules := cron.NextN(time.Now().UTC(), 2)
			sessionStartTime := schedules[0].Unix() - (schedules[1].Unix() - schedules[0].Unix())

			endActive = sessionStartTime + int64(dbDuration)
			if endActive < time.Now().UTC().Unix() {
				canEnter = false
			}

			nextReset = schedules[0].Unix()
		} else {
			endActive = int64(startTime + dbDuration)
			if endActive < time.Now().UTC().Unix() {
				canEnter = false
			}
		}

		tournament := &api.Tournament{
			Id:          dbId,
			Title:       dbTitle,
			Description: dbDescription,
			Category:    uint32(dbCategory),
			SortOrder:   uint32(dbSortOrder),
			Size:        uint32(dbSize),
			MaxSize:     uint32(dbMaxSize),
			MaxNumScore: uint32(dbMaxNumScore),
			CanEnter:    canEnter,
			EndActive:   uint32(endActive),
			NextReset:   uint32(nextReset),
			Metadata:    dbMetadata,
			CreateTime:  &timestamp.Timestamp{Seconds: dbCreateTime.Time.UTC().Unix()},
			StartTime:   &timestamp.Timestamp{Seconds: dbStartTime.Time.UTC().Unix()},
			EndTime:     nil,
		}

		if dbEndTime.Valid {
			tournament.EndTime = &timestamp.Timestamp{Seconds: dbEndTime.Time.UTC().Unix()}
		}

		records = append(records, tournament)
	}

	tournamentList := &api.TournamentList{
		Tournaments: records,
	}

	if newCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Error creating tournament records list cursor", zap.Error(err))
			return nil, err
		}
		tournamentList.Cursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return tournamentList, nil
}
