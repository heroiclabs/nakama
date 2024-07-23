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

	"log"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

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
	EnableRanks      bool
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

// OrderedTournaments defines a type alias for a list of tournaments that binds together sorting functions.
type OrderedTournaments []*Leaderboard

func (l OrderedTournaments) Len() int {
	return len(l)
}
func (l OrderedTournaments) Swap(i, j int) {
	l[i], l[j] = l[j], l[i]
}
func (l OrderedTournaments) Less(i, j int) bool {
	ti, tj := l[i], l[j]
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

type LeaderboardAllCursor struct {
	Offset int
}

type LeaderboardCache interface {
	Get(id string) *Leaderboard
	ListAll(limit int, reverse bool, cursor *LeaderboardAllCursor) ([]*Leaderboard, int, *LeaderboardAllCursor)
	RefreshAllLeaderboards(ctx context.Context) error
	Create(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string, enableRanks bool) (*Leaderboard, bool, error)
	Insert(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string, createTime int64, enableRanks bool)
	List(limit int, cursor *LeaderboardListCursor) ([]*Leaderboard, *LeaderboardListCursor, error)
	CreateTournament(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired, enableRanks bool) (*Leaderboard, bool, error)
	InsertTournament(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, duration, maxSize, maxNumScore int, joinRequired bool, createTime, startTime, endTime int64, enableRanks bool)
	ListTournaments(now int64, categoryStart, categoryEnd int, startTime, endTime int64, limit int, cursor *TournamentListCursor) ([]*Leaderboard, *TournamentListCursor, error)
	Delete(ctx context.Context, rankCache LeaderboardRankCache, scheduler LeaderboardScheduler, id string) (bool, error)
	Remove(id string)
}

type LocalLeaderboardCache struct {
	sync.RWMutex
	ctx          context.Context
	logger       *zap.Logger
	db           *sql.DB
	leaderboards map[string]*Leaderboard

	allList         []*Leaderboard
	leaderboardList []*Leaderboard // Non-tournament only
	tournamentList  []*Leaderboard
}

func NewLocalLeaderboardCache(ctx context.Context, logger, startupLogger *zap.Logger, db *sql.DB) LeaderboardCache {
	l := &LocalLeaderboardCache{
		ctx:          ctx,
		logger:       logger,
		db:           db,
		leaderboards: make(map[string]*Leaderboard),

		allList:         make([]*Leaderboard, 0),
		leaderboardList: make([]*Leaderboard, 0),
		tournamentList:  make([]*Leaderboard, 0),
	}

	if err := l.RefreshAllLeaderboards(ctx); err != nil {
		startupLogger.Fatal("Error loading leaderboard cache from database", zap.Error(err))
	}

	return l
}

func (l *LocalLeaderboardCache) RefreshAllLeaderboards(ctx context.Context) error {
	leaderboards := make(map[string]*Leaderboard)
	tournamentList := make([]*Leaderboard, 0, 100)
	leaderboardList := make([]*Leaderboard, 0, 100)
	allList := make([]*Leaderboard, 0, 100)

	const limit = 10_000

	var createTime pgtype.Timestamptz
	var id string
	for {
		query := `
SELECT id, authoritative, sort_order, operator, reset_schedule, metadata, create_time,
category, description, duration, end_time, join_required, max_size, max_num_score, title, start_time, enable_ranks
FROM leaderboard`
		params := make([]interface{}, 0, 3)
		params = append(params, limit)
		if id != "" {
			query += " WHERE (create_time, id) > ($2, $3)"
			params = append(params, createTime, id)
		}
		query += " ORDER BY create_time ASC, id ASC LIMIT $1"

		rows, err := l.db.QueryContext(ctx, query, params...)
		if err != nil {
			l.logger.Error("Error loading leaderboard cache from database", zap.Error(err))
			return err
		}

		var count int
		for rows.Next() {
			var authoritative bool
			var sortOrder int
			var operator int
			var resetSchedule sql.NullString
			var metadata string
			var category int
			var description string
			var duration int
			var endTime pgtype.Timestamptz
			var joinRequired bool
			var maxSize int
			var maxNumScore int
			var title string
			var startTime pgtype.Timestamptz
			var enableRanks bool

			err = rows.Scan(&id, &authoritative, &sortOrder, &operator, &resetSchedule, &metadata, &createTime,
				&category, &description, &duration, &endTime, &joinRequired, &maxSize, &maxNumScore, &title, &startTime, &enableRanks)
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
				EnableRanks:  enableRanks,
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

			count++
			leaderboards[id] = leaderboard

			allList = append(allList, leaderboard)
			if leaderboard.IsTournament() {
				tournamentList = append(tournamentList, leaderboard)
			} else {
				leaderboardList = append(leaderboardList, leaderboard)
			}
		}
		_ = rows.Close()

		if count < limit {
			break
		}
	}

	sort.Sort(OrderedTournaments(tournamentList))

	l.Lock()
	l.leaderboards = leaderboards
	l.allList = allList
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

func (l *LocalLeaderboardCache) ListAll(limit int, reverse bool, cursor *LeaderboardAllCursor) ([]*Leaderboard, int, *LeaderboardAllCursor) {
	var newCursor *LeaderboardAllCursor
	list := make([]*Leaderboard, 0, limit)

	l.RLock()
	total := len(l.allList)
	if reverse {
		// Listing in reverse to show newest leaderboards first.
		start := total - 1
		if cursor != nil {
			start = cursor.Offset
		}
		for i := start; i >= 0; i-- {
			if len(list) >= limit {
				newCursor = &LeaderboardAllCursor{
					Offset: i,
				}
				break
			}

			list = append(list, l.allList[i])
		}
	} else {
		// Listing in forward order, oldest created to newest.
		var start int
		if cursor != nil {
			start = cursor.Offset
		}
		for i := start; i < len(l.allList); i++ {
			if len(list) >= limit {
				newCursor = &LeaderboardAllCursor{
					Offset: i,
				}
				break
			}

			list = append(list, l.allList[i])
		}
	}
	l.RUnlock()

	return list, total, newCursor
}

func (l *LocalLeaderboardCache) Create(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string, enableRanks bool) (*Leaderboard, bool, error) {
	l.RLock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		// Creation is an idempotent operation.
		l.RUnlock()
		return leaderboard, false, nil
	}
	l.RUnlock()

	var expr *cronexpr.Expression
	var err error
	if resetSchedule != "" {
		expr, err = cronexpr.Parse(resetSchedule)
		if err != nil {
			l.logger.Error("Error parsing leaderboard reset schedule", zap.Error(err))
			return nil, false, err
		}
	}

	// Insert into database first.
	query := "INSERT INTO leaderboard (id, authoritative, sort_order, operator, metadata, enable_ranks"
	if resetSchedule != "" {
		query += ", reset_schedule"
	}
	query += ") VALUES ($1, $2, $3, $4, $5, $6"
	if resetSchedule != "" {
		query += ", $7"
	}
	query += ") RETURNING create_time"
	params := []interface{}{id, authoritative, sortOrder, operator, metadata, enableRanks}
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
				return nil, false, err
			}
			if resetSchedule != "" {
				expr, err = cronexpr.Parse(resetSchedule)
				if err != nil {
					l.logger.Error("Error parsing leaderboard reset schedule", zap.Error(err))
					return nil, false, err
				}
			}
		} else {
			l.logger.Error("Error creating leaderboard", zap.Error(err))
			return nil, false, err
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
		EnableRanks:      enableRanks,
	}

	l.Lock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		// Maybe multiple concurrent creations for this ID.
		l.Unlock()
		return leaderboard, false, nil
	}
	l.leaderboards[id] = leaderboard
	l.allList = append(l.allList, leaderboard)
	l.leaderboardList = append(l.leaderboardList, leaderboard)
	l.Unlock()

	return leaderboard, true, nil
}

func (l *LocalLeaderboardCache) Insert(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata string, createTime int64, enableRanks bool) {
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
		EnableRanks:      enableRanks,
	}

	l.Lock()
	_, found := l.leaderboards[id]
	l.leaderboards[id] = leaderboard

	if found {
		for idx, le := range l.allList {
			if le.Id == id {
				l.allList[idx] = leaderboard
				break
			}
		}
		for idx, le := range l.leaderboardList {
			if le.Id == id {
				l.leaderboardList[idx] = leaderboard
				break
			}
		}
	} else {
		l.allList = append(l.allList, leaderboard)
		l.leaderboardList = append(l.leaderboardList, leaderboard)
	}
	l.Unlock()
}

func (l *LocalLeaderboardCache) List(limit int, cursor *LeaderboardListCursor) ([]*Leaderboard, *LeaderboardListCursor, error) {
	list := make([]*Leaderboard, 0, limit)
	var newCursor *LeaderboardListCursor
	var start int
	if cursor != nil {
		start = cursor.Offset
	}

	l.RLock()
	for i := start; i < len(l.leaderboardList); i++ {
		if len(list) >= limit {
			newCursor = &LeaderboardListCursor{
				Offset: i,
			}
			break
		}

		list = append(list, l.leaderboardList[i])
	}
	l.RUnlock()

	return list, newCursor, nil
}

func (l *LocalLeaderboardCache) CreateTournament(ctx context.Context, id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, startTime, endTime, duration, maxSize, maxNumScore int, joinRequired, enableRanks bool) (*Leaderboard, bool, error) {
	resetCron, err := checkTournamentConfig(resetSchedule, startTime, endTime, duration, maxSize, maxNumScore)
	if err != nil {
		l.logger.Error("Error while creating tournament", zap.Error(err))
		return nil, false, err
	}

	l.RLock()
	leaderboard := l.leaderboards[id]
	l.RUnlock()
	if leaderboard != nil {
		if leaderboard.IsTournament() {
			// Creation is an idempotent operation.
			return leaderboard, false, nil
		}
		l.logger.Error("Cannot create tournament as leaderboard is already in use.", zap.String("leaderboard_id", id))
		return nil, false, fmt.Errorf("cannot create tournament as leaderboard is already in use")
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

	if !enableRanks {
		params = append(params, enableRanks)
		columns += ", enable_ranks"
		values += ", $" + strconv.Itoa(len(params))
	}

	query := "INSERT INTO leaderboard (" + columns + ") VALUES (" + values + ") RETURNING metadata, max_size, max_num_score, create_time, start_time, end_time"

	var dbMetadata string
	var dbMaxSize int
	var dbMaxNumScore int
	var createTime pgtype.Timestamptz
	var dbStartTime pgtype.Timestamptz
	var dbEndTime pgtype.Timestamptz
	err = l.db.QueryRowContext(ctx, query, params...).Scan(&dbMetadata, &dbMaxSize, &dbMaxNumScore, &createTime, &dbStartTime, &dbEndTime)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			// Concurrent attempt at creating the tournament, to keep idempotency query the existing tournament data.
			if err = l.db.QueryRowContext(ctx, "SELECT authoritative, sort_order, operator, COALESCE(reset_schedule, ''), metadata, category, description, duration, join_required, title, max_size, max_num_score, create_time, start_time, end_time FROM leaderboard WHERE id = $1", id).Scan(&authoritative, &sortOrder, &operator, &resetSchedule, &dbMetadata, &category, &description, &duration, &joinRequired, &title, &dbMaxSize, &dbMaxNumScore, &createTime, &dbStartTime, &dbEndTime); err != nil {
				l.logger.Error("Error retrieving tournament", zap.Error(err))
				return nil, false, err
			}
			if resetSchedule != "" {
				resetCron, err = cronexpr.Parse(resetSchedule)
				if err != nil {
					l.logger.Error("Error parsing tournament reset schedule", zap.Error(err))
					return nil, false, err
				}
			}
		} else {
			l.logger.Error("Error creating tournament", zap.Error(err))
			return nil, false, err
		}
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
		EnableRanks:      enableRanks,
	}
	if dbEndTime.Valid {
		leaderboard.EndTime = dbEndTime.Time.Unix()
	}

	l.Lock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		// Maybe multiple concurrent creations for this ID.
		l.Unlock()
		return leaderboard, false, nil
	}
	l.leaderboards[id] = leaderboard
	l.allList = append(l.allList, leaderboard)
	l.tournamentList = append(l.tournamentList, leaderboard)
	sort.Sort(OrderedTournaments(l.tournamentList))
	l.Unlock()

	return leaderboard, true, nil
}

func (l *LocalLeaderboardCache) InsertTournament(id string, authoritative bool, sortOrder, operator int, resetSchedule, metadata, title, description string, category, duration, maxSize, maxNumScore int, joinRequired bool, createTime, startTime, endTime int64, enableRanks bool) {
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
		EnableRanks:      enableRanks,
	}

	l.Lock()
	_, found := l.leaderboards[id]
	l.leaderboards[id] = leaderboard

	if found {
		for idx, le := range l.allList {
			if le.Id == id {
				l.allList[idx] = leaderboard
				break
			}
		}
		for idx, le := range l.tournamentList {
			if le.Id == id {
				l.tournamentList[idx] = leaderboard
				break
			}
		}
	} else {
		l.allList = append(l.allList, leaderboard)
		l.tournamentList = append(l.tournamentList, leaderboard)
		sort.Sort(OrderedTournaments(l.tournamentList))
	}

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

func (l *LocalLeaderboardCache) Delete(ctx context.Context, rankCache LeaderboardRankCache, scheduler LeaderboardScheduler, id string) (bool, error) {
	l.Lock()
	leaderboard, leaderboardFound := l.leaderboards[id]
	l.Unlock()

	if !leaderboardFound {
		// Deletion is an idempotent operation.
		return false, nil
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
	res, err := l.db.ExecContext(ctx, query, id)
	if err != nil {
		l.logger.Error("Error deleting leaderboard", zap.Error(err))
		return false, err
	}
	rowsAffected, err := res.RowsAffected()

	l.Lock()
	// Then delete from cache.
	delete(l.leaderboards, id)
	for i, currentAll := range l.allList {
		if currentAll.Id == id {
			copy(l.allList[i:], l.allList[i+1:])
			l.allList[len(l.allList)-1] = nil
			l.allList = l.allList[:len(l.allList)-1]
			break
		}
	}
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

	if expiryUnix > now.Unix() || expiryUnix == 0 {
		// Clear any cached ranks that have not yet expired.
		rankCache.DeleteLeaderboard(id, expiryUnix)
	}

	return rowsAffected != 0 || err != nil, nil
}

func (l *LocalLeaderboardCache) Remove(id string) {
	l.Lock()
	if leaderboard, ok := l.leaderboards[id]; ok {
		delete(l.leaderboards, id)
		for i, currentAll := range l.allList {
			if currentAll.Id == id {
				copy(l.allList[i:], l.allList[i+1:])
				l.allList[len(l.allList)-1] = nil
				l.allList = l.allList[:len(l.allList)-1]
				break
			}
		}
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
