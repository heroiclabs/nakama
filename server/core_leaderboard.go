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
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/jackc/pgx/pgtype"
	"github.com/pkg/errors"
	"go.uber.org/zap"
)

var (
	ErrLeaderboardNotFound      = errors.New("leaderboard not found")
	ErrLeaderboardAuthoritative = errors.New("leaderboard only allows authoritative submissions")
	ErrLeaderboardInvalidCursor = errors.New("leaderboard cursor invalid")
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

func LeaderboardRecordsList(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId string, limit *wrappers.Int32Value, cursor string, ownerIds []string, overrideExpiry int64) (*api.LeaderboardRecordList, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	expiryTime, recordsPossible := calculateExpiryOverride(overrideExpiry, leaderboard)
	if !recordsPossible {
		// If the expiry time is in the past, we wont have any records to return.
		return &api.LeaderboardRecordList{}, nil
	}

	records := make([]*api.LeaderboardRecord, 0)
	ownerRecords := make([]*api.LeaderboardRecord, 0)
	var nextCursorStr, prevCursorStr string

	if limit != nil {
		limitNumber := int(limit.Value)
		var incomingCursor *leaderboardRecordListCursor
		if cursor != "" {
			cb, err := base64.StdEncoding.DecodeString(cursor)
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

		logger.Debug("Leaderboard record list query", zap.String("query", query), zap.Any("params", params))
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
				CreateTime:    &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
				UpdateTime:    &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
				Rank:          rank,
			}
			if dbUsername.Valid {
				record.Username = &wrappers.StringValue{Value: dbUsername.String}
			}
			if expiryTime != 0 {
				record.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
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
			cursorBuf := new(bytes.Buffer)
			if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
				logger.Error("Error creating leaderboard records list next cursor", zap.Error(err))
				return nil, err
			}
			nextCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
		}
		if prevCursor != nil {
			cursorBuf := new(bytes.Buffer)
			if err := gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
				logger.Error("Error creating leaderboard records list previous cursor", zap.Error(err))
				return nil, err
			}
			prevCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
		}
	}

	if len(ownerIds) != 0 {
		params := make([]interface{}, 0, len(ownerIds)+2)
		params = append(params, leaderboardId, time.Unix(expiryTime, 0).UTC())
		statements := make([]string, len(ownerIds))
		for i, ownerID := range ownerIds {
			params = append(params, ownerID)
			statements[i] = "$" + strconv.Itoa(i+3)
		}

		query := "SELECT owner_id, username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND expiry_time = $2 AND owner_id IN (" + strings.Join(statements, ", ") + ")"
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
				CreateTime:    &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
				UpdateTime:    &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
			}
			if dbUsername.Valid {
				record.Username = &wrappers.StringValue{Value: dbUsername.String}
			}
			if expiryTime != 0 {
				record.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
			}

			ownerRecords = append(ownerRecords, record)
		}
		_ = rows.Close()
	}

	// Bulk fill in the ranks of any owner records requested.
	rankCache.Fill(leaderboardId, expiryTime, ownerRecords)

	return &api.LeaderboardRecordList{
		Records:      records,
		OwnerRecords: ownerRecords,
		NextCursor:   nextCursorStr,
		PrevCursor:   prevCursorStr,
	}, nil
}

func LeaderboardRecordWrite(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, caller uuid.UUID, leaderboardId, ownerID, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
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

	var opSQL string
	var filterSQL string
	var scoreDelta int64
	var subscoreDelta int64
	var scoreAbs int64
	var subscoreAbs int64
	switch leaderboard.Operator {
	case LeaderboardOperatorIncrement:
		opSQL = "score = leaderboard_record.score + $8, subscore = leaderboard_record.subscore + $9"
		filterSQL = " WHERE $8 <> 0 OR $9 <> 0"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorSet:
		opSQL = "score = $8, subscore = $9"
		filterSQL = " WHERE leaderboard_record.score <> $8 OR leaderboard_record.subscore <> $9"
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	case LeaderboardOperatorBest:
		fallthrough
	default:
		if leaderboard.SortOrder == LeaderboardSortOrderAscending {
			// Lower score is better.
			opSQL = "score = div((leaderboard_record.score + $8 - abs(leaderboard_record.score - $8)), 2), subscore = div((leaderboard_record.subscore + $9 - abs(leaderboard_record.subscore - $9)), 2)"
			filterSQL = " WHERE leaderboard_record.score > $8 OR leaderboard_record.subscore > $9"
		} else {
			// Higher score is better.
			opSQL = "score = div((leaderboard_record.score + $8 + abs(leaderboard_record.score - $8)), 2), subscore = div((leaderboard_record.subscore + $9 + abs(leaderboard_record.subscore - $9)), 2)"
			filterSQL = " WHERE leaderboard_record.score < $8 OR leaderboard_record.subscore < $9"
		}
		scoreDelta = score
		subscoreDelta = subscore
		scoreAbs = score
		subscoreAbs = subscore
	}

	query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'::JSONB), $7)
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSQL + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($6, leaderboard_record.metadata), username = COALESCE($3, leaderboard_record.username), update_time = now()` + filterSQL
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
	params = append(params, time.Unix(expiryTime, 0).UTC(), scoreDelta, subscoreDelta)

	_, err := db.ExecContext(ctx, query, params...)
	if err != nil {
		logger.Error("Error writing leaderboard record", zap.Error(err))
		return nil, err
	}

	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMaxNumScore int32
	var dbMetadata string
	var dbCreateTime pgtype.Timestamptz
	var dbUpdateTime pgtype.Timestamptz
	query = "SELECT username, score, subscore, num_score, max_num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
	err = db.QueryRowContext(ctx, query, leaderboardId, ownerID, time.Unix(expiryTime, 0).UTC()).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMaxNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
	if err != nil {
		logger.Error("Error after writing leaderboard record", zap.Error(err))
		return nil, err
	}

	// ensure we have the latest dbscore, dbsubscore
	newRank := rankCache.Insert(leaderboardId, expiryTime, leaderboard.SortOrder, uuid.Must(uuid.FromString(ownerID)), dbScore, dbSubscore)

	record := &api.LeaderboardRecord{
		Rank:          newRank,
		LeaderboardId: leaderboardId,
		OwnerId:       ownerID,
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

func LeaderboardRecordDelete(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, caller uuid.UUID, leaderboardId, ownerID string) error {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil
	}

	if leaderboard.Authoritative && caller != uuid.Nil {
		return ErrLeaderboardAuthoritative
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now().UTC()).UTC().Unix()
	}

	query := "DELETE FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = $3"
	_, err := db.ExecContext(ctx, query, leaderboardId, ownerID, time.Unix(expiryTime, 0).UTC())
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

func LeaderboardRecordsDeleteAll(ctx context.Context, logger *zap.Logger, tx *sql.Tx, userID uuid.UUID) error {
	query := "DELETE FROM leaderboard_record WHERE owner_id = $1"
	_, err := tx.ExecContext(ctx, query, userID.String())
	if err != nil {
		logger.Error("Error deleting all leaderboard records for user", zap.String("user_id", userID.String()), zap.Error(err))
		return err
	}
	return nil
}

func LeaderboardRecordsHaystack(ctx context.Context, logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardId string, ownerID uuid.UUID, limit int, overrideExpiry int64) ([]*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	expiryTime, recordsPossible := calculateExpiryOverride(overrideExpiry, leaderboard)
	if !recordsPossible {
		// If the expiry time is in the past, we wont have any records to return.
		return make([]*api.LeaderboardRecord, 0), nil
	}

	return getLeaderboardRecordsHaystack(ctx, logger, db, rankCache, ownerID, limit, leaderboard.Id, leaderboard.SortOrder, time.Unix(expiryTime, 0).UTC())
}

func getLeaderboardRecordsHaystack(ctx context.Context, logger *zap.Logger, db *sql.DB, rankCache LeaderboardRankCache, ownerID uuid.UUID, limit int, leaderboardId string, sortOrder int, expiryTime time.Time) ([]*api.LeaderboardRecord, error) {
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
		return []*api.LeaderboardRecord{}, nil
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
		CreateTime:    &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
		UpdateTime:    &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
	}
	if dbUsername.Valid {
		ownerRecord.Username = &wrappers.StringValue{Value: dbUsername.String}
	}
	if expiryTime := dbExpiryTime.Time.Unix(); expiryTime != 0 {
		ownerRecord.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
	}

	if limit == 1 {
		ownerRecord.Rank = rankCache.Get(leaderboardId, expiryTime.Unix(), ownerID)
		return []*api.LeaderboardRecord{ownerRecord}, nil
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
	firstParams := append(params, limit)
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
	if l := len(firstRecords); l < limit/2 {
		secondLimit = limit - l
	}
	secondParams := append(params, secondLimit)
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

	records := append(firstRecords, ownerRecord)
	records = append(records, secondRecords...)

	start := len(records) - int(limit)
	if start < 0 {
		start = 0
	}

	records = records[start:]
	rankCache.Fill(leaderboardId, expiryTime.Unix(), records)

	return records, nil
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
			CreateTime:    &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime:    &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
		}
		if dbUsername.Valid {
			record.Username = &wrappers.StringValue{Value: dbUsername.String}
		}
		expiryTime := dbExpiryTime.Time.Unix()
		if expiryTime != 0 {
			record.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
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
				// If the expiry time is in the past, we wont have any records to return.
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
