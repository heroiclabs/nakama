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
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
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

func LeaderboardRecordsList(logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, leaderboardId string, limit *wrappers.Int32Value, cursor string, ownerIds []string) (*api.LeaderboardRecordList, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now()).Unix()
	}

	records := make([]*api.LeaderboardRecord, 0)
	ownerRecords := make([]*api.LeaderboardRecord, 0)
	var nextCursorStr, prevCursorStr string

	if limit != nil {
		limitNumber := int(limit.Value)
		var incomingCursor *leaderboardRecordListCursor
		if cursor != "" {
			if cb, err := base64.StdEncoding.DecodeString(cursor); err != nil {
				return nil, ErrLeaderboardInvalidCursor
			} else {
				incomingCursor = &leaderboardRecordListCursor{}
				if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
					return nil, ErrLeaderboardInvalidCursor
				}
			}

			if leaderboardId != incomingCursor.LeaderboardId {
				// Cursor is for a different leaderboard.
				return nil, ErrLeaderboardInvalidCursor
			} else if expiryTime != incomingCursor.ExpiryTime {
				// Leaderboard expiry has rolled over since this cursor was generated.
				return nil, ErrLeaderboardInvalidCursor
			}
		}

		query := "SELECT owner_id, username, score, subscore, num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND expiry_time = CAST($2::BIGINT AS TIMESTAMPTZ)"
		if incomingCursor == nil {
			// Ascending doesn't need an ordering clause.
			if leaderboard.SortOrder == LeaderboardSortOrderDescending {
				query += " ORDER BY score DESC, subscore DESC, owner_id DESC"
			}
		} else {
			if (leaderboard.SortOrder == LeaderboardSortOrderAscending && incomingCursor.IsNext) || (leaderboard.SortOrder == LeaderboardSortOrderDescending && !incomingCursor.IsNext) {
				// Ascending and next page == descending and previous page.
				query += " AND (leaderboard_id, expiry_time, score, subscore, owner_id) > ($1, CAST($2::BIGINT AS TIMESTAMPTZ), $4, $5, $6)"
			} else {
				// Ascending and previous page == descending and next page.
				query += " AND (leaderboard_id, expiry_time, score, subscore, owner_id) < ($1, CAST($2::BIGINT AS TIMESTAMPTZ), $4, $5, $6) ORDER BY score DESC, subscore DESC, owner_id DESC"
			}
		}
		query += " LIMIT $3"
		params := make([]interface{}, 0, 6)
		params = append(params, leaderboardId, expiryTime, limitNumber+1)
		if incomingCursor != nil {
			params = append(params, incomingCursor.Score, incomingCursor.Subscore, incomingCursor.OwnerId)
		}

		rows, err := db.Query(query, params...)
		if err != nil {
			logger.Error("Error listing leaderboard records", zap.Error(err))
			return nil, err
		}
		defer rows.Close()

		rank := int64(0)
		if incomingCursor != nil {
			rank = incomingCursor.Rank
		}
		records = make([]*api.LeaderboardRecord, 0, limitNumber)
		var nextCursor, prevCursor *leaderboardRecordListCursor

		var dbOwnerId string
		var dbUsername sql.NullString
		var dbScore int64
		var dbSubscore int64
		var dbNumScore int32
		var dbMetadata string
		var dbCreateTime pq.NullTime
		var dbUpdateTime pq.NullTime
		for rows.Next() {
			if len(records) >= limitNumber {
				nextCursor = &leaderboardRecordListCursor{
					IsNext:        true,
					LeaderboardId: leaderboardId,
					ExpiryTime:    expiryTime,
					Score:         dbScore,
					Subscore:      dbSubscore,
					OwnerId:       dbOwnerId,
					Rank:          rank,
				}
				break
			}

			err = rows.Scan(&dbOwnerId, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
			if err != nil {
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
				OwnerId:       dbOwnerId,
				Score:         dbScore,
				Subscore:      dbSubscore,
				NumScore:      dbNumScore,
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
					OwnerId:       dbOwnerId,
					Rank:          rank,
				}
			}
		}

		if incomingCursor != nil && !incomingCursor.IsNext {
			// If this was a previous page listing, flip the results to their normal order and swap the cursors.
			nextCursor, nextCursor.IsNext, nextCursor.Rank, prevCursor, prevCursor.IsNext, prevCursor.Rank = prevCursor, prevCursor.IsNext, prevCursor.Rank, nextCursor, nextCursor.IsNext, nextCursor.Rank

			for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
				records[i], records[i].Rank, records[j], records[j].Rank = records[j], records[j].Rank, records[i], records[i].Rank
			}
		}

		if nextCursor != nil {
			cursorBuf := new(bytes.Buffer)
			if gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
				logger.Error("Error creating leaderboard records list next cursor", zap.Error(err))
				return nil, err
			}
			nextCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
		}
		if prevCursor != nil {
			cursorBuf := new(bytes.Buffer)
			if gob.NewEncoder(cursorBuf).Encode(prevCursor); err != nil {
				logger.Error("Error creating leaderboard records list previous cursor", zap.Error(err))
				return nil, err
			}
			prevCursorStr = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
		}
	}

	if len(ownerIds) != 0 {
		params := make([]interface{}, 0, len(ownerIds)+2)
		params = append(params, leaderboardId, expiryTime)
		statements := make([]string, len(ownerIds))
		for i, ownerId := range ownerIds {
			params = append(params, ownerId)
			statements[i] = "$" + strconv.Itoa(i+3)
		}

		query := "SELECT owner_id, username, score, subscore, num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND expiry_time = CAST($2::BIGINT AS TIMESTAMPTZ) AND owner_id IN (" + strings.Join(statements, ", ") + ")"
		rows, err := db.Query(query, params...)
		if err != nil {
			logger.Error("Error reading leaderboard records", zap.Error(err))
			return nil, err
		}
		defer rows.Close()

		ownerRecords = make([]*api.LeaderboardRecord, 0, len(ownerIds))

		var dbOwnerId string
		var dbUsername sql.NullString
		var dbScore int64
		var dbSubscore int64
		var dbNumScore int32
		var dbMetadata string
		var dbCreateTime pq.NullTime
		var dbUpdateTime pq.NullTime
		for rows.Next() {
			err = rows.Scan(&dbOwnerId, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
			if err != nil {
				logger.Error("Error parsing read leaderboard records", zap.Error(err))
				return nil, err
			}

			record := &api.LeaderboardRecord{
				LeaderboardId: leaderboardId,
				OwnerId:       dbOwnerId,
				Score:         dbScore,
				Subscore:      dbSubscore,
				NumScore:      dbNumScore,
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

		sort.Slice(ownerRecords, func(i, j int) bool {
			iRecord := ownerRecords[i]
			jRecord := ownerRecords[j]
			if leaderboard.SortOrder == LeaderboardSortOrderAscending {
				if iRecord.Score < jRecord.Score {
					return true
				} else if iRecord.Score == jRecord.Score {
					if iRecord.Subscore < jRecord.Subscore {
						return true
					} else if iRecord.Subscore == jRecord.Subscore {
						if iRecord.OwnerId < jRecord.OwnerId {
							return true
						}
					}
				}
				return false
			} else {
				if iRecord.Score > jRecord.Score {
					return true
				} else if iRecord.Score == jRecord.Score {
					if iRecord.Subscore > jRecord.Subscore {
						return true
					} else if iRecord.Subscore == jRecord.Subscore {
						if iRecord.OwnerId > jRecord.OwnerId {
							return true
						}
					}
				}
				return false
			}
		})
		for i, record := range ownerRecords {
			record.Rank = int64(i + 1)
		}
	}

	return &api.LeaderboardRecordList{
		Records:      records,
		OwnerRecords: ownerRecords,
		NextCursor:   nextCursorStr,
		PrevCursor:   prevCursorStr,
	}, nil
}

func LeaderboardRecordWrite(logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, caller uuid.UUID, leaderboardId, ownerId, username string, score, subscore int64, metadata string) (*api.LeaderboardRecord, error) {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil, ErrLeaderboardNotFound
	}

	if leaderboard.Authoritative && caller != uuid.Nil {
		return nil, ErrLeaderboardAuthoritative
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now()).Unix()
	}

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

	query := `INSERT INTO leaderboard_record (leaderboard_id, owner_id, username, score, subscore, metadata, expiry_time)
            VALUES ($1, $2, $3, $4, $5, COALESCE($6, '{}'), CAST($7::BIGINT AS TIMESTAMPTZ))
            ON CONFLICT (owner_id, leaderboard_id, expiry_time)
            DO UPDATE SET ` + opSql + `, num_score = leaderboard_record.num_score + 1, metadata = COALESCE($6, leaderboard_record.metadata), update_time = now()`
	params := make([]interface{}, 0, 9)
	params = append(params, leaderboardId, ownerId)
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

	_, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Error writing leaderboard record", zap.Error(err))
		return nil, err
	}

	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMetadata string
	var dbCreateTime pq.NullTime
	var dbUpdateTime pq.NullTime
	query = "SELECT username, score, subscore, num_score, metadata, create_time, update_time FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = CAST($3::BIGINT AS TIMESTAMPTZ)"
	err = db.QueryRow(query, leaderboardId, ownerId, expiryTime).Scan(&dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime)
	if err != nil {
		logger.Error("Error after writing leaderboard record", zap.Error(err))
		return nil, err
	}

	record := &api.LeaderboardRecord{
		LeaderboardId: leaderboardId,
		OwnerId:       ownerId,
		Score:         dbScore,
		Subscore:      dbSubscore,
		NumScore:      dbNumScore,
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

func LeaderboardRecordDelete(logger *zap.Logger, db *sql.DB, leaderboardCache LeaderboardCache, caller uuid.UUID, leaderboardId, ownerId string) error {
	leaderboard := leaderboardCache.Get(leaderboardId)
	if leaderboard == nil {
		return nil
	}

	if leaderboard.Authoritative && caller != uuid.Nil {
		return ErrLeaderboardAuthoritative
	}

	expiryTime := int64(0)
	if leaderboard.ResetSchedule != nil {
		expiryTime = leaderboard.ResetSchedule.Next(time.Now()).Unix()
	}

	query := "DELETE FROM leaderboard_record WHERE leaderboard_id = $1 AND owner_id = $2 AND expiry_time = CAST($3::BIGINT AS TIMESTAMPTZ)"
	_, err := db.Exec(query, leaderboardId, ownerId, expiryTime)
	if err != nil {
		logger.Error("Error deleting leaderboard record", zap.Error(err))
		return err
	}

	return nil
}

func LeaderboardRecordReadAll(logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*api.LeaderboardRecord, error) {
	query := "SELECT leaderboard_id, owner_id, username, score, subscore, num_score, metadata, create_time, update_time, expiry_time FROM leaderboard_record WHERE owner_id = $1"
	rows, err := db.Query(query, userID.String())
	if err != nil {
		logger.Error("Error reading all leaderboard records for user", zap.String("user_id", userID.String()), zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	records := make([]*api.LeaderboardRecord, 0, 10)

	var dbLeaderboardId string
	var dbOwnerId string
	var dbUsername sql.NullString
	var dbScore int64
	var dbSubscore int64
	var dbNumScore int32
	var dbMetadata string
	var dbCreateTime pq.NullTime
	var dbUpdateTime pq.NullTime
	var dbExpiryTime pq.NullTime
	for rows.Next() {
		err = rows.Scan(&dbLeaderboardId, &dbOwnerId, &dbUsername, &dbScore, &dbSubscore, &dbNumScore, &dbMetadata, &dbCreateTime, &dbUpdateTime, &dbExpiryTime)
		if err != nil {
			logger.Error("Error parsing read all leaderboard records for user", zap.String("user_id", userID.String()), zap.Error(err))
			return nil, err
		}

		record := &api.LeaderboardRecord{
			LeaderboardId: dbLeaderboardId,
			OwnerId:       dbOwnerId,
			Score:         dbScore,
			Subscore:      dbSubscore,
			NumScore:      dbNumScore,
			Metadata:      dbMetadata,
			CreateTime:    &timestamp.Timestamp{Seconds: dbCreateTime.Time.Unix()},
			UpdateTime:    &timestamp.Timestamp{Seconds: dbUpdateTime.Time.Unix()},
		}
		if dbUsername.Valid {
			record.Username = &wrappers.StringValue{Value: dbUsername.String}
		}
		if expiryTime := dbExpiryTime.Time.Unix(); expiryTime != 0 {
			record.ExpiryTime = &timestamp.Timestamp{Seconds: expiryTime}
		}

		records = append(records, record)
	}

	return records, nil
}

func LeaderboardRecordsDeleteAll(logger *zap.Logger, tx *sql.Tx, userID uuid.UUID) error {
	query := "DELETE FROM leaderboard_record WHERE owner_id = $1"
	_, err := tx.Exec(query, userID.String())
	if err != nil {
		logger.Error("Error deleting all leaderboard records for user", zap.String("user_id", userID.String()), zap.Error(err))
		return err
	}
	return nil
}
