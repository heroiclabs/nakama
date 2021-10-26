// Copyright 2021 The Nakama Authors
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
	"io/ioutil"
	"os"
	"testing"
	"time"

	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
)

// should only add to matchmaker
func TestMatchmakerAddOnly(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger, nil)
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "", "properties.a1:foo", 2, 2, map[string]string{
		"a1": "bar",
	}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket == "" {
		t.Fatal("expected valid ticket")
	}
}

// should add and remove from matchmaker
func TestMatchmakerAddAndRemove(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger, nil)
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "", "properties.a1:foo", 2, 2, map[string]string{
		"a1": "bar",
	}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket == "" {
		t.Fatal("expected valid ticket")
	}

	err = matchMaker.RemoveSession(sessionID.String(), ticket)
	if err != nil {
		t.Fatalf("error matchmaker remove session: %v", err)
	}
}

// should add to matchmaker and do basic match
func TestMatchmakerAddWithBasicMatch(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "", "properties.a3:bar", 2, 2, map[string]string{
		"a3": "baz",
	}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "", "properties.a3:baz", 2, 2, map[string]string{
		"a3": "bar",
	}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	// assert session 1 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID.String()]; ok {
		if mm.GetMatchId() != "" {
			t.Fatalf("expected match id to be empty, got '%s'", mm.GetMatchId())
		}
		if mm.GetToken() == "" {
			t.Fatal("expected token to not be empty")
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}

	// assert session 2 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID2.String()]; ok {
		if mm.GetMatchId() != "" {
			t.Fatalf("expected match id to be empty, got '%s'", mm.GetMatchId())
		}
		if mm.GetToken() == "" {
			t.Fatal("expected token to not be empty")
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}
}

// should add to matchmaker and match on range
func TestMatchmakerAddWithMatchOnRange(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"+properties.b1:>=10 +properties.b1:<=20",
		2, 2, map[string]string{},
		map[string]float64{
			"b1": 15,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"+properties.b1:>=10 +properties.b1:<=20",
		2, 2, map[string]string{},
		map[string]float64{
			"b1": 15,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	// assert session 1 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID.String()]; ok {
		if mm.GetMatchId() != "" {
			t.Fatalf("expected match id to be empty, got '%s'", mm.GetMatchId())
		}
		if mm.GetToken() == "" {
			t.Fatal("expected token to not be empty")
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}

	// assert session 2 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID2.String()]; ok {
		if mm.GetMatchId() != "" {
			t.Fatalf("expected match id to be empty, got '%s'", mm.GetMatchId())
		}
		if mm.GetToken() == "" {
			t.Fatal("expected token to not be empty")
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}
}

// should add to matchmaker and match on range and value
func TestMatchmakerAddWithMatchOnRangeAndValue(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"+properties.b1:>=10 +properties.b1:<=20",
		2, 2,
		map[string]string{
			"c2": "foo",
		},
		map[string]float64{
			"c1": 15,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"+properties.c1:>=10 +properties.c1:<=20 +properties.c2:foo",
		2, 2,
		map[string]string{
			"c2": "foo",
		},
		map[string]float64{
			"c1": 15,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	// assert session 1 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID.String()]; ok {
		if mm.GetMatchId() != "" {
			t.Fatalf("expected match id to be empty, got '%s'", mm.GetMatchId())
		}
		if mm.GetToken() == "" {
			t.Fatal("expected token to not be empty")
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}

	// assert session 2 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID2.String()]; ok {
		if mm.GetMatchId() != "" {
			t.Fatalf("expected match id to be empty, got '%s'", mm.GetMatchId())
		}
		if mm.GetToken() == "" {
			t.Fatal("expected token to not be empty")
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}
}

// should add to matchmaker then remove and not match
// FIXME - ported from JS test, but remove is not preventing the match
// there is only ever one item in the matchmaker, so it will never match
// anyway, test should be improved.
func TestMatchmakerAddRemoveNotMatch(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"properties.a3:bar",
		2, 2, map[string]string{
			"a3": "baz",
		}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	err = matchMaker.RemoveSession(sessionID.String(), ticket1)
	if err != nil {
		t.Fatalf("error matchmaker remove: %v", err)
	}

	time.Sleep(5 * time.Second)

	if len(matchesSeen) > 0 {
		t.Fatalf("expected 0 matches, got %d", len(matchesSeen))
	}
}

// should add to matchmaker but not match
func TestMatchmakerAddButNotMatch(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"properties.a5:bar",
		2, 2,
		map[string]string{
			"a5": "baz",
		},
		map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"properties.a5:bar",
		2, 2,
		map[string]string{
			"a5": "baz",
		},
		map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	if len(matchesSeen) > 0 {
		t.Fatalf("expected 0 matches, got %d", len(matchesSeen))
	}
}

// should add to matchmaker but not match on range
// NOTE: this test has been modified from the JS version
// The client properties have been updated to ensure neither user matches the other's query,
// avoiding a non-mutual matching corner-case.
func TestMatchmakerAddButNotMatchOnRange(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
			t.Logf("see match: %#v, ticket %s", presences, envelope.GetMatchmakerMatched().Ticket)
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	testID, _ := uuid.NewV4()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"+properties.b2:>=10 +properties.b2:<=20 +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
		},
		map[string]float64{
			"b2": 25,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"+properties.b2:>=10 +properties.b2:<=20 +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
		},
		map[string]float64{
			"b2": 5,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	if len(matchesSeen) > 0 {
		t.Fatalf("expected 0 matches, got %d", len(matchesSeen))
	}
}

// should add to matchmaker but not match on range and value
// NOTE: this test has been modified from the JS version
// The client properties have been updated to ensure neither user matches the other's query,
// avoiding a non-mutual matching corner-case.
func TestMatchmakerAddButNotMatchOnRangeAndValue(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	testID, _ := uuid.NewV4()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"+properties.c3:>=10 +properties.c3:<=20 +properties.c4:foo +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"c4": "foo",
		},
		map[string]float64{
			"c3": 25,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"+properties.c3:>=10 +properties.c3:<=20 +properties.c4:foo +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"c4": "foo",
		},
		map[string]float64{
			"c3": 5,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	if len(matchesSeen) > 0 {
		t.Fatalf("expected 0 matches, got %d", len(matchesSeen))
	}
}

// should add multiple to matchmaker and some match
func TestMatchmakerAddMultipleAndSomeMatch(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	testID, _ := uuid.NewV4()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"properties.a6:bar +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "bar",
		},
		map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"properties.a6:bar +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "bar",
		},
		map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	sessionID3, _ := uuid.NewV4()
	ticket3, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "c",
			SessionId: "c",
			Username:  "c",
			Node:      "c",
			SessionID: sessionID3,
		},
	}, sessionID3.String(), "",
		"properties.a6:bar +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "bar",
		},
		map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket3 == "" {
		t.Fatal("expected non-empty ticket3")
	}

	time.Sleep(5 * time.Second)

	if len(matchesSeen) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matchesSeen))
	}
}

// should add to matchmaker and match authoritative
func TestMatchmakerAddAndMatchAuthoritative(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchesSeen := make(map[string]*rtapi.MatchmakerMatched)
	matchMaker, cleanup, err := createTestMatchmaker(t, consoleLogger,
		func(presences []*PresenceID, envelope *rtapi.Envelope) {
			if len(presences) == 1 {
				matchesSeen[presences[0].SessionID.String()] = envelope.GetMatchmakerMatched()
			}
		})
	if err != nil {
		t.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	ticket1, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"properties.d1:foo",
		2, 2, map[string]string{
			"d1":   "foo",
			"mode": "authoritative",
		}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket1 == "" {
		t.Fatal("expected non-empty ticket1")
	}

	sessionID2, _ := uuid.NewV4()
	ticket2, err := matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"properties.d1:foo",
		2, 2, map[string]string{
			"d1":   "foo",
			"mode": "authoritative",
		}, map[string]float64{})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	time.Sleep(5 * time.Second)

	// assert session 1 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID.String()]; ok {
		if mm.GetMatchId() == "" {
			t.Fatal("expected match id not to be empty")
		}
		if mm.GetToken() != "" {
			t.Fatalf("expected token to be empty, got '%s'", mm.GetToken())
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}

	// assert session 2 sees the match, and has expected details
	if mm, ok := matchesSeen[sessionID2.String()]; ok {
		if mm.GetMatchId() == "" {
			t.Fatal("expected match id not to be empty")
		}
		if mm.GetToken() != "" {
			t.Fatalf("expected token to be empty, got '%s'", mm.GetToken())
		}
		if len(mm.GetUsers()) != 2 {
			t.Fatalf("expected users length to be 2, got %d", len(mm.GetUsers()))
		}
		self := mm.GetSelf()
		if self == nil {
			t.Fatal("expectd self to not be nil")
		}
		if self.Presence.GetSessionId() == "" {
			t.Fatalf("expected session id not to be empty")
		}
		if self.Presence.GetUserId() == "" {
			t.Fatalf("expected user id not to be empty")
		}
		if self.Presence.GetUsername() == "" {
			t.Fatalf("expected username not to be empty")
		}
	} else {
		t.Fatalf("expected session %s to see a match", sessionID.String())
	}
}

// createTestMatchmaker creates a minimally configured LocalMatchmaker for testing purposes
//
// an optional messageCallback can be provided, in which case the callback will be
// executed by the message router's SendToPresenceIDs call (allowing one to detect
// that a client would be notified of a match)
//
// the returned cleanup function should be executed after all test operations are complete
// to ensure proper resource management
func createTestMatchmaker(t *testing.T, logger *zap.Logger,
	messageCallback func(presences []*PresenceID, envelope *rtapi.Envelope)) (Matchmaker, func() error, error) {
	cfg := NewConfig(logger)
	cfg.Matchmaker.IntervalSec = 1
	// configure a path runtime can use (it will mkdir this, so it must be writable)
	var err error
	cfg.Runtime.Path, err = ioutil.TempDir("", "nakama-matchmaker-test")
	if err != nil {
		t.Fatal(err)
	}

	messageRouter := &testMessageRouter{
		sendToPresence: messageCallback,
	}
	sessionRegistry := &testSessionRegistry{}
	tracker := &testTracker{}
	metrics := &testMetrics{}

	jsonpbMarshaler := &protojson.MarshalOptions{
		UseEnumNumbers:  true,
		EmitUnpopulated: false,
		Indent:          "",
		UseProtoNames:   true,
	}
	jsonpbUnmarshaler := &protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, logger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}

	runtime, _, err := NewRuntime(context.Background(), logger, logger, nil, jsonpbMarshaler, jsonpbUnmarshaler, cfg,
		nil, nil, nil, nil, sessionRegistry, nil,
		nil, tracker, metrics, nil, messageRouter)
	if err != nil {
		t.Fatal(err)
	}

	// simulate a matchmaker match function
	runtime.matchmakerMatchedFunction = func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error) {
		if len(entries) != 2 {
			return "", false, nil
		}

		if !isModeAuthoritative(entries[0].Properties) {
			return "", false, nil
		}

		if !isModeAuthoritative(entries[1].Properties) {
			return "", false, nil
		}

		res, err := matchRegistry.CreateMatch(context.Background(), logger,
			runtimeMatchCreateFunc, "match", map[string]interface{}{})
		if err != nil {
			t.Fatal(err)
		}
		return res, true, nil
	}

	matchMaker := NewLocalMatchmaker(logger, logger, cfg, messageRouter, runtime)

	return matchMaker, func() error {
		matchMaker.Stop()
		matchRegistry.Stop(0)
		return os.RemoveAll(cfg.Runtime.Path)
	}, nil
}

func isModeAuthoritative(props map[string]interface{}) bool {
	if mode, ok := props["mode"]; ok {
		if modeStr, ok := mode.(string); ok {
			if modeStr == "authoritative" {
				return true
			}
		}
	}
	return false
}
