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
	"github.com/satori/go.uuid"
	"sync"
)

type Matchmaker interface {
	Queue(sessionID uuid.UUID, userID uuid.UUID, meta PresenceMeta, requiredCount int64) (uuid.UUID, map[MatchmakerKey]*MatchmakerProfile)
	Unqueue(sessionID uuid.UUID, userID uuid.UUID, ticket uuid.UUID) error
	UnqueueAll(sessionID uuid.UUID)
	UpdateAll(sessionID uuid.UUID, meta PresenceMeta)
}

type MatchmakerKey struct {
	ID     PresenceID
	UserID uuid.UUID
	Ticket uuid.UUID
}

type MatchmakerProfile struct {
	Meta          PresenceMeta
	RequiredCount int64
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

func (m *MatchmakerService) Queue(sessionID uuid.UUID, userID uuid.UUID, meta PresenceMeta, requiredCount int64) (uuid.UUID, map[MatchmakerKey]*MatchmakerProfile) {
	ticket := uuid.NewV4()
	selected := make(map[MatchmakerKey]*MatchmakerProfile, requiredCount-1)
	qmk := MatchmakerKey{ID: PresenceID{SessionID: sessionID, Node: m.name}, UserID: userID, Ticket: ticket}
	qmp := &MatchmakerProfile{Meta: meta, RequiredCount: requiredCount}

	m.Lock()
	for mk, mp := range m.values {
		if mk.ID.SessionID != sessionID && mk.UserID != userID && mp.RequiredCount == requiredCount {
			selected[mk] = mp
			if int64(len(selected)) == requiredCount-1 {
				break
			}
		}
	}
	if int64(len(selected)) == requiredCount-1 {
		for mk, _ := range selected {
			delete(m.values, mk)
		}
		selected[qmk] = qmp
	} else {
		m.values[qmk] = qmp
	}
	m.Unlock()

	if int64(len(selected)) != requiredCount {
		return ticket, nil
	} else {
		return ticket, selected
	}
}

func (m *MatchmakerService) Unqueue(sessionID uuid.UUID, userID uuid.UUID, ticket uuid.UUID) error {
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

func (m *MatchmakerService) UnqueueAll(sessionID uuid.UUID) {
	m.Lock()
	for mk, _ := range m.values {
		if mk.ID.SessionID == sessionID {
			delete(m.values, mk)
		}
	}
	m.Unlock()
}

func (m *MatchmakerService) UpdateAll(sessionID uuid.UUID, meta PresenceMeta) {
	m.Lock()
	for mk, mp := range m.values {
		if mk.ID.SessionID == sessionID {
			mp.Meta = meta
		}
	}
	m.Unlock()
}
