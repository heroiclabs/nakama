// Copyright 2022 The Nakama Authors
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
	"testing"

	"github.com/gofrs/uuid/v5"
)

func TestMatchPresenceList(t *testing.T) {
	list := NewMatchPresenceList()

	p1 := &MatchPresence{
		Node:      "nakama",
		UserID:    uuid.Must(uuid.NewV4()),
		SessionID: uuid.Must(uuid.NewV4()),
		Username:  "user1",
		Reason:    0,
	}
	p2 := &MatchPresence{
		Node:      "nakama",
		UserID:    uuid.Must(uuid.NewV4()),
		SessionID: uuid.Must(uuid.NewV4()),
		Username:  "user2",
		Reason:    0,
	}
	p3 := &MatchPresence{
		Node:      "nakama",
		UserID:    uuid.Must(uuid.NewV4()),
		SessionID: uuid.Must(uuid.NewV4()),
		Username:  "user3",
		Reason:    0,
	}

	list.Join([]*MatchPresence{p1, p2, p3})

	list.Leave([]*MatchPresence{p2})
	if list.Size() != 2 {
		t.Fatalf("list size error: %+v", list.ListPresences())
	}

	list.Leave([]*MatchPresence{p1})
	if list.Size() != 1 {
		t.Fatalf("list size error: %+v", list.ListPresences())
	}

	list.Leave([]*MatchPresence{p3})
	if list.Size() != 0 {
		t.Fatalf("list size error: %+v", list.ListPresences())
	}
}
