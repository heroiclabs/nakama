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
	"bytes"
	"encoding/gob"
	"encoding/json"
	"github.com/gorhill/cronexpr"
	"github.com/uber-go/zap"
	"strconv"
)

type leaderboardCursor struct {
	Id []byte
}

type leaderboardRecordCursor struct {
	LeaderboardId []byte
	OwnerId       []byte
	ExpiresAt     int64
}

func (p *pipeline) leaderboardsList(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardsList()

	limit := incoming.Limit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Limit must be between 10 and 100"}}})
		return
	}

	query := "SELECT id, authoritative, sort_order, count, reset_schedule, metadata, next_id, prev_id FROM leaderboard"
	params := []interface{}{}

	if len(incoming.Cursor) != 0 {
		var incomingCursor leaderboardCursor
		if err := gob.NewDecoder(bytes.NewReader(incoming.Cursor)).Decode(&incomingCursor); err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Invalid cursor data"}}})
			return
		}
		query += " WHERE id > $1"
		params = append(params, incomingCursor.Id)
	}

	params = append(params, limit+1)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("DB request", zap.String("query", query))
	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboards list query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboards"}}})
		return
	}
	defer rows.Close()

	leaderboards := []*Leaderboard{}
	var outgoingCursor []byte
	var lastLeaderboard *Leaderboard

	var id []byte
	var authoritative bool
	var sortOrder int64
	var count int64
	var resetSchedule string
	var metadata []byte
	var nextId []byte
	var prevId []byte
	for rows.Next() {
		if int64(len(leaderboards)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardCursor{
				Id: lastLeaderboard.Id,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboards list cursor", zap.Error(err))
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error encoding cursor"}}})
				return
			}
			outgoingCursor = cursorBuf.Bytes()
			break
		}

		err = rows.Scan(&id, &authoritative, &sortOrder, &count, &resetSchedule, &metadata, &nextId, &prevId)
		if err != nil {
			logger.Error("Could not scan leaderboards list query results", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboards"}}})
			return
		}

		lastLeaderboard = &Leaderboard{
			Id:            id,
			Authoritative: authoritative,
			Sort:          sortOrder,
			Count:         count,
			ResetSchedule: resetSchedule,
			Metadata:      metadata,
			NextId:        nextId,
			PrevId:        prevId,
		}
		leaderboards = append(leaderboards, lastLeaderboard)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not process leaderboards list query results", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboards"}}})
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Leaderboards{Leaderboards: &TLeaderboards{
		Leaderboards: leaderboards,
		Cursor:       outgoingCursor,
	}}})
}

func (p *pipeline) leaderboardRecordWrite(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardRecordWrite()
	if len(incoming.LeaderboardId) == 0 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Leaderboard ID must be present"}}})
		return
	}

	if len(incoming.Metadata) != 0 {
		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal(incoming.Metadata, &maybeJSON) != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Metadata must be a valid JSON object"}}})
			return
		}
	}

	var authoritative bool
	var sortOrder int64
	var resetSchedule string
	query := "SELECT authoritative, sort_order, reset_schedule FROM leaderboard WHERE id = $1"
	logger.Debug("DB request", zap.String("query", query))
	err := p.db.QueryRow(query, incoming.LeaderboardId).
		Scan(&authoritative, &sortOrder, &resetSchedule)
	if err != nil {
		logger.Error("Could not execute leaderboard record write metadata query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	now := now()
	updatedAt := timeToMs(now)
	expiresAt := int64(0)
	if resetSchedule != "" {
		expr, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			logger.Error("Could not parse leaderboard reset schedule query", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
			return
		}
		expiresAt = timeToMs(expr.Next(now))
	}

	if authoritative == true {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cannot submit to authoritative leaderboard"}}})
		return
	}

	var scoreOpSql string
	var scoreDelta int64
	var scoreAbs int64
	switch incoming.Op.(type) {
	case *TLeaderboardRecordWrite_Incr:
		scoreOpSql = "score = score + $15"
		scoreDelta = incoming.GetIncr()
		scoreAbs = incoming.GetIncr()
	case *TLeaderboardRecordWrite_Decr:
		scoreOpSql = "score = score - $15"
		scoreDelta = incoming.GetDecr()
		scoreAbs = 0 - incoming.GetDecr()
	case *TLeaderboardRecordWrite_Set:
		scoreOpSql = "score = $15"
		scoreDelta = incoming.GetSet()
		scoreAbs = incoming.GetSet()
	case *TLeaderboardRecordWrite_Best:
		if sortOrder == 0 {
			// Lower score is better.
			scoreOpSql = "score = (score + $15 - abs(score - $15)) / 2"
		} else {
			// Higher score is better.
			scoreOpSql = "score = (score + $15 + abs(score - $15)) / 2"
		}
		scoreDelta = incoming.GetBest()
		scoreAbs = incoming.GetBest()
	case nil:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "No leaderboard record write operator found"}}})
		return
	default:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Unknown leaderboard record write operator"}}})
		return
	}

	handle := session.handle.Load()
	var location string
	var timezone string
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var bannedAt int64
	query = `INSERT INTO leaderboard_record (leaderboard_id, owner_id, handle, lang, location, timezone,
				rank_value, score, num_score, metadata, ranked_at, updated_at, expires_at, banned_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, '{}'), $11, $12, $13, $14)
			ON CONFLICT (leaderboard_id, owner_id, expires_at)
			DO UPDATE SET handle = $3, lang = $4, location = COALESCE($5, location), timezone = COALESCE($6, timezone),
			  ` + scoreOpSql + `, num_score = num_score + 1, metadata = COALESCE($10, metadata), updated_at = $12
			RETURNING location, timezone, rank_value, score, num_score, metadata, ranked_at, banned_at`
	logger.Debug("DB request", zap.String("query", query))
	err = p.db.QueryRow(query,
		incoming.LeaderboardId, session.userID.Bytes(), handle, session.lang, incoming.Location,
		incoming.Timezone, 0, scoreAbs, 1, incoming.Metadata, 0, updatedAt, expiresAt, 0, scoreDelta).
		Scan(&location, &timezone, &rankValue, &score, &numScore, &metadata, &rankedAt, &bannedAt)
	if err != nil {
		logger.Error("Could not execute leaderboard record write query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_LeaderboardRecord{LeaderboardRecord: &TLeaderboardRecord{Record: &LeaderboardRecord{
		LeaderboardId: incoming.LeaderboardId,
		OwnerId:       session.userID.Bytes(),
		Handle:        handle,
		Lang:          session.lang,
		Location:      location,
		Timezone:      timezone,
		Rank:          rankValue,
		Score:         score,
		NumScore:      numScore,
		Metadata:      metadata,
		RankedAt:      rankedAt,
		UpdatedAt:     updatedAt,
		ExpiresAt:     expiresAt,
	}}}})
}

func (p *pipeline) leaderboardRecordsFetch(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardRecordsFetch()
	leaderboardIds := incoming.LeaderboardIds
	if len(leaderboardIds) == 0 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Leaderboard IDs must be present"}}})
		return
	}

	limit := incoming.Limit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Limit must be between 10 and 100"}}})
		return
	}

	var incomingCursor *leaderboardRecordCursor
	if len(incoming.Cursor) != 0 {
		incomingCursor = &leaderboardRecordCursor{}
		if err := gob.NewDecoder(bytes.NewReader(incoming.Cursor)).Decode(incomingCursor); err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Invalid cursor data"}}})
			return
		}
	}

	// TODO for now we return all records including expired ones, change this later?
	// TODO special handling of banned records?

	query := `SELECT leaderboard_id, owner_id, handle, lang, location, timezone,
	  rank_value, score, num_score, metadata, ranked_at, updated_at, expires_at, banned_at
	FROM leaderboard_record
	WHERE leaderboard_id IN $1
	AND owner_id = $2`
	params := []interface{}{leaderboardIds, session.userID.Bytes()}

	if incomingCursor != nil {
		query += " AND (leaderboard_id, owner_id, expires_at) > ($3, $4, $5)"
		params = append(params, incomingCursor.LeaderboardId, incomingCursor.OwnerId, incomingCursor.ExpiresAt)
	}

	params = append(params, limit+1)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("DB request", zap.String("query", query))
	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboard records fetch query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}
	defer rows.Close()

	leaderboardRecords := []*LeaderboardRecord{}
	var outgoingCursor []byte
	var lastRecord *LeaderboardRecord

	var leaderboardId []byte
	var ownerId []byte
	var handle string
	var lang string
	var location string
	var timezone string
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var updatedAt int64
	var expiresAt int64
	var bannedAt int64
	for rows.Next() {
		if int64(len(leaderboardRecords)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardRecordCursor{
				LeaderboardId: lastRecord.LeaderboardId,
				OwnerId:       lastRecord.OwnerId,
				ExpiresAt:     lastRecord.ExpiresAt,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboard records fetch cursor", zap.Error(err))
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error encoding cursor"}}})
				return
			}
			outgoingCursor = cursorBuf.Bytes()
			break
		}

		err = rows.Scan(&leaderboardId, &ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records fetch query results", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
			return
		}

		lastRecord = &LeaderboardRecord{
			LeaderboardId: leaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location,
			Timezone:      timezone,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      metadata,
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		}
		leaderboardRecords = append(leaderboardRecords, lastRecord)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not process leaderboard records fetch query results", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_LeaderboardRecords{LeaderboardRecords: &TLeaderboardRecords{
		Records: leaderboardRecords,
		Cursor:  outgoingCursor,
	}}})
}

func (p *pipeline) leaderboardRecordsList(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardRecordsList()

	if len(incoming.LeaderboardId) == 0 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Leaderboard ID must be present"}}})
		return
	}

	limit := incoming.Limit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Limit must be between 10 and 100"}}})
		return
	}

	var incomingCursor *leaderboardRecordCursor
	if len(incoming.Cursor) != 0 {
		incomingCursor = &leaderboardRecordCursor{}
		if err := gob.NewDecoder(bytes.NewReader(incoming.Cursor)).Decode(incomingCursor); err != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Invalid cursor data"}}})
			return
		}
		if !bytes.Equal(incoming.LeaderboardId, incomingCursor.LeaderboardId) {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cursor data does not match leaderboard ID"}}})
			return
		}
	}

	var sortOrder int64
	var resetSchedule string
	query := "SELECT sort_order, reset_schedule FROM leaderboard WHERE id = $1"
	logger.Debug("DB request", zap.String("query", query))
	err := p.db.QueryRow(query, incoming.LeaderboardId).
		Scan(&sortOrder, &resetSchedule)
	if err != nil {
		logger.Error("Could not execute leaderboard records list metadata query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	currentExpiresAt := int64(0)
	if resetSchedule != "" {
		expr, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			logger.Error("Could not parse leaderboard reset schedule query", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
			return
		}
		currentExpiresAt = timeToMs(expr.Next(now()))
	}

	query = `SELECT owner_id, handle, lang, location, timezone,
	  rank_value, score, num_score, metadata, ranked_at, updated_at, expires_at, banned_at
	FROM leaderboard_record
	WHERE leaderboard_id = $1
	AND expires_at = $2`
	params := []interface{}{incoming.LeaderboardId, currentExpiresAt}

	switch incoming.Filter.(type) {
	case *TLeaderboardRecordsList_OwnerId:
		if incomingCursor != nil {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Cursor not allowed with haystack query"}}})
			return
		}
		// Haystack queries are executed in a separate flow.
		p.loadLeaderboardRecordsHaystack(logger, session, envelope, incoming.LeaderboardId, currentExpiresAt, limit, sortOrder, query, params)
		return
	case *TLeaderboardRecordsList_OwnerIds:
		if len(incoming.GetOwnerIds().OwnerIds) == 0 {
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "One or more owner IDs required"}}})
			return
		}
		query += " AND owner_id IN $3"
		params = append(params, incoming.GetOwnerIds().OwnerIds)
	case *TLeaderboardRecordsList_Lang:
		query += " AND lang = $3"
		params = append(params, incoming.GetLang())
	case *TLeaderboardRecordsList_Location:
		query += " AND location = $3"
		params = append(params, incoming.GetLocation())
	case *TLeaderboardRecordsList_Timezone:
		query += " AND timezone = $3"
		params = append(params, incoming.GetTimezone())
	case nil:
		// No filter.
		break
	default:
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Unknown leaderboard record list filter"}}})
		return
	}

	if incomingCursor != nil {
		count := len(params)
		query += " AND (leaderboard_id, owner_id, expires_at) > ($" + strconv.Itoa(count) +
			", $" + strconv.Itoa(count+1) +
			", $" + strconv.Itoa(count+2) + ")"
		params = append(params, incomingCursor.LeaderboardId, incomingCursor.OwnerId, incomingCursor.ExpiresAt)
	}

	if sortOrder == 0 {
		// Lower score is better.
		query += " ORDER BY score ASC, updated_at DESC"
	} else {
		// Higher score is better.
		query += " ORDER BY score ASC, updated_at DESC"
	}

	params = append(params, limit+1)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("DB request", zap.String("query", query))
	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboard records list query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}
	defer rows.Close()

	leaderboardRecords := []*LeaderboardRecord{}
	var outgoingCursor []byte
	var lastRecord *LeaderboardRecord

	var ownerId []byte
	var handle string
	var lang string
	var location string
	var timezone string
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var updatedAt int64
	var expiresAt int64
	var bannedAt int64
	for rows.Next() {
		if int64(len(leaderboardRecords)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardRecordCursor{
				LeaderboardId: lastRecord.LeaderboardId,
				OwnerId:       lastRecord.OwnerId,
				ExpiresAt:     lastRecord.ExpiresAt,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboard records list cursor", zap.Error(err))
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error encoding cursor"}}})
				return
			}
			outgoingCursor = cursorBuf.Bytes()
			break
		}

		err = rows.Scan(&ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records list query results", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
			return
		}

		lastRecord = &LeaderboardRecord{
			LeaderboardId: incoming.LeaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location,
			Timezone:      timezone,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      metadata,
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		}
		leaderboardRecords = append(leaderboardRecords, lastRecord)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not process leaderboard records list query results", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	p.normalizeAndSendLeaderboardRecords(logger, session, envelope, leaderboardRecords, outgoingCursor)
}

func (p *pipeline) loadLeaderboardRecordsHaystack(logger zap.Logger, session *session, envelope *Envelope, leaderboardId []byte, currentExpiresAt, limit, sortOrder int64, query string, params []interface{}) {
	// First half.
	count := len(params)
	firstQuery := query + " AND (leaderboard_id, owner_id, expires_at) <= ($" + strconv.Itoa(count) +
		", $" + strconv.Itoa(count+1) +
		", $" + strconv.Itoa(count+2) + ")"
	firstParams := append(params, leaderboardId, session.userID.Bytes(), currentExpiresAt)
	if sortOrder == 0 {
		// Lower score is better.
		firstQuery += " ORDER BY score ASC, updated_at DESC"
	} else {
		// Higher score is better.
		firstQuery += " ORDER BY score ASC, updated_at DESC"
	}
	firstParams = append(firstParams, int64(limit/2))
	firstQuery += " LIMIT $" + strconv.Itoa(len(firstParams))

	logger.Debug("DB request", zap.String("query", firstQuery))
	firstRows, err := p.db.Query(firstQuery, firstParams...)
	if err != nil {
		logger.Error("Could not execute leaderboard records list query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}
	defer firstRows.Close()

	leaderboardRecords := []*LeaderboardRecord{}

	var ownerId []byte
	var handle string
	var lang string
	var location string
	var timezone string
	var rankValue int64
	var score int64
	var numScore int64
	var metadata []byte
	var rankedAt int64
	var updatedAt int64
	var expiresAt int64
	var bannedAt int64
	for firstRows.Next() {
		err = firstRows.Scan(&ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records list query results", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
			return
		}

		leaderboardRecords = append(leaderboardRecords, &LeaderboardRecord{
			LeaderboardId: leaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location,
			Timezone:      timezone,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      metadata,
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		})
	}
	if err = firstRows.Err(); err != nil {
		logger.Error("Could not process leaderboard records list query results", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	// Second half.
	secondQuery := query + " AND (leaderboard_id, owner_id, expires_at) > ($" + strconv.Itoa(count) +
		", $" + strconv.Itoa(count+1) +
		", $" + strconv.Itoa(count+2) + ")"
	secondParams := append(params, leaderboardId, session.userID.Bytes(), currentExpiresAt)
	if sortOrder == 0 {
		// Lower score is better.
		secondQuery += " ORDER BY score ASC, updated_at DESC"
	} else {
		// Higher score is better.
		secondQuery += " ORDER BY score ASC, updated_at DESC"
	}
	secondParams = append(secondParams, limit-int64(len(leaderboardRecords))+2)
	secondQuery += " LIMIT $" + strconv.Itoa(len(secondParams))

	logger.Debug("DB request", zap.String("query", secondQuery))
	secondRows, err := p.db.Query(secondQuery, secondParams...)
	if err != nil {
		logger.Error("Could not execute leaderboard records list query", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}
	defer secondRows.Close()

	var outgoingCursor []byte
	var lastRecord *LeaderboardRecord

	for secondRows.Next() {
		if int64(len(leaderboardRecords)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardRecordCursor{
				LeaderboardId: lastRecord.LeaderboardId,
				OwnerId:       lastRecord.OwnerId,
				ExpiresAt:     lastRecord.ExpiresAt,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboard records list cursor", zap.Error(err))
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error encoding cursor"}}})
				return
			}
			outgoingCursor = cursorBuf.Bytes()
			break
		}

		err = secondRows.Scan(&ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records list query results", zap.Error(err))
			session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
			return
		}

		lastRecord = &LeaderboardRecord{
			LeaderboardId: leaderboardId,
			OwnerId:       ownerId,
			Handle:        handle,
			Lang:          lang,
			Location:      location,
			Timezone:      timezone,
			Rank:          rankValue,
			Score:         score,
			NumScore:      numScore,
			Metadata:      metadata,
			RankedAt:      rankedAt,
			UpdatedAt:     updatedAt,
			ExpiresAt:     expiresAt,
		}
		leaderboardRecords = append(leaderboardRecords, lastRecord)
	}
	if err = secondRows.Err(); err != nil {
		logger.Error("Could not process leaderboard records list query results", zap.Error(err))
		session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Error{&Error{Reason: "Error loading leaderboard records"}}})
		return
	}

	p.normalizeAndSendLeaderboardRecords(logger, session, envelope, leaderboardRecords, outgoingCursor)
}

func (p *pipeline) normalizeAndSendLeaderboardRecords(logger zap.Logger, session *session, envelope *Envelope, records []*LeaderboardRecord, cursor []byte) {
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

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_LeaderboardRecords{LeaderboardRecords: &TLeaderboardRecords{
		Records: records,
		Cursor:  cursor,
	}}})
}
