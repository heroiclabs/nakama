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

type PresenceID struct {
	Node      string
	SessionID string
}

type PresenceMeta struct {
	Handle string
	Format SessionFormat
}

type Presence struct {
	ID     PresenceID
	Topic  string
	UserID string
	Meta   PresenceMeta
}

type Tracker interface {
	AddDiffListener(func([]Presence, []Presence))
	Stop()

	// Track a presence. Returns `true` if it was a new presence, `false` otherwise.
	Track(sessionID string, topic string, userID string, meta PresenceMeta) bool
	Untrack(sessionID string, topic string, userID string)
	UntrackAll(sessionID string)
	Update(sessionID string, topic string, userID string, meta PresenceMeta) error
	UpdateAll(sessionID string, meta PresenceMeta)

	// Get current total number of presences.
	Count() int
	// Check if a single presence on the current node exists.
	CheckLocalByIDTopicUser(sessionID string, topic string, userID string) bool
	// List presences by topic.
	ListByTopic(topic string) []Presence
	// List presences on the current node by topic.
	ListLocalByTopic(topic string) []Presence
	// List presences by topic and user ID.
	ListByTopicUser(topic string, userID string) []Presence
}

type presenceCompact struct {
	ID     PresenceID
	Topic  string // The presence topic.
	UserID string // The user ID.
}

type TrackerService struct {
	sync.RWMutex
	name          string
	diffListeners []func([]Presence, []Presence)
	values        map[presenceCompact]PresenceMeta
}

func NewTrackerService(name string) *TrackerService {
	return &TrackerService{
		name:          name,
		diffListeners: make([]func([]Presence, []Presence), 0),
		values:        make(map[presenceCompact]PresenceMeta),
	}
}

func (t *TrackerService) AddDiffListener(f func([]Presence, []Presence)) {
	t.Lock()
	t.diffListeners = append(t.diffListeners, f)
	t.Unlock()
}

func (t *TrackerService) Stop() {
	// TODO cleanup after service shutdown.
}

func (t *TrackerService) Track(sessionID string, topic string, userID string, meta PresenceMeta) bool {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Topic: topic, UserID: userID}
	t.Lock()
	_, alreadyTracked := t.values[pc]
	if !alreadyTracked {
		t.values[pc] = meta
		t.notifyDiffListeners(
			[]Presence{
				Presence{ID: pc.ID, Topic: topic, UserID: userID, Meta: meta},
			},
			[]Presence{},
		)
	}
	t.Unlock()
	return !alreadyTracked
}

func (t *TrackerService) Untrack(sessionID string, topic string, userID string) {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Topic: topic, UserID: userID}
	t.Lock()
	meta, ok := t.values[pc]
	if ok {
		delete(t.values, pc)
		t.notifyDiffListeners(
			[]Presence{},
			[]Presence{
				Presence{ID: pc.ID, Topic: topic, UserID: userID, Meta: meta},
			},
		)
	}
	t.Unlock()
}

func (t *TrackerService) UntrackAll(sessionID string) {
	ps := make([]Presence, 0)
	t.Lock()
	for pc, m := range t.values {
		if pc.ID.SessionID == sessionID {
			ps = append(ps, Presence{ID: pc.ID, Topic: pc.Topic, UserID: pc.UserID, Meta: m})
		}
	}
	if len(ps) != 0 {
		for _, p := range ps {
			delete(t.values, presenceCompact{ID: p.ID, Topic: p.Topic, UserID: p.UserID})
		}
		t.notifyDiffListeners(
			[]Presence{},
			ps,
		)
	}
	t.Unlock()
}

func (t *TrackerService) Update(sessionID string, topic string, userID string, meta PresenceMeta) error {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Topic: topic, UserID: userID}
	var e error
	t.Lock()
	m, ok := t.values[pc]
	if ok {
		t.values[pc] = meta
		t.notifyDiffListeners(
			[]Presence{
				Presence{ID: pc.ID, Topic: topic, UserID: userID, Meta: meta},
			},
			[]Presence{
				Presence{ID: pc.ID, Topic: topic, UserID: userID, Meta: m},
			},
		)
	} else {
		e = errors.New("no existing presence")
	}
	t.Unlock()
	return e
}

func (t *TrackerService) UpdateAll(sessionID string, meta PresenceMeta) {
	joins := make([]Presence, 0)
	leaves := make([]Presence, 0)
	t.Lock()
	for pc, m := range t.values {
		if pc.ID.SessionID == sessionID {
			joins = append(joins, Presence{ID: pc.ID, Topic: pc.Topic, UserID: pc.UserID, Meta: meta})
			leaves = append(leaves, Presence{ID: pc.ID, Topic: pc.Topic, UserID: pc.UserID, Meta: m})
		}
	}
	if len(joins) != 0 {
		for _, p := range joins {
			t.values[presenceCompact{ID: p.ID, Topic: p.Topic, UserID: p.UserID}] = p.Meta
		}
		t.notifyDiffListeners(
			joins,
			leaves,
		)
	}
	t.Unlock()
}

func (t *TrackerService) Count() int {
	var count int
	t.RLock()
	count = len(t.values)
	t.RUnlock()
	return count
}

func (t *TrackerService) CheckLocalByIDTopicUser(sessionID string, topic string, userID string) bool {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Topic: topic, UserID: userID}
	t.RLock()
	_, ok := t.values[pc]
	t.RUnlock()
	return ok
}

func (t *TrackerService) ListByTopic(topic string) []Presence {
	ps := make([]Presence, 0)
	t.RLock()
	for pc, m := range t.values {
		if pc.Topic == topic {
			ps = append(ps, Presence{ID: pc.ID, Topic: topic, UserID: pc.UserID, Meta: m})
		}
	}
	t.RUnlock()
	return ps
}

func (t *TrackerService) ListLocalByTopic(topic string) []Presence {
	ps := make([]Presence, 0)
	t.RLock()
	for pc, m := range t.values {
		if pc.Topic == topic && pc.ID.Node == t.name {
			ps = append(ps, Presence{ID: pc.ID, Topic: topic, UserID: pc.UserID, Meta: m})
		}
	}
	t.RUnlock()
	return ps
}

func (t *TrackerService) ListByTopicUser(topic string, userID string) []Presence {
	ps := make([]Presence, 0)
	t.RLock()
	for pc, m := range t.values {
		if pc.Topic == topic && pc.UserID == userID {
			ps = append(ps, Presence{ID: pc.ID, Topic: topic, UserID: pc.UserID, Meta: m})
		}
	}
	t.RUnlock()
	return ps
}

func (t *TrackerService) notifyDiffListeners(joins, leaves []Presence) {
	go func() {
		for _, f := range t.diffListeners {
			f(joins, leaves) // TODO run these in parallel? Will we have more than one?
		}
	}()
}
