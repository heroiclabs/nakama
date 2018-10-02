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
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/gorhill/cronexpr"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

const (
	LeaderboardSortOrderAscending = iota
	LeaderboardSortOrderDescending
)

const (
	LeaderboardOperatorBest = iota
	LeaderboardOperatorSet
	LeaderboardOperatorIncrement
)

type Leaderboard struct {
	Id               string
	Authoritative    bool
	SortOrder        int
	Operator         int
	ResetScheduleStr string
	ResetSchedule    *cronexpr.Expression
	Metadata         string
	CreateTime       int64
	Category         int
	Description      string
	Duration         int
	EndTime          int64
	JoinRequired     bool
	MaxSize          int
	MaxNumScore      int
	Title            string
	StartTime        int64
}

func (l *Leaderboard) IsTournament() bool {
	return l.Duration != 0
}
func (l *Leaderboard) GetId() string {
	return l.Id
}
func (l *Leaderboard) GetAuthoritative() bool {
	return l.Authoritative
}
func (l *Leaderboard) GetSortOrder() string {
	switch l.SortOrder {
	case LeaderboardSortOrderAscending:
		return "asc"
	case LeaderboardSortOrderDescending:
		fallthrough
	default:
		return "desc"
	}
}
func (l *Leaderboard) GetOperator() string {
	switch l.Operator {
	case LeaderboardOperatorSet:
		return "set"
	case LeaderboardOperatorIncrement:
		return "incr"
	case LeaderboardOperatorBest:
		fallthrough
	default:
		return "best"
	}
}
func (l *Leaderboard) GetReset() string {
	return l.ResetScheduleStr
}
func (l *Leaderboard) GetMetadata() map[string]interface{} {
	metadata := make(map[string]interface{})
	if l.Metadata == "" || l.Metadata == "{}" {
		return metadata
	}
	if err := json.Unmarshal([]byte(l.Metadata), &metadata); err != nil {
		log.Printf("Could not unmarshal leaderboard metadata into map[string]interface{}: %v \r\n", err)
	}

	return metadata
}
func (l *Leaderboard) GetCreateTime() int64 {
	return l.CreateTime
}

type LeaderboardCache interface {
	Get(id string) *Leaderboard
	GetAllLeaderboards() []*Leaderboard
	Create(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string) error
	CreateTournament(id string, sortOrder, operator int, resetSchedule, metadata, description, title string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) (*Leaderboard, error)
	Delete(id string) error
}

type LocalLeaderboardCache struct {
	sync.RWMutex
	logger       *zap.Logger
	db           *sql.DB
	leaderboards map[string]*Leaderboard
}

func NewLocalLeaderboardCache(logger, startupLogger *zap.Logger, db *sql.DB) LeaderboardCache {
	l := &LocalLeaderboardCache{
		logger:       logger,
		db:           db,
		leaderboards: make(map[string]*Leaderboard),
	}

	query := `
SELECT 
id, authoritative, sort_order, operator, reset_schedule, metadata, create_time, 
category, description, duration, end_time, join_required, max_size, max_num_score, title, start_time 
FROM leaderboard`

	rows, err := db.Query(query)
	if err != nil {
		startupLogger.Fatal("Error loading leaderboard cache from database", zap.Error(err))
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var authoritative bool
		var sortOrder int
		var operator int
		var resetSchedule sql.NullString
		var metadata string
		var createTime pq.NullTime
		var category int
		var description string
		var duration int
		var endTime pq.NullTime
		var joinRequired bool
		var maxSize int
		var maxNumScore int
		var title string
		var startTime pq.NullTime

		err = rows.Scan(&id, &authoritative, &sortOrder, &operator, &resetSchedule, &metadata, &createTime,
			&category, &description, &duration, &endTime, &joinRequired, &maxSize, &maxNumScore, &title, &startTime)
		if err != nil {
			startupLogger.Fatal("Error parsing leaderboard cache from database", zap.Error(err))
		}

		leaderboard := &Leaderboard{
			Id:            id,
			Authoritative: authoritative,
			SortOrder:     sortOrder,
			Operator:      operator,

			Metadata:     metadata,
			CreateTime:   createTime.Time.Unix(),
			Category:     category,
			Description:  description,
			Duration:     duration,
			EndTime:      0,
			JoinRequired: joinRequired,
			MaxSize:      maxSize,
			MaxNumScore:  maxNumScore,
			Title:        title,
			StartTime:    startTime.Time.Unix(),
		}
		if resetSchedule.Valid {
			expr, err := cronexpr.Parse(resetSchedule.String)
			if err != nil {
				startupLogger.Fatal("Error parsing leaderboard reset schedule from database", zap.Error(err))
			}
			leaderboard.ResetScheduleStr = resetSchedule.String
			leaderboard.ResetSchedule = expr
		}
		if endTime.Valid {
			leaderboard.EndTime = endTime.Time.Unix()
		}

		l.leaderboards[id] = leaderboard
	}

	return l
}

func (l *LocalLeaderboardCache) Get(id string) *Leaderboard {
	var lb *Leaderboard
	l.RLock()
	lb = l.leaderboards[id]
	l.RUnlock()
	return lb
}

func (l *LocalLeaderboardCache) GetAllLeaderboards() []*Leaderboard {
	l.RLock()
	leaderboards := make([]*Leaderboard, 0, len(l.leaderboards))
	for _, v := range l.leaderboards {
		leaderboards = append(leaderboards, v)
	}
	l.RUnlock()
	return leaderboards
}

func (l *LocalLeaderboardCache) Create(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string) error {
	l.Lock()
	if _, ok := l.leaderboards[id]; ok {
		// Creation is an idempotent operation.
		l.Unlock()
		return nil
	}

	var expr *cronexpr.Expression
	var err error
	if resetSchedule != "" {
		expr, err = cronexpr.Parse(resetSchedule)
		if err != nil {
			l.logger.Error("Error parsing leaderboard reset schedule", zap.Error(err))
			return err
		}
	}

	// Insert into database first.
	query := "INSERT INTO leaderboard (id, authoritative, sort_order, operator, metadata"
	if resetSchedule != "" {
		query += ", reset_schedule"
	}
	query += ") VALUES ($1, $2, $3, $4, $5"
	if resetSchedule != "" {
		query += ", $6"
	}
	query += ") RETURNING create_time"
	params := []interface{}{id, authoritative, sortOrder, operator, metadata}
	if resetSchedule != "" {
		params = append(params, resetSchedule)
	}
	var createTime pq.NullTime
	err = l.db.QueryRow(query, params...).Scan(&createTime)
	if err != nil {
		l.Unlock()
		l.logger.Error("Error creating leaderboard", zap.Error(err))
		return err
	}

	// Then add to cache.
	l.leaderboards[id] = &Leaderboard{
		Id:               id,
		Authoritative:    authoritative,
		SortOrder:        sortOrder,
		Operator:         operator,
		ResetScheduleStr: resetSchedule,
		ResetSchedule:    expr,
		Metadata:         metadata,
		CreateTime:       createTime.Time.Unix(),
	}

	l.Unlock()

	return nil
}

func (l *LocalLeaderboardCache) CreateTournament(id string, sortOrder, operator int, resetSchedule, metadata,
	title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) (*Leaderboard, error) {

	if err := checkTournamentConfig(resetSchedule, startTime, endTime, duration, maxSize, maxNumScore); err != nil {
		l.logger.Error("Error while creating tournament", zap.Error(err))
		return nil, err
	}

	l.RLock()
	leaderboard := l.leaderboards[id]
	l.RUnlock()
	if leaderboard != nil {
		if leaderboard.Duration > 0 {
			// Creation is an idempotent operation.
			return nil, nil // return nil for leaderboard to indicate no new creation
		} else {
			l.logger.Error("Cannot create tournament as leaderboard is already in use.", zap.String("leaderboard_id", id))
			return nil, fmt.Errorf("cannot create tournament as leaderboard is already in use")
		}
	}

	params := make([]interface{}, 0)
	paramsIndex := make(map[string]string)

	params = append(params, id)
	paramsIndex["id"] = strconv.Itoa(len(params))

	params = append(params, true)
	paramsIndex["authoritative"] = strconv.Itoa(len(params))

	params = append(params, sortOrder)
	paramsIndex["sort_order"] = strconv.Itoa(len(params))

	params = append(params, operator)
	paramsIndex["operator"] = strconv.Itoa(len(params))

	params = append(params, duration)
	paramsIndex["duration"] = strconv.Itoa(len(params))

	if resetSchedule != "" {
		params = append(params, resetSchedule)
		paramsIndex["reset_schedule"] = strconv.Itoa(len(params))
	}

	if metadata != "" {
		params = append(params, metadata)
		paramsIndex["metadata"] = strconv.Itoa(len(params))
	}

	if category >= 0 {
		params = append(params, category)
		paramsIndex["category"] = strconv.Itoa(len(params))
	}

	if description != "" {
		params = append(params, description)
		paramsIndex["description"] = strconv.Itoa(len(params))
	}

	if endTime > 0 {
		params = append(params, time.Unix(int64(endTime), 0).UTC())
		paramsIndex["end_time"] = strconv.Itoa(len(params))
	}

	if joinRequired {
		params = append(params, joinRequired)
		paramsIndex["join_required"] = strconv.Itoa(len(params))
	}

	if maxSize > 0 {
		params = append(params, maxSize)
		paramsIndex["max_size"] = strconv.Itoa(len(params))
	}

	if maxNumScore > 0 {
		params = append(params, maxNumScore)
		paramsIndex["max_num_score"] = strconv.Itoa(len(params))
	}

	if title != "" {
		params = append(params, title)
		paramsIndex["title"] = strconv.Itoa(len(params))
	}

	if startTime > 0 {
		params = append(params, time.Unix(int64(startTime), 0).UTC())
		paramsIndex["start_time"] = strconv.Itoa(len(params))
	}

	columns := ""
	values := ""
	for k, v := range paramsIndex {
		if columns != "" {
			columns += ", "
			values += ", "
		}
		columns += k
		values += "$" + v
	}

	query := "INSERT INTO leaderboard (" + columns + ") VALUES (" + values + ") RETURNING create_time, start_time, end_time"

	l.logger.Debug("Create tournament query", zap.String("query", query))

	var createTime pq.NullTime
	var dbStartTime pq.NullTime
	var dbEndTime pq.NullTime
	err := l.db.QueryRow(query, params...).Scan(&createTime, &dbStartTime, &dbEndTime)
	if err != nil {
		l.logger.Error("Error creating tournament", zap.Error(err))
		return nil, err
	}

	cron, _ := cronexpr.Parse(resetSchedule)
	leaderboard = &Leaderboard{
		Id:               id,
		Authoritative:    true,
		SortOrder:        sortOrder,
		Operator:         operator,
		ResetScheduleStr: resetSchedule,
		ResetSchedule:    cron,
		Metadata:         metadata,
		CreateTime:       createTime.Time.Unix(),
		Category:         category,
		Description:      description,
		Duration:         duration,
		EndTime:          0,
		JoinRequired:     joinRequired,
		MaxSize:          maxSize,
		MaxNumScore:      maxNumScore,
		Title:            title,
		StartTime:        dbStartTime.Time.Unix(),
	}
	if dbEndTime.Valid {
		leaderboard.EndTime = dbEndTime.Time.Unix()
	}

	l.Lock()
	l.leaderboards[id] = leaderboard
	l.Unlock()

	return leaderboard, nil
}

func (l *LocalLeaderboardCache) Delete(id string) error {
	l.Lock()
	_, leaderboardFound := l.leaderboards[id]
	l.Unlock()

	if !leaderboardFound {
		// Deletion is an idempotent operation.
		return nil
	}

	// Delete from database first.
	query := "DELETE FROM leaderboard WHERE id = $1"
	_, err := l.db.Exec(query, id)
	if err != nil {
		l.logger.Error("Error deleting leaderboard", zap.Error(err))
		return err
	}

	l.Lock()
	// Then delete from cache.
	delete(l.leaderboards, id)
	l.Unlock()
	return nil
}

func checkTournamentConfig(resetSchedule string, startTime, endTime, duration, maxSize, maxNumScore int) error {
	if startTime < 0 {
		return fmt.Errorf("tournament start time must be a unix UTC time in the future")
	} else if startTime == 0 {
		startTime = int(time.Now().UTC().Unix())
	} else if time.Now().UTC().After(time.Unix(int64(startTime), 0).UTC()) {
		return fmt.Errorf("tournament start time must be a unix UTC time in the future")
	}

	if duration <= 0 {
		return fmt.Errorf("tournament duration must be greater than zero")
	}

	if maxSize < 0 {
		return fmt.Errorf("tournament max must be greater than zero")
	}

	if maxNumScore < 0 {
		return fmt.Errorf("tournament m num score must be greater than zero")
	}

	if (endTime > 0) && (endTime < startTime) {
		return fmt.Errorf("tournament end time cannot be before start time")
	}

	if (endTime > 0) && (endTime < (startTime + duration)) {
		return fmt.Errorf("tournament end time cannot be before end of first session")
	}

	var cron *cronexpr.Expression
	if resetSchedule != "" {
		expr, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			return fmt.Errorf("could not parse reset schedule: %s", err.Error())
		}
		cron = expr
	}

	if cron != nil {
		startTimeUtc := time.Unix(int64(startTime), 0).UTC()
		nextReset := cron.Next(startTimeUtc).Unix()
		if (endTime > 0) && (int64(endTime) <= nextReset) {
			return fmt.Errorf("tournament end time cannot be before first reset schedule - either increase end time or change/disable reset schedule")
		}

		if nextReset < int64(startTime+duration) {
			return fmt.Errorf("tournament cannot be scheduled to be reset while it is ongoing - either decrease duration or change/disable reset schedule")
		}
	}

	return nil
}
