// The MIT License (MIT)
//
// Copyright (c) 2015 Yusuke Inuzuka
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package server

import (
	"github.com/yuin/gopher-lua"
	"strings"
	"time"
)

var startedAt time.Time

func init() {
	startedAt = time.Now()
}

func getIntField(L *lua.LState, tb *lua.LTable, key string, v int) int {
	ret := tb.RawGetString(key)
	if ln, ok := ret.(lua.LNumber); ok {
		return int(ln)
	}
	return v
}

func getBoolField(L *lua.LState, tb *lua.LTable, key string, v bool) bool {
	ret := tb.RawGetString(key)
	if lb, ok := ret.(lua.LBool); ok {
		return bool(lb)
	}
	return v
}

func OpenOs(L *lua.LState) int {
	osmod := L.RegisterModule(lua.OsLibName, osFuncs)
	L.Push(osmod)
	return 1
}

var osFuncs = map[string]lua.LGFunction{
	"clock":    osClock,
	"difftime": osDiffTime,
	"date":     osDate,
	"time":     osTime,
}

func osClock(L *lua.LState) int {
	L.Push(lua.LNumber(float64(time.Now().Sub(startedAt)) / float64(time.Second)))
	return 1
}

func osDiffTime(L *lua.LState) int {
	L.Push(lua.LNumber(L.CheckInt64(1) - L.CheckInt64(2)))
	return 1
}

func osDate(L *lua.LState) int {
	t := time.Now().UTC()
	cfmt := "%c"
	if L.GetTop() >= 1 {
		cfmt = L.CheckString(1)
		if strings.HasPrefix(cfmt, "!") {
			t = time.Now().UTC()
			cfmt = strings.TrimLeft(cfmt, "!")
		}
		if L.GetTop() >= 2 {
			t = time.Unix(L.CheckInt64(2), 0)
		}
		if strings.HasPrefix(cfmt, "*t") {
			ret := L.NewTable()
			ret.RawSetString("year", lua.LNumber(t.Year()))
			ret.RawSetString("month", lua.LNumber(t.Month()))
			ret.RawSetString("day", lua.LNumber(t.Day()))
			ret.RawSetString("hour", lua.LNumber(t.Hour()))
			ret.RawSetString("min", lua.LNumber(t.Minute()))
			ret.RawSetString("sec", lua.LNumber(t.Second()))
			ret.RawSetString("wday", lua.LNumber(t.Weekday()))
			ret.RawSetString("yday", lua.LNumber(t.YearDay()))
			// TODO dst
			ret.RawSetString("isdst", lua.LFalse)
			L.Push(ret)
			return 1
		}
	}
	L.Push(lua.LString(strftime(t, cfmt)))
	return 1
}

func osTime(L *lua.LState) int {
	if L.GetTop() == 0 {
		L.Push(lua.LNumber(time.Now().UTC().Unix()))
	} else {
		tbl := L.CheckTable(1)
		sec := getIntField(L, tbl, "sec", 0)
		min := getIntField(L, tbl, "min", 0)
		hour := getIntField(L, tbl, "hour", 12)
		day := getIntField(L, tbl, "day", -1)
		month := getIntField(L, tbl, "month", -1)
		year := getIntField(L, tbl, "year", -1)
		isdst := getBoolField(L, tbl, "isdst", false)
		t := time.Date(year, time.Month(month), day, hour, min, sec, 0, time.UTC)
		// TODO dst
		if false {
			print(isdst)
		}
		L.Push(lua.LNumber(t.UTC().Unix()))
	}
	return 1
}
