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
	ErrTournamentZeroMaxAttemptCount     = errors.New("max attempt count must be greater or less than zero")
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

	leaderboard, err := cache.CreateTournament(leaderboardId, sortOrder, operator, resetSchedule, metadata,
		title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired)

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
	if err := cache.Delete(leaderboardId); err != nil {
		return err
	}

	scheduler.Update()
	rankCache.DeleteLeaderboard(leaderboardId)

	return nil
}

func TournamentAddAttempt(logger *zap.Logger, db *sql.DB, leaderboardId string, owner string, count int) error {
	if count == 0 {
		return ErrTournamentZeroMaxAttemptCount
	}

	query := `UPDATE leaderboard_record SET max_num_score = (max_num_score + $1) WHERE leaderboard_id = $2 AND owner_id = $3`
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

	now := time.Now().UTC()
	startActive, endActive, _ := calculateTournamentDeadlines(leaderboard, now)
	if startActive > now.Unix() || endActive <= now.Unix() {
		logger.Info("Cannot join tournament record as it is outside of tournament duration.")
		return ErrTournamentOutsideDuration
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

		expiryTime := int64(0)
		if leaderboard.ResetSchedule != nil {
			expiryTime = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
		}

		query = `INSERT INTO leaderboard_record 
(leaderboard_id, owner_id, expiry_time, username, num_score) 
VALUES 
($1, $2, $3, $4, $5)
ON CONFLICT(owner_id, leaderboard_id, expiry_time) DO NOTHING`
		_, err = tx.Exec(query, tournamentId, owner, time.Unix(expiryTime, 0).UTC(), username, 0)
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
WHERE`

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
		params = append(params, time.Unix(int64(startTime), 0).UTC())
		filter += " start_time >= $" + strconv.Itoa(len(params))
	}

	if endTime >= 0 {
		if filter != "" {
			filter += " AND "
		}
		params = append(params, time.Unix(int64(endTime), 0).UTC())
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
		} else if len(ids) == 0 {
			return &api.TournamentList{
				Tournaments: make([]*api.Tournament, 0),
			}, nil
		} else if len(ids) > 0 {
			idParams := make([]string, len(ids))
			for i, id := range ids {
				params = append(params, id)
				idParams[i] = "$" + strconv.Itoa(len(params))
			}

			if filter != "" {
				filter += " AND "
			}

			filter += " id IN (" + strings.Join(idParams, ",") + ")"
		}
	}

	query = query + filter

	params = append(params, limit+1) // to ensure that there are more records, so the cursor is returned
	query += " LIMIT $" + strconv.Itoa(len(params))

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
		tournament, err := parseTournament(rows)
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

	now := time.Now().UTC()
	startActive, endActive, expiryTime := calculateTournamentDeadlines(leaderboard, now)
	if startActive > now.Unix() || endActive <= now.Unix() {
		logger.Info("Cannot write tournament record as it is outside of tournament duration.", zap.String("id", leaderboard.Id))
		return nil, ErrTournamentOutsideDuration
	}

	var record *api.LeaderboardRecord
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, err
	}

	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		if err := tournamentJoinCheck(logger, tx, leaderboard, ownerId); err != nil {
			return err
		}

		if err := tournamentMaxSizeCheck(logger, tx, leaderboard); err != nil {
			return err
		}

		if err := tournamentMaxNumScoreCheck(logger, tx, leaderboard.Id, ownerId); err != nil {
			return err
		}

		record, err = tournamentWriteRecord(logger, tx, leaderboard, expiryTime, ownerId, username, score, subscore, metadata)
		record.Rank = rankCache.Insert(leaderboard.Id, leaderboard.SortOrder, expiryTime, ownerId, record.Score, record.Subscore)
		return err
	}); err != nil {
		if err == ErrTournamentMaxSizeReached || err == ErrTournamentWriteMaxNumScoreReached || err == ErrTournamentWriteJoinRequired {
			logger.Info("Aborted writing tournament record", zap.String("reason", err.Error()), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId.String()))
		} else {
			logger.Error("Could not write tournament record", zap.Error(err), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId.String()))
		}

		return nil, err
	}

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

func getJoinedTournaments(logger *zap.Logger, db *sql.DB, ownerId string) ([]interface{}, error) {
	result := make([]interface{}, 0)
	query := `SELECT leaderboard_id FROM leaderboard_record WHERE (owner_id = $1 AND expiry_time > now()) OR (owner_id = $1 AND expiry_time = '1970-01-01 00:00:00')`
	logger.Debug("Finding joined tournaments", zap.String("query", query))
	rows, err := db.Query(query, ownerId)
	if err != nil {
		logger.Error("Could not list leaderboard records belonging to owner", zap.Error(err), zap.String("owner_id", ownerId))
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			if err == sql.ErrNoRows {
				return make([]interface{}, 0), nil
			}
			logger.Error("Failed to parse database results", zap.Error(err))
			return nil, err
		}

		result = append(result, id)
	}

	logger.Debug("Found joined tournaments", zap.Any("tournament_ids", result))

	return result, nil
}

func tournamentJoinCheck(logger *zap.Logger, tx *sql.Tx, leaderboard *Leaderboard, ownerId uuid.UUID) error {
	if !leaderboard.JoinRequired {
		return nil
	}

	query := `
SELECT EXISTS (
	SELECT leaderboard_id 
	FROM leaderboard_record 
	WHERE leaderboard_id = $1 
		AND owner_id = $2 
		AND (expiry_time > now() OR expiry_time = '1970-01-01 00:00:00')
)`
	var exists bool
	if err := tx.QueryRow(query, leaderboard.Id, ownerId).Scan(&exists); err != nil {
		logger.Error("Failed to check for tournament join check", zap.Error(err))
		return err
	}

	if !exists {
		return ErrTournamentWriteJoinRequired
	}

	return nil
}

func tournamentMaxSizeCheck(logger *zap.Logger, tx *sql.Tx, leaderboard *Leaderboard) error {
	if leaderboard.MaxSize == 0 {
		return nil
	}

	query := "SELECT EXISTS (SELECT id FROM leaderboard WHERE id = $1 AND max_size > 0 AND size < max_size)"

	var exists bool
	if err := tx.QueryRow(query, leaderboard.Id).Scan(&exists); err != nil {
		logger.Error("Failed to check for tournament size", zap.Error(err))
		return err
	}

	if !exists {
		return ErrTournamentMaxSizeReached
	}

	return nil
}

func tournamentMaxNumScoreCheck(logger *zap.Logger, tx *sql.Tx, tournamentId string, ownerId uuid.UUID) error {
	// cannot cache max_num_score in memory as they are per entry

	query := `
SELECT EXISTS (
	SELECT leaderboard_id 
	FROM leaderboard_record 
	WHERE leaderboard_id = $1 
		AND owner_id = $2 
		AND ( expiry_time > now() OR expiry_time = '1970-01-01 00:00:00' )
		AND max_num_score > 0
		AND num_score = max_num_score 
)`

	logger.Debug("Checking max number score", zap.String("query", query), zap.String("tournament_id", tournamentId), zap.String("owner_id", ownerId.String()))

	var exists bool
	if err := tx.QueryRow(query, tournamentId, ownerId).Scan(&exists); err != nil {
		logger.Error("Failed to check for tournament record max num score", zap.Error(err))
		return err
	}

	if exists {
		return ErrTournamentWriteMaxNumScoreReached
	}

	return nil
}

func tournamentWriteRecord(logger *zap.Logger, tx *sql.Tx, leaderboard *Leaderboard, expiryTime int64, ownerId uuid.UUID, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
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

	query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time, max_num_score)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'::JSONB), $7, $10)
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSql + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($6, leaderboard_record.metadata), update_time = now()`
	params := make([]interface{}, 0, 10)
	params = append(params, leaderboard.Id, ownerId)
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
	params = append(params, time.Unix(expiryTime, 0).UTC(), scoreDelta, subscoreDelta, leaderboard.MaxNumScore)

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
AND EXISTS (
	SELECT leaderboard_id FROM leaderboard_record
	WHERE leaderboard_id = $1 
	AND owner_id = $2 
	AND (expiry_time > now() OR expiry_time = '1970-01-01 00:00:00')
	AND create_time = update_time)`
	_, err = tx.Exec(query, leaderboard.Id, ownerId)
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
	query = "SELECT username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
	err = tx.QueryRow(query, leaderboard.Id, ownerId, time.Unix(expiryTime, 0).UTC()).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
	if err != nil {
		logger.Error("Error after writing leaderboard record", zap.Error(err))
		return nil, err
	}

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
	if expiryTime != 0 {
		record.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
	}

	return record, nil
}

func calculateTournamentDeadlines(leaderboard *Leaderboard, t time.Time) (int64, int64, int64) {
	if leaderboard.ResetSchedule != nil {
		schedules := leaderboard.ResetSchedule.NextN(t, 2)

		startActive := schedules[0].UTC().Unix() - (schedules[1].UTC().Unix() - schedules[0].UTC().Unix())
		endActive := startActive + int64(leaderboard.Duration)
		expiryTime := schedules[0].UTC().Unix()

		if leaderboard.StartTime > endActive {
			// The start time after the end of the current active period but before the next reset.
			// e.g. Reset schedule is daily at noon, duration is 1 hour, but time is currently 3pm.
			startActive = leaderboard.ResetSchedule.Next(time.Unix(leaderboard.StartTime, 0).UTC()).UTC().Unix()
			endActive = startActive + int64(leaderboard.Duration)
			expiryTime = startActive + (schedules[1].UTC().Unix() - schedules[0].UTC().Unix())
		}

		return startActive, endActive, expiryTime
	} else {
		endActive := int64(0)
		if leaderboard.StartTime <= t.Unix() {
			endActive = leaderboard.StartTime + int64(leaderboard.Duration)
		}
		expiryTime := leaderboard.EndTime
		return leaderboard.StartTime, endActive, expiryTime
	}
}

func resetTournamentSize(logger *zap.Logger, db *sql.DB, leaderboardIds []string) {
	logger.Info("Resetting tournament size", zap.Strings("ids", leaderboardIds))

	index := make([]string, len(leaderboardIds))
	params := make([]interface{}, len(leaderboardIds))
	for i, id := range leaderboardIds {
		index[i] = "$" + strconv.Itoa(i+1)
		params[i] = id
	}

	if _, err := db.Exec("UPDATE leaderboard SET size = 0 WHERE id IN ("+strings.Join(index, ",")+")", params...); err != nil {
		logger.Error("Could not reset leaderboard size", zap.Error(err), zap.Strings("ids", leaderboardIds))
	}
}

func parseTournament(rows *sql.Rows) (*api.Tournament, error) {
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
	err := rows.Scan(&dbId, &dbSortOrder, &dbResetSchedule, &dbMetadata, &dbCreateTime,
		&dbCategory, &dbDescription, &dbDuration, &dbEndTime, &dbMaxSize, &dbMaxNumScore, &dbTitle, &dbSize, &dbStartTime)
	if err != nil {
		return nil, err
	}

	canEnter := true
	endActive := int64(0)
	nextReset := int64(0)

	now := time.Now().UTC()
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
