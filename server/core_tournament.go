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
	"strconv"
	"strings"
	"time"

	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

var (
	ErrTournamentNotFound               = errors.New("tournament not found")
	ErrTournamentSubzeroMaxAttemptCount = errors.New("max attempt count must be greater than zero")
	ErrTournamentMaxSizeReached         = errors.New("tournament max size reached")
	ErrTournamentWriteOutsideDuration   = errors.New("tournament submission outside of duration")
	ErrTournamentWriteMaxAttemptReached = errors.New("max attempt count reached")
	ErrTournamentWriteJoinRequired      = errors.New("required to join before writing tournament record")
)

type tournamentListCursor struct {
	// ID fields.
	TournamentId string
}

func TournamentCreate(logger *zap.Logger, cache LeaderboardCache, leaderboardId string, sortOrder, operator int, resetSchedule, metadata,
	description, title string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {

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
		return ErrTournamentSubzeroMaxAttemptCount
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
		return ErrTournamentNotFound
	}

	if !leaderboard.JoinRequired {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	maxSizeReached := false
	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		query := "UPDATE leaderboard SET size = size+1 WHERE size < max_size AND id = $1"
		result, err := tx.Exec(query, tournamentId)
		if err != nil {
			return err
		}

		if rowsAffected, err := result.RowsAffected(); err != nil {
			return err
		} else {
			if rowsAffected == 0 {
				maxSizeReached = true
				return nil
			}
		}

		query = `INSERT INTO leaderboard_record 
(leaderboard_id, owner_id, username, num_score) 
VALUES 
($1, $2, $3, $4)
ON CONFLICT DO NOTHING`
		_, err = tx.Exec(query, tournamentId, owner, username, 0)
		if err != nil {
			return err
		}

		return nil
	}); err != nil {
		logger.Error("Could not join tournament.", zap.Error(err))
		return err
	}

	if maxSizeReached {
		logger.Info("Failed to join tournament as reached max size allowed.", zap.String("tournament_id", tournamentId), zap.String("owner", owner), zap.String("username", username))
		return ErrTournamentMaxSizeReached
	}

	logger.Info("Joined tournament.", zap.String("tournament_id", tournamentId), zap.String("owner", owner), zap.String("username", username))
	return nil
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
		filter += " start_time >= $" + strconv.Itoa(len(params))
	}

	if endTime >= 0 {
		if filter != "" {
			filter += " AND "
		}
		etime := time.Unix(int64(endTime), 0).UTC()
		params = append(params, pq.FormatTimestamp(etime))
		filter += " end_time <= $" + strconv.Itoa(len(params))
	}

	if cursor != nil {
		if filter != "" {
			filter += " AND "
		}
		params = append(params, cursor.TournamentId)
		filter += " id > $" + strconv.Itoa(len(params))
	}

	if ownerId != "" {
		if ids, err := getJoinedTournaments(logger, db, ownerId); err != nil {
			return nil, err
		} else if len(ids) > 0 {
			currentCount := len(params)
			idParams := make([]string, len(ids))
			for i := range ids {
				idParams[i] = "$" + strconv.Itoa(currentCount+i)
			}

			if filter != "" {
				filter += " AND "
			}
			params = append(params, ids)
			filter += " id IN (" + strings.Join(idParams, ",") + ")"
		}
	}

	query = query + filter

	params = append(params, limit)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("Tournament listing query", zap.String("query", query), zap.Any("params", params))
	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Could not retrieve tournaments", zap.Error(err))
		return nil, err
	}

	records := make([]*api.Tournament, 0)
	var newCursor *tournamentListCursor

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

	for rows.Next() {
		if len(records) >= limit {
			newCursor = &tournamentListCursor{
				TournamentId: dbId,
			}
			break
		}

		err = rows.Scan(&dbId, &dbSortOrder, &dbResetSchedule, &dbMetadata, &dbCreateTime,
			&dbCategory, &dbDescription, &dbDuration, &dbEndTime, &dbMaxSize, &dbMaxNumScore, &dbTitle, &dbSize, &dbStartTime)
		if err != nil {
			logger.Error("Error parsing listed tournament records", zap.Error(err))
			return nil, err
		}

		canEnter := true
		endActive := int64(0)
		nextReset := int64(0)

		if dbResetSchedule.Valid {
			cron := cronexpr.MustParse(dbResetSchedule.String)
			schedules := cron.NextN(time.Now().UTC(), 2)
			sessionStartTime := schedules[0].Unix() - (schedules[1].Unix() - schedules[0].Unix())

			endActive = sessionStartTime + int64(dbDuration)
			if endActive < time.Now().UTC().Unix() {
				canEnter = false
			}

			nextReset = schedules[0].Unix()
		} else {
			endActive = dbStartTime.Time.UTC().Unix() + int64(dbDuration)
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
		}

		if dbEndTime.Time.Unix() > 0 {
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

func TournamentRecordWrite(logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, tournamentId, ownerId, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(tournamentId)

	currentTime := time.Now().UTC()
	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		schedules := leaderboard.ResetSchedule.NextN(currentTime, 2)
		sessionStartTime := schedules[0].Unix() - (schedules[1].Unix() - schedules[0].Unix())

		endActive := sessionStartTime + int64(leaderboard.Duration)
		if endActive < currentTime.Unix() {
			logger.Info("Cannot write tournament record as it is outside of tournament duration.")
			return nil, ErrTournamentWriteOutsideDuration
		}

		expiryTime = schedules[0].Unix()
	} else {
		endActive := leaderboard.StartTime + int64(leaderboard.Duration)
		if endActive < currentTime.Unix() {
			logger.Info("Cannot write tournament record as it is outside of tournament duration.")
			return nil, ErrTournamentWriteOutsideDuration
		}
	}

	var record *api.LeaderboardRecord
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, err
	}

	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		if err := tournamentJoinCheck(logger, tx, leaderboard, tournamentId, ownerId); err != nil {
			return err
		}

		if err := tournamentMaxSizeCheck(logger, tx, tournamentId); err != nil {
			return err
		}

		if err := tournamentMaxAttemptCheck(logger, tx, tournamentId, ownerId); err != nil {
			return err
		}

		record, err = tournamentWriteRecord(logger, tx, leaderboard, expiryTime, tournamentId, ownerId, username, score, subscore, metadata)

		//TODO (mo,zyro) update rank cache

		return err
	}); err != nil {
		if err == ErrTournamentMaxSizeReached || err == ErrTournamentWriteMaxAttemptReached || err == ErrTournamentWriteJoinRequired {
			logger.Info("Aborted writing tournament record.", zap.String("reason", err.Error()), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId))
		} else {
			logger.Error("Could not write tournament record.", zap.Error(err), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId))
		}

		return nil, err
	}

	return record, nil
}

func getJoinedTournaments(logger *zap.Logger, db *sql.DB, ownerId string) ([]string, error) {
	result := make([]string, 0)
	rows, err := db.Query("SELECT leaderboard_id FROM leaderboard_record WHERE owner_id = $1 AND expiry_time > now()")
	if err != nil {
		logger.Error("Could not list leaderboard records belonging to owner", zap.Error(err), zap.String("owner_id", ownerId))
		return nil, err
	}

	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			if err == sql.ErrNoRows {
				return make([]string, 0), nil
			}
			logger.Error("Failed to parse database results", zap.Error(err))
			return nil, err
		}

		result = append(result, id)
	}

	return result, nil
}

func tournamentJoinCheck(logger *zap.Logger, tx *sql.Tx, leaderboard *Leaderboard, tournamentId, ownerId string) error {
	if !leaderboard.JoinRequired {
		return nil
	}

	query := "SELECT EXISTS (SELECT id FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time > now())"
	var exists bool
	if err := tx.QueryRow(query, tournamentId, ownerId).Scan(&exists); err != nil {
		logger.Error("Failed to check for tournament join check.", zap.Error(err))
		return err
	}

	if !exists {
		return ErrTournamentWriteJoinRequired
	}

	return nil
}

func tournamentMaxSizeCheck(logger *zap.Logger, tx *sql.Tx, tournamentId string) error {
	query := "SELECT EXISTS (SELECT id FROM leaderboard WHERE leaderboard_id = $1 AND size < max_size)"

	var exists bool
	if err := tx.QueryRow(query, tournamentId).Scan(&exists); err != nil {
		logger.Error("Failed to check for tournament size.", zap.Error(err))
		return err
	}

	if !exists {
		return ErrTournamentMaxSizeReached
	}

	return nil
}

func tournamentMaxAttemptCheck(logger *zap.Logger, tx *sql.Tx, tournamentId, ownerId string) error {
	query := `
SELECT EXISTS (
	SELECT id 
	FROM leaderboard_record 
	WHERE leaderboard_id = $1 
		AND owner_id = $2 
		AND expiry_time > now() 
		AND num_score < max_num_score 
)`
	var exists bool
	if err := tx.QueryRow(query, tournamentId, ownerId).Scan(&exists); err != nil {
		logger.Error("Failed to check for tournament record max attempt count.", zap.Error(err))
		return err
	}

	if !exists {
		return ErrTournamentWriteMaxAttemptReached
	}

	return nil
}

func tournamentWriteRecord(logger *zap.Logger, tx *sql.Tx, leaderboard *Leaderboard, expiryTime int64, tournamentId, ownerId, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
	var opSql string
	var scoreDelta int64
	var subscoreDelta int64
	var scoreAbs int64
	var subscoreAbs int64
	switch leaderboard.Operator {
	case LeaderboardOperatorIncrement:
		opSql = "score = leaderboard_record.score + $8::BIGINT, subscore = leaderboard_record.subscore + $9::BIGINT"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorSet:
		opSql = "score = $8::BIGINT, subscore = $9::BIGINT"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorBest:
		fallthrough
	default:
		if leaderboard.SortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			opSql = "score = ((leaderboard_record.score + $8::BIGINT - abs(leaderboard_record.score - $8::BIGINT)) / 2)::BIGINT, subscore = ((leaderboard_record.subscore + $9::BIGINT - abs(leaderboard_record.subscore - $9::BIGINT)) / 2)::BIGINT"
		} else {
			// Higher score is better.
			opSql = "score = ((leaderboard_record.score + $8::BIGINT + abs(leaderboard_record.score - $8::BIGINT)) / 2)::BIGINT, subscore = ((leaderboard_record.subscore + $9::BIGINT + abs(leaderboard_record.subscore - $9::BIGINT)) / 2)::BIGINT"
		}
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	}

	query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, max_num_score, username, score, subscore, metadata, expiry_time)
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'), CAST($8::BIGINT AS TIMESTAMPTZ))
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSql + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($6, leaderboard_record.metadata), update_time = now()`
	params := make([]interface{}, 0, 9)
	params = append(params, tournamentId, ownerId, leaderboard.MaxNumScore)
	if username == "" {
		params = append(params, nil)
	} else {
		params = append(params, username)
	}
	params = append(params, scoreAbs, subscoreAbs)
	if metadata == "" {
		params = append(params, nil)
	} else {
		params = append(params, metadata)
	}
	params = append(params, expiryTime, scoreDelta, subscoreDelta)

	_, err := tx.Exec(query, params...)
	if err != nil {
		logger.Error("Error writing leaderboard record", zap.Error(err))
		return nil, err
	}

	// only increment leaderboard size if a new record was inserted
	// we test for a new record by comparing create_time = update_time
	query = ` 
UPDATE leaderboard SET size = size + 1 
WHERE id = $1
AND SELECT EXISTS (
	SELECT leaderboard_id FROM leaderboard_record
	WHERE leaderboard_id = $1 
	AND owner_id = $2 
	AND expiry_time > now()
	AND create_time = update_time)`
	_, err = tx.Exec(query, tournamentId)
	if err != nil {
		logger.Error("Error update leaderboard size", zap.Error(err))
		return nil, err
	}

	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMaxNumScore int32
	var dbMetadata string
	var dbCreateTime pq.NullTime
	var dbUpdateTime pq.NullTime
	query = "SELECT username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = CAST($3::BIGINT AS TIMESTAMPTZ)"
	err = tx.QueryRow(query, tournamentId, ownerId, expiryTime).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
	if err != nil {
		logger.Error("Error after writing leaderboard record", zap.Error(err))
		return nil, err
	}

	record := &api.LeaderboardRecord{
		LeaderboardId: tournamentId,
		OwnerId:       ownerId,
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
	if expiryTime != 0 {
		record.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
	}

	return record, nil
}
