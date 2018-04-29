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
	"sync"

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
}

type LeaderboardCache interface {
	Get(id string) *Leaderboard
	Create(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string) error
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

	query := "SELECT id, authoritative, sort_order, operator, reset_schedule, metadata, create_time FROM leaderboard"
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

		err = rows.Scan(&id, &authoritative, &sortOrder, &operator, &resetSchedule, &metadata, &createTime)
		if err != nil {
			startupLogger.Fatal("Error parsing leaderboard cache from database", zap.Error(err))
		}

		leaderboard := &Leaderboard{
			Id:            id,
			Authoritative: authoritative,
			SortOrder:     sortOrder,
			Operator:      operator,

			Metadata:   metadata,
			CreateTime: createTime.Time.Unix(),
		}
		if resetSchedule.Valid {
			expr, err := cronexpr.Parse(resetSchedule.String)
			if err != nil {
				startupLogger.Fatal("Error parsing leaderboard reset schedule from database", zap.Error(err))
			}
			leaderboard.ResetSchedule = expr
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
