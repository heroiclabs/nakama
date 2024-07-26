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
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

// Internal error used to signal out of transactional wrappers.
var errTournamentWriteNoop = errors.New("tournament write noop")

type TournamentListCursor struct {
	Id string
}

func TournamentCreate(ctx context.Context, logger *zap.Logger, cache LeaderboardCache, scheduler LeaderboardScheduler, leaderboardId string, authoritative bool, sortOrder, operator int, resetSchedule, metadata,
	title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired, enableRanks bool) error {

	_, created, err := cache.CreateTournament(ctx, leaderboardId, authoritative, sortOrder, operator, resetSchedule, metadata, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired, enableRanks)
	if err != nil {
		return err
	}

	if created {
		// Only need to update the scheduler for newly created tournaments.
		scheduler.Update()
	}

	return nil
}

func TournamentDelete(ctx context.Context, cache LeaderboardCache, rankCache LeaderboardRankCache, scheduler LeaderboardScheduler, leaderboardId string) error {
	leaderboard := cache.Get(leaderboardId)
	if leaderboard == nil || !leaderboard.IsTournament() {
		// If it does not exist treat it as success.
		return nil
	}

	_, err := cache.Delete(ctx, rankCache, scheduler, leaderboardId)
	if err != nil {
		return err
	}

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
		return runtime.ErrTournamentNotFound
	}
	if !leaderboard.IsTournament() {
		// Leaderboard exists but is not a tournament, treat it as success.
		return runtime.ErrTournamentNotFound
	}

	nowTime := time.Now().UTC()
	nowUnix := nowTime.Unix()

	_, endActive, expiryTime := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, nowTime)
	if endActive <= nowUnix {
		logger.Info("Cannot add attempt outside of tournament duration.")
		return runtime.ErrTournamentOutsideDuration
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

func TournamentJoin(ctx context.Context, logger *zap.Logger, db *sql.DB, cache LeaderboardCache, rankCache LeaderboardRankCache, ownerID uuid.UUID, username, tournamentId string) error {
	leaderboard := cache.Get(tournamentId)
	if leaderboard == nil {
		// If it does not exist treat it as success.
		return runtime.ErrTournamentNotFound
	}
	if !leaderboard.IsTournament() {
		// Leaderboard exists but is not a tournament.
		return runtime.ErrTournamentNotFound
	}

	if !leaderboard.JoinRequired {
		return nil
	}

	now := time.Now().UTC()
	nowUnix := now.Unix()
	_, endActive, expiryTime := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, now)
	if endActive <= nowUnix {
		logger.Info("Cannot join tournament outside of tournament duration.")
		return runtime.ErrTournamentOutsideDuration
	}

	var isNewJoin bool
	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		query := `INSERT INTO leaderboard_record
(leaderboard_id, owner_id, expiry_time, username, num_score, max_num_score)
VALUES
($1, $2, $3, $4, $5, $6)
ON CONFLICT(owner_id, leaderboard_id, expiry_time) DO NOTHING`
		result, err := tx.ExecContext(ctx, query, tournamentId, ownerID.String(), time.Unix(expiryTime, 0).UTC(), username, 0, leaderboard.MaxNumScore)
		if err != nil {
			return err
		}

		if rowsAffected, err := result.RowsAffected(); err != nil {
			return err
		} else if rowsAffected != 1 {
			// Owner has already joined this tournament, treat it as a no-op.
			return nil
		}

		if leaderboard.HasMaxSize() {
			query = "UPDATE leaderboard SET size = size+1 WHERE id = $1 AND size < max_size"
			result, err = tx.ExecContext(ctx, query, tournamentId)
			if err != nil {
				return err
			}

			if rowsAffected, err := result.RowsAffected(); err != nil {
				return err
			} else if rowsAffected == 0 {
				// Tournament is full.
				return runtime.ErrTournamentMaxSizeReached
			}
		}

		isNewJoin = true

		return nil
	}); err != nil {
		if err == runtime.ErrTournamentMaxSizeReached {
			logger.Info("Failed to join tournament, reached max size allowed.", zap.String("tournament_id", tournamentId), zap.String("owner", ownerID.String()), zap.String("username", username))
			return err
		}
		logger.Error("Could not join tournament.", zap.Error(err))
		return err
	}

	// Ensure new tournament joiner is included in the rank cache.
	if isNewJoin {
		_ = rankCache.Insert(leaderboard.Id, leaderboard.SortOrder, 0, 0, 0, expiryTime, ownerID, leaderboard.EnableRanks)
	}

	logger.Info("Joined tournament.", zap.String("tournament_id", tournamentId), zap.String("owner", ownerID.String()), zap.String("username", username))
	return nil
}

func TournamentsGet(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, tournamentIDs []string) ([]*api.Tournament, error) {
	now := time.Now().UTC()

	records := make([]*api.Tournament, 0, len(tournamentIDs))
	uniqueTournamentIDs := make(map[string]struct{}, len(tournamentIDs))
	dbLookupTournamentIDs := make([]string, 0, 1)
	for _, tournamentID := range tournamentIDs {
		if _, found := uniqueTournamentIDs[tournamentID]; found {
			continue
		}
		uniqueTournamentIDs[tournamentID] = struct{}{}

		tournament := leaderboardCache.Get(tournamentID)
		if tournament == nil || !tournament.IsTournament() {
			continue
		}
		if tournament.HasMaxSize() {
			dbLookupTournamentIDs = append(dbLookupTournamentIDs, tournamentID)
			continue
		}

		canEnter := true
		endTime := tournament.EndTime

		startActive, endActiveUnix, expiryUnix := calculateTournamentDeadlines(tournament.StartTime, endTime, int64(tournament.Duration), tournament.ResetSchedule, now)

		if startActive > now.Unix() || (endActiveUnix != 0 && endActiveUnix < now.Unix()) {
			canEnter = false
		}

		var prevReset int64
		if tournament.ResetSchedule != nil {
			prevReset = calculatePrevReset(now, tournament.StartTime, tournament.ResetSchedule)
		}

		tournamentRecord := &api.Tournament{
			Id:            tournament.Id,
			Title:         tournament.Title,
			Description:   tournament.Description,
			Category:      uint32(tournament.Category),
			SortOrder:     uint32(tournament.SortOrder),
			Operator:      OperatorIntToEnum[tournament.Operator],
			Size:          0,
			MaxSize:       uint32(tournament.MaxSize),
			MaxNumScore:   uint32(tournament.MaxNumScore),
			CanEnter:      canEnter,
			EndActive:     uint32(endActiveUnix),
			PrevReset:     uint32(prevReset),
			NextReset:     uint32(expiryUnix),
			Metadata:      tournament.Metadata,
			CreateTime:    &timestamppb.Timestamp{Seconds: tournament.CreateTime},
			StartTime:     &timestamppb.Timestamp{Seconds: tournament.StartTime},
			Duration:      uint32(tournament.Duration),
			StartActive:   uint32(startActive),
			Authoritative: tournament.Authoritative,
		}

		if endTime > 0 {
			tournamentRecord.EndTime = &timestamppb.Timestamp{Seconds: endTime}
		}

		records = append(records, tournamentRecord)
	}

	if len(dbLookupTournamentIDs) > 0 {
		query := `SELECT id, sort_order, operator, reset_schedule, metadata, create_time, category, description, duration, end_time, max_size, max_num_score, title, size, start_time
FROM leaderboard
WHERE id = ANY($1::text[])`

		// Retrieved directly from database to have the latest configuration and 'size' etc field values.
		// Ensures consistency between return data from this call and TournamentList.
		rows, err := db.QueryContext(ctx, query, dbLookupTournamentIDs)
		if err != nil {
			logger.Error("Could not retrieve tournaments", zap.Error(err))
			return nil, err
		}

		for rows.Next() {
			tournament, err := parseTournament(rows, now)
			if err != nil {
				if err == runtime.ErrTournamentNotFound {
					// This ID mapped to a non-tournament leaderboard, just skip it.
					continue
				}

				_ = rows.Close()
				logger.Error("Error parsing retrieved tournament records", zap.Error(err))
				return nil, err
			}

			records = append(records, tournament)
		}
		_ = rows.Close()
	}

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
	ids := make([]string, 0, len(list))
	for _, leaderboard := range list {
		if !leaderboard.HasMaxSize() {
			continue
		}
		ids = append(ids, leaderboard.Id)
	}

	sizes := make(map[string]int, len(list))
	if len(ids) > 0 {
		query := "SELECT id, size FROM leaderboard WHERE id = ANY($1::text[])"
		rows, err := db.QueryContext(ctx, query, ids)
		if err != nil {
			logger.Error("Could not retrieve tournaments", zap.Error(err))
			return nil, err
		}

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
	}

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

		var prevReset int64
		if leaderboard.ResetSchedule != nil {
			prevReset = calculatePrevReset(now, leaderboard.StartTime, leaderboard.ResetSchedule)
		}

		record := &api.Tournament{
			Id:            leaderboard.Id,
			Title:         leaderboard.Title,
			Description:   leaderboard.Description,
			Category:      uint32(leaderboard.Category),
			SortOrder:     uint32(leaderboard.SortOrder),
			Operator:      OperatorIntToEnum[leaderboard.Operator],
			Size:          uint32(size),
			MaxSize:       uint32(leaderboard.MaxSize),
			MaxNumScore:   uint32(leaderboard.MaxNumScore),
			CanEnter:      canEnter,
			EndActive:     uint32(endActiveUnix),
			PrevReset:     uint32(prevReset),
			NextReset:     uint32(expiryUnix),
			Metadata:      leaderboard.Metadata,
			CreateTime:    &timestamppb.Timestamp{Seconds: leaderboard.CreateTime},
			StartTime:     &timestamppb.Timestamp{Seconds: leaderboard.StartTime},
			Duration:      uint32(leaderboard.Duration),
			StartActive:   uint32(startActive),
			Authoritative: leaderboard.Authoritative,
		}
		if leaderboard.EndTime != 0 {
			record.EndTime = &timestamppb.Timestamp{Seconds: leaderboard.EndTime}
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

func TournamentRecordsList(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, tournamentId string, ownerIds []string, limit *wrapperspb.Int32Value, cursor string, overrideExpiry int64) (*api.TournamentRecordList, error) {
	leaderboard := leaderboardCache.Get(tournamentId)
	if leaderboard == nil || !leaderboard.IsTournament() {
		return nil, runtime.ErrTournamentNotFound
	}

	if overrideExpiry == 0 && leaderboard.EndTime > 0 && leaderboard.EndTime <= time.Now().UTC().Unix() {
		return nil, runtime.ErrTournamentOutsideDuration
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
		RankCount:    records.RankCount,
	}

	return recordList, nil
}

func TournamentRecordWrite(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, caller uuid.UUID, tournamentId string, ownerId uuid.UUID, username string, score, subscore int64, metadata string, overrideOperator api.Operator) (*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(tournamentId)
	if leaderboard == nil || !leaderboard.IsTournament() {
		return nil, runtime.ErrTournamentNotFound
	}

	if leaderboard.Authoritative && caller != uuid.Nil {
		return nil, runtime.ErrTournamentAuthoritative
	}

	nowTime := time.Now().UTC()
	nowUnix := nowTime.Unix()

	startActiveUnix, endActiveUnix, expiryUnix := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, nowTime)
	if startActiveUnix > nowUnix || endActiveUnix <= nowUnix {
		logger.Info("Cannot write tournament record as it is outside of tournament duration.", zap.String("id", leaderboard.Id))
		return nil, runtime.ErrTournamentOutsideDuration
	}

	operator := leaderboard.Operator
	if overrideOperator != api.Operator_NO_OVERRIDE {
		switch overrideOperator {
		case api.Operator_INCREMENT:
			operator = LeaderboardOperatorIncrement
		case api.Operator_SET:
			operator = LeaderboardOperatorSet
		case api.Operator_BEST:
			operator = LeaderboardOperatorBest
		case api.Operator_DECREMENT:
			operator = LeaderboardOperatorDecrement
		default:
			return nil, ErrInvalidOperator
		}
	}

	var opSQL string
	var scoreDelta int64
	var subscoreDelta int64
	var scoreAbs int64
	var subscoreAbs int64
	switch operator {
	case LeaderboardOperatorIncrement:
		opSQL = "score = leaderboard_record.score + $5, subscore = leaderboard_record.subscore + $6"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorDecrement:
		opSQL = "score = GREATEST(leaderboard_record.score - $5, 0), subscore = GREATEST(leaderboard_record.subscore - $6, 0)"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = 0
		subscoreAbs = 0
	case LeaderboardOperatorSet:
		opSQL = "score = $5, subscore = $6"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorBest:
		fallthrough
	default:
		if leaderboard.SortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			opSQL = "score = LEAST(leaderboard_record.score, $5), subscore = LEAST(leaderboard_record.subscore, $6)"
		} else {
			// Higher score is better.
			opSQL = "score = GREATEST(leaderboard_record.score, $5), subscore = GREATEST(leaderboard_record.subscore, $6)"
		}
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	}

	expiryTime := time.Unix(expiryUnix, 0).UTC()

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
				return nil, runtime.ErrTournamentWriteJoinRequired
			}
			logger.Error("Error checking tournament record", zap.Error(err))
			return nil, err
		}

		query := `UPDATE leaderboard_record
              SET ` + opSQL + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($7, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now()
              WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $4 AND (max_num_score = 0 OR num_score < max_num_score)`
		logger.Debug("Tournament update query", zap.String("query", query), zap.Any("params", params))
		_, err = db.ExecContext(ctx, query, params...)

		if err != nil {
			logger.Error("Error writing tournament record", zap.Error(err))
			return nil, err
		}
	} else {
		// Update or insert a new record. If the record isn't greater we still want to increment the num_scores.
		query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time, max_num_score)
            VALUES ($1, $2, $3, $9, $10, COALESCE($7, '{}'::JSONB), $4, $8)
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSQL + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($7, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now() RETURNING (SELECT (num_score,max_num_score) FROM leaderboard_record WHERE leaderboard_id=$1 AND owner_id=$2 AND expiry_time=$4)`
		params = append(params, leaderboard.MaxNumScore, scoreAbs, subscoreAbs)

		if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
			dbOldScores := int64Tuple{}
			err := tx.QueryRowContext(ctx, query, params...).Scan(&dbOldScores)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "leaderboard_record_pkey") {
					return errTournamentWriteNoop
				}
				return err
			}

			var dbNumScore int64
			var dbMaxNumScore int64
			if dbOldScores.Valid && len(dbOldScores.Tuple) == 2 {
				dbNumScore = dbOldScores.Tuple[0] + 1
				dbMaxNumScore = dbOldScores.Tuple[1]
			} else {
				// There was no previous score.
				dbNumScore = 1
				dbMaxNumScore = int64(leaderboard.MaxNumScore)
			}

			// Check if the max number of submissions has been reached.
			if dbMaxNumScore > 0 && dbNumScore > dbMaxNumScore {
				return runtime.ErrTournamentWriteMaxNumScoreReached
			}

			// Check if we need to increment the tournament score count by checking if this was a newly inserted record.
			if leaderboard.HasMaxSize() && dbNumScore <= 1 {
				res, err := tx.ExecContext(ctx, "UPDATE leaderboard SET size = size + 1 WHERE id = $1 AND (max_size = 0 OR size < max_size)", leaderboard.Id)
				if err != nil {
					logger.Error("Error updating tournament size", zap.Error(err))
					return err
				}
				if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
					// If the update failed then the tournament had a max size and it was met or exceeded.
					return runtime.ErrTournamentMaxSizeReached
				}
			}

			return nil
		}); err != nil && !errors.Is(err, errTournamentWriteNoop) {
			if errors.Is(err, runtime.ErrTournamentWriteMaxNumScoreReached) || errors.Is(err, runtime.ErrTournamentMaxSizeReached) {
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
		CreateTime:    &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()},
		UpdateTime:    &timestamppb.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
	}
	if dbUsername.Valid {
		record.Username = &wrapperspb.StringValue{Value: dbUsername.String}
	}
	if u := expiryTime.Unix(); u != 0 {
		record.ExpiryTime = &timestamppb.Timestamp{Seconds: u}
	}

	// Enrich the return record with rank data.
	record.Rank = rankCache.Insert(leaderboard.Id, leaderboard.SortOrder, record.Score, record.Subscore, dbNumScore, expiryUnix, ownerId, leaderboard.EnableRanks)

	return record, nil
}

func TournamentRecordDelete(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, caller uuid.UUID, tournamentID, ownerID string) error {
	tournament := leaderboardCache.Get(tournamentID)

	if tournament == nil || !tournament.IsTournament() {
		return runtime.ErrTournamentNotFound
	}

	if tournament.Authoritative && caller != uuid.Nil {
		return runtime.ErrTournamentAuthoritative
	}

	now := time.Now().UTC()
	_, _, expiryUnix := calculateTournamentDeadlines(tournament.StartTime, tournament.EndTime, int64(tournament.Duration), tournament.ResetSchedule, now)

	query := "DELETE FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"

	_, err := db.ExecContext(
		ctx, query, tournamentID, ownerID, time.Unix(expiryUnix, 0).UTC())
	if err != nil {
		logger.Error("Error deleting tournament record", zap.Error(err))
		return err
	}

	rankCache.Delete(tournamentID, expiryUnix, uuid.Must(uuid.FromString(ownerID)))

	return nil
}

func TournamentRecordsHaystack(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId, cursor string, ownerId uuid.UUID, limit int, expiryOverride int64) (*api.TournamentRecordList, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil || !leaderboard.IsTournament() {
		return nil, ErrLeaderboardNotFound
	}

	sortOrder := leaderboard.SortOrder

	expiry := expiryOverride
	if expiry == 0 {
		now := time.Now().UTC()
		_, _, expiry = calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, now)
		if expiry != 0 && expiry <= now.Unix() {
			// if the expiry time is in the past, we wont have any records to return
			return &api.TournamentRecordList{Records: []*api.LeaderboardRecord{}}, nil
		}
	}

	expiryTime := time.Unix(expiry, 0).UTC()

	results, err := getLeaderboardRecordsHaystack(ctx, logger, db, leaderboardCache, rankCache, ownerId, limit, leaderboard.Id, cursor, sortOrder, expiryTime)
	if err != nil {
		return nil, err
	}

	tournamentRecordList := &api.TournamentRecordList{Records: results.Records, NextCursor: results.NextCursor, PrevCursor: results.NextCursor, RankCount: results.RankCount}

	return tournamentRecordList, nil
}

func calculateTournamentDeadlines(startTime, endTime, duration int64, resetSchedule *cronexpr.Expression, t time.Time) (int64, int64, int64) {
	tUnix := t.UTC().Unix()
	if resetSchedule != nil {
		var startActiveUnix int64

		if tUnix < startTime {
			//  the supplied time is behind the start time
			startActiveUnix = resetSchedule.Next(time.Unix(startTime, 0).UTC()).UTC().Unix()
		} else {
			// check if we are landing squarely on the reset schedule
			landsOnSched := resetSchedule.Next(t.Add(-1*time.Second)).Unix() == t.Unix()
			if landsOnSched {
				startActiveUnix = tUnix
			} else {
				startActiveUnix = resetSchedule.Last(t).UTC().Unix()
			}
		}

		// endActiveUnix is when the current iteration ends.
		endActiveUnix := startActiveUnix + duration
		// expiryUnix represent the start of the next schedule, i.e., when the next iteration begins. It's when the current records "expire".
		expiryUnix := resetSchedule.Next(time.Unix(startActiveUnix, 0).UTC()).UTC().Unix()

		if endActiveUnix > expiryUnix {
			// Cap the end active to the same time as the expiry.
			endActiveUnix = expiryUnix
		}

		if startTime > endActiveUnix {
			// The start time after the end of the current active period but before the next reset.
			// e.g. Reset schedule is daily at noon, duration is 1 hour, but time is currently 3pm.
			schedules := resetSchedule.NextN(time.Unix(startTime, 0).UTC(), 2)
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
	var dbOperator int
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
	err := scannable.Scan(&dbID, &dbSortOrder, &dbOperator, &dbResetSchedule, &dbMetadata, &dbCreateTime,
		&dbCategory, &dbDescription, &dbDuration, &dbEndTime, &dbMaxSize, &dbMaxNumScore, &dbTitle, &dbSize, &dbStartTime)
	if err != nil {
		return nil, err
	}
	if dbDuration <= 0 {
		return nil, runtime.ErrTournamentNotFound
	}

	var resetSchedule *cronexpr.Expression
	if dbResetSchedule.Valid {
		resetSchedule = cronexpr.MustParse(dbResetSchedule.String)
	}

	canEnter := true
	endTime := dbEndTime.Time.UTC().Unix()

	startActiveUnix, endActiveUnix, expiryUnix := calculateTournamentDeadlines(dbStartTime.Time.UTC().Unix(), endTime, int64(dbDuration), resetSchedule, now)

	if startActiveUnix > now.Unix() || (endActiveUnix != 0 && endActiveUnix < now.Unix()) {
		canEnter = false
	}

	if canEnter && dbSize >= dbMaxSize {
		canEnter = false
	}

	var prevReset int64
	if resetSchedule != nil {
		prevReset = calculatePrevReset(now, dbStartTime.Time.UTC().Unix(), resetSchedule)
	}

	tournament := &api.Tournament{
		Id:          dbID,
		Title:       dbTitle,
		Description: dbDescription,
		Category:    uint32(dbCategory),
		SortOrder:   uint32(dbSortOrder),
		Operator:    OperatorIntToEnum[dbOperator],
		Size:        uint32(dbSize),
		MaxSize:     uint32(dbMaxSize),
		MaxNumScore: uint32(dbMaxNumScore),
		CanEnter:    canEnter,
		StartActive: uint32(startActiveUnix),
		EndActive:   uint32(endActiveUnix),
		PrevReset:   uint32(prevReset),
		NextReset:   uint32(expiryUnix),
		Metadata:    dbMetadata,
		CreateTime:  &timestamppb.Timestamp{Seconds: dbCreateTime.Time.UTC().Unix()},
		StartTime:   &timestamppb.Timestamp{Seconds: dbStartTime.Time.UTC().Unix()},
		Duration:    uint32(dbDuration),
	}

	if endTime > 0 {
		tournament.EndTime = &timestamppb.Timestamp{Seconds: endTime}
	}

	return tournament, nil
}

func DisableTournamentRanks(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, id string) error {
	l := leaderboardCache.Get(id)
	if l == nil || !l.IsTournament() {
		return runtime.ErrTournamentNotFound
	}

	if _, err := db.QueryContext(ctx, "UPDATE leaderboard SET enable_ranks = false WHERE id = $1", id); err != nil {
		logger.Error("failed to set leaderboard enable_ranks value", zap.Error(err))
		return errors.New("failed to disable leaderboard ranks")
	}

	leaderboardCache.Insert(l.Id, l.Authoritative, l.SortOrder, l.Operator, l.ResetScheduleStr, l.Metadata, l.CreateTime, false)

	_, _, expiryUnix := calculateTournamentDeadlines(l.StartTime, l.EndTime, int64(l.Duration), l.ResetSchedule, time.Now())
	rankCache.DeleteLeaderboard(l.Id, expiryUnix)

	return nil
}
