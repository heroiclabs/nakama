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
	"fmt"

	"github.com/yuin/gopher-lua"
)

type ExecutionMode int

const (
	RPC ExecutionMode = iota
	BEFORE
	AFTER
	HTTP
	JOB
	LEADERBOARD_RESET
)

func (e ExecutionMode) String() string {
	switch e {
	case HTTP:
		return "http"
	case RPC:
		return "rpc"
	case BEFORE:
		return "before"
	case AFTER:
		return "after"
	case JOB:
		return "job"
	case LEADERBOARD_RESET:
		return "leaderboard_reset"
	}

	return ""
}

const (
	__CTX_ENV              = "Env"
	__CTX_MODE             = "ExecutionMode"
	__CTX_USER_ID          = "UserId"
	__CTX_USER_HANDLE      = "UserHandle"
	__CTX_USER_SESSION_EXP = "UserSessionExp"
)

func NewLuaContext(l *lua.LState, env *lua.LTable, mode ExecutionMode, uid string, handle string, sessionExpiry int64) *lua.LTable {
	lt := l.NewTable()
	lt.RawSetString(__CTX_ENV, env)
	lt.RawSetString(__CTX_MODE, lua.LString(mode.String()))

	if uid != "" {
		lt.RawSetString(__CTX_USER_ID, lua.LString(uid))
		lt.RawSetString(__CTX_USER_HANDLE, lua.LString(handle))
		lt.RawSetString(__CTX_USER_SESSION_EXP, lua.LNumber(sessionExpiry))
	}

	return lt
}

func ConvertMap(l *lua.LState, data map[string]interface{}) *lua.LTable {
	lt := l.NewTable()

	for k, v := range data {
		lt.RawSetString(k, convertValue(l, v))
	}

	return lt
}

func ConvertLuaTable(lv *lua.LTable) map[string]interface{} {
	returnData, _ := convertLuaValue(lv).(map[string]interface{})
	return returnData
}

func convertValue(l *lua.LState, val interface{}) lua.LValue {
	if val == nil {
		return lua.LNil
	}

	// types looked up from
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
	case map[string]interface{}:
		return ConvertMap(l, v)
	case []interface{}:
		lt := l.NewTable()
		for k, v := range v {
			lt.RawSetInt(k+1, convertValue(l, v))
		}
		return lt
	default:
		return nil
	}
}

func convertLuaValue(lv lua.LValue) interface{} {
	// taken from https://github.com/yuin/gluamapper/blob/master/gluamapper.go#L79
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
		if maxn == 0 { // table
			ret := make(map[string]interface{})
			v.ForEach(func(key, value lua.LValue) {
				keystr := fmt.Sprint(convertLuaValue(key))
				ret[keystr] = convertLuaValue(value)
			})
			return ret
		} else { // array
			ret := make([]interface{}, 0, maxn)
			for i := 1; i <= maxn; i++ {
				ret = append(ret, convertLuaValue(v.RawGetInt(i)))
			}
			return ret
		}
	default:
		return v
	}
}
