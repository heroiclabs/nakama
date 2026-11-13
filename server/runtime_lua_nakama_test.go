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
	"context"
	"strings"
	"testing"
)

// tournament_list documents startTime and endTime as optional with a default of -1, and -1 is the
// value that means "do not filter on this". The argument check used to reject anything below zero,
// so the default was rejected too. Reported in #2398, fixed by matching the Go runtime's
// TournamentList, which checks "< -1".
func TestRuntimeLuaTournamentListTimes(t *testing.T) {
	modules := map[string]string{
		"test": `
local nakama = require("nakama")

function test(ctx, payload)
	if payload == "default" then
		return nakama.tournament_list()
	elseif payload == "sentinel" then
		return nakama.tournament_list(0, 0, -1, -1)
	elseif payload == "below" then
		return nakama.tournament_list(0, 0, -2, -1)
	elseif payload == "fractional" then
		return nakama.tournament_list(0, 0, -1.5, -1)
	end
	return "unknown case"
end

nakama.register_rpc(test, "test")`,
	}

	runtime, _, err := runtimeWithModules(t, modules)
	if err != nil {
		t.Fatal(err.Error())
	}
	fn := runtime.Rpc("test")
	if fn == nil {
		t.Fatal("Expected RPC function to be registered")
	}

	call := func(t *testing.T, payload string) error {
		t.Helper()
		_, err, _ := fn(context.Background(), nil, nil, "", "", "", nil, 0, "", "", "", "", payload)
		return err
	}

	// The documented default and the explicit sentinel must be accepted and reach TournamentList.
	for _, payload := range []string{"default", "sentinel"} {
		if err := call(t, payload); err != nil {
			t.Fatalf("tournament_list %q was rejected by the argument check: %v", payload, err)
		}
	}

	// Values below the sentinel must be rejected, including fractional values that int() would
	// truncate toward zero (-1.5 -> -1) and let through as if they were the sentinel.
	for _, tc := range []struct{ payload, want string }{
		{"below", "startTime must be >= -1"},
		{"fractional", "startTime must be >= -1"},
	} {
		err := call(t, tc.payload)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("tournament_list %q was not rejected by the argument check: %v", tc.payload, err)
		}
	}
}
