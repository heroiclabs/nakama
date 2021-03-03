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
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
)

var (
	ErrTournamentNotFound                = errors.New("tournament not found")
	ErrTournamentMaxSizeReached          = errors.New("tournament max size reached")
	ErrTournamentOutsideDuration         = errors.New("tournament outside of duration")
	ErrTournamentWriteMaxNumScoreReached = errors.New("max number score count reached")
	ErrTournamentWriteJoinRequired       = errors.New("required to join before writing tournament record")
)

type TournamentListCursor struct {
	Id string
}

func TournamentCreate(ctx context.Context, logger *zap.Logger, cache LeaderboardCache, scheduler LeaderboardScheduler, leaderboardId string, sortOrder, operator int, resetSchedule, metadata,
	title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error {

	leaderboard, err := cache.CreateTournament(ctx, leaderboardId, sortOrder, operator, resetSchedule, metadata, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired)

	if err != nil {
		return err
	}

	if leaderboard != nil {
		logger.Info("Tournament created", zap.String("id", leaderboard.Id))
		scheduler.Update()
	}

	return nil
}

func TournamentDelete(ctx context.Context, cache LeaderboardCache, rankCache LeaderboardRankCache, scheduler LeaderboardScheduler, leaderboardId string) error {
	leaderboard := cache.Get(leaderboardId)
	if leaderboard == nil {
		// If it does not exist treat it as success.
		return nil
	}

	var expiryUnix int64
	if leaderboard.ResetSchedule != nil {
		expiryUnix = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
	}

	if leaderboard.EndTime > 0 && expiryUnix > leaderboard.EndTime {
		expiryUnix = leaderboard.EndTime
	}

	if err := cache.Delete(ctx, leaderboardId); err != nil {
		return err
	}

	scheduler.Update()
	rankCache.DeleteLeaderboard(leaderboardId, expiryUnix)

	return nil
}

func TournamentAddAttempt(ctx context.Context, logger *zap.Logger, db *sql.DB, cache LeaderboardCache, leaderboardId string, owner string, count int) error {
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
		if leaderboard.EndTime > 0 && expiryTime > leaderboard.EndTime {
			expiryTime = leaderboard.EndTime
		}
	}

	query := `UPDATE leaderboard_record SET max_num_score = (max_num_score + $1) WHERE leaderboard_id = $2 AND owner_id = $3 AND expiry_time = $4`
	_, err := db.ExecContext(ctx, query, count, leaderboardId, owner, time.Unix(expiryTime, 0).UTC())
	if err != nil {
		logger.Error("Could not increment max attempt counter", zap.Error(err))
	} else {
		logger.Info("Max attempt count was increased", zap.Int("new_count", count), zap.String("owner", owner), zap.String("leaderboard_id", leaderboardId))
	}
	return nil
}

func TournamentJoin(ctx context.Context, logger *zap.Logger, db *sql.DB, cache LeaderboardCache, owner, username, tournamentId string) error {
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
	_, endActive, expiryTime := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, now)
	if endActive <= nowUnix {
		logger.Info("Cannot join tournament outside of tournament duration.")
		return ErrTournamentOutsideDuration
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		query := `INSERT INTO leaderboard_record
(leaderboard_id, owner_id, expiry_time, username, num_score, max_num_score)
VALUES
($1, $2, $3, $4, $5, $6)
ON CONFLICT(owner_id, leaderboard_id, expiry_time) DO NOTHING`
		result, err := tx.ExecContext(ctx, query, tournamentId, owner, time.Unix(expiryTime, 0).UTC(), username, 0, leaderboard.MaxNumScore)
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
		result, err = tx.ExecContext(ctx, query, tournamentId)
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
		}
		logger.Error("Could not join tournament.", zap.Error(err))
		return err
	}

	logger.Info("Joined tournament.", zap.String("tournament_id", tournamentId), zap.String("owner", owner), zap.String("username", username))
	return nil
}

func TournamentsGet(ctx context.Context, logger *zap.Logger, db *sql.DB, tournamentIDs []string) ([]*api.Tournament, error) {
	now := time.Now().UTC()

	params := make([]interface{}, 0, len(tournamentIDs))
	statements := make([]string, 0, len(tournamentIDs))
	for i, tournamentID := range tournamentIDs {
		params = append(params, tournamentID)
		statements = append(statements, fmt.Sprintf("$%v", i+1))
	}
	query := `SELECT id, sort_order, reset_schedule, metadata, create_time, category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE id IN (` + strings.Join(statements, ",") + `) AND duration > 0`

	// Retrieved directly from database to have the latest configuration and 'size' etc field values.
	// Ensures consistency between return data from this call and TournamentList.
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Could not retrieve tournaments", zap.Error(err))
		return nil, err
	}

	records := make([]*api.Tournament, 0)
	for rows.Next() {
		tournament, err := parseTournament(rows, now)
		if err != nil {
			_ = rows.Close()
			logger.Error("Error parsing retrieved tournament records", zap.Error(err))
			return nil, err
		}

		records = append(records, tournament)
	}
	_ = rows.Close()

	return records, nil
}

func TournamentList(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, categoryStart, categoryEnd, startTime, endTime, limit int, cursor *TournamentListCursor) (*api.TournamentList, error) {
	now := time.Now().UTC()
	nowUnix := now.Unix()

	list, newCursor, err := leaderboardCache.ListTournaments(nowUnix, categoryStart, categoryEnd, int64(startTime), int64(endTime), limit, cursor)
	if err != nil {
		logger.Error("Could not retrieve tournaments", zap.Error(err))
		return nil, err
	}

	if len(list) == 0 {
		return &api.TournamentList{
			Tournaments: []*api.Tournament{},
		}, nil
	}

	// Read most up to date sizes from database.
	statements := make([]string, 0, len(list))
	params := make([]interface{}, 0, len(list))
	for i, leaderboard := range list {
		params = append(params, leaderboard.Id)
		statements = append(statements, "$"+strconv.Itoa(i+1))
	}
	query := "SELECT id, size FROM leaderboard WHERE id IN (" + strings.Join(statements, ",") + ")"
	logger.Debug("Tournament listing query", zap.String("query", query), zap.Any("params", params))
	rows, err := db.QueryContext(ctx, query, params...)
	if err != nil {
		logger.Error("Could not retrieve tournaments", zap.Error(err))
		return nil, err
	}

	sizes := make(map[string]int, len(list))
	var dbID string
	var dbSize int
	for rows.Next() {
		if err := rows.Scan(&dbID, &dbSize); err != nil {
			_ = rows.Close()
			logger.Error("Error parsing listed tournament records", zap.Error(err))
			return nil, err
		}
		sizes[dbID] = dbSize
	}
	_ = rows.Close()

	records := make([]*api.Tournament, 0, len(list))
	for _, leaderboard := range list {
		size := sizes[leaderboard.Id]
		startActive, endActiveUnix, expiryUnix := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, now)
		canEnter := true

		if startActive > nowUnix || endActiveUnix < nowUnix {
			canEnter = false
		}
		if canEnter && size >= leaderboard.MaxSize {
			canEnter = false
		}

		record := &api.Tournament{
			Id:          leaderboard.Id,
			Title:       leaderboard.Title,
			Description: leaderboard.Description,
			Category:    uint32(leaderboard.Category),
			SortOrder:   uint32(leaderboard.SortOrder),
			Size:        uint32(size),
			MaxSize:     uint32(leaderboard.MaxSize),
			MaxNumScore: uint32(leaderboard.MaxNumScore),
			CanEnter:    canEnter,
			EndActive:   uint32(endActiveUnix),
			NextReset:   uint32(expiryUnix),
			Metadata:    leaderboard.Metadata,
			CreateTime:  &timestamp.Timestamp{Seconds: leaderboard.CreateTime},
			StartTime:   &timestamp.Timestamp{Seconds: leaderboard.StartTime},
			Duration:    uint32(leaderboard.Duration),
			StartActive: uint32(startActive),
		}
		if leaderboard.EndTime != 0 {
			record.EndTime = &timestamp.Timestamp{Seconds: leaderboard.EndTime}
		}
		records = append(records, record)
	}

	tournamentList := &api.TournamentList{
		Tournaments: records,
	}
	if newCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Error creating tournament records list cursor", zap.Error(err))
			return nil, err
		}
		tournamentList.Cursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return tournamentList, nil
}

func TournamentRecordsList(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, tournamentId string, ownerIds []string, limit *wrappers.Int32Value, cursor string, overrideExpiry int64) (*api.TournamentRecordList, error) {
	leaderboard := leaderboardCache.Get(tournamentId)
	if leaderboard == nil || !leaderboard.IsTournament() {
		return nil, ErrTournamentNotFound
	}

	if overrideExpiry == 0 && leaderboard.EndTime > 0 && leaderboard.EndTime <= time.Now().UTC().Unix() {
		return nil, ErrTournamentOutsideDuration
	}

	records, err := LeaderboardRecordsList(ctx, logger, db, leaderboardCache, rankCache, tournamentId, limit, cursor, ownerIds, overrideExpiry)
	if err != nil {
		logger.Error("Error listing records from tournament.", zap.Error(err))
		return nil, err
	}

	recordList := &api.TournamentRecordList{
		Records:      records.Records,
		OwnerRecords: records.OwnerRecords,
		NextCursor:   records.NextCursor,
		PrevCursor:   records.PrevCursor,
	}

	return recordList, nil
}

func TournamentRecordWrite(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, tournamentId string, ownerId uuid.UUID, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(tournamentId)

	nowTime := time.Now().UTC()
	nowUnix := nowTime.Unix()

	startActiveUnix, endActiveUnix, expiryUnix := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, nowTime)
	if startActiveUnix > nowUnix || endActiveUnix <= nowUnix {
		logger.Info("Cannot write tournament record as it is outside of tournament duration.", zap.String("id", leaderboard.Id))
		return nil, ErrTournamentOutsideDuration
	}

	expiryTime := time.Unix(expiryUnix, 0).UTC()

	var opSQL string
	var filterSQL string
	var scoreDelta int64
	var subscoreDelta int64
	var scoreAbs int64
	var subscoreAbs int64
	switch leaderboard.Operator {
	case LeaderboardOperatorIncrement:
		opSQL = "score = leaderboard_record.score + $5, subscore = leaderboard_record.subscore + $6"
		filterSQL = " WHERE ($5 <> 0 OR $6 <> 0)"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorSet:
		opSQL = "score = $5, subscore = $6"
		filterSQL = " WHERE (leaderboard_record.score <> $5 OR leaderboard_record.subscore <> $6)"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorBest:
		fallthrough
	default:
		if leaderboard.SortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			opSQL = "score = div((leaderboard_record.score + $5 - abs(leaderboard_record.score - $5)), 2), subscore = div((leaderboard_record.subscore + $6 - abs(leaderboard_record.subscore - $6)), 2)" // (sub)score = min(db_value, $var)
			filterSQL = " WHERE (leaderboard_record.score > $5 OR leaderboard_record.subscore > $6)"
		} else {
			// Higher score is better.
			opSQL = "score = div((leaderboard_record.score + $5 + abs(leaderboard_record.score - $5)), 2), subscore = div((leaderboard_record.subscore + $6 + abs(leaderboard_record.subscore - $6)), 2)" // (sub)score = max(db_value, $var)
			filterSQL = " WHERE (leaderboard_record.score < $5 OR leaderboard_record.subscore < $6)"
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

		var exists int
		err := db.QueryRowContext(ctx, "SELECT 1 FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3", leaderboard.Id, ownerId, expiryTime).Scan(&exists)
		if err != nil {
			if err == sql.ErrNoRows {
				// Tournament required join but no row was found to update.
				return nil, ErrTournamentWriteJoinRequired
			}
			logger.Error("Error checking tournament record", zap.Error(err))
			return nil, err
		}

		query := `UPDATE leaderboard_record
              SET ` + opSQL + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($7, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now()
              WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $4 AND (max_num_score = 0 OR num_score < max_num_score)` + strings.ReplaceAll(filterSQL, "WHERE", "AND")
		logger.Debug("Tournament update query", zap.String("query", query), zap.Any("params", params))
		_, err = db.ExecContext(ctx, query, params...)
		if err != nil {
			logger.Error("Error writing tournament record", zap.Error(err))
			return nil, err
		}
	} else {
		// Update or insert a new record. Maybe increment number of records tracked for this tournament.

		query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time, max_num_score)
            VALUES ($1, $2, $3, $8, $9, COALESCE($7, '{}'::JSONB), $4, $10)
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSQL + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($7, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now()` + filterSQL
		params = append(params, scoreAbs, subscoreAbs, leaderboard.MaxNumScore)

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			logger.Error("Could not begin database transaction.", zap.Error(err))
			return nil, err
		}

		if err := ExecuteInTx(ctx, tx, func() error {
			recordQueryResult, err := tx.ExecContext(ctx, query, params...)
			if err != nil {
				return err
			}

			// A record was inserted or updated
			if rowsAffected, _ := recordQueryResult.RowsAffected(); rowsAffected > 0 {
				var dbNumScore int
				var dbMaxNumScore int

				err := tx.QueryRowContext(ctx, "SELECT num_score, max_num_score FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3", leaderboard.Id, ownerId, expiryTime).Scan(&dbNumScore, &dbMaxNumScore)
				if err != nil {
					logger.Error("Error reading leaderboard record.", zap.Error(err))
					return err
				}

				// Check if the max number of submissions has been reached.
				if dbMaxNumScore > 0 && dbNumScore > dbMaxNumScore {
					return ErrTournamentWriteMaxNumScoreReached
				}

				// Check if we need to increment the tournament score count by checking if this was a newly inserted record.
				if dbNumScore <= 1 {
					res, err := tx.ExecContext(ctx, "UPDATE leaderboard SET size = size + 1 WHERE id = $1 AND (max_size = 0 OR size < max_size)", leaderboard.Id)
					if err != nil {
						logger.Error("Error updating tournament size", zap.Error(err))
						return err
					}
					if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
						// If the update failed then the tournament had a max size and it was met or exceeded.
						return ErrTournamentMaxSizeReached
					}
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
	var dbCreateTime pgtype.Timestamptz
	var dbUpdateTime pgtype.Timestamptz
	query := "SELECT username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
	err := db.QueryRowContext(ctx, query, leaderboard.Id, ownerId, expiryTime).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
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

func TournamentRecordsHaystack(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId string, ownerId uuid.UUID, limit int, expiryOverride int64) ([]*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	sortOrder := leaderboard.SortOrder

	expiry := expiryOverride
	if expiry == 0 {
		now := time.Now().UTC()
		_, _, expiry = calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, now)
		if expiry != 0 && expiry <= now.Unix() {
			// if the expiry time is in the past, we wont have any records to return
			return make([]*api.LeaderboardRecord, 0), nil
		}
	}

	expiryTime := time.Unix(expiry, 0).UTC()
	return getLeaderboardRecordsHaystack(ctx, logger, db, rankCache, ownerId, limit, leaderboard.Id, sortOrder, expiryTime)
}

func calculateTournamentDeadlines(startTime, endTime, duration int64, resetSchedule *cronexpr.Expression, t time.Time) (int64, int64, int64) {
	tUnix := t.UTC().Unix()
	if resetSchedule != nil {
		if tUnix < startTime {
			// if startTime is in the future, always use startTime
			t = time.Unix(startTime, 0).UTC()
			tUnix = t.UTC().Unix()
		}

		schedules := resetSchedule.NextN(t, 2)
		// Roll time back a safe amount, then scan forward looking for the current start active.
		startActiveUnix := tUnix - ((schedules[1].UTC().Unix() - schedules[0].UTC().Unix()) * 2)
		for {
			s := resetSchedule.Next(time.Unix(startActiveUnix, 0).UTC()).UTC().Unix()
			if s < tUnix {
				startActiveUnix = s
			} else {
				if s == tUnix {
					startActiveUnix = s
				}
				break
			}
		}
		endActiveUnix := startActiveUnix + duration
		expiryUnix := schedules[0].UTC().Unix()
		if endActiveUnix > expiryUnix {
			// Cap the end active to the same time as the expiry.
			endActiveUnix = expiryUnix
		}

		if startTime > endActiveUnix {
			// The start time after the end of the current active period but before the next reset.
			// e.g. Reset schedule is daily at noon, duration is 1 hour, but time is currently 3pm.
			schedules = resetSchedule.NextN(time.Unix(startTime, 0).UTC(), 2)
			startActiveUnix = schedules[0].UTC().Unix()
			endActiveUnix = startActiveUnix + duration
			expiryUnix = schedules[1].UTC().Unix()
			if endActiveUnix > expiryUnix {
				// Cap the end active to the same time as the expiry.
				endActiveUnix = expiryUnix
			}
		} else if startTime > startActiveUnix {
			startActiveUnix = startTime
		}

		if endTime > 0 && expiryUnix > endTime {
			expiryUnix = endTime
			if endActiveUnix > expiryUnix {
				// Cap the end active to the same time as the expiry.
				endActiveUnix = expiryUnix
			}
		}

		return startActiveUnix, endActiveUnix, expiryUnix
	}

	endActiveUnix := startTime + duration
	expiryUnix := endTime
	if endTime > 0 && endActiveUnix > endTime {
		// Cap the end active to the same time as the expiry.
		endActiveUnix = endTime
	}
	return startTime, endActiveUnix, expiryUnix
}

func parseTournament(scannable Scannable, now time.Time) (*api.Tournament, error) {
	var dbID string
	var dbSortOrder int
	var dbResetSchedule sql.NullString
	var dbMetadata string
	var dbCreateTime pgtype.Timestamptz
	var dbCategory int
	var dbDescription string
	var dbDuration int
	var dbEndTime pgtype.Timestamptz
	var dbMaxSize int
	var dbMaxNumScore int
	var dbTitle string
	var dbSize int
	var dbStartTime pgtype.Timestamptz
	err := scannable.Scan(&dbID, &dbSortOrder, &dbResetSchedule, &dbMetadata, &dbCreateTime,
		&dbCategory, &dbDescription, &dbDuration, &dbEndTime, &dbMaxSize, &dbMaxNumScore, &dbTitle, &dbSize, &dbStartTime)
	if err != nil {
		return nil, err
	}

	var resetSchedule *cronexpr.Expression
	if dbResetSchedule.Valid {
		resetSchedule = cronexpr.MustParse(dbResetSchedule.String)
	}

	canEnter := true
	endTime := dbEndTime.Time.UTC().Unix()

	startActive, endActiveUnix, expiryUnix := calculateTournamentDeadlines(dbStartTime.Time.UTC().Unix(), endTime, int64(dbDuration), resetSchedule, now)

	if startActive > now.Unix() || (endActiveUnix != 0 && endActiveUnix < now.Unix()) {
		canEnter = false
	}

	if canEnter && dbSize >= dbMaxSize {
		canEnter = false
	}

	tournament := &api.Tournament{
		Id:          dbID,
		Title:       dbTitle,
		Description: dbDescription,
		Category:    uint32(dbCategory),
		SortOrder:   uint32(dbSortOrder),
		Size:        uint32(dbSize),
		MaxSize:     uint32(dbMaxSize),
		MaxNumScore: uint32(dbMaxNumScore),
		CanEnter:    canEnter,
		EndActive:   uint32(endActiveUnix),
		NextReset:   uint32(expiryUnix),
		Metadata:    dbMetadata,
		CreateTime:  &timestamp.Timestamp{Seconds: dbCreateTime.Time.UTC().Unix()},
		StartTime:   &timestamp.Timestamp{Seconds: dbStartTime.Time.UTC().Unix()},
		Duration:    uint32(dbDuration),
		StartActive: uint32(startActive),
	}

	if endTime > 0 {
		tournament.EndTime = &timestamp.Timestamp{Seconds: endTime}
	}

	return tournament, nil
}
