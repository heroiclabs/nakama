// Copyright 2026 The Nakama Authors
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
	"strings"
	"testing"

	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
)

// runtimeLuaModuleWithClosedDB builds just enough of the Lua runtime module to run an argument
// check. The database is closed, so anything that gets past the checks fails there instead of
// doing any work - which is what lets these tests tell "rejected by the argument check" apart from
// "accepted and carried on".
func runtimeLuaModuleWithClosedDB(t *testing.T) *RuntimeLuaNakamaModule {
	t.Helper()

	db, err := sql.Open("pgx", "postgresql://postgres@127.0.0.1:5432/nakama?sslmode=disable")
	if err != nil {
		t.Fatalf("Error opening database handle: %s", err.Error())
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Error closing database handle: %s", err.Error())
	}

	return &RuntimeLuaNakamaModule{logger: logger, db: db}
}

// callTournamentList runs the tournament_list binding with the given arguments and returns the
// error a Lua script would see, rather than letting the raise unwind into the test.
func callTournamentList(n *RuntimeLuaNakamaModule, args ...lua.LValue) error {
	l := lua.NewState()
	defer l.Close()

	return l.CallByParam(lua.P{Fn: l.NewFunction(n.tournamentList), NRet: lua.MultRet, Protect: true}, args...)
}

// tournament_list documents startTime and endTime as optional with a default of -1, and -1 is the
// value that means "do not filter on this". The argument check used to reject anything below zero,
// so the default was rejected too. Reported in #2398, fixed by matching the Go runtime's
// TournamentList, which checks "< -1".
func TestRuntimeLuaTournamentListAcceptsTheDefaultTimes(t *testing.T) {
	n := runtimeLuaModuleWithClosedDB(t)

	err := callTournamentList(n)
	if err != nil && strings.Contains(err.Error(), "must be >= -1") {
		t.Fatalf("tournament_list() with no times was rejected by the argument check: %s", err.Error())
	}

	err = callTournamentList(n, lua.LNumber(0), lua.LNumber(0), lua.LNumber(-1), lua.LNumber(-1))
	if err != nil && strings.Contains(err.Error(), "must be >= -1") {
		t.Fatalf("tournament_list(0, 0, -1, -1) was rejected by the argument check: %s", err.Error())
	}
}

// The check still has to reject values below the sentinel.
func TestRuntimeLuaTournamentListRejectsTimesBelowTheSentinel(t *testing.T) {
	n := runtimeLuaModuleWithClosedDB(t)

	err := callTournamentList(n, lua.LNumber(0), lua.LNumber(0), lua.LNumber(-2), lua.LNumber(-1))
	if err == nil || !strings.Contains(err.Error(), "startTime must be >= -1") {
		t.Fatalf("tournament_list(0, 0, -2, -1) was not rejected by the argument check: %v", err)
	}

	err = callTournamentList(n, lua.LNumber(0), lua.LNumber(0), lua.LNumber(-1), lua.LNumber(-2))
	if err == nil || !strings.Contains(err.Error(), "endTime must be >= -1") {
		t.Fatalf("tournament_list(0, 0, -1, -2) was not rejected by the argument check: %v", err)
	}
}
