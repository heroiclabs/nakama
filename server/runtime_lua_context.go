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
	"time"

	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
)

const (
	__RUNTIME_LUA_CTX_ENV              = "env"
	__RUNTIME_LUA_CTX_MODE             = "execution_mode"
	__RUNTIME_LUA_CTX_NODE             = "node"
	__RUNTIME_LUA_CTX_VERSION          = "version"
	__RUNTIME_LUA_CTX_HEADERS          = "headers"
	__RUNTIME_LUA_CTX_QUERY_PARAMS     = "query_params"
	__RUNTIME_LUA_CTX_USER_ID          = "user_id"
	__RUNTIME_LUA_CTX_USERNAME         = "username"
	__RUNTIME_LUA_CTX_VARS             = "vars"
	__RUNTIME_LUA_CTX_USER_SESSION_EXP = "user_session_exp"
	__RUNTIME_LUA_CTX_SESSION_ID       = "session_id"
	__RUNTIME_LUA_CTX_LANG             = "lang"
	__RUNTIME_LUA_CTX_CLIENT_IP        = "client_ip"
	__RUNTIME_LUA_CTX_CLIENT_PORT      = "client_port"
	__RUNTIME_LUA_CTX_MATCH_ID         = "match_id"
	__RUNTIME_LUA_CTX_MATCH_NODE       = "match_node"
	__RUNTIME_LUA_CTX_MATCH_LABEL      = "match_label"
	__RUNTIME_LUA_CTX_MATCH_TICK_RATE  = "match_tick_rate"
)

func NewRuntimeLuaContext(l *lua.LState, node, version string, env *lua.LTable, mode RuntimeExecutionMode, headers, queryParams map[string][]string, sessionExpiry int64, userID, username string, vars map[string]string, sessionID, clientIP, clientPort, lang string) *lua.LTable {
	size := 4
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
	lt.RawSetString(__RUNTIME_LUA_CTX_ENV, env)
	lt.RawSetString(__RUNTIME_LUA_CTX_MODE, lua.LString(mode.String()))
	lt.RawSetString(__RUNTIME_LUA_CTX_NODE, lua.LString(node))
	lt.RawSetString(__RUNTIME_LUA_CTX_VERSION, lua.LString(version))
	if headers == nil {
		lt.RawSetString(__RUNTIME_LUA_CTX_HEADERS, l.CreateTable(0, 0))
	} else {
		lt.RawSetString(__RUNTIME_LUA_CTX_HEADERS, RuntimeLuaConvertValue(l, headers))
	}
	if queryParams == nil {
		lt.RawSetString(__RUNTIME_LUA_CTX_QUERY_PARAMS, l.CreateTable(0, 0))
	} else {
		lt.RawSetString(__RUNTIME_LUA_CTX_QUERY_PARAMS, RuntimeLuaConvertValue(l, queryParams))
	}

	if userID != "" {
		lt.RawSetString(__RUNTIME_LUA_CTX_USER_ID, lua.LString(userID))
		lt.RawSetString(__RUNTIME_LUA_CTX_USERNAME, lua.LString(username))
		if vars != nil {
			vt := l.CreateTable(0, len(vars))
			for k, v := range vars {
				vt.RawSetString(k, lua.LString(v))
			}
			lt.RawSetString(__RUNTIME_LUA_CTX_VARS, vt)
		}
		lt.RawSetString(__RUNTIME_LUA_CTX_USER_SESSION_EXP, lua.LNumber(sessionExpiry))
		if sessionID != "" {
			lt.RawSetString(__RUNTIME_LUA_CTX_SESSION_ID, lua.LString(sessionID))
			// Lang is never reported without session ID.
			lt.RawSetString(__RUNTIME_LUA_CTX_LANG, lua.LString(lang))
		}
	}

	if clientIP != "" {
		lt.RawSetString(__RUNTIME_LUA_CTX_CLIENT_IP, lua.LString(clientIP))
	}
	if clientPort != "" {
		lt.RawSetString(__RUNTIME_LUA_CTX_CLIENT_PORT, lua.LString(clientPort))
	}

	return lt
}

func RuntimeLuaConvertMapString(l *lua.LState, data map[string]string) *lua.LTable {
	lt := l.CreateTable(0, len(data))

	for k, v := range data {
		lt.RawSetString(k, RuntimeLuaConvertValue(l, v))
	}

	return lt
}

func RuntimeLuaConvertMap(l *lua.LState, data map[string]interface{}) *lua.LTable {
	lt := l.CreateTable(0, len(data))

	for k, v := range data {
		lt.RawSetString(k, RuntimeLuaConvertValue(l, v))
	}

	return lt
}

func RuntimeLuaConvertMapInt64(l *lua.LState, data map[string]int64) *lua.LTable {
	lt := l.CreateTable(0, len(data))

	for k, v := range data {
		lt.RawSetString(k, RuntimeLuaConvertValue(l, v))
	}

	return lt
}

func RuntimeLuaConvertLuaTable(lv *lua.LTable) map[string]interface{} {
	returnData, _ := RuntimeLuaConvertLuaValue(lv).(map[string]interface{})
	return returnData
}

func RuntimeLuaConvertValue(l *lua.LState, val interface{}) lua.LValue {
	if val == nil {
		return lua.LNil
	}

	// Types looked up from:
	// https://golang.org/pkg/encoding/json/#Unmarshal
	// https://developers.google.com/protocol-buffers/docs/proto3#scalar
	// More types added based on observations.
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
			lt.RawSetString(k, RuntimeLuaConvertValue(l, v))
		}
		return lt
	case map[string]string:
		return RuntimeLuaConvertMapString(l, v)
	case map[string]int64:
		return RuntimeLuaConvertMapInt64(l, v)
	case map[string]interface{}:
		return RuntimeLuaConvertMap(l, v)
	case []string:
		lt := l.CreateTable(len(val.([]string)), 0)
		for k, v := range v {
			lt.RawSetInt(k+1, lua.LString(v))
		}
		return lt
	case []interface{}:
		lt := l.CreateTable(len(val.([]interface{})), 0)
		for k, v := range v {
			lt.RawSetInt(k+1, RuntimeLuaConvertValue(l, v))
		}
		return lt
	case time.Time:
		return lua.LNumber(v.UTC().Unix())
	case nil:
		return lua.LNil
	default:
		// Never return an actual Go `nil` or it will cause nil pointer dereferences inside gopher-lua.
		return lua.LNil
	}
}

func RuntimeLuaConvertLuaValue(lv lua.LValue) interface{} {
	// Taken from: https://github.com/yuin/gluamapper/blob/master/gluamapper.go#L79
	switch v := lv.(type) {
	case *lua.LNilType:
		return nil
	case lua.LBool:
		return bool(v)
	case lua.LString:
		return string(v)
	case lua.LNumber:
		vf := float64(v)
		vi := int64(v)
		if vf == float64(vi) {
			// If it's a whole number use an actual integer type.
			return vi
		}
		return vf
	case *lua.LTable:
		maxn := v.MaxN()
		if maxn == 0 {
			// Table.
			ret := make(map[string]interface{})
			v.ForEach(func(key, value lua.LValue) {
				keyStr := fmt.Sprint(RuntimeLuaConvertLuaValue(key))
				ret[keyStr] = RuntimeLuaConvertLuaValue(value)
			})
			return ret
		}
		// Array.
		ret := make([]interface{}, 0, maxn)
		for i := 1; i <= maxn; i++ {
			ret = append(ret, RuntimeLuaConvertLuaValue(v.RawGetInt(i)))
		}
		return ret
	case *lua.LFunction:
		return v.String()
	default:
		return v
	}
}
