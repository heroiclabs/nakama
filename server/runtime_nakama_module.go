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
	"context"

	"strings"

	"database/sql"

	"fmt"

	"encoding/json"

	"github.com/fatih/structs"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
)

const CALLBACKS = "runtime_callbacks"

type Callbacks struct {
	HTTP   map[string]*lua.LFunction
	RPC    map[string]*lua.LFunction
	Before map[string]*lua.LFunction
	After  map[string]*lua.LFunction
}

type NakamaModule struct {
	logger *zap.Logger
	db     *sql.DB
}

func NewNakamaModule(logger *zap.Logger, db *sql.DB, l *lua.LState) *NakamaModule {
	l.SetContext(context.WithValue(context.Background(), CALLBACKS, &Callbacks{
		RPC:    make(map[string]*lua.LFunction),
		Before: make(map[string]*lua.LFunction),
		After:  make(map[string]*lua.LFunction),
		HTTP:   make(map[string]*lua.LFunction),
	}))
	return &NakamaModule{
		logger: logger,
		db:     db,
	}
}

func (n *NakamaModule) Loader(l *lua.LState) int {
	mod := l.SetFuncs(l.NewTable(), map[string]lua.LGFunction{
		"logger_info":        n.loggerInfo,
		"logger_warn":        n.loggerWarn,
		"logger_error":       n.loggerError,
		"register_rpc":       n.registerRPC,
		"register_before":    n.registerBefore,
		"register_after":     n.registerAfter,
		"register_http":      n.registerHTTP,
		"user_fetch_id":      n.userFetchId,
		"leaderboard_create": n.leaderboardCreate,
	})

	l.Push(mod)
	return 1
}

func (n *NakamaModule) loggerInfo(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Info(message)
	return 0
}

func (n *NakamaModule) loggerWarn(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Warn(message)
	return 0
}

func (n *NakamaModule) loggerError(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Error(message)
	return 0
}

func (n *NakamaModule) registerRPC(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects rpc id")
		return 0
	}

	id = strings.ToLower(id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.RPC[id] = fn
	n.logger.Info("Registered RPC function invocation", zap.String("id", id))
	return 0
}

func (n *NakamaModule) registerBefore(l *lua.LState) int {
	fn := l.CheckFunction(1)
	messageName := l.CheckString(2)

	if messageName == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	messageName = strings.ToLower(messageName)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.Before[messageName] = fn
	n.logger.Info("Registered Before function invocation", zap.String("message", messageName))
	return 0
}

func (n *NakamaModule) registerAfter(l *lua.LState) int {
	fn := l.CheckFunction(1)
	messageName := l.CheckString(2)

	if messageName == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	messageName = strings.ToLower(messageName)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.After[messageName] = fn
	n.logger.Info("Registered After function invocation", zap.String("message", messageName))
	return 0
}

func (n *NakamaModule) registerHTTP(l *lua.LState) int {
	fn := l.CheckFunction(1)
	path := l.CheckString(2)

	if path == "" {
		l.ArgError(2, "expects http path")
		return 0
	}

	if strings.HasPrefix(path, "/") {
		l.ArgError(2, "http path should not start with leading slash")
		return 0
	}

	path = strings.ToLower(path)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.HTTP[path] = fn
	n.logger.Info("Registered HTTP function invocation", zap.String("path", path))
	return 0
}

func (n *NakamaModule) userFetchId(l *lua.LState) int {
	lt := l.CheckTable(1)
	userIds, ok := convertLuaValue(lt).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}

	userIdBytes := make([][]byte, 0)
	for _, id := range userIds {
		uid, err := uuid.FromString(id.(string))
		if err != nil {
			l.ArgError(1, "invalid user id")
			return 0
		}
		userIdBytes = append(userIdBytes, uid.Bytes())
	}

	users, err := UsersFetch(n.logger, n.db, userIdBytes)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to retrieve users: %s", err.Error()))
		return 0
	}

	//translate uuid to string bytes
	for _, u := range users {
		uid, _ := uuid.FromBytes(u.Id)
		u.Id = []byte(uid.String())
	}

	lv := l.NewTable()
	for i, u := range users {
		um := structs.Map(u)
		lv.RawSetInt(i, convertValue(l, um))
	}

	l.Push(lv)
	return 1
}

func (n *NakamaModule) leaderboardCreate(l *lua.LState) int {
	id := l.CheckString(1)
	sort := l.CheckString(2)
	reset := l.OptString(3, "")
	metadata := l.OptTable(4, l.NewTable())
	authoritative := l.OptBool(5, false)

	leaderboardId, err := uuid.FromString(id)
	if err != nil {
		l.ArgError(1, "invalid leaderboard id")
		return 0
	}

	if sort != "asc" && sort != "desc" {
		l.ArgError(2, "invalid sort - only acceptable values are 'asc' and 'desc'")
		return 0
	}

	metadataMap := ConvertLuaTable(metadata)
	metadataBytes, err := json.Marshal(metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert metadata: %s", err.Error()))
		return 0
	}

	_, err = createLeaderboard(n.logger, n.db, leaderboardId.String(), sort, reset, string(metadataBytes), authoritative)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to create leaderboard: %s", err.Error()))
		return 0
	}

	return 0
}
