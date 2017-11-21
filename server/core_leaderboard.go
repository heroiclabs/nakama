// Copyright 2017 The Nakama Authors
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
	"encoding/base64"
	"encoding/json"

	"database/sql"
	"errors"

	"bytes"
	"encoding/gob"
	"github.com/gorhill/cronexpr"
	"go.uber.org/zap"
	"strconv"
	"strings"
)

func leaderboardCreate(logger *zap.Logger, db *sql.DB, id string, sortOrder, resetSchedule, metadata string, authoritative bool) (string, error) {
	query := `INSERT INTO leaderboard (id, authoritative, sort_order, reset_schedule, metadata)
	VALUES ($1, $2, $3, $4, $5)`
	params := []interface{}{}

	// ID.
	if len(id) == 0 {
		params = append(params, generateNewId())
	} else {
		params = append(params, id)
	}

	// Authoritative.
	params = append(params, authoritative)

	// Sort order.
	if sortOrder == "asc" {
		params = append(params, 0)
	} else if sortOrder == "desc" {
		params = append(params, 1)
	} else {
		logger.Warn("Invalid sort value, must be 'asc' or 'desc'.", zap.String("sort", sortOrder))
		return "", errors.New("Invalid sort value, must be 'asc' or 'desc'.")
	}

	// Count is hardcoded in the INSERT above.

	// Reset schedule.
	if resetSchedule != "" {
		_, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			logger.Warn("Failed to parse reset schedule", zap.String("reset", resetSchedule), zap.Error(err))
			return "", err
		}
		params = append(params, resetSchedule)
	} else {
		params = append(params, nil)
	}

	// Metadata.
	metadataBytes := []byte(metadata)
	var maybeJSON map[string]interface{}
	if err := json.Unmarshal(metadataBytes, &maybeJSON); err != nil {
		logger.Warn("Failed to unmarshall metadata", zap.String("metadata", metadata), zap.Error(err))
		return "", err
	}
	params = append(params, metadataBytes)

	res, err := db.Exec(query, params...)
	if err != nil {
		if strings.HasSuffix(err.Error(), "violates unique constraint \"primary\"") {
			return "", errors.New("Leaderboard ID already in use")
		} else {
			logger.Error("Error creating leaderboard", zap.Error(err))
			return "", err
		}
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
		logger.Error("Error creating leaderboard, unexpected insert result")
		return "", errors.New("Error creating leaderboard, unexpected insert result")
	}

	return params[0].(string), nil
}

func leaderboardRecordsList(logger *zap.Logger, db *sql.DB, caller string, list *TLeaderboardRecordsList) ([]*LeaderboardRecord, string, Error_Code, error) {
	if len(list.LeaderboardId) == 0 {
		return nil, "", BAD_INPUT, errors.New("Leaderboard ID must be present")
	}

	limit := list.Limit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		return nil, "", BAD_INPUT, errors.New("Limit must be between 10 and 100")
	}

	var incomingCursor *leaderboardRecordListCursor
	if len(list.Cursor) != 0 {
		if cb, err := base64.StdEncoding.DecodeString(list.Cursor); err != nil {
			return nil, "", BAD_INPUT, errors.New("Invalid cursor data")
		} else {
			incomingCursor = &leaderboardRecordListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
				return nil, "", BAD_INPUT, errors.New("Invalid cursor data")
			}
		}
	}

	var sortOrder int64
	var resetSchedule sql.NullString
	query := "SELECT sort_order, reset_schedule FROM leaderboard WHERE id = $1"
	logger.Debug("Leaderboard lookup", zap.String("query", query))
	err := db.QueryRow(query, list.LeaderboardId).
		Scan(&sortOrder, &resetSchedule)
	if err != nil {
		logger.Error("Could not execute leaderboard records list metadata query", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}

	currentExpiresAt := int64(0)
	if resetSchedule.Valid {
		expr, err := cronexpr.Parse(resetSchedule.String)
		if err != nil {
			logger.Error("Could not parse leaderboard reset schedule query", zap.Error(err))
			return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
		}
		currentExpiresAt = timeToMs(expr.Next(now()))
	}

	query = `SELECT id, owner_id, handle, lang, location, timezone,
	  rank_value, score, num_score, metadata, ranked_at, updated_at, expires_at, banned_at
	FROM leaderboard_record
	WHERE leaderboard_id = $1
	AND expires_at = $2`
	params := []interface{}{list.LeaderboardId, currentExpiresAt}

	returnCursor := true
	switch list.Filter.(type) {
	case *TLeaderboardRecordsList_OwnerId:
		if incomingCursor != nil {
			return nil, "", BAD_INPUT, errors.New("Cursor not allowed with haystack query")
		}
		// Haystack queries are executed in a separate flow.
		return loadLeaderboardRecordsHaystack(logger, db, caller, list, list.LeaderboardId, list.GetOwnerId(), currentExpiresAt, limit, sortOrder, query, params)
	case *TLeaderboardRecordsList_OwnerIds:
		if incomingCursor != nil {
			return nil, "", BAD_INPUT, errors.New("Cursor not allowed with batch filter query")
		}
		if len(list.GetOwnerIds().OwnerIds) < 1 || len(list.GetOwnerIds().OwnerIds) > 100 {
			return nil, "", BAD_INPUT, errors.New("Must be 1-100 owner IDs")
		}
		statements := []string{}
		for _, ownerId := range list.GetOwnerIds().OwnerIds {
			params = append(params, ownerId)
			statements = append(statements, "$"+strconv.Itoa(len(params)))
		}
		query += " AND owner_id IN (" + strings.Join(statements, ", ") + ")"
		// Never return a cursor with this filter type.
		returnCursor = false
	case *TLeaderboardRecordsList_Lang:
		query += " AND lang = $3"
		params = append(params, list.GetLang())
	case *TLeaderboardRecordsList_Location:
		query += " AND location = $3"
		params = append(params, list.GetLocation())
	case *TLeaderboardRecordsList_Timezone:
		query += " AND timezone = $3"
		params = append(params, list.GetTimezone())
	case nil:
		// No filter.
		break
	default:
		return nil, "", BAD_INPUT, errors.New("Unknown leaderboard record list filter")
	}

	if incomingCursor != nil {
		count := len(params)
		if sortOrder == 0 {
			// Ascending leaderboard.
			query += " AND (score, updated_at, id) > ($" + strconv.Itoa(count+1) +
				", $" + strconv.Itoa(count+2) +
				", $" + strconv.Itoa(count+3) + ")"
			params = append(params, incomingCursor.Score, incomingCursor.UpdatedAt, incomingCursor.Id)
		} else {
			// Descending leaderboard.
			query += " AND (score, updated_at_inverse, id) < ($" + strconv.Itoa(count+1) +
				", $" + strconv.Itoa(count+2) +
				", $" + strconv.Itoa(count+3) + ")"
			params = append(params, incomingCursor.Score, invertMs(incomingCursor.UpdatedAt), incomingCursor.Id)
		}
	}

	if sortOrder == 0 {
		// Ascending leaderboard, lower score is better.
		query += " ORDER BY score ASC, updated_at ASC"
	} else {
		// Descending leaderboard, higher score is better.
		query += " ORDER BY score DESC, updated_at_inverse DESC"
	}

	params = append(params, limit+1)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("Leaderboard records list", zap.String("query", query))
	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboard records list query", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}
	defer rows.Close()

	leaderboardRecords := []*LeaderboardRecord{}
	var outgoingCursor string

	var id string
	var ownerId string
	var handle string
	var lang string
	var location sql.NullString
	var timezone sql.NullString
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var updatedAt int64
	var expiresAt int64
	var bannedAt int64
	for rows.Next() {
		if returnCursor && int64(len(leaderboardRecords)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardRecordListCursor{
				Score:     score,
				UpdatedAt: updatedAt,
				Id:        id,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboard records list cursor", zap.Error(err))
				return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		err = rows.Scan(&id, &ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records list query results", zap.Error(err))
			return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
		}

		leaderboardRecords = append(leaderboardRecords, &LeaderboardRecord{
			LeaderboardId: list.LeaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location.String,
			Timezone:      timezone.String,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      string(metadata),
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not process leaderboard records list query results", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}

	return normalizeLeaderboardRecords(leaderboardRecords), outgoingCursor, 0, nil
}

func loadLeaderboardRecordsHaystack(logger *zap.Logger, db *sql.DB, caller string, list *TLeaderboardRecordsList, leaderboardId, findOwnerId string, currentExpiresAt, limit, sortOrder int64, query string, params []interface{}) ([]*LeaderboardRecord, string, Error_Code, error) {
	// Find the owner's record.
	var pivotID string
	var pivotScore int64
	var pivotUpdatedAt int64
	findQuery := `SELECT id, score, updated_at
		FROM leaderboard_record
		WHERE leaderboard_id = $1
		AND expires_at = $2
		AND owner_id = $3`
	logger.Debug("Leaderboard record find", zap.String("query", findQuery))
	err := db.QueryRow(findQuery, leaderboardId, currentExpiresAt, findOwnerId).Scan(&pivotID, &pivotScore, &pivotUpdatedAt)
	if err == sql.ErrNoRows {
		return []*LeaderboardRecord{}, "", 0, nil
	} else if err != nil {
		logger.Error("Could not load owner record in leaderboard records list haystack", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}

	// First half.
	count := len(params)
	firstQuery := query
	firstParams := make([]interface{}, count)
	copy(firstParams, params)
	if sortOrder == 0 {
		// Lower score is better, but get in reverse order from current user to get those immediately above.
		firstQuery += " AND (score, updated_at_inverse, id) <= ($" + strconv.Itoa(count+1) +
			", $" + strconv.Itoa(count+2) +
			", $" + strconv.Itoa(count+3) + ") ORDER BY score DESC, updated_at_inverse DESC"
		firstParams = append(firstParams, pivotScore, invertMs(pivotUpdatedAt), pivotID)
	} else {
		// Higher score is better.
		firstQuery += " AND (score, updated_at, id) >= ($" + strconv.Itoa(count+1) +
			", $" + strconv.Itoa(count+2) +
			", $" + strconv.Itoa(count+3) + ") ORDER BY score ASC, updated_at ASC"
		firstParams = append(firstParams, pivotScore, pivotUpdatedAt, pivotID)
	}
	firstParams = append(firstParams, limit)
	firstQuery += " LIMIT $" + strconv.Itoa(len(firstParams))

	logger.Debug("Leaderboard records list", zap.String("query", firstQuery))
	firstRows, err := db.Query(firstQuery, firstParams...)
	if err != nil {
		logger.Error("Could not execute leaderboard records list query", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}
	defer firstRows.Close()

	leaderboardRecords := []*LeaderboardRecord{}

	var id string
	var ownerId string
	var handle string
	var lang string
	var location sql.NullString
	var timezone sql.NullString
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var updatedAt int64
	var expiresAt int64
	var bannedAt int64
	for firstRows.Next() {
		err = firstRows.Scan(&id, &ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records list query results", zap.Error(err))
			return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
		}

		leaderboardRecords = append(leaderboardRecords, &LeaderboardRecord{
			LeaderboardId: leaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location.String,
			Timezone:      timezone.String,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      string(metadata),
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		})
	}
	if err = firstRows.Err(); err != nil {
		logger.Error("Could not process leaderboard records list query results", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}

	// We went 'up' on the leaderboard, so reverse the first half of records.
	for left, right := 0, len(leaderboardRecords)-1; left < right; left, right = left+1, right-1 {
		leaderboardRecords[left], leaderboardRecords[right] = leaderboardRecords[right], leaderboardRecords[left]
	}

	// Second half.
	secondQuery := query
	secondParams := make([]interface{}, count)
	copy(secondParams, params)
	if sortOrder == 0 {
		// Lower score is better.
		secondQuery += " AND (score, updated_at, id) > ($" + strconv.Itoa(count+1) +
			", $" + strconv.Itoa(count+2) +
			", $" + strconv.Itoa(count+3) + ") ORDER BY score ASC, updated_at ASC"
		secondParams = append(secondParams, pivotScore, pivotUpdatedAt, pivotID)
	} else {
		// Higher score is better.
		secondQuery += " AND (score, updated_at_inverse, id) < ($" + strconv.Itoa(count+1) +
			", $" + strconv.Itoa(count+2) +
			", $" + strconv.Itoa(count+3) + ") ORDER BY score DESC, updated_at DESC"
		secondParams = append(secondParams, pivotScore, invertMs(pivotUpdatedAt), pivotID)
	}
	secondLimit := limit/2 + 2
	if l := int64(len(leaderboardRecords)); l < limit/2 {
		secondLimit = limit - l + 2
	}
	secondParams = append(secondParams, secondLimit)
	secondQuery += " LIMIT $" + strconv.Itoa(len(secondParams))

	logger.Debug("Leaderboard records list", zap.String("query", secondQuery))
	secondRows, err := db.Query(secondQuery, secondParams...)
	if err != nil {
		logger.Error("Could not execute leaderboard records list query", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}
	defer secondRows.Close()

	var outgoingCursor string

	need := limit / 2
	if l := int64(len(leaderboardRecords)); l < limit/2 {
		need += limit/2 - l
	}
	for secondRows.Next() {
		if need <= 0 {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardRecordListCursor{
				Score:     score,
				UpdatedAt: updatedAt,
				Id:        id,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboard records list cursor", zap.Error(err))
				return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		err = secondRows.Scan(&id, &ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records list query results", zap.Error(err))
			return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
		}

		leaderboardRecords = append(leaderboardRecords, &LeaderboardRecord{
			LeaderboardId: leaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location.String,
			Timezone:      timezone.String,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      string(metadata),
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		})
		need--
	}
	if err = secondRows.Err(); err != nil {
		logger.Error("Could not process leaderboard records list query results", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, errors.New("Error loading leaderboard records")
	}

	start := int64(len(leaderboardRecords)) - limit
	if start < 0 {
		start = 0
	}
	return normalizeLeaderboardRecords(leaderboardRecords[start:]), outgoingCursor, 0, nil
}

func normalizeLeaderboardRecords(records []*LeaderboardRecord) []*LeaderboardRecord {
	var bestRank int64
	for _, record := range records {
		if record.Rank != 0 && record.Rank < bestRank {
			bestRank = record.Rank
		}
	}
	if bestRank != 0 {
		for i := int64(0); i < int64(len(records)); i++ {
			records[i].Rank = bestRank + i
		}
	}
	return records
}

func leaderboardSubmit(logger *zap.Logger, db *sql.DB, caller string, leaderboardID string, ownerID string, handle string, lang string, op string, value int64, location string, timezone string, metadata []byte) (*LeaderboardRecord, Error_Code, error) {
	var authoritative bool
	var sortOrder int64
	var resetSchedule sql.NullString
	query := "SELECT authoritative, sort_order, reset_schedule FROM leaderboard WHERE id = $1"
	logger.Debug("Leaderboard lookup", zap.String("query", query), zap.Any("leaderboard_id", leaderboardID))
	err := db.QueryRow(query, leaderboardID).
		Scan(&authoritative, &sortOrder, &resetSchedule)
	if err != nil {
		logger.Error("Could not execute leaderboard record write metadata query", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Error writing leaderboard record")
	}

	now := now()
	updatedAt := timeToMs(now)
	expiresAt := int64(0)
	if resetSchedule.Valid {
		expr, err := cronexpr.Parse(resetSchedule.String)
		if err != nil {
			logger.Error("Could not parse leaderboard reset schedule query", zap.Error(err))
			return nil, RUNTIME_EXCEPTION, errors.New("Error writing leaderboard record")
		}
		expiresAt = timeToMs(expr.Next(now))
	}

	if authoritative && caller != "" {
		return nil, BAD_INPUT, errors.New("Cannot submit to authoritative leaderboard")
	}

	var scoreOpSql string
	var scoreDelta int64
	var scoreAbs int64
	switch op {
	case "incr":
		scoreOpSql = "score = leaderboard_record.score + $17::BIGINT"
		scoreDelta = value
		scoreAbs = value
	case "decr":
		scoreOpSql = "score = leaderboard_record.score - $17::BIGINT"
		scoreDelta = value
		scoreAbs = 0 - value
	case "set":
		scoreOpSql = "score = $17::BIGINT"
		scoreDelta = value
		scoreAbs = value
	case "best":
		if sortOrder == 0 {
			// Lower score is better.
			scoreOpSql = "score = ((leaderboard_record.score + $17::BIGINT - abs(leaderboard_record.score - $17::BIGINT)) / 2)::BIGINT"
		} else {
			// Higher score is better.
			scoreOpSql = "score = ((leaderboard_record.score + $17::BIGINT + abs(leaderboard_record.score - $17::BIGINT)) / 2)::BIGINT"
		}
		scoreDelta = value
		scoreAbs = value
	default:
		return nil, BAD_INPUT, errors.New("Unknown leaderboard record write operator")
	}

	params := []interface{}{generateNewId(), leaderboardID, ownerID, handle, lang}
	if location != "" {
		params = append(params, location)
	} else {
		params = append(params, nil)
	}
	if timezone != "" {
		params = append(params, timezone)
	} else {
		params = append(params, nil)
	}
	params = append(params, 0, scoreAbs, 1)
	if len(metadata) != 0 {
		params = append(params, metadata)
	} else {
		params = append(params, nil)
	}
	params = append(params, 0, updatedAt, invertMs(updatedAt), expiresAt, 0, scoreDelta)

	query = `INSERT INTO leaderboard_record (id, leaderboard_id, owner_id, handle, lang, location, timezone,
				rank_value, score, num_score, metadata, ranked_at, updated_at, updated_at_inverse, expires_at, banned_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, '{}'::BYTEA), $12, $13, $14, $15, $16)
			ON CONFLICT (leaderboard_id, expires_at, owner_id)
			DO UPDATE SET handle = $4, lang = $5, location = COALESCE($6, leaderboard_record.location),
			  timezone = COALESCE($7, leaderboard_record.timezone), ` + scoreOpSql + `, num_score = leaderboard_record.num_score + 1,
			  metadata = COALESCE($11, leaderboard_record.metadata), updated_at = $13`
	logger.Debug("Leaderboard record write", zap.String("query", query))
	res, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboard record write query", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Error writing leaderboard record")
	}
	if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
		logger.Error("Unexpected row count from leaderboard record write query")
		return nil, RUNTIME_EXCEPTION, errors.New("Error writing leaderboard record")
	}

	record, err := leaderboardQueryRecords(logger, db, leaderboardID, ownerID, handle, lang, expiresAt, updatedAt)
	if err != nil {
		return nil, RUNTIME_EXCEPTION, errors.New("Error writing leaderboard record")
	}
	return record, 0, nil
}

func leaderboardQueryRecords(logger *zap.Logger, db *sql.DB, leaderboardID string, ownerID string, handle string, lang string, expiresAt int64, updatedAt int64) (*LeaderboardRecord, error) {
	var location sql.NullString
	var timezone sql.NullString
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var bannedAt int64
	query := `SELECT location, timezone, rank_value, score, num_score, metadata, ranked_at, banned_at
		FROM leaderboard_record
		WHERE leaderboard_id = $1
		AND expires_at = $2
		AND owner_id = $3`
	logger.Debug("Leaderboard record read", zap.String("query", query))
	err := db.QueryRow(query, leaderboardID, expiresAt, ownerID).
		Scan(&location, &timezone, &rankValue, &score, &numScore, &metadata, &rankedAt, &bannedAt)
	if err != nil {
		logger.Error("Could not execute leaderboard record read query", zap.Error(err))
		return nil, err
	}

	return &LeaderboardRecord{
		LeaderboardId: leaderboardID,
		OwnerId:       ownerID,
		Handle:        handle,
		Lang:          lang,
		Location:      location.String,
		Timezone:      timezone.String,
		Rank:          rankValue,
		Score:         score,
		NumScore:      numScore,
		Metadata:      string(metadata),
		RankedAt:      rankedAt,
		UpdatedAt:     updatedAt,
		ExpiresAt:     expiresAt,
	}, nil
}
