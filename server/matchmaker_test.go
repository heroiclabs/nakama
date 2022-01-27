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
	"errors"
	"io/ioutil"
	"os"
	"testing"
	"time"

	"github.com/blugelabs/bluge"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
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

	matchMaker.process(bluge.NewBatch())

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

// should add to matchmaker and match using query string "*"
func TestMatchmakerAddWithMatchOnStar(t *testing.T) {
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
		"*",
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
		"*",
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

	matchMaker.process(bluge.NewBatch())

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

	matchMaker.process(bluge.NewBatch())

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
			"b1": 15,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket2 == "" {
		t.Fatal("expected non-empty ticket2")
	}

	matchMaker.process(bluge.NewBatch())

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

	matchMaker.process(bluge.NewBatch())

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

	matchMaker.process(bluge.NewBatch())

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

	matchMaker.process(bluge.NewBatch())

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

	matchMaker.process(bluge.NewBatch())

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

	matchMaker.process(bluge.NewBatch())

	// assert that 2 are notified of a match
	if len(matchesSeen) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matchesSeen))
	}
	// assert that session1 is one of the ones notified
	if _, ok := matchesSeen[sessionID.String()]; !ok {
		t.Errorf("expected session1 to match, it didn't %#v", matchesSeen)
	}
	// cannot assert session2 or session3, one of them will match, but it
	// cannot be assured which one
}

// should add multiple to matchmaker and some match
func TestMatchmakerAddMultipleAndSomeMatchWithBoost(t *testing.T) {
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
		"properties.n1:<10^10 properties.a6:bar +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "bar",
		},
		map[string]float64{
			"n1": 5,
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
		"properties.n1:>10^10 properties.a6:bar +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "bar",
		},
		map[string]float64{
			"n1": 15,
		})
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
		"properties.n1:<10^10 properties.a6:bar +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "bar",
		},
		map[string]float64{
			"n1": 5,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}
	if ticket3 == "" {
		t.Fatal("expected non-empty ticket3")
	}

	matchMaker.process(bluge.NewBatch())

	if len(matchesSeen) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matchesSeen))
	}

	// sessions 1 and 3 prefer to match each other
	// but if we try to match session2 first, it will choose session1
	// due to the creation time

	// if session3 matched, session 1 should also
	if _, ok := matchesSeen[sessionID3.String()]; ok {
		if _, ok := matchesSeen[sessionID.String()]; !ok {
			t.Fatalf("session1 matched, but not session 3")
		}
	}
	// if session2 matched, session 1 should also
	if _, ok := matchesSeen[sessionID2.String()]; ok {
		if _, ok := matchesSeen[sessionID.String()]; !ok {
			t.Fatalf("session2 matched, but not session 1")
		}
	}
}

// should add multiple to matchmaker and some match
func TestMatchmakerAddMultipleAndSomeMatchOptionalTextAlteringScore(t *testing.T) {
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
		"properties.a6:bar properties.a6:foo +properties.id:"+testID.String(),
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
		"properties.a6:bar properties.a6:foo +properties.id:"+testID.String(),
		2, 2,
		map[string]string{
			"id": testID.String(),
			"a6": "foo",
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
		"properties.a6:bar properties.a6:foo +properties.id:"+testID.String(),
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

	matchMaker.process(bluge.NewBatch())

	// assert that 2 are notified of a match
	if len(matchesSeen) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matchesSeen))
	}
	// assert that session1 is one of the ones notified
	if _, ok := matchesSeen[sessionID.String()]; !ok {
		t.Errorf("expected session1 to match, it didn't %#v", matchesSeen)
	}
	// cannot assert session2 or session3, one of them will match, but it
	// cannot be assured which one
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

	matchMaker.process(bluge.NewBatch())

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
func createTestMatchmaker(t fatalable, logger *zap.Logger,
	messageCallback func(presences []*PresenceID, envelope *rtapi.Envelope)) (*LocalMatchmaker, func() error, error) {
	cfg := NewConfig(logger)
	cfg.Matchmaker.IntervalSec = int(time.Hour / time.Second)
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

	return matchMaker.(*LocalMatchmaker), func() error {
		matchMaker.Stop()
		matchRegistry.Stop(0)
		return os.RemoveAll(cfg.Runtime.Path)
	}, nil
}

// should add to matchmaker and NOT match due to not having mutual matching queries/properties
// ticktet 2 satisfies what ticket 1 is looking for
// but ticket 1 does NOT satisfy what ticket 2 is looking for
// this should prevent a match from being made
func TestMatchmakerRequireMutualMatch(t *testing.T) {
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
			"b1": 5,
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

	matchMaker.process(bluge.NewBatch())

	if len(matchesSeen) > 0 {
		t.Fatalf("expected no matches, got %#v", matchesSeen)
	}
}

// TestMatchmakerRequireMutualMatchLarger attempts to validate
// mutual matchmaking of a larger size (3)
//
// The data is carefully arranged as follows:
//
// items B and C are given non-mutually matching data
// this means if the outer-loop ever chooses to start with B or C,
// we will fail to find a match due to mutual matching making
// ensuring we do not reach the desired size (3)
// this is not the purpose of the test, but relevant to the asserted behavior
//
// in the event item A is chosen in the outer-loop, we have designed
// the boost clauses to ensure that B comes before C in the results
// B does mutually match with A, allowing us to proceed populating the entryCombos
// however, C's query does not match B, and strict mutual matching should
// prevent this match being made
func TestMatchmakerRequireMutualMatchLarger(t *testing.T) {
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
	_, err = matchMaker.Add([]*MatchmakerPresence{
		{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"+properties.foo:bar properties.b1:10^10",
		3, 3, map[string]string{
			"foo": "bar",
		},
		map[string]float64{
			"b1": 5,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	sessionID2, _ := uuid.NewV4()
	_, err = matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"+properties.foo:bar properties.b1:20^10",
		3, 3, map[string]string{
			"foo": "bar",
		},
		map[string]float64{
			"b1": 10,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	sessionID3, _ := uuid.NewV4()
	_, err = matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "c",
			SessionId: "c",
			Username:  "c",
			Node:      "c",
			SessionID: sessionID3,
		},
	}, sessionID3.String(), "",
		"+properties.foo:bar +properties.b1:<10",
		3, 3, map[string]string{
			"foo": "bar",
		},
		map[string]float64{
			"b1": 20,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	matchMaker.process(bluge.NewBatch())

	if len(matchesSeen) > 0 {
		t.Fatalf("expected no matches, got %#v", matchesSeen)
	}
}

// TestMatchmakerRequireMutualMatchLargerReversed attempts to validate
// mutual matchmaking of a larger size (3)
//
// The data is carefully arranged as follows:
//
// items B and C are given non-mutually matching data
// this means if the outer-loop ever chooses to start with B or C,
// we will fail to find a match due to mutual matching making
// ensuring we do not reach the desired size (3)
// this is not the purpose of the test, but relevant to the asserted behavior
//
// in the event item A is chosen in the outer-loop, we have designed
// the boost clauses to ensure that B comes before C in the results
// B does mutually match with A, allowing us to proceed populating the entryCombos
// however, B's query does not match C, and strict mutual matching should
// prevent this match being made
func TestMatchmakerRequireMutualMatchLargerReversed(t *testing.T) {
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
	_, err = matchMaker.Add([]*MatchmakerPresence{
		{
			UserId:    "a",
			SessionId: "a",
			Username:  "a",
			Node:      "a",
			SessionID: sessionID,
		},
	}, sessionID.String(), "",
		"+properties.foo:bar properties.b1:10^10",
		3, 3, map[string]string{
			"foo": "bar",
		},
		map[string]float64{
			"b1": 5,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	sessionID2, _ := uuid.NewV4()
	_, err = matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "b",
			SessionId: "b",
			Username:  "b",
			Node:      "b",
			SessionID: sessionID2,
		},
	}, sessionID2.String(), "",
		"+properties.foo:bar +properties.b1:<10 properties.b1:20^10",
		3, 3, map[string]string{
			"foo": "bar",
		},
		map[string]float64{
			"b1": 10,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	sessionID3, _ := uuid.NewV4()
	_, err = matchMaker.Add([]*MatchmakerPresence{
		&MatchmakerPresence{
			UserId:    "c",
			SessionId: "c",
			Username:  "c",
			Node:      "c",
			SessionID: sessionID3,
		},
	}, sessionID3.String(), "",
		"+properties.foo:bar",
		3, 3, map[string]string{
			"foo": "bar",
		},
		map[string]float64{
			"b1": 20,
		})
	if err != nil {
		t.Fatalf("error matchmaker add: %v", err)
	}

	matchMaker.process(bluge.NewBatch())

	if len(matchesSeen) > 0 {
		t.Fatalf("expected no matches, got %#v", matchesSeen)
	}
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

// *** Benchmarks

// BenchmarkMatchmakerSmallProcessAllMutual attempts to
// benchmark the Matchmaker as follows:
// - small pool (2 active)
// - min/max count 2
// - all items are a mutual match
func BenchmarkMatchmakerSmallProcessAllMutual(b *testing.B) {
	benchmarkMatchmakerHelper(b, 2, 2, 2,
		func(i int) (string, map[string]string) {
			return benchmarkMatchQueryAny, benchmarkPropsAny
		})
}

// BenchmarkMatchmakerSmallProcessSomeNotMutual attempts to
// benchmark the Matchmaker as follows:
// - small pool (2 active)
// - min/max count 2
// - approx 50% items are a mutual match
func BenchmarkMatchmakerSmallProcessSomeNotMutual(b *testing.B) {
	benchmarkMatchmakerHelper(b, 2, 2, 2,
		func(i int) (string, map[string]string) {
			matchQuery := benchmarkMatchQueryAny
			props := benchmarkPropsAny
			if i%2 == 0 {
				matchQuery = benchmarkMatchQuerySome
				props = benchmarkPropsSome
			}
			return matchQuery, props
		})
}

// BenchmarkMatchmakerMediumProcessAllMutual attempts to
// benchmark the Matchmaker as follows:
// - medium pool (100 active)
// - min/max count 2
// - all items are a mutual match
func BenchmarkMatchmakerMediumProcessAllMutual(b *testing.B) {
	benchmarkMatchmakerHelper(b, 100, 2, 2,
		func(i int) (string, map[string]string) {
			return benchmarkMatchQueryAny, benchmarkPropsAny
		})
}

// BenchmarkMatchmakerMediumProcessSomeNonMutual attempts to
// benchmark the Matchmaker as follows:
// - medium pool (100 active)
// - min/max count 2
// - approx 50% items are a mutual match
func BenchmarkMatchmakerMediumProcessSomeNonMutual(b *testing.B) {
	benchmarkMatchmakerHelper(b, 100, 2, 2,
		func(i int) (string, map[string]string) {
			matchQuery := benchmarkMatchQueryAny
			props := benchmarkPropsAny
			if i%2 == 0 {
				matchQuery = benchmarkMatchQuerySome
				props = benchmarkPropsSome
			}
			return matchQuery, props
		})
}

// BenchmarkMatchmakerProcessMediumSomeNonMutualBiggerGroup attempts to
// benchmark the Matchmaker as follows:
// - medium pool (100 active)
// - min/max count 6
// - approx 50% items are a mutual match
func BenchmarkMatchmakerProcessMediumSomeNonMutualBiggerGroup(b *testing.B) {
	benchmarkMatchmakerHelper(b, 100, 6, 6,
		func(i int) (string, map[string]string) {
			matchQuery := benchmarkMatchQueryAny
			props := benchmarkPropsAny
			if i%2 == 0 {
				matchQuery = benchmarkMatchQuerySome
				props = benchmarkPropsSome
			}
			return matchQuery, props
		})
}

// BenchmarkMatchmakerProcessMediumSomeNonMutualBiggerGroupAndDifficultMatch attempts to
// benchmark the Matchmaker as follows:
// - medium pool (100 active)
// - min/max count 6
// - docs are now in a 50/40/10 distribution
// - 50% match all, 40% match some, and 10% match few
func BenchmarkMatchmakerProcessMediumSomeNonMutualBiggerGroupAndDifficultMatch(b *testing.B) {
	benchmarkMatchmakerHelper(b, 100, 6, 6,
		func(i int) (string, map[string]string) {
			matchQuery := benchmarkMatchQueryAny
			props := benchmarkPropsAny
			if i%10 == 0 {
				matchQuery = benchmarkMatchQueryFew
				props = benchmarkPropsFew
			} else if i%2 == 0 {
				matchQuery = benchmarkMatchQuerySome
				props = benchmarkPropsSome
			}
			return matchQuery, props
		})
}

func benchmarkMatchmakerHelper(b *testing.B, activeCount, minCount, maxCount int,
	withQueryAndProps func(i int) (string, map[string]string)) {
	consoleLogger := loggerForBenchmark(b)
	matchMaker, cleanup, err := createTestMatchmaker(b, consoleLogger, nil)
	if err != nil {
		b.Fatalf("error creating test matchmaker: %v", err)
	}
	defer cleanup()

	var matchMakerAdded int
	b.ResetTimer()

	for n := 0; n < b.N; n++ {
		// ensure the matchmaker has 'activeCount' active items
		for len(matchMaker.activeIndexes) < activeCount {
			matchQuery, props := withQueryAndProps(matchMakerAdded)

			sessionID, _ := uuid.NewV4()
			_, err = matchMaker.Add([]*MatchmakerPresence{
				{
					UserId:    sessionID.String(),
					SessionId: sessionID.String(),
					Username:  sessionID.String(),
					Node:      sessionID.String(),
					SessionID: sessionID,
				},
			}, sessionID.String(), "",
				matchQuery,
				minCount, maxCount,
				props,
				map[string]float64{})
			if err != nil {
				b.Fatalf("error matchmaker add: %v", err)
			}
			matchMakerAdded++
		}

		// process matches
		matchMaker.process(bluge.NewBatch())
	}
}

var benchmarkMatchQueryAny = "+properties.a6:bar"
var benchmarkMatchQuerySome = benchmarkMatchQueryAny + " +properties.a7:foo"
var benchmarkMatchQueryFew = benchmarkMatchQuerySome + " +properties.a8:baz"
var benchmarkPropsAny = map[string]string{
	"a6": "bar",
}
var benchmarkPropsSome = map[string]string{
	"a6": "bar",
	"a7": "foo",
}
var benchmarkPropsFew = map[string]string{
	"a6": "bar",
	"a7": "foo",
	"a8": "baz",
}

func TestMatchmakerMaxPartyTracking(t *testing.T) {
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

	createTicketFunc := func(party string) error {
		sessionID, _ := uuid.NewV4()
		_, err = matchMaker.Add([]*MatchmakerPresence{
			&MatchmakerPresence{
				UserId:    sessionID.String(),
				SessionId: sessionID.String(),
				Username:  sessionID.String(),
				Node:      sessionID.String(),
				SessionID: sessionID,
			},
		}, sessionID.String(), party,
			"properties.a5:bar",
			2, 2,
			map[string]string{
				"a5": "bar",
			},
			map[string]float64{})
		if err != nil {
			return err
		}
		return nil
	}

	// create max tickets with party-a
	maxTickets := matchMaker.config.GetMatchmaker().MaxTickets
	for i := 0; i < maxTickets; i++ {
		err := createTicketFunc("party-a")
		if err != nil {
			t.Fatalf("error adding ticket: %v", err)
		}
	}

	// try to create one more ticket, expect error
	err = createTicketFunc("party-a")
	if !errors.Is(err, runtime.ErrMatchmakerTooManyTickets) {
		t.Fatalf("exected error too many tickets, got: %v", err)
	}

	// now create one with a different party, expect no error
	// also we expect it can match one of the previous
	// because it has a different party
	err = createTicketFunc("party-b")
	if err != nil {
		t.Fatalf("error adding ticket: %v", err)
	}

	// process tickets
	matchMaker.process(bluge.NewBatch())

	// expect 2 matches
	if len(matchesSeen) !=2 {
		t.Fatalf("expected 2 matches, got %d", len(matchesSeen))
	}

	// now we expect we should be able to add one more party-a ticket
	// because one was matched previously
	err = createTicketFunc("party-a")
	if err != nil {
		t.Fatalf("error adding ticket: %v", err)
	}

	// expect that adding again should fail, again hitting the max tickets
	err = createTicketFunc("party-a")
	if !errors.Is(err, runtime.ErrMatchmakerTooManyTickets) {
		t.Fatalf("exected error too many tickets, got: %v", err)
	}
}

func TestMatchmakerMaxSessionTracking(t *testing.T) {
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

	createTicketFunc := func(sessionID uuid.UUID) error {
		_, err = matchMaker.Add([]*MatchmakerPresence{
			&MatchmakerPresence{
				UserId:    sessionID.String(),
				SessionId: sessionID.String(),
				Username:  sessionID.String(),
				Node:      sessionID.String(),
				SessionID: sessionID,
			},
		}, sessionID.String(), "",
			"properties.a5:bar",
			2, 2,
			map[string]string{
				"a5": "bar",
			},
			map[string]float64{})
		if err != nil {
			return err
		}
		return nil
	}

	sessionID1, _ := uuid.NewV4()

	// create max tickets with sessionID1
	maxTickets := matchMaker.config.GetMatchmaker().MaxTickets
	for i := 0; i < maxTickets; i++ {
		err := createTicketFunc(sessionID1)
		if err != nil {
			t.Fatalf("error adding ticket: %v", err)
		}
	}

	// try to create one more ticket, expect error
	err = createTicketFunc(sessionID1)
	if !errors.Is(err, runtime.ErrMatchmakerTooManyTickets) {
		t.Fatalf("exected error too many tickets, got: %v", err)
	}

	sessionID2, _ := uuid.NewV4()

	// now create one with a different session, expect no error
	// also we expect it can match one of the previous
	// because it has a different session
	err = createTicketFunc(sessionID2)
	if err != nil {
		t.Fatalf("error adding ticket: %v", err)
	}

	// process tickets
	matchMaker.process(bluge.NewBatch())

	// expect 2 matches
	if len(matchesSeen) !=2 {
		t.Fatalf("expected 2 matches, got %d", len(matchesSeen))
	}

	// now we expect we should be able to add one more sessionID1 ticket
	// because one was matched previously
	err = createTicketFunc(sessionID1)
	if err != nil {
		t.Fatalf("error adding ticket: %v", err)
	}

	// expect that adding again should fail, again hitting the max tickets
	err = createTicketFunc(sessionID1)
	if !errors.Is(err, runtime.ErrMatchmakerTooManyTickets) {
		t.Fatalf("exected error too many tickets, got: %v", err)
	}
}
