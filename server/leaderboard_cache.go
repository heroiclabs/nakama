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
	"fmt"
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
	Id            string
	Authoritative bool
	SortOrder     int
	Operator      int
	ResetSchedule *cronexpr.Expression
	Metadata      string
	CreateTime    int64
	Category      int
	Description   string
	Duration      int
	EndTime       int64
	JoinRequired  bool
	MaxSize       int
	MaxNumScore   int
	Title         string
	Size          int
	StartTime     int64
}

type LeaderboardCache interface {
	Get(id string) *Leaderboard
	Create(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string) error
	CreateTournament(id string, sortOrder, operator int, resetSchedule, metadata, description, title string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) error
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
category, description, duration, end_time, join_required, max_size, max_num_score, title, size, start_time 
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
		var size int
		var startTime pq.NullTime

		err = rows.Scan(&id, &authoritative, &sortOrder, &operator, &resetSchedule, &metadata, &createTime,
			&category, &description, &duration, &endTime, &joinRequired, &maxSize, &maxNumScore, &title, &size, &startTime)
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
			Size:         size,
			StartTime:    startTime.Time.Unix(),
		}
		if resetSchedule.Valid {
			expr, err := cronexpr.Parse(resetSchedule.String)
			if err != nil {
				startupLogger.Fatal("Error parsing leaderboard reset schedule from database", zap.Error(err))
			}
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
		Id:            id,
		Authoritative: authoritative,
		SortOrder:     sortOrder,
		Operator:      operator,
		ResetSchedule: expr,
		Metadata:      metadata,
		CreateTime:    createTime.Time.Unix(),
	}

	l.Unlock()
	return nil
}

func (l *LocalLeaderboardCache) CreateTournament(id string, sortOrder, operator int, resetSchedule, metadata,
	description, title string, category, endTime, duration, maxSize, maxNumScore, startTime int, joinRequired bool) error {

	if err := checkTournamentConfig(resetSchedule, metadata, startTime, endTime, duration, maxSize, maxNumScore); err != nil {
		l.logger.Error("Error while creating tournament", zap.Error(err))
		return err
	}

	l.Lock()
	leaderboard := l.leaderboards[id]
	if leaderboard != nil {
		if leaderboard.Duration > 0 {
			// Creation is an idempotent operation.
			l.Unlock()
			return nil
		} else {
			l.Unlock()
			l.logger.Error("Cannot create tournament as leaderboard is already in use.", zap.String("leaderboard_id", id))
			return fmt.Errorf("cannot create tournament as leaderboard is already in use")
		}
	}

	params := make([]interface{}, 0)
	paramsIndex := make(map[string]string)
	index := 1

	paramsIndex["id"] = strconv.Itoa(index)
	params = append(params, id)
	index++

	paramsIndex["authoritative"] = strconv.Itoa(index)
	params = append(params, true)
	index++

	paramsIndex["sort_order"] = strconv.Itoa(index)
	params = append(params, sortOrder)
	index++

	paramsIndex["operator"] = strconv.Itoa(index)
	params = append(params, operator)
	index++

	paramsIndex["duration"] = strconv.Itoa(index)
	params = append(params, duration)
	index++

	if metadata != "" {
		paramsIndex["metadata"] = strconv.Itoa(index)
		params = append(params, resetSchedule)
		index++
	}

	if resetSchedule != "" {
		paramsIndex["reset_schedule"] = strconv.Itoa(index)
		params = append(params, resetSchedule)
		index++
	}

	if metadata != "" {
		paramsIndex["metadata"] = strconv.Itoa(index)
		params = append(params, metadata)
		index++
	}

	if category >= 0 {
		paramsIndex["category"] = strconv.Itoa(index)
		params = append(params, category)
		index++
	}

	if description != "" {
		paramsIndex["description"] = strconv.Itoa(index)
		params = append(params, description)
		index++
	}

	if endTime > 0 {
		paramsIndex["end_time"] = strconv.Itoa(index)
		params = append(params, endTime)
		index++
	}

	if joinRequired {
		paramsIndex["join_required"] = strconv.Itoa(index)
		params = append(params, joinRequired)
		index++
	}

	if maxSize > 0 {
		paramsIndex["max_size"] = strconv.Itoa(index)
		params = append(params, maxSize)
		index++
	}

	if maxNumScore > 0 {
		paramsIndex["max_num_score"] = strconv.Itoa(index)
		params = append(params, maxNumScore)
		index++
	}

	if title != "" {
		paramsIndex["title"] = strconv.Itoa(index)
		params = append(params, title)
		index++
	}

	if startTime > 0 {
		paramsIndex["start_time"] = strconv.Itoa(index)
		params = append(params, startTime)
		index++
	}

	columns := ""
	values := ""
	for k, v := range paramsIndex {
		if columns != "" {
			columns += ", "
			values += ", "
		}
		columns += k
		values += v
	}

	query := "INSERT INTO leaderboard (" + columns + ") VALUES (" + values + ") RETURNING create_time, start_time, end_time"

	var createTime pq.NullTime
	var startTimeZ pq.NullTime
	var endTimeZ pq.NullTime
	err := l.db.QueryRow(query, params...).Scan(&createTime, &startTime, &endTime)
	if err != nil {
		l.Unlock()
		l.logger.Error("Error creating leaderboard", zap.Error(err))
		return err
	}

	cron, _ := cronexpr.Parse(resetSchedule)
	leaderboard = &Leaderboard{
		Id:            id,
		Authoritative: true,
		SortOrder:     sortOrder,
		Operator:      operator,
		ResetSchedule: cron,
		Metadata:      metadata,
		CreateTime:    createTime.Time.Unix(),
		Category:      category,
		Description:   description,
		Duration:      duration,
		EndTime:       0,
		JoinRequired:  joinRequired,
		MaxSize:       maxSize,
		MaxNumScore:   maxNumScore,
		Title:         title,
		Size:          0,
		StartTime:     startTimeZ.Time.Unix(),
	}
	if endTimeZ.Valid {
		leaderboard.EndTime = endTimeZ.Time.Unix()
	}

	l.leaderboards[id] = leaderboard
	l.Unlock()
	return nil
}

func (l *LocalLeaderboardCache) Delete(id string) error {
	l.Lock()
	if _, ok := l.leaderboards[id]; ok {
		// Deletion is an idempotent operation.
		l.Unlock()
		return nil
	}

	// Delete from database first.
	query := "DELETE FROM leaderboard WHERE id = $1"
	_, err := l.db.Exec(query, id)
	if err != nil {
		l.Unlock()
		l.logger.Error("Error deleting leaderboard", zap.Error(err))
		return err
	}

	// Then delete from cache.
	delete(l.leaderboards, id)

	l.Unlock()
	return nil
}

func checkTournamentConfig(resetSchedule, metadata string, startTime, endTime, duration, maxSize, maxNumScore int) error {
	if startTime < 0 {
		return fmt.Errorf("tournament start time must be a unix UTC time in the future")
	} else if startTime == 0 {
		startTime = int(time.Now().UTC().Unix())
	} else if time.Now().UTC().After(time.Unix(int64(startTime), 0)) {
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

	if metadata != "" {
		//TODO do json validation...
	}

	return nil
}
