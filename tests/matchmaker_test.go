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

package tests

import (
	"nakama/server"
	"testing"

	"sort"

	"github.com/satori/go.uuid"
)

var matchmaker server.Matchmaker

func newMatchmaker() {
	matchmaker = server.NewMatchmakerService("test_node")
}

func add(props map[string]interface{}, filters map[string]server.MatchmakerFilter) (string, map[server.MatchmakerKey]*server.MatchmakerProfile, []*server.MatchmakerAcceptedProperty) {
	return addRequest(2, props, filters)
}

func addRequest(count int, props map[string]interface{}, filters map[string]server.MatchmakerFilter) (string, map[server.MatchmakerKey]*server.MatchmakerProfile, []*server.MatchmakerAcceptedProperty) {
	userID := uuid.NewV4().String()
	profile := &server.MatchmakerProfile{
		Meta:          server.PresenceMeta{Handle: userID, Format: server.SessionFormatProtobuf},
		RequiredCount: count,
		Properties:    props,
		Filters:       filters,
	}
	_, m, p := matchmaker.Add(uuid.NewV4().String(), userID, profile)
	return userID, m, p
}

// Two users, both having the same required count and no other filters
func TestMatchmakeOnlyRequiredCount(t *testing.T) {
	newMatchmaker()

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, nil)
	if matched != nil || matchedCriteria != nil {
		t.Fatal("Somehow found matches with a new matchmaker!")
	}

	_, matched, matchedCriteria = add(map[string]interface{}{
		"rank":  int64(12),
		"modes": []string{"tdm"},
	}, nil)
	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 2 {
		t.Fatal("Matchmaking did not matched expected result")
	}
}

// Two users, both having the same required count
// and both with range filters that match each other
func TestMatchmakeRange(t *testing.T) {
	newMatchmaker()

	profile1id, _, _ := add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{8, 12},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(12),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{10, 14},
	})

	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 2 {
		t.Fatal("Matchmaking did not matched expected result")
	}

	// make sure data is sorted
	sort.Slice(matchedCriteria, func(i, j int) bool { return matchedCriteria[i].UserID == profile1id })

	p := matchedCriteria[0].Properties
	if p["rank"] != int64(10) {
		t.Fatal("Profile 1 rank does not match")
	}

	p = matchedCriteria[1].Properties
	if p["rank"] != int64(12) {
		t.Fatal("Profile 2 rank does not match")
	}
}

// Two users, both having the same required count
// and both with ANY terms filters that match each other
func TestMatchmakeAnyTerms(t *testing.T) {
	newMatchmaker()

	profile1id, _, _ := add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, false},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(12),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm"}, false},
	})

	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 2 {
		t.Fatal("Matchmaking did not matched expected result")
	}

	// make sure data is sorted
	sort.Slice(matchedCriteria, func(i, j int) bool { return matchedCriteria[i].UserID == profile1id })

	p := matchedCriteria[0].Properties
	pt := p["modes"].([]string)
	if len(pt) != 2 {
		t.Fatal("Profile 1 modes does not match")
	}

	p = matchedCriteria[1].Properties
	pt = p["modes"].([]string)
	if pt[0] != "tdm" || len(pt) != 1 {
		t.Fatal("Profile 2 modes does not match")
	}
}

// Two users, both having the same required count
// and both with ALL terms filters that DON'T match each other
func TestMatchmakeAllTerms1(t *testing.T) {
	newMatchmaker()

	add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, true},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(12),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm"}, false},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}
}

// Two users, both having the same required count
// and both with terms filters that DO match each other
// reversed term filters
func TestMatchmakeAllTerms2(t *testing.T) {
	newMatchmaker()

	profile1id, _, _ := add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, false},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(12),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm"}, true},
	})

	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 2 {
		t.Fatal("Matchmaking did not matched expected result")
	}

	// make sure data is sorted
	sort.Slice(matchedCriteria, func(i, j int) bool { return matchedCriteria[i].UserID == profile1id })

	p := matchedCriteria[0].Properties
	pt := p["modes"].([]string)
	if len(pt) != 2 {
		t.Fatal("Profile 1 modes does not match")
	}

	p = matchedCriteria[1].Properties
	pt = p["modes"].([]string)
	if pt[0] != "tdm" || len(pt) != 1 {
		t.Fatal("Profile 2 modes does not match")
	}
}

func TestMatchmakeBoolFalse(t *testing.T) {
	newMatchmaker()

	add(map[string]interface{}{
		"rank":   int64(10),
		"modes":  []string{"tdm", "s-d"},
		"ranked": true,
	}, map[string]server.MatchmakerFilter{
		"ranked": &server.MatchmakerBoolFilter{true},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":   int64(12),
		"modes":  []string{"tdm"},
		"ranked": false,
	}, map[string]server.MatchmakerFilter{
		"ranked": &server.MatchmakerBoolFilter{false},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}
}

func TestMatchmakeUnmatchingRange(t *testing.T) {
	newMatchmaker()

	add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{8, 12},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(5),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{10, 14},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}
}

func TestMatchmakeUnmatchingAllTerms(t *testing.T) {
	newMatchmaker()

	add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, true},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(5),
		"modes": []string{"tdm", "s-d", "ffa"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d", "ffa"}, true},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}

	newMatchmaker()

	add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d", "ffa"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d", "ffa"}, true},
	})

	_, matched, matchedCriteria = add(map[string]interface{}{
		"rank":  int64(5),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, true},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}

	newMatchmaker()

	add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, false},
	})

	_, matched, matchedCriteria = add(map[string]interface{}{
		"rank":  int64(5),
		"modes": []string{"tdm", "s-d", "ffa"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d", "ffa"}, true},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}
}

func TestMatchmakeUnmatchingMissingProperties(t *testing.T) {
	// missing rank property
	newMatchmaker()
	add(map[string]interface{}{
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{8, 12},
	})

	_, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(5),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{10, 14},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}

	// missing modes
	newMatchmaker()
	add(map[string]interface{}{
		"rank": int64(10),
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d", "ffa"}, true},
	})

	_, matched, matchedCriteria = add(map[string]interface{}{
		"rank":  int64(5),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, true},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}

	// missing modes - reversed
	newMatchmaker()
	add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm", "s-d", "ffa"},
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d", "ffa"}, true},
	})

	_, matched, matchedCriteria = add(map[string]interface{}{
		"rank": int64(5),
	}, map[string]server.MatchmakerFilter{
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, true},
	})

	if matched != nil || matchedCriteria != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}
}

func TestMatchmakeMultipleProfile(t *testing.T) {
	newMatchmaker()
	profile1, _, _ := add(map[string]interface{}{
		"rank":  int64(10),
		"modes": []string{"tdm"},
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{10, 14},
		// not matching on "modes"
	})

	_, matched, _ := add(map[string]interface{}{
		"rank": int64(8),
	}, map[string]server.MatchmakerFilter{
		"rank": &server.MatchmakerRangeFilter{10, 14},
	})
	if matched != nil {
		t.Fatal("Expected Matchmaking to fail but found with unexpected results")
	}

	profile3, matched, matchedCriteria := add(map[string]interface{}{
		"rank":  int64(11),
		"modes": []string{"tdm", "s-d"},
	}, map[string]server.MatchmakerFilter{
		"rank":  &server.MatchmakerRangeFilter{8, 12},
		"modes": &server.MatchmakerTermFilter{[]string{"tdm", "s-d"}, false},
	})

	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 2 {
		t.Fatal("Matchmaking did not matched expected result")
	}

	// make sure data is sorted
	sort.Slice(matchedCriteria, func(i, j int) bool { return matchedCriteria[i].UserID == profile1 })

	if matchedCriteria[1].UserID == profile1 || matchedCriteria[0].UserID == profile3 {
		t.Fatal("Matchmaking did not matched expected result - wrong matches")
	}

	p := matchedCriteria[0].Properties
	pt := p["modes"].([]string)
	if pt[0] != "tdm" || len(pt) != 1 {
		t.Fatal("Profile 1 modes does not match")
	}

	if p["rank"].(int64) != 10 {
		t.Fatal("Profile 1 rank does not match")
	}

	p = matchedCriteria[1].Properties
	pt = p["modes"].([]string)
	if len(pt) != 2 {
		t.Fatal("Profile 2 modes does not match")
	}

	if p["rank"].(int64) != 11 {
		t.Fatal("Profile 2 rank does not match")
	}
}

func TestMatchmakeMultiFilter(t *testing.T) {
	newMatchmaker()
	profile1, _, _ := add(map[string]interface{}{
		"rank":      int64(10),
		"modes":     []string{"tdm", "ffa"},
		"divisions": []string{"silver1"},
	}, map[string]server.MatchmakerFilter{
		"rank":      &server.MatchmakerRangeFilter{10, 15},
		"modes":     &server.MatchmakerTermFilter{[]string{"tdm", "ffa"}, false},
		"divisions": &server.MatchmakerTermFilter{[]string{"bronze3", "silver1", "silver2"}, false},
	})

	profile2, matched, matchedCriteria := add(map[string]interface{}{
		"rank":      int64(10),
		"modes":     []string{"tdm", "ffa"},
		"divisions": []string{"bronze3"},
	}, map[string]server.MatchmakerFilter{
		"rank":      &server.MatchmakerRangeFilter{8, 12},
		"modes":     &server.MatchmakerTermFilter{[]string{"tdm", "ffa"}, false},
		"divisions": &server.MatchmakerTermFilter{[]string{"bronze2", "bronze3", "silver1"}, false},
	})

	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 2 {
		t.Fatal("Matchmaking did not matched expected result")
	}

	// make sure data is sorted
	sort.Slice(matchedCriteria, func(i, j int) bool { return matchedCriteria[i].UserID == profile1 })

	if matchedCriteria[1].UserID == profile1 || matchedCriteria[0].UserID == profile2 {
		t.Fatal("Matchmaking did not matched expected result - wrong matches")
	}

	p := matchedCriteria[0].Properties
	if p["rank"].(int64) != int64(10) {
		t.Fatal("Profile 1 rank does not match")
	}

	p = matchedCriteria[1].Properties
	if p["rank"].(int64) != int64(10) {
		t.Fatal("Profile 2 rank does not match")
	}
}

func TestMatchmakeMultiFilterMultiuser(t *testing.T) {
	newMatchmaker()
	addRequest(3, map[string]interface{}{
		"rank":      int64(12),
		"modes":     []string{"tdm", "ffa"},
		"divisions": []string{"silver1"},
	}, map[string]server.MatchmakerFilter{
		"rank":      &server.MatchmakerRangeFilter{10, 15},
		"modes":     &server.MatchmakerTermFilter{[]string{"tdm", "ffa"}, false},
		"divisions": &server.MatchmakerTermFilter{[]string{"bronze3", "silver1", "silver2"}, false},
	})

	addRequest(3, map[string]interface{}{
		"rank":      int64(11),
		"modes":     []string{"tdm", "ffa"},
		"divisions": []string{"bronze3"},
	}, map[string]server.MatchmakerFilter{
		"rank":      &server.MatchmakerRangeFilter{8, 12},
		"modes":     &server.MatchmakerTermFilter{[]string{"tdm", "ffa"}, false},
		"divisions": &server.MatchmakerTermFilter{[]string{"bronze2", "bronze3", "silver1"}, false},
	})

	//unmatching profile
	addRequest(2, map[string]interface{}{
		"rank":      int64(50),
		"modes":     []string{"ffa"},
		"divisions": []string{"gold1"},
	}, map[string]server.MatchmakerFilter{
		"rank":      &server.MatchmakerRangeFilter{8, 12},
		"modes":     &server.MatchmakerTermFilter{[]string{"tdm", "ffa"}, false},
		"divisions": &server.MatchmakerTermFilter{[]string{"bronze3", "silver1", "silver2"}, false},
	})

	_, matched, matchedCriteria := addRequest(3, map[string]interface{}{
		"rank":      int64(10),
		"modes":     []string{"tdm"},
		"divisions": []string{"silver1"},
	}, map[string]server.MatchmakerFilter{
		"rank":      &server.MatchmakerRangeFilter{8, 12},
		"modes":     &server.MatchmakerTermFilter{[]string{"tdm", "ffa"}, false},
		"divisions": &server.MatchmakerTermFilter{[]string{"bronze2", "bronze3", "silver1"}, false},
	})

	if matched == nil || matchedCriteria == nil {
		t.Fatal("Matchmaking failed with nil result")
	}

	if len(matched) != 3 {
		t.Fatal("Matchmaking did not matched expected result")
	}
}
