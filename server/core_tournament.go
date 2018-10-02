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
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"errors"
	"time"

	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

var (
	ErrTournamentNotFound                = errors.New("tournament not found")
	ErrTournamentMaxSizeReached          = errors.New("tournament max size reached")
	ErrTournamentOutsideDuration         = errors.New("tournament outside of duration")
	ErrTournamentWriteMaxNumScoreReached = errors.New("max number score count reached")
	ErrTournamentWriteJoinRequired       = errors.New("required to join before writing tournament record")
)

type tournamentListCursor struct {
	// ID fields.
	TournamentId string
}

func TournamentCreate(logger *zap.Logger, cache LeaderboardCache, scheduler *LeaderboardScheduler, leaderboardId string, sortOrder, operator int, resetSchedule, metadata,
	title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {

	leaderboard, err := cache.CreateTournament(leaderboardId, sortOrder, operator, resetSchedule, metadata, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired)

	if err != nil {
		return err
	}

	if leaderboard != nil {
		logger.Info("Tournament created", zap.String("id", leaderboard.Id))
		scheduler.Update()
	}

	return nil
}

func TournamentDelete(logger *zap.Logger, cache LeaderboardCache, rankCache LeaderboardRankCache, scheduler *LeaderboardScheduler, leaderboardId string) error {
	leaderboard := cache.Get(leaderboardId)
	if leaderboard == nil {
		// If it does not exist treat it as success.
		return nil
	}
	// Allow deletion of non-tournament leaderboards here.

	var expiryUnix int64
	if leaderboard.ResetSchedule != nil {
		expiryUnix = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
	}

	if err := cache.Delete(leaderboardId); err != nil {
		return err
	}

	scheduler.Update()
	rankCache.DeleteLeaderboard(leaderboardId, expiryUnix)

	return nil
}

func TournamentAddAttempt(logger *zap.Logger, db *sql.DB, cache LeaderboardCache, leaderboardId string, owner string, count int) error {
	if count == 0 {
		// No-op.
		return nil
	}
	leaderboard := cache.Get(leaderboardId)
	if leaderboard == nil {
		// If it does not exist treat it as success.
		return ErrTournamentNotFound
	}
	if !leaderboard.IsTournament() {
		// Leaderboard exists but is not a tournament, treat it as success.
		return ErrTournamentNotFound
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
	}

	query := `UPDATE leaderboard_record SET max_num_score = (max_num_score + $1) WHERE leaderboard_id = $2 AND owner_id = $3 AND expiry_time = $4`
	_, err := db.Exec(query, count, leaderboardId, owner, time.Unix(expiryTime, 0).UTC())
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
		// If it does not exist treat it as success.
		return ErrTournamentNotFound
	}
	if !leaderboard.IsTournament() {
		// Leaderboard exists but is not a tournament.
		return ErrTournamentNotFound
	}

	if !leaderboard.JoinRequired {
		return nil
	}

	now := time.Now().UTC()
	nowUnix := now.Unix()
	startActive, endActive, _ := calculateTournamentDeadlines(leaderboard, now)
	if startActive > nowUnix || endActive <= nowUnix {
		logger.Info("Cannot join tournament outside of tournament duration.")
		return ErrTournamentOutsideDuration
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(now).UTC().Unix()
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		query := `INSERT INTO leaderboard_record 
(leaderboard_id, owner_id, expiry_time, username, num_score, max_num_score) 
VALUES 
($1, $2, $3, $4, $5, $6)
ON CONFLICT(owner_id, leaderboard_id, expiry_time) DO NOTHING`
		result, err := tx.Exec(query, tournamentId, owner, time.Unix(expiryTime, 0).UTC(), username, 0, leaderboard.MaxNumScore)
		if err != nil {
			return err
		}

		if rowsAffected, err := result.RowsAffected(); err != nil {
			return err
		} else if rowsAffected != 1 {
			// Owner has already joined this tournament, treat it as a no-op.
			return nil
		}

		query = "UPDATE leaderboard SET size = size+1 WHERE id = $1 AND size < max_size"
		result, err = tx.Exec(query, tournamentId)
		if err != nil {
			return err
		}

		if rowsAffected, err := result.RowsAffected(); err != nil {
			return err
		} else if rowsAffected == 0 {
			// Tournament is full.
			return ErrTournamentMaxSizeReached
		}

		return nil
	}); err != nil {
		if err == ErrTournamentMaxSizeReached {
			logger.Info("Failed to join tournament, reached max size allowed.", zap.String("tournament_id", tournamentId), zap.String("owner", owner), zap.String("username", username))
			return err
		} else {
			logger.Error("Could not join tournament.", zap.Error(err))
			return err
		}
	}

	logger.Info("Joined tournament.", zap.String("tournament_id", tournamentId), zap.String("owner", owner), zap.String("username", username))
	return nil
}

func TournamentList(logger *zap.Logger, db *sql.DB, categoryStart, categoryEnd, startTime, endTime, limit int, cursor *tournamentListCursor) (*api.TournamentList, error) {
	now := time.Now().UTC()

	query := `
SELECT 
id, sort_order, reset_schedule, metadata, create_time, category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE duration > 0 AND start_time >= $1 AND end_time <= $2 AND category >= $3 AND category <= $4`

	params := make([]interface{}, 0, 6)
	if startTime >= 0 {
		params = append(params, time.Unix(int64(startTime), 0).UTC())
	} else {
		params = append(params, time.Unix(0, 0).UTC())
	}
	if endTime >= 0 {
		params = append(params, time.Unix(int64(endTime), 0).UTC())
	} else {
		params = append(params, time.Unix(0, 0).UTC())
	}
	if categoryStart >= 0 && categoryStart <= 127 {
		params = append(params, categoryStart)
	} else {
		params = append(params, 0)
	}
	if categoryEnd >= 0 && categoryEnd <= 127 {
		params = append(params, categoryEnd)
	} else {
		params = append(params, 127)
	}

	// To ensure that there are more records, so the cursor is returned/
	params = append(params, limit+1)

	if cursor != nil {
		query += " AND id > $6"
		params = append(params, cursor.TournamentId)
	}

	query += " LIMIT $5"

	logger.Debug("Tournament listing query", zap.String("query", query), zap.Any("params", params))
	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Could not retrieve tournaments", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	records := make([]*api.Tournament, 0)
	newCursor := &tournamentListCursor{}

	count := 0
	for rows.Next() {
		tournament, err := parseTournament(rows, now)
		if err != nil {
			logger.Error("Error parsing listed tournament records", zap.Error(err))
			return nil, err
		}
		count++

		if count <= limit {
			records = append(records, tournament)
		} else if count > limit {
			newCursor.TournamentId = records[limit].Id
		}
	}

	tournamentList := &api.TournamentList{
		Tournaments: records,
	}

	if newCursor.TournamentId != "" {
		cursorBuf := new(bytes.Buffer)
		if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Error creating tournament records list cursor", zap.Error(err))
			return nil, err
		}
		tournamentList.Cursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return tournamentList, nil
}

func TournamentRecordWrite(logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, tournamentId string, ownerId uuid.UUID, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(tournamentId)

	nowTime := time.Now().UTC()
	nowUnix := nowTime.Unix()

	startActiveUnix, endActiveUnix, expiryUnix := calculateTournamentDeadlines(leaderboard, nowTime)
	if startActiveUnix > nowUnix || endActiveUnix <= nowUnix {
		logger.Info("Cannot write tournament record as it is outside of tournament duration.", zap.String("id", leaderboard.Id))
		return nil, ErrTournamentOutsideDuration
	}

	expiryTime := time.Unix(expiryUnix, 0).UTC()

	var opSql string
	var scoreDelta int64
	var subscoreDelta int64
	var scoreAbs int64
	var subscoreAbs int64
	switch leaderboard.Operator {
	case LeaderboardOperatorIncrement:
		opSql = "score = leaderboard_record.score + $5::BIGINT, subscore = leaderboard_record.subscore + $6::BIGINT"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorSet:
		opSql = "score = $5::BIGINT, subscore = $6::BIGINT"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorBest:
		fallthrough
	default:
		if leaderboard.SortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			opSql = "score = ((leaderboard_record.score + $5::BIGINT - abs(leaderboard_record.score - $5::BIGINT)) / 2)::BIGINT, subscore = ((leaderboard_record.subscore + $6::BIGINT - abs(leaderboard_record.subscore - $6::BIGINT)) / 2)::BIGINT"
		} else {
			// Higher score is better.
			opSql = "score = ((leaderboard_record.score + $5::BIGINT + abs(leaderboard_record.score - $5::BIGINT)) / 2)::BIGINT, subscore = ((leaderboard_record.subscore + $6::BIGINT + abs(leaderboard_record.subscore - $6::BIGINT)) / 2)::BIGINT"
		}
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	}

	params := make([]interface{}, 0, 10)
	params = append(params, leaderboard.Id, ownerId)
	if username == "" {
		params = append(params, nil)
	} else {
		params = append(params, username)
	}
	params = append(params, expiryTime, scoreDelta, subscoreDelta)
	if metadata == "" {
		params = append(params, nil)
	} else {
		params = append(params, metadata)
	}

	if leaderboard.JoinRequired {
		// If join is required then the user must already have a record to update.
		// There's also no need to increment the number of records tracked for this tournament.

		query := `UPDATE leaderboard_record
              SET ` + opSql + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($7, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now()
              WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $4 AND (max_num_score = 0 OR num_score < max_num_score)`

		res, err := db.Exec(query, params...)
		if err != nil {
			logger.Error("Error writing tournament record", zap.Error(err))
			return nil, err
		}

		if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
			// Tournament required join but no row was found to update.
			return nil, ErrTournamentWriteJoinRequired
		}
	} else {
		// Update or insert a new record. Maybe increment number of records tracked for this tournament.

		query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time, max_num_score)
            VALUES ($1, $2, $3, $8, $9, COALESCE($7, '{}'::JSONB), $4, $10)
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSql + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($7, leaderboard_record.metadata), update_time = now()
						RETURNING num_score, max_num_score`
		params = append(params, scoreAbs, subscoreAbs, leaderboard.MaxNumScore)

		var dbNumScore int
		var dbMaxNumScore int

		tx, err := db.Begin()
		if err != nil {
			logger.Error("Could not begin database transaction.", zap.Error(err))
			return nil, err
		}

		if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
			if err := tx.QueryRow(query, params...).Scan(&dbNumScore, &dbMaxNumScore); err != nil {
				return err
			}

			// Check if the max number of submissions has been reached.
			if dbMaxNumScore > 0 && dbNumScore > dbMaxNumScore {
				return ErrTournamentWriteMaxNumScoreReached
			}

			// Check if we need to increment the tournament score count by checking if this was a newly inserted record.
			if dbNumScore <= 1 {
				res, err := tx.Exec("UPDATE leaderboard SET size = size + 1 WHERE id = $1 AND (max_size = 0 OR size < max_size)", leaderboard.Id)
				if err != nil {
					logger.Error("Error updating tournament size", zap.Error(err))
					return err
				}
				if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
					// If the update failed then the tournament had a max size and it was met or exceeded.
					return ErrTournamentMaxSizeReached
				}
			}

			return nil
		}); err != nil {
			if err == ErrTournamentWriteMaxNumScoreReached || err == ErrTournamentMaxSizeReached {
				logger.Info("Aborted writing tournament record", zap.String("reason", err.Error()), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId.String()))
			} else {
				logger.Error("Could not write tournament record", zap.Error(err), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId.String()))
			}
			return nil, err
		}
	}

	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMaxNumScore int32
	var dbMetadata string
	var dbCreateTime pq.NullTime
	var dbUpdateTime pq.NullTime
	query := "SELECT username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
	err := db.QueryRow(query, leaderboard.Id, ownerId, expiryTime).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
	if err != nil {
		logger.Error("Error after writing leaderboard record", zap.Error(err))
		return nil, err
	}

	// Prepare the return record.
	record := &api.LeaderboardRecord{
		LeaderboardId: leaderboard.Id,
		OwnerId:       ownerId.String(),
		Score:         dbScore,
		Subscore:      dbSubscore,
		NumScore:      dbNumScore,
		MaxNumScore:   uint32(dbMaxNumScore),
		Metadata:      dbMetadata,
		CreateTime:    &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
		UpdateTime:    &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
	}
	if dbUsername.Valid {
		record.Username = &wrappers.StringValue{Value: dbUsername.String}
	}
	if u := expiryTime.Unix(); u != 0 {
		record.ExpiryTime = &timestamp.Timestamp{Seconds: u}
	}

	// Enrich the return record with rank data.
	record.Rank = rankCache.Insert(leaderboard.Id, expiryUnix, leaderboard.SortOrder, ownerId, record.Score, record.Subscore)

	return record, nil
}

func TournamentRecordsHaystack(logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId string, ownerId uuid.UUID, limit int) ([]*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	sortOrder := leaderboard.SortOrder

	_, _, expiry := calculateTournamentDeadlines(leaderboard, time.Now().UTC())
	expiryTime := time.Unix(expiry, 0).UTC()

	return getLeaderboardRecordsHaystack(logger, db, rankCache, ownerId, limit, leaderboard.Id, sortOrder, expiryTime)
}

func calculateTournamentDeadlines(leaderboard *Leaderboard, t time.Time) (int64, int64, int64) {
	if leaderboard.ResetSchedule != nil {
		schedules := leaderboard.ResetSchedule.NextN(t, 2)
		schedule0Unix := schedules[0].UTC().Unix()
		schedule1Unix := schedules[1].UTC().Unix()

		startActiveUnix := schedule0Unix - (schedule1Unix - schedule0Unix)
		endActiveUnix := startActiveUnix + int64(leaderboard.Duration)
		expiryUnix := schedule0Unix

		if leaderboard.StartTime > endActiveUnix {
			// The start time after the end of the current active period but before the next reset.
			// e.g. Reset schedule is daily at noon, duration is 1 hour, but time is currently 3pm.
			startActiveUnix = leaderboard.ResetSchedule.Next(time.Unix(leaderboard.StartTime, 0).UTC()).UTC().Unix()
			endActiveUnix = startActiveUnix + int64(leaderboard.Duration)
			expiryUnix = startActiveUnix + (schedule1Unix - schedule0Unix)
		}

		return startActiveUnix, endActiveUnix, expiryUnix
	} else {
		endActiveUnix := int64(0)
		if leaderboard.StartTime <= t.Unix() {
			endActiveUnix = leaderboard.StartTime + int64(leaderboard.Duration)
		}
		expiryUnix := leaderboard.EndTime
		return leaderboard.StartTime, endActiveUnix, expiryUnix
	}
}

func parseTournament(scannable Scannable, now time.Time) (*api.Tournament, error) {
	var dbId string
	var dbSortOrder int
	var dbResetSchedule sql.NullString
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
	err := scannable.Scan(&dbId, &dbSortOrder, &dbResetSchedule, &dbMetadata, &dbCreateTime,
		&dbCategory, &dbDescription, &dbDuration, &dbEndTime, &dbMaxSize, &dbMaxNumScore, &dbTitle, &dbSize, &dbStartTime)
	if err != nil {
		return nil, err
	}

	canEnter := true
	endActive := int64(0)
	nextReset := int64(0)

	if dbResetSchedule.Valid {
		cron := cronexpr.MustParse(dbResetSchedule.String)
		schedules := cron.NextN(now, 2)
		sessionStartTime := schedules[0].Unix() - (schedules[1].Unix() - schedules[0].Unix())

		if dbStartTime.Time.UTC().After(now) {
			endActive = 0
		} else {
			endActive = sessionStartTime + int64(dbDuration)
		}
		nextReset = schedules[0].Unix()
	} else {
		if dbStartTime.Time.UTC().After(now) {
			endActive = 0
		} else {
			endActive = dbStartTime.Time.UTC().Unix() + int64(dbDuration)
		}
	}

	if endActive < now.Unix() {
		canEnter = false
	}

	if canEnter && dbSize == dbMaxSize {
		canEnter = false
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
	}

	if dbEndTime.Time.Unix() > 0 {
		tournament.EndTime = &timestamp.Timestamp{Seconds: dbEndTime.Time.UTC().Unix()}
	}

	return tournament, nil
}
