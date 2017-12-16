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
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"strconv"
	"strings"

	"go.uber.org/zap"
)

type leaderboardCursor struct {
	Id string
}

type leaderboardRecordFetchCursor struct {
	OwnerId       string
	LeaderboardId string
}

type leaderboardRecordListCursor struct {
	Score     int64
	UpdatedAt int64
	Id        string
}

func (p *pipeline) leaderboardsList(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardsList()

	limit := incoming.Limit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Limit must be between 10 and 100"), true)
		return
	}

	query := "SELECT id, authoritative, sort_order, count, reset_schedule, metadata FROM leaderboard"
	params := []interface{}{}

	if len(incoming.Cursor) != 0 {
		if cb, err := base64.StdEncoding.DecodeString(incoming.Cursor); err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"), true)
			return
		} else {
			var incomingCursor leaderboardCursor
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(&incomingCursor); err != nil {
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"), true)
				return
			}
			query += " WHERE id > $1"
			params = append(params, incomingCursor.Id)
		}
	}

	if len(incoming.GetFilterLeaderboardId()) != 0 {
		statements := make([]string, 0)
		for _, filterId := range incoming.GetFilterLeaderboardId() {
			params = append(params, filterId)
			statement := "$" + strconv.Itoa(len(params))
			statements = append(statements, statement)
		}

		if len(incoming.Cursor) != 0 {
			query += " AND "
		}

		query += " WHERE id IN (" + strings.Join(statements, ", ") + ")"
	}

	params = append(params, limit+1)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("Leaderboards list", zap.String("query", query))
	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboards list query", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list leaderboards"), true)
		return
	}
	defer rows.Close()

	leaderboards := []*Leaderboard{}
	var outgoingCursor string

	var id sql.NullString
	var authoritative bool
	var sortOrder int64
	var count int64
	var resetSchedule sql.NullString
	var metadata []byte
	for rows.Next() {
		if int64(len(leaderboards)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardCursor{
				Id: id.String,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboards list cursor", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list leaderboards"), true)
				return
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		err = rows.Scan(&id, &authoritative, &sortOrder, &count, &resetSchedule, &metadata)
		if err != nil {
			logger.Error("Could not scan leaderboards list query results", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list leaderboards"), true)
			return
		}

		leaderboards = append(leaderboards, &Leaderboard{
			Id:            id.String,
			Authoritative: authoritative,
			Sort:          sortOrder,
			Count:         count,
			ResetSchedule: resetSchedule.String,
			Metadata:      string(metadata),
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not process leaderboards list query results", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list leaderboards"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Leaderboards{Leaderboards: &TLeaderboards{
		Leaderboards: leaderboards,
		Cursor:       outgoingCursor,
	}}}, true)
}

func (p *pipeline) leaderboardRecordWrite(logger *zap.Logger, session session, envelope *Envelope) {
	e := envelope.GetLeaderboardRecordsWrite()

	if len(e.Records) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"), true)
		return
	} else if len(e.Records) > 1 {
		logger.Warn("There are more than one item passed to the request - only processing the first item.")
	}

	incoming := e.Records[0]

	if len(incoming.LeaderboardId) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Leaderboard ID must be present"), true)
		return
	}

	if len(incoming.Metadata) != 0 {
		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal([]byte(incoming.Metadata), &maybeJSON) != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Metadata must be a valid JSON object"), true)
			return
		}
	}

	var op string
	var value int64
	switch incoming.Op.(type) {
	case *TLeaderboardRecordsWrite_LeaderboardRecordWrite_Incr:
		op = "incr"
		value = incoming.GetIncr()
	case *TLeaderboardRecordsWrite_LeaderboardRecordWrite_Decr:
		op = "decr"
		value = incoming.GetDecr()
	case *TLeaderboardRecordsWrite_LeaderboardRecordWrite_Set:
		op = "set"
		value = incoming.GetSet()
	case *TLeaderboardRecordsWrite_LeaderboardRecordWrite_Best:
		op = "best"
		value = incoming.GetBest()
	case nil:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No leaderboard record write operator found"), true)
		return
	default:
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Unknown leaderboard record write operator"), true)
		return
	}

	record, code, err := leaderboardSubmit(logger, p.db, session.UserID(), incoming.LeaderboardId, session.UserID(), session.Handle(), session.Lang(), op, value, incoming.Location, incoming.Timezone, []byte(incoming.Metadata))
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_LeaderboardRecords{
		LeaderboardRecords: &TLeaderboardRecords{
			Records: []*LeaderboardRecord{
				record,
			},
			// No cursor.
		},
	}}, true)
}

func (p *pipeline) leaderboardRecordsFetch(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardRecordsFetch()
	leaderboardIds := incoming.LeaderboardIds
	if len(leaderboardIds) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Leaderboard IDs must be present"), true)
		return
	}

	limit := incoming.Limit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Limit must be between 10 and 100"), true)
		return
	}

	var incomingCursor *leaderboardRecordFetchCursor
	if len(incoming.Cursor) != 0 {
		if cb, err := base64.StdEncoding.DecodeString(incoming.Cursor); err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"), true)
			return
		} else {
			incomingCursor = &leaderboardRecordFetchCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"), true)
				return
			}
		}
	}

	// TODO for now we return all records including expired ones, change this later?
	// TODO special handling of banned records?

	statements := []string{}
	params := []interface{}{session.UserID()}
	for _, leaderboardId := range leaderboardIds {
		params = append(params, leaderboardId)
		statements = append(statements, "$"+strconv.Itoa(len(params)))
	}

	query := `SELECT leaderboard_id, owner_id, handle, lang, location, timezone,
	  rank_value, score, num_score, metadata, ranked_at, updated_at, expires_at, banned_at
	FROM leaderboard_record
	WHERE owner_id = $1
	AND leaderboard_id IN (` + strings.Join(statements, ", ") + `)`

	if incomingCursor != nil {
		query += " AND (owner_id, leaderboard_id) > ($" + strconv.Itoa(len(params)+1) + ", $" + strconv.Itoa(len(params)+2) + ")"
		params = append(params, incomingCursor.OwnerId, incomingCursor.LeaderboardId)
	}

	params = append(params, limit+1)
	query += " LIMIT $" + strconv.Itoa(len(params))

	logger.Debug("Leaderboard records fetch", zap.String("query", query))
	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute leaderboard records fetch query", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error loading leaderboard records"), true)
		return
	}
	defer rows.Close()

	leaderboardRecords := []*LeaderboardRecord{}
	var outgoingCursor string

	var leaderboardId string
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
		if int64(len(leaderboardRecords)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &leaderboardRecordFetchCursor{
				OwnerId:       ownerId,
				LeaderboardId: leaderboardId,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating leaderboard records fetch cursor", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error loading leaderboard records"), true)
				return
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		err = rows.Scan(&leaderboardId, &ownerId, &handle, &lang, &location, &timezone,
			&rankValue, &score, &numScore, &metadata, &rankedAt, &updatedAt, &expiresAt, &bannedAt)
		if err != nil {
			logger.Error("Could not scan leaderboard records fetch query results", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error loading leaderboard records"), true)
			return
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
	if err = rows.Err(); err != nil {
		logger.Error("Could not process leaderboard records fetch query results", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Error loading leaderboard records"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_LeaderboardRecords{LeaderboardRecords: &TLeaderboardRecords{
		Records: leaderboardRecords,
		Cursor:  outgoingCursor,
	}}}, true)
}

func (p *pipeline) leaderboardRecordsList(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetLeaderboardRecordsList()

	leaderboardRecords, outgoingCursor, code, err := leaderboardRecordsList(logger, p.db, session.UserID(), incoming)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_LeaderboardRecords{LeaderboardRecords: &TLeaderboardRecords{
		Records: leaderboardRecords,
		Cursor:  outgoingCursor,
	}}}, true)
}

func invertMs(ms int64) int64 {
	// Subtract a millisecond timestamp from a fixed value.
	// This value represents Wed, 16 Nov 5138 at about 09:46:39 UTC.
	return 99999999999999 - ms
}
