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
	"fmt"

	"github.com/yuin/gopher-lua"
)

type ExecutionMode int

const (
	ExecutionModeRunOnce ExecutionMode = iota
	ExecutionModeRPC
	ExecutionModeBefore
	ExecutionModeAfter
	ExecutionModeMatch
	ExecutionModeMatchmaker
)

func (e ExecutionMode) String() string {
	switch e {
	case ExecutionModeRunOnce:
		return "run_once"
	case ExecutionModeRPC:
		return "rpc"
	case ExecutionModeBefore:
		return "before"
	case ExecutionModeAfter:
		return "after"
	case ExecutionModeMatch:
		return "match"
	case ExecutionModeMatchmaker:
		return "matchmaker"
	}

	return ""
}

const (
	__CTX_ENV              = "env"
	__CTX_MODE             = "execution_mode"
	__CTX_QUERY_PARAMS     = "query_params"
	__CTX_USER_ID          = "user_id"
	__CTX_USERNAME         = "username"
	__CTX_USER_SESSION_EXP = "user_session_exp"
	__CTX_SESSION_ID       = "session_id"
	__CTX_CLIENT_IP        = "client_ip"
	__CTX_CLIENT_PORT      = "client_port"
	__CTX_MATCH_ID         = "match_id"
	__CTX_MATCH_NODE       = "match_node"
	__CTX_MATCH_LABEL      = "match_label"
	__CTX_MATCH_TICK_RATE  = "match_tick_rate"
)

func NewLuaContext(l *lua.LState, env *lua.LTable, mode ExecutionMode, queryParams map[string][]string, sessionExpiry int64,
	userID, username, sessionID, clientIP, clientPort string) *lua.LTable {
	size := 3
	if userID != "" {
		size += 3
		if sessionID != "" {
			size++
		}
	}

	if clientIP != "" {
		size++
	}
	if clientPort != "" {
		size++
	}

	lt := l.CreateTable(0, size)
	lt.RawSetString(__CTX_ENV, env)
	lt.RawSetString(__CTX_MODE, lua.LString(mode.String()))
	if queryParams == nil {
		lt.RawSetString(__CTX_QUERY_PARAMS, l.CreateTable(0, 0))
	} else {
		lt.RawSetString(__CTX_QUERY_PARAMS, ConvertValue(l, queryParams))
	}

	if userID != "" {
		lt.RawSetString(__CTX_USER_ID, lua.LString(userID))
		lt.RawSetString(__CTX_USERNAME, lua.LString(username))
		lt.RawSetString(__CTX_USER_SESSION_EXP, lua.LNumber(sessionExpiry))
		if sessionID != "" {
			lt.RawSetString(__CTX_SESSION_ID, lua.LString(sessionID))
		}
	}

	if clientIP != "" {
		lt.RawSetString(__CTX_CLIENT_IP, lua.LString(clientIP))
	}

	if clientPort != "" {
		lt.RawSetString(__CTX_CLIENT_PORT, lua.LString(clientPort))
	}

	return lt
}

func ConvertMap(l *lua.LState, data map[string]interface{}) *lua.LTable {
	lt := l.CreateTable(0, len(data))

	for k, v := range data {
		lt.RawSetString(k, ConvertValue(l, v))
	}

	return lt
}

func ConvertLuaTable(lv *lua.LTable) map[string]interface{} {
	returnData, _ := ConvertLuaValue(lv).(map[string]interface{})
	return returnData
}

func ConvertValue(l *lua.LState, val interface{}) lua.LValue {
	if val == nil {
		return lua.LNil
	}

	// Types looked up from:
	// https://golang.org/pkg/encoding/json/#Unmarshal
	// https://developers.google.com/protocol-buffers/docs/proto3#scalar
	switch v := val.(type) {
	case bool:
		return lua.LBool(v)
	case string:
		return lua.LString(v)
	case []byte:
		return lua.LString(v)
	case float32:
		return lua.LNumber(v)
	case float64:
		return lua.LNumber(v)
	case int:
		return lua.LNumber(v)
	case int32:
		return lua.LNumber(v)
	case int64:
		return lua.LNumber(v)
	case uint32:
		return lua.LNumber(v)
	case uint64:
		return lua.LNumber(v)
	case map[string][]string:
		lt := l.CreateTable(0, len(v))
		for k, v := range v {
			lt.RawSetString(k, ConvertValue(l, v))
		}
		return lt
	case map[string]interface{}:
		return ConvertMap(l, v)
	case []string:
		lt := l.CreateTable(len(val.([]string)), 0)
		for k, v := range v {
			lt.RawSetInt(k+1, lua.LString(v))
		}
		return lt
	case []interface{}:
		lt := l.CreateTable(len(val.([]interface{})), 0)
		for k, v := range v {
			lt.RawSetInt(k+1, ConvertValue(l, v))
		}
		return lt
	default:
		return nil
	}
}

func ConvertLuaValue(lv lua.LValue) interface{} {
	// Taken from: https://github.com/yuin/gluamapper/blob/master/gluamapper.go#L79
	switch v := lv.(type) {
	case *lua.LNilType:
		return nil
	case lua.LBool:
		return bool(v)
	case lua.LString:
		return string(v)
	case lua.LNumber:
		return float64(v)
	case *lua.LTable:
		maxn := v.MaxN()
		if maxn == 0 {
			// Table.
			ret := make(map[string]interface{})
			v.ForEach(func(key, value lua.LValue) {
				keystr := fmt.Sprint(ConvertLuaValue(key))
				ret[keystr] = ConvertLuaValue(value)
			})
			return ret
		} else {
			// Array.
			ret := make([]interface{}, 0, maxn)
			for i := 1; i <= maxn; i++ {
				ret = append(ret, ConvertLuaValue(v.RawGetInt(i)))
			}
			return ret
		}
	default:
		return v
	}
}
