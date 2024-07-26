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
	"github.com/heroiclabs/nakama-common/runtime"
	"sort"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var (
	ErrLeaderboardNotFound      = errors.New("leaderboard not found")
	ErrLeaderboardAuthoritative = errors.New("leaderboard only allows authoritative submissions")
	ErrLeaderboardInvalidCursor = errors.New("leaderboard cursor invalid")
	ErrInvalidOperator          = errors.New("invalid operator")
)

type leaderboardRecordListCursor struct {
	// Query hint.
	IsNext bool
	// ID fields.
	LeaderboardId string
	ExpiryTime    int64
	Score         int64
	Subscore      int64
	OwnerId       string
	Rank          int64
}

var (
	OperatorIntToEnum = map[int]api.Operator{
		LeaderboardOperatorBest:      api.Operator_BEST,
		LeaderboardOperatorSet:       api.Operator_SET,
		LeaderboardOperatorIncrement: api.Operator_INCREMENT,
		LeaderboardOperatorDecrement: api.Operator_DECREMENT,
	}
)

type LeaderboardListCursor struct {
	Offset int
}

func LeaderboardList(logger *zap.Logger, leaderboardCache LeaderboardCache, limit int, cursor *LeaderboardListCursor) (*api.LeaderboardList, error) {
	list, newCursor, err := leaderboardCache.List(limit, cursor)
	if err != nil {
		logger.Error("Could not retrieve leaderboards", zap.Error(err))
		return nil, err
	}

	if len(list) == 0 {
		return &api.LeaderboardList{
			Leaderboards: []*api.Leaderboard{},
		}, nil
	}

	records := make([]*api.Leaderboard, 0, len(list))
	now := time.Now().UTC()
	for _, leaderboard := range list {
		var prevReset int64
		var nextReset int64
		if leaderboard.ResetSchedule != nil {
			prevReset = calculatePrevReset(now, leaderboard.CreateTime, leaderboard.ResetSchedule)

			next := leaderboard.ResetSchedule.Next(now)
			nextReset = next.Unix()
		}

		record := &api.Leaderboard{
			Id:            leaderboard.Id,
			SortOrder:     uint32(leaderboard.SortOrder),
			Operator:      OperatorIntToEnum[leaderboard.Operator],
			PrevReset:     uint32(prevReset),
			NextReset:     uint32(nextReset),
			Metadata:      leaderboard.Metadata,
			CreateTime:    &timestamppb.Timestamp{Seconds: leaderboard.CreateTime},
			Authoritative: leaderboard.Authoritative,
		}
		records = append(records, record)
	}

	leaderboardList := &api.LeaderboardList{
		Leaderboards: records,
	}
	if newCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			logger.Error("Error creating leaderboard records list cursor", zap.Error(err))
			return nil, err
		}
		leaderboardList.Cursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return leaderboardList, nil
}

func LeaderboardRecordsList(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId string, limit *wrapperspb.Int32Value, cursor string, ownerIds []string, overrideExpiry int64) (*api.LeaderboardRecordList, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	expiryTime, recordsPossible := calculateExpiryOverride(overrideExpiry, leaderboard)
	if !recordsPossible {
		// If the expiry time is in the past, we won't have any records to return.
		return &api.LeaderboardRecordList{}, nil
	}

	records := make([]*api.LeaderboardRecord, 0)
	ownerRecords := make([]*api.LeaderboardRecord, 0)
	var nextCursorStr, prevCursorStr string

	if limit != nil {
		limitNumber := int(limit.Value)
		incomingCursor, err := unmarshalLeaderboardRecordsListCursor(leaderboardId, expiryTime, cursor)
		if err != nil {
			return nil, err
		}

		query := "SELECT owner_id, username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND expiry_time = $2"
		if incomingCursor == nil {
			if leaderboard.SortOrder == LeaderboardSortOrderAscending {
				query += " ORDER BY score ASC, subscore ASC, owner_id ASC"
			} else {
				query += " ORDER BY score DESC, subscore DESC, owner_id DESC"
			}
		} else {
			if (leaderboard.SortOrder == LeaderboardSortOrderAscending && incomingCursor.IsNext) || (leaderboard.SortOrder == LeaderboardSortOrderDescending && !incomingCursor.IsNext) {
				// Ascending and next page == descending and previous page.
				query += " AND (leaderboard_id, expiry_time, score, subscore, owner_id) > ($1, $2, $4, $5, $6) ORDER BY score ASC, subscore ASC, owner_id ASC"
			} else {
				// Ascending and previous page == descending and next page.
				query += " AND (leaderboard_id, expiry_time, score, subscore, owner_id) < ($1, $2, $4, $5, $6) ORDER BY score DESC, subscore DESC, owner_id DESC"
			}
		}
		query += " LIMIT $3"
		params := make([]interface{}, 0, 6)
		params = append(params, leaderboardId, time.Unix(expiryTime, 0).UTC(), limitNumber+1)
		if incomingCursor != nil {
			params = append(params, incomingCursor.Score, incomingCursor.Subscore, incomingCursor.OwnerId)
		}

		rows, err := db.QueryContext(ctx, query, params...)
		if err != nil {
			logger.Error("Error listing leaderboard records", zap.Error(err))
			return nil, err
		}

		rank := int64(0)
		if incomingCursor != nil {
			rank = incomingCursor.Rank
		}
		records = make([]*api.LeaderboardRecord, 0, limitNumber)
		var nextCursor, prevCursor *leaderboardRecordListCursor

		var dbOwnerID string
		var dbUsername sql.NullString
		var dbScore int64
		var dbSubscore int64
		var dbNumScore int32
		var dbMaxNumScore int32
		var dbMetadata string
		var dbCreateTime pgtype.Timestamptz
		var dbUpdateTime pgtype.Timestamptz
		for rows.Next() {
			if len(records) >= limitNumber {
				nextCursor = &leaderboardRecordListCursor{
					IsNext:        true,
					LeaderboardId: leaderboardId,
					ExpiryTime:    expiryTime,
					Score:         dbScore,
					Subscore:      dbSubscore,
					OwnerId:       dbOwnerID,
					Rank:          rank,
				}
				break
			}

			err = rows.Scan(&dbOwnerID, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
			if err != nil {
				_ = rows.Close()
				logger.Error("Error parsing listed leaderboard records", zap.Error(err))
				return nil, err
			}

			if incomingCursor != nil && !incomingCursor.IsNext {
				rank--
			} else {
				rank++
			}

			record := &api.LeaderboardRecord{
				LeaderboardId: leaderboardId,
				OwnerId:       dbOwnerID,
				Score:         dbScore,
				Subscore:      dbSubscore,
				NumScore:      dbNumScore,
				MaxNumScore:   uint32(dbMaxNumScore),
				Metadata:      dbMetadata,
				CreateTime:    &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()},
				UpdateTime:    &timestamppb.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
				Rank:          rank,
			}
			if dbUsername.Valid {
				record.Username = &wrapperspb.StringValue{Value: dbUsername.String}
			}
			if expiryTime != 0 {
				record.ExpiryTime = &timestamppb.Timestamp{Seconds: expiryTime}
			}

			records = append(records, record)

			// There can only be a previous page if this is a paginated listing.
			if incomingCursor != nil && prevCursor == nil {
				prevCursor = &leaderboardRecordListCursor{
					IsNext:        false,
					LeaderboardId: leaderboardId,
					ExpiryTime:    expiryTime,
					Score:         dbScore,
					Subscore:      dbSubscore,
					OwnerId:       dbOwnerID,
					Rank:          rank,
				}
			}
		}
		_ = rows.Close()

		if incomingCursor != nil && !incomingCursor.IsNext {
			// If this was a previous page listing, flip the results to their normal order and swap the cursors.
			if nextCursor != nil && prevCursor != nil {
				nextCursor, nextCursor.IsNext, nextCursor.Rank, prevCursor, prevCursor.IsNext, prevCursor.Rank = prevCursor, prevCursor.IsNext, prevCursor.Rank, nextCursor, nextCursor.IsNext, nextCursor.Rank
			} else if nextCursor != nil {
				nextCursor, prevCursor = nil, nextCursor
				prevCursor.IsNext = !prevCursor.IsNext
			} else if prevCursor != nil {
				nextCursor, prevCursor = prevCursor, nil
				nextCursor.IsNext = !nextCursor.IsNext
			}

			for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
				records[i], records[i].Rank, records[j], records[j].Rank = records[j], records[j].Rank, records[i], records[i].Rank
			}
		}

		if nextCursor != nil {
			nextCursorStr, err = marshalLeaderboardRecordsListCursor(nextCursor)
			if err != nil {
				logger.Error("Error creating leaderboard records list next cursor", zap.Error(err))
				return nil, err
			}
		}
		if prevCursor != nil {
			prevCursorStr, err = marshalLeaderboardRecordsListCursor(prevCursor)
			if err != nil {
				logger.Error("Error creating leaderboard records list previous cursor", zap.Error(err))
				return nil, err
			}
		}
	}

	if len(ownerIds) != 0 {
		params := []any{leaderboardId, time.Unix(expiryTime, 0).UTC(), ownerIds}
		query := `SELECT owner_id, username, score, subscore, num_score, max_num_score, metadata, create_time, update_time
FROM leaderboard_record
WHERE leaderboard_id = $1 AND expiry_time = $2 AND owner_id = ANY($3)`

		rows, err := db.QueryContext(ctx, query, params...)
		if err != nil {
			logger.Error("Error reading leaderboard records", zap.Error(err))
			return nil, err
		}

		ownerRecords = make([]*api.LeaderboardRecord, 0, len(ownerIds))

		var dbOwnerID string
		var dbUsername sql.NullString
		var dbScore int64
		var dbSubscore int64
		var dbNumScore int32
		var dbMaxNumScore int32
		var dbMetadata string
		var dbCreateTime pgtype.Timestamptz
		var dbUpdateTime pgtype.Timestamptz
		for rows.Next() {
			err = rows.Scan(&dbOwnerID, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
			if err != nil {
				rows.Close()
				logger.Error("Error parsing read leaderboard records", zap.Error(err))
				return nil, err
			}

			record := &api.LeaderboardRecord{
				// Rank filled in in bulk below.
				LeaderboardId: leaderboardId,
				OwnerId:       dbOwnerID,
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
			if expiryTime != 0 {
				record.ExpiryTime = &timestamppb.Timestamp{Seconds: expiryTime}
			}

			ownerRecords = append(ownerRecords, record)
		}
		_ = rows.Close()
	}

	// Sort owner records according to leaderboard ordering
	var sortFn func(i, j int) bool
	if leaderboard.SortOrder == LeaderboardSortOrderAscending {
		sortFn = func(i, j int) bool {
			if ownerRecords[i].Score == ownerRecords[j].Score {
				if ownerRecords[i].Subscore == ownerRecords[j].Subscore {
					return ownerRecords[i].OwnerId < ownerRecords[j].OwnerId
				}
				return ownerRecords[i].Subscore < ownerRecords[j].Subscore
			}
			return ownerRecords[i].Score < ownerRecords[j].Score
		}
	} else {
		sortFn = func(i, j int) bool {
			if ownerRecords[i].Score == ownerRecords[j].Score {
				if ownerRecords[i].Subscore == ownerRecords[j].Subscore {
					return ownerRecords[i].OwnerId > ownerRecords[j].OwnerId
				}
				return ownerRecords[i].Subscore > ownerRecords[j].Subscore
			}
			return ownerRecords[i].Score > ownerRecords[j].Score
		}
	}

	sort.Slice(ownerRecords, sortFn)

	// Bulk fill in the ranks of any owner records requested.
	rankCount := rankCache.Fill(leaderboardId, expiryTime, ownerRecords, leaderboard.EnableRanks)

	return &api.LeaderboardRecordList{
		Records:      records,
		OwnerRecords: ownerRecords,
		NextCursor:   nextCursorStr,
		PrevCursor:   prevCursorStr,
		RankCount:    rankCount,
	}, nil
}

func marshalLeaderboardRecordsListCursor(cursor *leaderboardRecordListCursor) (string, error) {
	cursorBuf := new(bytes.Buffer)
	if err := gob.NewEncoder(cursorBuf).Encode(cursor); err != nil {
		return "", err
	}

	return base64.URLEncoding.EncodeToString(cursorBuf.Bytes()), nil
}

func unmarshalLeaderboardRecordsListCursor(leaderboardId string, expiryTime int64, cursor string) (*leaderboardRecordListCursor, error) {
	var incomingCursor *leaderboardRecordListCursor
	if cursor != "" {
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			return nil, ErrLeaderboardInvalidCursor
		}
		incomingCursor = &leaderboardRecordListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrLeaderboardInvalidCursor
		}

		if leaderboardId != incomingCursor.LeaderboardId {
			// Cursor is for a different leaderboard.
			return nil, ErrLeaderboardInvalidCursor
		} else if expiryTime != incomingCursor.ExpiryTime {
			// Leaderboard expiry has rolled over since this cursor was generated.
			return nil, ErrLeaderboardInvalidCursor
		}
	}

	return incomingCursor, nil
}

func LeaderboardRecordWrite(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, caller uuid.UUID, leaderboardId, ownerID, username string, score, subscore int64, metadata string, overrideOperator api.Operator) (*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	if leaderboard.Authoritative && caller != uuid.Nil {
		return nil, ErrLeaderboardAuthoritative
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
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
	var filterSQL string
	var scoreDelta int64
	var subscoreDelta int64
	var scoreAbs int64
	var subscoreAbs int64
	switch operator {
	case LeaderboardOperatorIncrement:
		opSQL = "score = leaderboard_record.score + $8, subscore = leaderboard_record.subscore + $9"
		filterSQL = " WHERE $8 <> 0 OR $9 <> 0"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorDecrement:
		opSQL = "score = GREATEST(leaderboard_record.score - $8, 0), subscore = GREATEST(leaderboard_record.subscore - $9, 0)"
		filterSQL = " WHERE $8 <> 0 OR $9 <> 0"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = 0
		subscoreAbs = 0
	case LeaderboardOperatorSet:
		opSQL = "score = $4, subscore = $5"
		filterSQL = " WHERE leaderboard_record.score <> $4 OR leaderboard_record.subscore <> $5"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorBest:
		fallthrough
	default:
		if leaderboard.SortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			opSQL = "score = LEAST(leaderboard_record.score, $4), subscore = LEAST(leaderboard_record.subscore, $5)"
			filterSQL = " WHERE leaderboard_record.score > $4 OR leaderboard_record.subscore > $5"
		} else {
			// Higher score is better.
			opSQL = "score = GREATEST(leaderboard_record.score, $4), subscore = GREATEST(leaderboard_record.subscore, $5)"
			filterSQL = " WHERE leaderboard_record.score < $4 OR leaderboard_record.subscore < $5"
		}
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	}

	query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'::JSONB), $7)
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSQL + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($6, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now()` + filterSQL + `
            RETURNING username, score, subscore, num_score, max_num_score, metadata, create_time, update_time`

	params := make([]interface{}, 0, 9)
	params = append(params, leaderboardId, ownerID)
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
	params = append(params, time.Unix(expiryTime, 0).UTC())
	if operator == LeaderboardOperatorIncrement || operator == LeaderboardOperatorDecrement {
		params = append(params, scoreDelta, subscoreDelta)
	}

	// Track if the database record actually updates or not.
	var unchanged bool

	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMaxNumScore int32
	var dbMetadata string
	var dbCreateTime pgtype.Timestamptz
	var dbUpdateTime pgtype.Timestamptz

	err := db.QueryRowContext(ctx, query, params...).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)

	if err != nil {
		var pgErr *pgconn.PgError
		if err != sql.ErrNoRows && !(errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "leaderboard_record_pkey")) {
			logger.Error("Error writing leaderboard record", zap.Error(err))
			return nil, err
		}

		// If no rows were returned then both of these criteria must have been met:
		// 1. There was already a record for this leaderboard, user, and expiry time.
		// 2. This new update did not meet the criteria to be stored, so no update
		//    occurred. For example the new entry was not better in a "best" leaderboard.
		// In this case the user's record is unchanged, and we can just read it as is.
		query = "SELECT username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
		err = db.QueryRowContext(ctx, query, leaderboardId, ownerID, time.Unix(expiryTime, 0).UTC()).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
		if err != nil {
			logger.Error("Error after writing leaderboard record", zap.Error(err))
			return nil, err
		}
		unchanged = true
	}

	var rank int64
	if unchanged {
		rank = rankCache.Get(leaderboardId, expiryTime, uuid.Must(uuid.FromString(ownerID)))
	} else {
		// Ensure we have the latest dbscore, dbsubscore if there was an update.
		rank = rankCache.Insert(leaderboardId, leaderboard.SortOrder, dbScore, dbSubscore, dbNumScore, expiryTime, uuid.Must(uuid.FromString(ownerID)), leaderboard.EnableRanks)
	}

	record := &api.LeaderboardRecord{
		Rank:          rank,
		LeaderboardId: leaderboardId,
		OwnerId:       ownerID,
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
	if expiryTime != 0 {
		record.ExpiryTime = &timestamppb.Timestamp{Seconds: expiryTime}
	}

	return record, nil
}

func LeaderboardRecordDelete(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, caller uuid.UUID, leaderboardId, ownerID string) error {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil || leaderboard.IsTournament() {
		return ErrLeaderboardNotFound
	}

	if leaderboard.Authoritative && caller != uuid.Nil {
		return ErrLeaderboardAuthoritative
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
	}

	query := "DELETE FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
	_, err := db.ExecContext(
		ctx, query, leaderboardId, ownerID, time.Unix(expiryTime, 0).UTC())
	if err != nil {
		logger.Error("Error deleting leaderboard record", zap.Error(err))
		return err
	}

	rankCache.Delete(leaderboardId, expiryTime, uuid.Must(uuid.FromString(ownerID)))

	return nil
}

func LeaderboardRecordReadAll(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*api.LeaderboardRecord, error) {
	query := "SELECT leaderboard_id, owner_id, username, score, subscore, num_score, max_num_score, metadata, create_time, update_time, expiry_time FROM leaderboard_record WHERE owner_id = $1"
	rows, err := db.QueryContext(ctx, query, userID.String())
	if err != nil {
		logger.Error("Error reading all leaderboard records for user", zap.String("user_id", userID.String()), zap.Error(err))
		return nil, err
	}
	// rows.Close() called in parseLeaderboardRecords

	return parseLeaderboardRecords(logger, rows)
}

func LeaderboardRecordsDeleteAll(ctx context.Context, logger *zap.Logger, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, tx *sql.Tx, userID uuid.UUID, currentTime int64) error {
	query := "DELETE FROM leaderboard_record WHERE owner_id = $1 RETURNING leaderboard_id, expiry_time"
	rows, err := tx.QueryContext(ctx, query, userID.String())
	if err != nil {
		logger.Error("Error deleting all leaderboard records for user", zap.String("user_id", userID.String()), zap.Error(err))
		return err
	}

	var leaderboardId string
	var expiryTime pgtype.Timestamptz
	for rows.Next() {
		if err := rows.Scan(&leaderboardId, &expiryTime); err != nil {
			_ = rows.Close()
			logger.Error("Error deleting all leaderboard records for user, failed to scan", zap.String("user_id", userID.String()), zap.Error(err))
			return err
		}

		expiryUnix := expiryTime.Time.Unix()
		if expiryUnix <= currentTime {
			// Expired ranks are handled by the rank cache itself.
			continue
		}

		leaderboardRankCache.Delete(leaderboardId, expiryUnix, userID)
	}
	_ = rows.Close()

	return nil
}

func LeaderboardRecordsHaystack(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId, cursor string, ownerID uuid.UUID, limit int, overrideExpiry int64) (*api.LeaderboardRecordList, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	expiryTime, recordsPossible := calculateExpiryOverride(overrideExpiry, leaderboard)
	if !recordsPossible {
		// If the expiry time is in the past, we won't have any records to return.
		return &api.LeaderboardRecordList{Records: []*api.LeaderboardRecord{}}, nil
	}

	return getLeaderboardRecordsHaystack(ctx, logger, db, leaderboardCache, rankCache, ownerID, limit, leaderboard.Id, cursor, leaderboard.SortOrder, time.Unix(expiryTime, 0).UTC())
}

func LeaderboardsGet(leaderboardCache LeaderboardCache, leaderboardIDs []string) []*api.Leaderboard {
	leaderboards := make([]*api.Leaderboard, 0, len(leaderboardIDs))
	for _, id := range leaderboardIDs {
		l := leaderboardCache.Get(id)
		if l == nil || l.IsTournament() {
			continue
		}

		var prevReset int64
		var nextReset int64
		now := time.Now().UTC()
		if l.ResetSchedule != nil {
			prevReset = calculatePrevReset(now, l.CreateTime, l.ResetSchedule)

			next := l.ResetSchedule.Next(now)
			nextReset = next.Unix()
		}

		leaderboards = append(leaderboards, &api.Leaderboard{
			Id:            l.Id,
			SortOrder:     uint32(l.SortOrder),
			Operator:      OperatorIntToEnum[l.Operator],
			PrevReset:     uint32(prevReset),
			NextReset:     uint32(nextReset),
			Metadata:      l.Metadata,
			CreateTime:    &timestamppb.Timestamp{Seconds: l.CreateTime},
			Authoritative: l.Authoritative,
		})
	}

	if len(leaderboards) == 0 {
		return []*api.Leaderboard{}
	}

	return leaderboards
}

func calculatePrevReset(currentTime time.Time, startTime int64, resetSchedule *cronexpr.Expression) int64 {
	if resetSchedule == nil {
		return 0
	}

	if time.Unix(startTime, 0).After(currentTime) {
		// Hasn't started yet, no prev reset exists.
		return 0
	}

	return resetSchedule.Last(currentTime).Unix()
}

func getLeaderboardRecordsHaystack(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, ownerID uuid.UUID, limit int, leaderboardId, cursor string, sortOrder int, expiryTime time.Time) (*api.LeaderboardRecordList, error) {
	if cursor == "" {
		var dbLeaderboardID string
		var dbOwnerID string
		var dbUsername sql.NullString
		var dbScore int64
		var dbSubscore int64
		var dbNumScore int32
		var dbMaxNumScore int32
		var dbMetadata string
		var dbCreateTime pgtype.Timestamptz
		var dbUpdateTime pgtype.Timestamptz
		var dbExpiryTime pgtype.Timestamptz

		findQuery := `SELECT leaderboard_id, owner_id, username, score, subscore, num_score, max_num_score, metadata, create_time, update_time, expiry_time
		FROM leaderboard_record
		WHERE owner_id = $1
		AND leaderboard_id = $2
		AND expiry_time = $3`
		logger.Debug("Leaderboard haystack lookup", zap.String("query", findQuery))
		err := db.QueryRowContext(ctx, findQuery, ownerID, leaderboardId, expiryTime).Scan(&dbLeaderboardID, &dbOwnerID, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime, &dbExpiryTime)
		if err == sql.ErrNoRows {
			return &api.LeaderboardRecordList{
				Records: []*api.LeaderboardRecord{},
			}, nil
		} else if err != nil {
			logger.Error("Could not load owner record in leaderboard records list haystack", zap.Error(err), zap.String("leaderboard_id", leaderboardId), zap.String("owner_id", ownerID.String()))
			return nil, err
		}

		ownerRecord := &api.LeaderboardRecord{
			// Record populated later.
			LeaderboardId: dbLeaderboardID,
			OwnerId:       dbOwnerID,
			Score:         dbScore,
			Subscore:      dbSubscore,
			NumScore:      dbNumScore,
			MaxNumScore:   uint32(dbMaxNumScore),
			Metadata:      dbMetadata,
			CreateTime:    &timestamppb.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime:    &timestamppb.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
		}
		if dbUsername.Valid {
			ownerRecord.Username = &wrapperspb.StringValue{Value: dbUsername.String}
		}
		if expiryTime := dbExpiryTime.Time.Unix(); expiryTime != 0 {
			ownerRecord.ExpiryTime = &timestamppb.Timestamp{Seconds: expiryTime}
		}

		query := `SELECT leaderboard_id, owner_id, username, score, subscore, num_score, max_num_score, metadata, create_time, update_time, expiry_time
	FROM leaderboard_record
	WHERE leaderboard_id = $1
	AND expiry_time = $2`

		// First half.
		params := []interface{}{leaderboardId, expiryTime, ownerRecord.Score, ownerRecord.Subscore, ownerID}
		firstQuery := query
		if sortOrder == LeaderboardSortOrderAscending {
			// Lower score is better, but get in reverse order from current user to get those immediately above.
			firstQuery += " AND (score, subscore, owner_id) < ($3, $4, $5) ORDER BY score DESC, subscore DESC, owner_id DESC"
		} else {
			// Higher score is better.
			firstQuery += " AND (score, subscore, owner_id) > ($3, $4, $5) ORDER BY score ASC, subscore ASC, owner_id ASC"
		}
		firstParams := append(params, limit+1)
		firstQuery += " LIMIT $6"

		firstRows, err := db.QueryContext(ctx, firstQuery, firstParams...)
		if err != nil {
			logger.Error("Could not execute leaderboard records list query", zap.Error(err))
			return nil, err
		}
		// firstRows.Close() called in parseLeaderboardRecords

		firstRecords, err := parseLeaderboardRecords(logger, firstRows)
		if err != nil {
			return nil, err
		}

		setPrevCursor := false
		if len(firstRecords) > limit {
			// Check if there might be a next cursor
			setPrevCursor = true
			firstRecords = firstRecords[:len(firstRecords)-1]
		}

		// We went 'up' on the leaderboard, so reverse the first half of records.
		for left, right := 0, len(firstRecords)-1; left < right; left, right = left+1, right-1 {
			firstRecords[left], firstRecords[right] = firstRecords[right], firstRecords[left]
		}

		secondQuery := query
		if sortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			secondQuery += " AND (score, subscore, owner_id) > ($3, $4, $5) ORDER BY score ASC, subscore ASC, owner_id ASC"
		} else {
			// Higher score is better.
			secondQuery += " AND (score, subscore, owner_id) < ($3, $4, $5) ORDER BY score DESC, subscore DESC, owner_id DESC"
		}
		secondLimit := limit / 2
		if l := len(firstRecords); l < secondLimit {
			secondLimit = limit - l
		}
		secondParams := append(params, secondLimit+1)
		secondQuery += " LIMIT $6"

		secondRows, err := db.QueryContext(ctx, secondQuery, secondParams...)
		if err != nil {
			logger.Error("Could not execute leaderboard records list query", zap.Error(err))
			return nil, err
		}
		// secondRows.Close() called in parseLeaderboardRecords

		secondRecords, err := parseLeaderboardRecords(logger, secondRows)
		if err != nil {
			return nil, err
		}

		setNextCursor := false
		if len(secondRecords) > secondLimit {
			// Check if there might be a prev cursor
			setNextCursor = true
			secondRecords = secondRecords[:len(secondRecords)-1]
		}

		records := append(firstRecords, ownerRecord)
		records = append(records, secondRecords...)

		numRecords := len(records)
		start := numRecords - limit
		if start < 0 || len(firstRecords) < secondLimit {
			start = 0
		}
		end := start + limit
		if end > numRecords {
			end = numRecords
		}

		if start > 0 {
			// There was a previous result that was discarded, the prev_cursor should be set.
			setPrevCursor = true
		}

		records = records[start:end]
		l := leaderboardCache.Get(leaderboardId)
		if l == nil {
			// Should never happen unless leaderboard is concurrently deleted as records are being requested.
			return nil, ErrLeaderboardNotFound
		}
		rankCount := rankCache.Fill(leaderboardId, expiryTime.Unix(), records, l.EnableRanks)

		var prevCursorStr string
		if setPrevCursor {
			record := records[0]

			prevCursor := &leaderboardRecordListCursor{
				IsNext:        false,
				LeaderboardId: record.LeaderboardId,
				ExpiryTime:    expiryTime.Unix(),
				Score:         record.Score,
				Subscore:      record.Subscore,
				OwnerId:       record.OwnerId,
				Rank:          record.Rank,
			}
			prevCursorStr, err = marshalLeaderboardRecordsListCursor(prevCursor)
			if err != nil {
				logger.Error("Error creating leaderboard records list previous cursor", zap.Error(err))
				return nil, err
			}
		}

		var nextCursorStr string
		if setNextCursor {
			record := records[len(records)-1]

			nextCursor := &leaderboardRecordListCursor{
				IsNext:        true,
				LeaderboardId: record.LeaderboardId,
				ExpiryTime:    expiryTime.Unix(),
				Score:         record.Score,
				Subscore:      record.Subscore,
				OwnerId:       record.OwnerId,
				Rank:          record.Rank,
			}
			nextCursorStr, err = marshalLeaderboardRecordsListCursor(nextCursor)
			if err != nil {
				logger.Error("Error creating leaderboard records list next cursor", zap.Error(err))
				return nil, err
			}
		}

		return &api.LeaderboardRecordList{Records: records, PrevCursor: prevCursorStr, NextCursor: nextCursorStr, RankCount: rankCount}, nil
	} else {
		// If a cursor is passed, then this becomes a regular record listing operation.
		return LeaderboardRecordsList(ctx, logger, db, leaderboardCache, rankCache, leaderboardId, wrapperspb.Int32(int32(limit)), cursor, nil, expiryTime.Unix())
	}
}

func parseLeaderboardRecords(logger *zap.Logger, rows *sql.Rows) ([]*api.LeaderboardRecord, error) {
	defer rows.Close()
	records := make([]*api.LeaderboardRecord, 0, 10)

	var dbLeaderboardID string
	var dbOwnerID string
	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMaxNumScore int32
	var dbMetadata string
	var dbCreateTime pgtype.Timestamptz
	var dbUpdateTime pgtype.Timestamptz
	var dbExpiryTime pgtype.Timestamptz
	for rows.Next() {
		if err := rows.Scan(&dbLeaderboardID, &dbOwnerID, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime, &dbExpiryTime); err != nil {
			logger.Error("Could not execute leaderboard records list query", zap.Error(err))
			return nil, err
		}

		record := &api.LeaderboardRecord{
			LeaderboardId: dbLeaderboardID,
			OwnerId:       dbOwnerID,
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
		expiryTime := dbExpiryTime.Time.Unix()
		if expiryTime != 0 {
			record.ExpiryTime = &timestamppb.Timestamp{Seconds: expiryTime}
		}

		records = append(records, record)
	}

	return records, nil
}

func calculateExpiryOverride(overrideExpiry int64, leaderboard *Leaderboard) (int64, bool) {
	if overrideExpiry == 0 {
		if leaderboard.IsTournament() {
			now := time.Now().UTC()
			_, _, expiryTime := calculateTournamentDeadlines(leaderboard.StartTime, leaderboard.EndTime, int64(leaderboard.Duration), leaderboard.ResetSchedule, now)
			if expiryTime != 0 && expiryTime <= now.Unix() {
				// If the expiry time is in the past, we won't have any records to return.
				return 0, false
			}
			return expiryTime, true
		} else if leaderboard.ResetSchedule != nil {
			now := time.Now().UTC()
			return leaderboard.ResetSchedule.Next(now).UTC().Unix(), true
		}
	}
	return overrideExpiry, true
}

func disableLeaderboardRanks(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, id string) error {
	l := leaderboardCache.Get(id)
	if l == nil || l.IsTournament() {
		return runtime.ErrLeaderboardNotFound
	}

	if _, err := db.QueryContext(ctx, "UPDATE leaderboard SET enable_ranks = false WHERE id = $1", id); err != nil {
		logger.Error("failed to set leaderboard enable_ranks value", zap.Error(err))
		return errors.New("failed to disable tournament ranks")
	}

	leaderboardCache.Insert(l.Id, l.Authoritative, l.SortOrder, l.Operator, l.ResetScheduleStr, l.Metadata, l.CreateTime, false)

	expiryTime := int64(0)
	if l.ResetSchedule != nil {
		expiryTime = l.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
	}

	rankCache.DeleteLeaderboard(l.Id, expiryTime)

	return nil
}
