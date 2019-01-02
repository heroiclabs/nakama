// Copyright 2018 The Nakama Authors
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
	"github.com/gofrs/uuid"
	"go.uber.org/atomic"
	"sync"
)

// Represents routing and identify information for a single match participant.
type MatchPresence struct {
	Node      string
	UserID    uuid.UUID
	SessionID uuid.UUID
	Username  string
}

func (p *MatchPresence) GetUserId() string {
	return p.UserID.String()
}
func (p *MatchPresence) GetSessionId() string {
	return p.SessionID.String()
}
func (p *MatchPresence) GetNodeId() string {
	return p.Node
}
func (p *MatchPresence) GetHidden() bool {
	return false
}
func (p *MatchPresence) GetPersistence() bool {
	return false
}
func (p *MatchPresence) GetUsername() string {
	return p.Username
}
func (p *MatchPresence) GetStatus() string {
	return ""
}

// Used to monitor when match presences begin and complete their match join process.
type MatchJoinMarker struct {
	expiryTick int64
	marked     *atomic.Bool
	ch         chan struct{}
}

type MatchJoinMarkerList struct {
	sync.RWMutex
	joinMarkers map[uuid.UUID]*MatchJoinMarker
}

func (m *MatchJoinMarkerList) Add(sessionID uuid.UUID, expiryTick int64) {
	m.Lock()
	m.joinMarkers[sessionID] = &MatchJoinMarker{
		expiryTick: expiryTick,
		marked:     atomic.NewBool(false),
		ch:         make(chan struct{}),
	}
	m.Unlock()
}

func (m *MatchJoinMarkerList) Get(sessionID uuid.UUID) <-chan struct{} {
	var ch chan struct{}
	m.RLock()
	if joinMarker, ok := m.joinMarkers[sessionID]; ok {
		ch = joinMarker.ch
	}
	m.RUnlock()
	return ch
}

func (m *MatchJoinMarkerList) Mark(sessionID uuid.UUID) {
	m.RLock()
	if joinMarker, ok := m.joinMarkers[sessionID]; ok {
		if joinMarker.marked.CAS(false, true) {
			close(joinMarker.ch)
		}
	}
	m.RUnlock()
}

func (m *MatchJoinMarkerList) ClearExpired(tick int64) {
	m.Lock()
	for sessionID, joinMarker := range m.joinMarkers {
		if joinMarker.expiryTick <= tick {
			delete(m.joinMarkers, sessionID)
		}
	}
	m.Unlock()
}

// Maintains the match presences for routing and validation purposes.
type MatchPresenceList struct {
	sync.RWMutex
	presences []*PresenceID
}

func (m *MatchPresenceList) Join(joins []*MatchPresence) {
	m.Lock()
	for _, join := range joins {
		m.presences = append(m.presences, &PresenceID{
			Node:      join.Node,
			SessionID: join.SessionID,
		})
	}
	m.Unlock()
}

func (m *MatchPresenceList) Leave(leaves []*MatchPresence) {
	m.Lock()
	for _, leave := range leaves {
		for i, presenceID := range m.presences {
			if presenceID.SessionID == leave.SessionID && presenceID.Node == leave.Node {
				m.presences = append(m.presences[:i], m.presences[i+1:]...)
				break
			}
		}
	}
	m.Unlock()
}

func (m *MatchPresenceList) Contains(presence *PresenceID) bool {
	var found bool
	m.RLock()
	for _, p := range m.presences {
		if p.SessionID == presence.SessionID && p.Node == p.Node {
			found = true
			break
		}
	}
	m.RUnlock()
	return found
}

func (m *MatchPresenceList) List() []*PresenceID {
	m.RLock()
	list := make([]*PresenceID, 0, len(m.presences))
	for _, presence := range m.presences {
		list = append(list, presence)
	}
	m.RUnlock()
	return list
}
