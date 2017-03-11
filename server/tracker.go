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

	"github.com/satori/go.uuid"
)

type PresenceID struct {
	Node      string
	SessionID uuid.UUID
}

type PresenceMeta struct {
	Handle string
}

type Presence struct {
	ID     PresenceID
	Topic  string
	UserID uuid.UUID
	Meta   PresenceMeta
}

type Tracker interface {
	AddDiffListener(func([]Presence, []Presence))
	Stop()

	Track(sessionID uuid.UUID, topic string, userID uuid.UUID, meta PresenceMeta)
	Untrack(sessionID uuid.UUID, topic string, userID uuid.UUID)
	UntrackAll(sessionID uuid.UUID)
	Update(sessionID uuid.UUID, topic string, userID uuid.UUID, meta PresenceMeta) error
	UpdateAll(sessionID uuid.UUID, meta PresenceMeta)

	// Get current total number of presences.
	Count() int
	// Check if a single presence on the current node exists.
	CheckLocalByIDTopicUser(sessionID uuid.UUID, topic string, userID uuid.UUID) bool
	// List presences by topic.
	ListByTopic(topic string) []Presence
	// List presences on the current node by topic.
	ListLocalByTopic(topic string) []Presence
}

type presenceCompact struct {
	ID     PresenceID
	Topic  string    // The presence topic.
	UserID uuid.UUID // The user ID.
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

func (t *TrackerService) Track(sessionID uuid.UUID, topic string, userID uuid.UUID, meta PresenceMeta) {
	pc := presenceCompact{ID: PresenceID{Node: t.name, SessionID: sessionID}, Topic: topic, UserID: userID}
	t.Lock()
	_, ok := t.values[pc]
	if !ok {
		t.values[pc] = meta
		t.notifyDiffListeners(
			[]Presence{
				Presence{ID: pc.ID, Topic: topic, UserID: userID, Meta: meta},
			},
			[]Presence{},
		)
	}
	t.Unlock()
}

func (t *TrackerService) Untrack(sessionID uuid.UUID, topic string, userID uuid.UUID) {
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

func (t *TrackerService) UntrackAll(sessionID uuid.UUID) {
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

func (t *TrackerService) Update(sessionID uuid.UUID, topic string, userID uuid.UUID, meta PresenceMeta) error {
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

func (t *TrackerService) UpdateAll(sessionID uuid.UUID, meta PresenceMeta) {
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

func (t *TrackerService) CheckLocalByIDTopicUser(sessionID uuid.UUID, topic string, userID uuid.UUID) bool {
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

func (t *TrackerService) notifyDiffListeners(joins, leaves []Presence) {
	go func() {
		for _, f := range t.diffListeners {
			f(joins, leaves) // TODO run these in parallel? Will we have more than one?
		}
	}()
}
