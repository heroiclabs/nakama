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

package server

import (
	"errors"
	"sync"
)

type Matchmaker interface {
	Add(sessionID string, userID string, requestProfile *MatchmakerProfile) (string, map[MatchmakerKey]*MatchmakerProfile, []*MatchmakerAcceptedProperty)
	Remove(sessionID string, userID string, ticket string) error
	RemoveAll(sessionID string)
	UpdateAll(sessionID string, meta PresenceMeta)
}

type Filter int

const (
	BOOL Filter = iota
	RANGE
	TERM
)

type MatchmakerFilter interface {
	Type() Filter
}

type MatchmakerTermFilter struct {
	Terms    []string
	AllTerms bool // set to False for Any Term
}

func (*MatchmakerTermFilter) Type() Filter {
	return TERM
}

type MatchmakerRangeFilter struct {
	LowerBound int64
	UpperBound int64
}

func (*MatchmakerRangeFilter) Type() Filter {
	return RANGE
}

type MatchmakerBoolFilter struct {
	Value bool
}

func (*MatchmakerBoolFilter) Type() Filter {
	return BOOL
}

type MatchmakerAcceptedProperty struct {
	UserID     string
	Properties map[string]interface{}
	Filters    map[string]MatchmakerFilter
}

type MatchmakerKey struct {
	ID     PresenceID
	UserID string
	Ticket string
}

type MatchmakerProfile struct {
	Meta          PresenceMeta
	RequiredCount int
	Properties    map[string]interface{}
	Filters       map[string]MatchmakerFilter
}

type MatchmakerService struct {
	sync.Mutex
	name   string
	values map[MatchmakerKey]*MatchmakerProfile
}

func NewMatchmakerService(name string) *MatchmakerService {
	return &MatchmakerService{
		name:   name,
		values: make(map[MatchmakerKey]*MatchmakerProfile),
	}
}

func (m *MatchmakerService) Add(sessionID string, userID string, incomingProfile *MatchmakerProfile) (string, map[MatchmakerKey]*MatchmakerProfile, []*MatchmakerAcceptedProperty) {
	ticket := generateNewId()
	candidates := make(map[MatchmakerKey]*MatchmakerProfile, incomingProfile.RequiredCount-1)
	requestKey := MatchmakerKey{ID: PresenceID{SessionID: sessionID, Node: m.name}, UserID: userID, Ticket: ticket}

	m.Lock()
	defer m.Unlock()

	// find list of suitable candidates
	for key, profile := range m.values {
		// if queued users match the current user, then skip
		if key.ID.SessionID == sessionID || key.UserID == userID {
			continue
		}

		// compatible with the request's filter
		if !m.checkFilter(incomingProfile, profile) {
			continue
		}

		// compatible with the profile's filter
		if !m.checkFilter(profile, incomingProfile) {
			continue
		}

		candidates[key] = profile
	}

	// cross match all previously selected profiles
	// to see if they are compatible with each other as well
	matches := m.crossmatchCandidates(candidates, incomingProfile.RequiredCount-1)

	// not enough profiles, bail out early
	if len(matches) < int(incomingProfile.RequiredCount-1) {
		m.values[requestKey] = incomingProfile
		return ticket, nil, nil
	}

	// remove the matched profiles from the queue
	for mk, _ := range matches {
		delete(m.values, mk)
	}

	// add the incoming profile to the final list
	matches[requestKey] = incomingProfile

	return ticket, matches, m.calculateAcceptedProperties(matches)
}

func (m *MatchmakerService) crossmatchCandidates(candidates map[MatchmakerKey]*MatchmakerProfile, requiredCount int) map[MatchmakerKey]*MatchmakerProfile {
	if requiredCount == 0 {
		return map[MatchmakerKey]*MatchmakerProfile{}
	}

	if requiredCount > len(candidates) {
		return nil
	}

	keys := make([]MatchmakerKey, 0)
	values := make([]*MatchmakerProfile, 0)
	for key, value := range candidates {
		keys = append(keys, key)
		values = append(values, value)
	}

	for i := 0; i < len(keys); i++ {
		s := values[i]
		tempCandidates := make(map[MatchmakerKey]*MatchmakerProfile, 0)
		for j := i + 1; j < len(keys); j++ {
			p := values[j]
			if m.checkFilter(s, p) && m.checkFilter(p, s) {
				tempCandidates[keys[j]] = p
			}
		}

		findCandidateResult := m.crossmatchCandidates(tempCandidates, requiredCount-1)
		if findCandidateResult != nil {
			findCandidateResult[keys[i]] = s
			return findCandidateResult
		}
	}
	return nil
}

func (m *MatchmakerService) checkFilter(requestProfile, queuedProfile *MatchmakerProfile) bool {
	if queuedProfile.RequiredCount != requestProfile.RequiredCount {
		return false
	}

	for filterName, filter := range requestProfile.Filters {
		propertyValue := queuedProfile.Properties[filterName]
		if propertyValue == nil {
			return false
		}

		if filter.Type() == TERM {
			termFilter := filter.(*MatchmakerTermFilter)
			propertyTermList, ok := propertyValue.([]string)
			if !ok {
				return false
			}

			matchingTerms := m.intersection(termFilter.Terms, propertyTermList)
			if len(matchingTerms) == 0 {
				return false
			}

			if termFilter.AllTerms && len(matchingTerms) != len(termFilter.Terms) {
				return false
			}
		} else if filter.Type() == RANGE {
			rangeFilter := filter.(*MatchmakerRangeFilter)
			propertyInt, ok := propertyValue.(int64)

			if !ok || propertyInt < rangeFilter.LowerBound || propertyInt > rangeFilter.UpperBound {
				return false
			}
		} else if filter.Type() == BOOL {
			boolFilter := filter.(*MatchmakerBoolFilter)
			propertyBool, ok := propertyValue.(bool)
			if !ok || boolFilter.Value != propertyBool {
				return false
			}
		}
	}

	return true
}

func (m *MatchmakerService) calculateAcceptedProperties(matched map[MatchmakerKey]*MatchmakerProfile) []*MatchmakerAcceptedProperty {
	props := make([]*MatchmakerAcceptedProperty, 0)
	for key, profile := range matched {
		prop := &MatchmakerAcceptedProperty{
			UserID:     key.UserID,
			Properties: profile.Properties,
			Filters:    profile.Filters,
		}
		props = append(props, prop)
	}

	return props
}

func (m *MatchmakerService) intersection(a, b []string) []string {
	o := make([]string, 0)
	for i := range a {
		for j := range b {
			if a[i] == b[j] {
				o = append(o, a[i])
				break
			}
		}
	}
	return o
}

func (m *MatchmakerService) Remove(sessionID string, userID string, ticket string) error {
	mk := MatchmakerKey{ID: PresenceID{SessionID: sessionID, Node: m.name}, UserID: userID, Ticket: ticket}
	var e error

	m.Lock()
	_, ok := m.values[mk]
	if ok {
		delete(m.values, mk)
	} else {
		e = errors.New("ticket not found")
	}
	m.Unlock()

	return e
}

func (m *MatchmakerService) RemoveAll(sessionID string) {
	m.Lock()
	for mk, _ := range m.values {
		if mk.ID.SessionID == sessionID {
			delete(m.values, mk)
		}
	}
	m.Unlock()
}

func (m *MatchmakerService) UpdateAll(sessionID string, meta PresenceMeta) {
	m.Lock()
	for mk, mp := range m.values {
		if mk.ID.SessionID == sessionID {
			mp.Meta = meta
		}
	}
	m.Unlock()
}
