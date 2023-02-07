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
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"log"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/jackc/pgx/v5/pgtype"
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
	LeaderboardOperatorDecrement
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
func (l *Leaderboard) HasMaxSize() bool {
	return l.MaxSize != math.MaxInt32
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

// Type alias for a list of tournaments that binds together sorting functions.
// Not intended to be used for sorting lists of non-tournament leaderboards.
type OrderedTournaments []*Leaderboard

func (t OrderedTournaments) Len() int {
	return len(t)
}
func (t OrderedTournaments) Swap(i, j int) {
	t[i], t[j] = t[j], t[i]
}
func (t OrderedTournaments) Less(i, j int) bool {
	ti, tj := t[i], t[j]
	if ti.StartTime < tj.StartTime {
		return true
	} else if ti.StartTime == tj.StartTime {
		if ti.EndTime > tj.EndTime {
			return true
		} else if ti.EndTime == tj.EndTime {
			if ti.Category < tj.Category {
				return true
			} else if ti.Category == tj.Category {
				return ti.Id < tj.Id
			}
		}
	}
	return false
}

type LeaderboardCache interface {
	Get(id string) *Leaderboard
	GetAllLeaderboards() []*Leaderboard
	RefreshAllLeaderboards(ctx context.Context) error
	Create(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string) (*Leaderboard, error)
	Insert(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string, createTime int64)
	List(categoryStart, categoryEnd, limit int, cursor *LeaderboardListCursor) ([]*Leaderboard, *LeaderboardListCursor, error)
	CreateTournament(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) (*Leaderboard, error)
	InsertTournament(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, duration, maxSize, maxNumScore int, joinRequired bool, createTime, startTime, endTime int64)
	ListTournaments(now int64, categoryStart, categoryEnd int, startTime, endTime int64, limit int, cursor *TournamentListCursor) ([]*Leaderboard, *TournamentListCursor, error)
	Delete(ctx context.Context, rankCache LeaderboardRankCache, scheduler LeaderboardScheduler, id string) error
	Remove(id string)
}

type LocalLeaderboardCache struct {
	sync.RWMutex
	logger       *zap.Logger
	db           *sql.DB
	leaderboards map[string]*Leaderboard

	leaderboardList []*Leaderboard // Non-tournament only
	tournamentList  []*Leaderboard
}

func NewLocalLeaderboardCache(logger, startupLogger *zap.Logger, db *sql.DB) LeaderboardCache {
	l := &LocalLeaderboardCache{
		logger:       logger,
		db:           db,
		leaderboards: make(map[string]*Leaderboard),

		leaderboardList: make([]*Leaderboard, 0),
		tournamentList:  make([]*Leaderboard, 0),
	}

	err := l.RefreshAllLeaderboards(context.Background())
	if err != nil {
		startupLogger.Fatal("Error loading leaderboard cache from database", zap.Error(err))
	}

	return l
}

func (l *LocalLeaderboardCache) RefreshAllLeaderboards(ctx context.Context) error {
	query := `
SELECT
id, authoritative, sort_order, operator, reset_schedule, metadata, create_time,
category, description, duration, end_time, join_required, max_size, max_num_score, title, start_time
FROM leaderboard`

	rows, err := l.db.QueryContext(ctx, query)
	if err != nil {
		l.logger.Error("Error loading leaderboard cache from database", zap.Error(err))
		return err
	}

	leaderboards := make(map[string]*Leaderboard)
	tournamentList := make([]*Leaderboard, 0)
	leaderboardList := make([]*Leaderboard, 0)

	for rows.Next() {
		var id string
		var authoritative bool
		var sortOrder int
		var operator int
		var resetSchedule sql.NullString
		var metadata string
		var createTime pgtype.Timestamptz
		var category int
		var description string
		var duration int
		var endTime pgtype.Timestamptz
		var joinRequired bool
		var maxSize int
		var maxNumScore int
		var title string
		var startTime pgtype.Timestamptz

		err = rows.Scan(&id, &authoritative, &sortOrder, &operator, &resetSchedule, &metadata, &createTime,
			&category, &description, &duration, &endTime, &joinRequired, &maxSize, &maxNumScore, &title, &startTime)
		if err != nil {
			_ = rows.Close()
			l.logger.Error("Error parsing leaderboard cache from database", zap.Error(err))
			return err
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
				_ = rows.Close()
				l.logger.Error("Error parsing leaderboard reset schedule from database", zap.Error(err))
				return err
			}
			leaderboard.ResetScheduleStr = resetSchedule.String
			leaderboard.ResetSchedule = expr
		}
		if endTime.Valid {
			leaderboard.EndTime = endTime.Time.Unix()
		}

		leaderboards[id] = leaderboard

		if leaderboard.IsTournament() {
			tournamentList = append(tournamentList, leaderboard)
		} else {
			leaderboardList = append(leaderboardList, leaderboard)
		}
	}
	_ = rows.Close()

	sort.Sort(OrderedTournaments(tournamentList))

	l.Lock()
	l.leaderboards = leaderboards
	l.tournamentList = tournamentList
	l.leaderboardList = leaderboardList
	l.Unlock()

	return nil
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

func (l *LocalLeaderboardCache) Create(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string) (*Leaderboard, error) {
	l.RLock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		// Creation is an idempotent operation.
		l.RUnlock()
		return leaderboard, nil
	}
	l.RUnlock()

	var expr *cronexpr.Expression
	var err error
	if resetSchedule != "" {
		expr, err = cronexpr.Parse(resetSchedule)
		if err != nil {
			l.logger.Error("Error parsing leaderboard reset schedule", zap.Error(err))
			return nil, err
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
	var createTime pgtype.Timestamptz
	err = l.db.QueryRowContext(ctx, query, params...).Scan(&createTime)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			// Concurrent attempt at creating the leaderboard, to keep idempotency query the existing leaderboard data.
			if err = l.db.QueryRowContext(ctx, "SELECT authoritative, sort_order, operator, COALESCE(reset_schedule, ''), metadata, create_time FROM leaderboard WHERE id = $1", id).Scan(&authoritative, &sortOrder, &operator, &resetSchedule, &metadata, &createTime); err != nil {
				l.logger.Error("Error retrieving leaderboard", zap.Error(err))
				return nil, err
			}
			if resetSchedule != "" {
				expr, err = cronexpr.Parse(resetSchedule)
				if err != nil {
					l.logger.Error("Error parsing leaderboard reset schedule", zap.Error(err))
					return nil, err
				}
			}
		} else {
			l.logger.Error("Error creating leaderboard", zap.Error(err))
			return nil, err
		}
	}

	// Then add to cache.
	leaderboard := &Leaderboard{
		Id:               id,
		Authoritative:    authoritative,
		SortOrder:        sortOrder,
		Operator:         operator,
		ResetScheduleStr: resetSchedule,
		ResetSchedule:    expr,
		Metadata:         metadata,
		CreateTime:       createTime.Time.Unix(),
	}

	l.Lock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		// Maybe multiple concurrent creations for this ID.
		l.Unlock()
		return leaderboard, nil
	}
	l.leaderboards[id] = leaderboard
	l.leaderboardList = append(l.leaderboardList, leaderboard)
	sort.Sort(OrderedTournaments(l.leaderboardList))
	l.Unlock()

	return leaderboard, nil
}

func (l *LocalLeaderboardCache) Insert(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string, createTime int64) {
	var expr *cronexpr.Expression
	var err error
	if resetSchedule != "" {
		expr, err = cronexpr.Parse(resetSchedule)
		if err != nil {
			// Not expected, this insert is as a result of a previous create that has succeeded.
			l.logger.Error("Error parsing leaderboard reset schedule for insert", zap.Error(err))
			return
		}
	}

	leaderboard := &Leaderboard{
		Id:               id,
		Authoritative:    authoritative,
		SortOrder:        sortOrder,
		Operator:         operator,
		ResetScheduleStr: resetSchedule,
		ResetSchedule:    expr,
		Metadata:         metadata,
		CreateTime:       createTime,
	}

	l.Lock()
	l.leaderboards[id] = leaderboard
	l.leaderboardList = append(l.leaderboardList, leaderboard)
	sort.Sort(OrderedTournaments(l.leaderboardList))
	l.Unlock()
}

func (l *LocalLeaderboardCache) List(categoryStart, categoryEnd, limit int, cursor *LeaderboardListCursor) ([]*Leaderboard, *LeaderboardListCursor, error) {
	list := make([]*Leaderboard, 0, limit)
	var newCursor *TournamentListCursor
	skip := cursor != nil

	l.RLock()
	for _, leaderboard := range l.leaderboardList {
		if skip {
			if leaderboard.Id == cursor.Id {
				skip = false
			}
			continue
		}

		if leaderboard.Category < categoryStart {
			// Skip tournaments with category before start boundary.
			continue
		}
		if leaderboard.Category > categoryEnd {
			// Skip tournaments with category after end boundary.
			continue
		}

		if ln := len(list); ln >= limit {
			newCursor = &LeaderboardListCursor{
				Id: list[ln-1].Id,
			}
			break
		}

		list = append(list, leaderboard)
	}
	l.RUnlock()

	return list, newCursor, nil
}

func (l *LocalLeaderboardCache) CreateTournament(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired bool) (*Leaderboard, error) {
	resetCron, err := checkTournamentConfig(resetSchedule, startTime, endTime, duration, maxSize, maxNumScore)
	if err != nil {
		l.logger.Error("Error while creating tournament", zap.Error(err))
		return nil, err
	}

	l.RLock()
	leaderboard := l.leaderboards[id]
	l.RUnlock()
	if leaderboard != nil {
		if leaderboard.IsTournament() {
			// Creation is an idempotent operation.
			return leaderboard, nil
		}
		l.logger.Error("Cannot create tournament as leaderboard is already in use.", zap.String("leaderboard_id", id))
		return nil, fmt.Errorf("cannot create tournament as leaderboard is already in use")
	}

	params := []interface{}{id, authoritative, sortOrder, operator, duration}
	columns := "id, authoritative, sort_order, operator, duration"
	values := "$1, $2, $3, $4, $5"

	if resetSchedule != "" {
		params = append(params, resetSchedule)
		columns += ", reset_schedule"
		values += ", $" + strconv.Itoa(len(params))
	}

	if metadata != "" {
		params = append(params, metadata)
		columns += ", metadata"
		values += ", $" + strconv.Itoa(len(params))
	}

	if category >= 0 {
		params = append(params, category)
		columns += ", category"
		values += ", $" + strconv.Itoa(len(params))
	}

	if description != "" {
		params = append(params, description)
		columns += ", description"
		values += ", $" + strconv.Itoa(len(params))
	}

	if endTime > 0 {
		params = append(params, time.Unix(int64(endTime), 0).UTC())
		columns += ", end_time"
		values += ", $" + strconv.Itoa(len(params))
	}

	if joinRequired {
		params = append(params, joinRequired)
		columns += ", join_required"
		values += ", $" + strconv.Itoa(len(params))
	}

	if maxSize == 0 {
		maxSize = math.MaxInt32
	}
	if maxSize > 0 {
		params = append(params, maxSize)
		columns += ", max_size"
		values += ", $" + strconv.Itoa(len(params))
	}

	if maxNumScore > 0 {
		params = append(params, maxNumScore)
		columns += ", max_num_score"
		values += ", $" + strconv.Itoa(len(params))
	}

	if title != "" {
		params = append(params, title)
		columns += ", title"
		values += ", $" + strconv.Itoa(len(params))
	}

	if startTime > 0 {
		params = append(params, time.Unix(int64(startTime), 0).UTC())
		columns += ", start_time"
		values += ", $" + strconv.Itoa(len(params))
	}

	query := "INSERT INTO leaderboard (" + columns + ") VALUES (" + values + ") RETURNING metadata, max_size, max_num_score, create_time, start_time, end_time"

	l.logger.Debug("Create tournament query", zap.String("query", query))

	var dbMetadata string
	var dbMaxSize int
	var dbMaxNumScore int
	var createTime pgtype.Timestamptz
	var dbStartTime pgtype.Timestamptz
	var dbEndTime pgtype.Timestamptz
	err = l.db.QueryRowContext(ctx, query, params...).Scan(&dbMetadata, &dbMaxSize, &dbMaxNumScore, &createTime, &dbStartTime, &dbEndTime)
	if err != nil {
		l.logger.Error("Error creating tournament", zap.Error(err))
		return nil, err
	}

	leaderboard = &Leaderboard{
		Id:               id,
		Authoritative:    authoritative,
		SortOrder:        sortOrder,
		Operator:         operator,
		ResetScheduleStr: resetSchedule,
		ResetSchedule:    resetCron,
		Metadata:         dbMetadata,
		CreateTime:       createTime.Time.Unix(),
		Category:         category,
		Description:      description,
		Duration:         duration,
		EndTime:          0,
		JoinRequired:     joinRequired,
		MaxSize:          dbMaxSize,
		MaxNumScore:      dbMaxNumScore,
		Title:            title,
		StartTime:        dbStartTime.Time.Unix(),
	}
	if dbEndTime.Valid {
		leaderboard.EndTime = dbEndTime.Time.Unix()
	}

	l.Lock()
	l.leaderboards[id] = leaderboard
	l.tournamentList = append(l.tournamentList, leaderboard)
	sort.Sort(OrderedTournaments(l.tournamentList))
	l.Unlock()

	return leaderboard, nil
}

func (l *LocalLeaderboardCache) InsertTournament(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, duration, maxSize, maxNumScore int, joinRequired bool, createTime, startTime, endTime int64) {
	var expr *cronexpr.Expression
	var err error
	if resetSchedule != "" {
		expr, err = cronexpr.Parse(resetSchedule)
		if err != nil {
			// Not expected, this insert is as a result of a previous create that has succeeded.
			l.logger.Error("Error parsing tournament reset schedule for insert", zap.Error(err))
			return
		}
	}

	leaderboard := &Leaderboard{
		Id:               id,
		Authoritative:    authoritative,
		SortOrder:        sortOrder,
		Operator:         operator,
		ResetScheduleStr: resetSchedule,
		ResetSchedule:    expr,
		Metadata:         metadata,
		CreateTime:       createTime,
		Category:         category,
		Description:      description,
		Duration:         duration,
		JoinRequired:     joinRequired,
		MaxSize:          maxSize,
		MaxNumScore:      maxNumScore,
		Title:            title,
		StartTime:        startTime,
		EndTime:          endTime,
	}

	l.Lock()
	l.leaderboards[id] = leaderboard
	l.tournamentList = append(l.tournamentList, leaderboard)
	sort.Sort(OrderedTournaments(l.tournamentList))
	l.Unlock()
}

func (l *LocalLeaderboardCache) ListTournaments(now int64, categoryStart, categoryEnd int, startTime, endTime int64, limit int, cursor *TournamentListCursor) ([]*Leaderboard, *TournamentListCursor, error) {
	list := make([]*Leaderboard, 0, limit)
	var newCursor *TournamentListCursor
	skip := cursor != nil

	l.RLock()
	for _, leaderboard := range l.tournamentList {
		if skip {
			if leaderboard.Id == cursor.Id {
				skip = false
			}
			continue
		}

		if leaderboard.Category < categoryStart {
			// Skip tournaments with category before start boundary.
			continue
		}
		if leaderboard.Category > categoryEnd {
			// Skip tournaments with category after end boundary.
			continue
		}
		if leaderboard.StartTime < startTime {
			// Skip tournaments with start time before filter.
			continue
		}
		if (endTime == 0 && leaderboard.EndTime != 0) || (endTime == -1 && (leaderboard.EndTime != 0 && leaderboard.EndTime < now)) || (endTime > 0 && (leaderboard.EndTime == 0 || leaderboard.EndTime > endTime)) {
			// if (endTime == 0 && leaderboard.EndTime != 0) || (endTime == -1 && endTime < now) ||leaderboard.EndTime > endTime || leaderboard.EndTime == 0) || leaderboard.EndTime > endTime {
			// SKIP tournaments where:
			// - If end time filter is == 0, tournament end time is non-0.
			// - If end time filter is default (show only ongoing/future tournaments) and tournament has ended.
			// - If end time filter is set and tournament end time is below it.
			continue
		}

		if ln := len(list); ln >= limit {
			newCursor = &TournamentListCursor{
				Id: list[ln-1].Id,
			}
			break
		}

		list = append(list, leaderboard)
	}
	l.RUnlock()

	return list, newCursor, nil
}

func (l *LocalLeaderboardCache) Delete(ctx context.Context, rankCache LeaderboardRankCache, scheduler LeaderboardScheduler, id string) error {
	l.Lock()
	leaderboard, leaderboardFound := l.leaderboards[id]
	l.Unlock()

	if !leaderboardFound {
		// Deletion is an idempotent operation.
		return nil
	}

	now := time.Now().UTC()
	var expiryUnix int64
	if leaderboard.ResetSchedule != nil {
		expiryUnix = leaderboard.ResetSchedule.Next(now).UTC().Unix()
	}
	if leaderboard.EndTime > 0 && expiryUnix > leaderboard.EndTime {
		expiryUnix = leaderboard.EndTime
	}

	// Delete from database first.
	query := "DELETE FROM leaderboard WHERE id = $1"
	_, err := l.db.ExecContext(ctx, query, id)
	if err != nil {
		l.logger.Error("Error deleting leaderboard", zap.Error(err))
		return err
	}

	l.Lock()
	// Then delete from cache.
	delete(l.leaderboards, id)
	if leaderboard.IsTournament() {
		for i, currentLeaderboard := range l.tournamentList {
			if currentLeaderboard.Id == id {
				copy(l.tournamentList[i:], l.tournamentList[i+1:])
				l.tournamentList[len(l.tournamentList)-1] = nil
				l.tournamentList = l.tournamentList[:len(l.tournamentList)-1]
				break
			}
		}
	} else {
		for i, currentLeaderboard := range l.leaderboardList {
			if currentLeaderboard.Id == id {
				copy(l.leaderboardList[i:], l.leaderboardList[i+1:])
				l.leaderboardList[len(l.leaderboardList)-1] = nil
				l.leaderboardList = l.leaderboardList[:len(l.leaderboardList)-1]
				break
			}
		}
	}
	l.Unlock()

	scheduler.Update()

	if expiryUnix > now.Unix() {
		// Clear any cached ranks that have not yet expired.
		rankCache.DeleteLeaderboard(id, expiryUnix)
	}

	return nil
}

func (l *LocalLeaderboardCache) Remove(id string) {
	l.Lock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		delete(l.leaderboards, id)
		if leaderboard.IsTournament() {
			for i, currentLeaderboard := range l.tournamentList {
				if currentLeaderboard.Id == id {
					copy(l.tournamentList[i:], l.tournamentList[i+1:])
					l.tournamentList[len(l.tournamentList)-1] = nil
					l.tournamentList = l.tournamentList[:len(l.tournamentList)-1]
					break
				}
			}
		} else {
			for i, currentLeaderboard := range l.leaderboardList {
				if currentLeaderboard.Id == id {
					copy(l.leaderboardList[i:], l.leaderboardList[i+1:])
					l.leaderboardList[len(l.leaderboardList)-1] = nil
					l.leaderboardList = l.leaderboardList[:len(l.leaderboardList)-1]
					break
				}
			}
		}
	}
	l.Unlock()
}

func checkTournamentConfig(resetSchedule string, startTime, endTime, duration, maxSize, maxNumScore int) (*cronexpr.Expression, error) {
	if startTime < 0 {
		return nil, fmt.Errorf("tournament start time must be a unix UTC time in the future")
	}

	if duration <= 0 {
		return nil, fmt.Errorf("tournament duration must be greater than zero")
	}

	if maxSize < 0 {
		return nil, fmt.Errorf("tournament max must be greater than zero")
	}

	if maxNumScore < 0 {
		return nil, fmt.Errorf("tournament m num score must be greater than zero")
	}

	if (endTime > 0) && (endTime < startTime) {
		return nil, fmt.Errorf("tournament end time cannot be before start time")
	}

	var cron *cronexpr.Expression
	if resetSchedule != "" {
		expr, err := cronexpr.Parse(resetSchedule)
		if err != nil {
			return nil, fmt.Errorf("could not parse reset schedule: %s", err.Error())
		}
		cron = expr
	}

	if cron != nil {
		schedules := cron.NextN(time.Unix(int64(startTime), 0).UTC(), 2)
		firstResetUnix := schedules[0].UTC().Unix()

		// Check that the end time (if specified) is at least strictly after the first active period start time.
		if (endTime > 0) && (int64(endTime) <= firstResetUnix) {
			return nil, fmt.Errorf("tournament end time cannot be before first reset schedule - either increase end time or change/disable reset schedule")
		}
	}

	return cron, nil
}
