// Copyright 2020 The Nakama Authors
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
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/heroiclabs/nakama-common/runtime"
)

func TestEncode(t *testing.T) {
	entries := []runtime.MatchmakerEntry{
		&MatchmakerEntry{Ticket: "123", Presence: &MatchmakerPresence{Username: "a"}},
		&MatchmakerEntry{Ticket: "456", Presence: &MatchmakerPresence{Username: "b"}},
	}
	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(map[string]interface{}{"foo": entries}); err != nil {
		t.Fatalf("error: %v", err)
	}
	t.Log("ok")
}
