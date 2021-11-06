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
	"context"
	"encoding/gob"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gofrs/uuid"
	"google.golang.org/protobuf/types/known/wrapperspb"

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

// should create authoritative match, and join with metadata
func TestMatchRegistryAuthoritativeMatchAndJoin(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	res, err := matchRegistry.CreateMatch(context.Background(), consoleLogger,
		runtimeMatchCreateFunc, "match", map[string]interface{}{})
	if err != nil {
		t.Fatal(err)
	}

	userID, _ := uuid.NewV4()
	sessionID, _ := uuid.NewV4()
	matchID, err := matchUUIDFromString(res)
	if err != nil {
		t.Fatal(err)
	}
	found, accepted, _, _, _, _ := matchRegistry.JoinAttempt(context.Background(), matchID, "node", userID,
		sessionID, "username", 0, map[string]string{}, "clientIP", "clientPort",
		"fromNode", map[string]string{})
	if !found {
		t.Fatalf("expected match to be found, was not")
	}
	if !accepted {
		t.Fatalf("expected join to be accepted, was not")
	}
}

// should create authoritative match, list matches without querying
func TestMatchRegistryAuthoritativeMatchAndListMatches(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	_, err = matchRegistry.CreateMatch(context.Background(), consoleLogger,
		runtimeMatchCreateFunc, "match", map[string]interface{}{})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(5 * time.Second)

	matches, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5), wrapperspb.String(""))
	if len(matches) != 1 {
		t.Fatalf("expected one match, got %d", len(matches))
	}
	matchZero := matches[0]
	if matchZero.MatchId == "" {
		t.Fatalf("expected non-empty  match id, was empty")
	}
	if !matchZero.Authoritative {
		t.Fatalf("expected authoritative match, got non-authoritative")
	}
}

// should create authoritative match, list matches with querying
func TestMatchRegistryAuthoritativeMatchAndListMatchesWithQuerying(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	_, err = matchRegistry.CreateMatch(context.Background(), consoleLogger,
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": `{"skill":60}`,
		})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(5 * time.Second)

	matches, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5),
		wrapperspb.String("+label.skill:>=50"))
	if len(matches) != 1 {
		t.Fatalf("expected one match, got %d", len(matches))
	}
	matchZero := matches[0]
	if matchZero.MatchId == "" {
		t.Fatalf("expected non-empty  match id, was empty")
	}
	if !matchZero.Authoritative {
		t.Fatalf("expected authoritative match, got non-authoritative")
	}
}

// should create authoritative match, list matches with querying arrays
func TestMatchRegistryAuthoritativeMatchAndListMatchesWithQueryingArrays(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	convoID1, _ := uuid.NewV4()
	convoID2, _ := uuid.NewV4()
	convoID3, _ := uuid.NewV4()

	_, err = matchRegistry.CreateMatch(context.Background(), consoleLogger,
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": fmt.Sprintf(`{"convo_ids": ["%s", "%s", "%s"]}`, convoID1, convoID2, convoID3),
		})
	if err != nil {
		t.Fatal(err)
	}

	time.Sleep(5 * time.Second)

	matches, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5),
		wrapperspb.String(fmt.Sprintf("+label.convo_ids:%s", convoID2)))
	if len(matches) != 1 {
		t.Fatalf("expected one match, got %d", len(matches))
	}
	matchZero := matches[0]
	if matchZero.MatchId == "" {
		t.Fatalf("expected non-empty  match id, was empty")
	}
	if !matchZero.Authoritative {
		t.Fatalf("expected authoritative match, got non-authoritative")
	}
}

func matchUUIDFromString(matchIDString string) (uuid.UUID, error) {
	matchIDComponents := strings.SplitN(matchIDString, ".", 2)
	if len(matchIDComponents) != 2 {
		return uuid.Nil, fmt.Errorf("error splitting uuui.host")
	}
	return uuid.FromString(matchIDComponents[0])
}
