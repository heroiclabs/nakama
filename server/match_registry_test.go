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
	"github.com/blugelabs/bluge"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/stretchr/testify/require"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"strings"
	"testing"
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

func TestEncodeDecode(t *testing.T) {
	entries := []runtime.MatchmakerEntry{
		&MatchmakerEntry{Ticket: "123", Presence: &MatchmakerPresence{Username: "a"}},
		&MatchmakerEntry{Ticket: "456", Presence: &MatchmakerPresence{Username: "b"}},
	}
	params := map[string]interface{}{
		"invited": entries,
	}
	buf := &bytes.Buffer{}
	if err := gob.NewEncoder(buf).Encode(params); err != nil {
		t.Fatalf("error: %v", err)
	}
	if err := gob.NewDecoder(buf).Decode(&params); err != nil {
		t.Fatalf("error: %v", err)
	}
	t.Log("ok")
}

func TestEncodeDecodePresences(t *testing.T) {
	presences := []runtime.Presence{
		&Presence{
			ID: PresenceID{
				Node:      "nakama",
				SessionID: uuid.Must(uuid.NewV4()),
			},
			Stream: PresenceStream{
				Mode:    StreamModeMatchAuthoritative,
				Subject: uuid.Must(uuid.NewV4()),
				Label:   "nakama",
			},
			UserID: uuid.Must(uuid.NewV4()),
			Meta: PresenceMeta{
				Username: "username1",
			},
		},
		&Presence{
			ID: PresenceID{
				Node:      "nakama",
				SessionID: uuid.Must(uuid.NewV4()),
			},
			Stream: PresenceStream{
				Mode:    StreamModeMatchAuthoritative,
				Subject: uuid.Must(uuid.NewV4()),
				Label:   "nakama",
			},
			UserID: uuid.Must(uuid.NewV4()),
			Meta: PresenceMeta{
				Username: "username2",
			},
		},
	}
	params := map[string]interface{}{
		"presences": presences,
	}
	buf := &bytes.Buffer{}
	if err := gob.NewEncoder(buf).Encode(params); err != nil {
		t.Fatalf("error: %v", err)
	}
	if err := gob.NewDecoder(buf).Decode(&params); err != nil {
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

	res, err := matchRegistry.CreateMatch(context.Background(),
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

	_, err = matchRegistry.CreateMatch(context.Background(),
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": "label",
		})
	if err != nil {
		t.Fatal(err)
	}

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	matches, _, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5), nil, nil)
	require.NoError(t, err)
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

// should create authoritative match, list matches with particular label
// the label is chosen to be something which might tokenize into multiple
// terms, if a tokenizer is incorrectly applied
func TestMatchRegistryAuthoritativeMatchAndListMatchesWithTokenizableLabel(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	_, err = matchRegistry.CreateMatch(context.Background(),
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": "label-part2",
		})
	if err != nil {
		t.Fatal(err)
	}

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	matches, _, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label-part2"), wrapperspb.Int32(0), wrapperspb.Int32(5), nil, nil)
	require.NoError(t, err)
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

	_, err = matchRegistry.CreateMatch(context.Background(),
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": `{"skill":60}`,
		})
	if err != nil {
		t.Fatal(err)
	}

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	matches, _, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5),
		wrapperspb.String("+label.skill:>=50"), nil)
	require.NoError(t, err)
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

// should create authoritative match, list matches with query *
func TestMatchRegistryAuthoritativeMatchAndListAllMatchesWithQueryStar(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	_, err = matchRegistry.CreateMatch(context.Background(),
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": `{"skill":60}`,
		})
	if err != nil {
		t.Fatal(err)
	}

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	matches, _, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5),
		wrapperspb.String("*"), nil)
	require.NoError(t, err)
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

	_, err = matchRegistry.CreateMatch(context.Background(),
		runtimeMatchCreateFunc, "match", map[string]interface{}{
			"label": fmt.Sprintf(`{"convo_ids": ["%s", "%s", "%s"]}`, convoID1, convoID2, convoID3),
		})
	if err != nil {
		t.Fatal(err)
	}

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	matches, _, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5),
		wrapperspb.String(fmt.Sprintf("+label.convo_ids:%s", convoID2)), nil)
	require.NoError(t, err)
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

// Tests that match can be queried by updated labels
func TestMatchRegistryListMatchesAfterLabelsUpdate(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	var rgmc *RuntimeGoMatchCore

	matchCreateWrapper := func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
		rmc, err := runtimeMatchCreateFunc(ctx, logger, id, node, stopped, name)
		if err != nil {
			return nil, err
		}
		rgmc = rmc.(*RuntimeGoMatchCore)
		return rmc, nil
	}

	_, err = matchRegistry.CreateMatch(context.Background(), matchCreateWrapper, "match", nil)
	if err != nil {
		t.Fatal(err)
	}

	err = rgmc.MatchLabelUpdate(`{"updated_label": 1}`)
	require.NoError(t, err)

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	matches, _, err := matchRegistry.ListMatches(context.Background(), 2, wrapperspb.Bool(true),
		nil, wrapperspb.Int32(0), wrapperspb.Int32(5),
		wrapperspb.String(`label.updated_label:1`), nil)
	require.NoError(t, err)
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
func TestMatchRegistryAuthoritativeMatchAndListMatchesWithQueryingAndBoost(t *testing.T) {
	consoleLogger := loggerForTest(t)
	matchRegistry, runtimeMatchCreateFunc, err := createTestMatchRegistry(t, consoleLogger)
	if err != nil {
		t.Fatalf("error creating test match registry: %v", err)
	}
	defer matchRegistry.Stop(0)

	matchLabels := []string{
		`{"foo": 5, "bar": 1, "option": "a", "baz": 4}`,
		`{"foo": 5, "bar": 1, "option": "b", "baz": 4}`,
		`{"foo": 5, "bar": 1, "option": "a", "baz": 3}`,
		`{"foo": 5, "bar": 1, "option": "b", "baz": 3}`,
		`{"foo": 5, "bar": 1, "option": "a", "baz": 2}`,
		`{"foo": 5, "bar": 1, "option": "b", "baz": 2}`,
		`{"foo": 5, "bar": 1, "option": "a", "baz": 1}`,
		`{"foo": 5, "bar": 1, "option": "b", "baz": 1}`,
		`{"foo": 5, "bar": 1, "option": "a", "baz": 0}`,
		`{"foo": 5, "bar": 1, "option": "b", "baz": 0}`,
	}

	// create all matches
	for _, matchLabel := range matchLabels {
		_, err = matchRegistry.CreateMatch(context.Background(),
			runtimeMatchCreateFunc, "match", map[string]interface{}{
				"label": matchLabel,
			})
		if err != nil {
			t.Fatal(err)
		}
	}

	matchRegistry.processLabelUpdates(bluge.NewBatch())

	tests := []struct {
		name         string
		query        string
		total        int
		labelMatches map[int]string
	}{
		{
			// query should find all matches, with baz 4 in first 2 positions
			// and baz 2 in next 2 positions
			// we can only match on the baz value, not the entire string, because order
			// is not imposed over the option a/b
			name:  "exact numeric boost",
			query: "+label.foo:5 +label.bar:1 label.baz:4^10 label.baz:2^5",
			total: 10,
			labelMatches: map[int]string{
				0: `"baz": 4`,
				1: `"baz": 4`,
				2: `"baz": 2`,
				3: `"baz": 2`,
			},
		},
		{
			// this variant introduces a required text match (bm25 scoring)
			// query should find only option a, with baz 4 in first position
			// and baz 2 in next position
			name:  "exact numeric boost with required text match",
			query: "+label.foo:5 +label.bar:1 +label.option:a label.baz:4^10 label.baz:2^5",
			total: 5,
			labelMatches: map[int]string{
				0: matchLabels[0],
				1: matchLabels[4],
			},
		},
		{
			// this variant makes the text match (bm25 scoring) optional
			// query should find all matches, with baz 4 in first 2 positions
			// and baz 2 in next 2 positions
			name:  "exact numeric boost with optional text match",
			query: "+label.foo:5 +label.bar:1 label.option:a label.baz:4^10 label.baz:2^5",
			total: 10,
			labelMatches: map[int]string{
				0: matchLabels[0],
				1: matchLabels[1],
				2: matchLabels[4],
				3: matchLabels[5],
			},
		},
	}

	for _, test := range tests {
		test := test

		t.Run(test.name, func(t *testing.T) {
			matches, _, err := matchRegistry.ListMatches(context.Background(), 10, wrapperspb.Bool(true),
				wrapperspb.String("label"), wrapperspb.Int32(0), wrapperspb.Int32(5),
				wrapperspb.String(test.query), nil)
			if err != nil {
				t.Fatalf("error listing matches: %v", err)
			}
			if len(matches) != test.total {
				t.Fatalf("expected %d match, got %d", test.total, len(matches))
			}

			for labelMatchI, labelMatch := range test.labelMatches {
				if !strings.Contains(matches[labelMatchI].Label.Value, labelMatch) {
					for i, match := range matches {
						t.Errorf("%d match: %s label: %s", i, match.MatchId, match.Label)
					}
					t.Fatalf("results in wrong order")
				}
			}
		})
	}
}

func matchUUIDFromString(matchIDString string) (uuid.UUID, error) {
	matchIDComponents := strings.SplitN(matchIDString, ".", 2)
	if len(matchIDComponents) != 2 {
		return uuid.Nil, fmt.Errorf("error splitting uuui.host")
	}
	return uuid.FromString(matchIDComponents[0])
}
