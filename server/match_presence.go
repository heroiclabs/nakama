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
	presence   *MatchPresence
	expiryTick int64
}

type MatchJoinMarkerList struct {
	sync.RWMutex
	expiryDelayMs int64
	tickRate      int64
	joinMarkers   map[uuid.UUID]*MatchJoinMarker
}

func NewMatchJoinMarkerList(config Config, tickRate int64) *MatchJoinMarkerList {
	return &MatchJoinMarkerList{
		expiryDelayMs: int64(config.GetMatch().JoinMarkerDeadlineMs),
		tickRate:      tickRate,
		joinMarkers:   make(map[uuid.UUID]*MatchJoinMarker),
	}
}

func (m *MatchJoinMarkerList) Add(presence *MatchPresence, currentTick int64) {
	m.Lock()
	m.joinMarkers[presence.SessionID] = &MatchJoinMarker{
		presence:   presence,
		expiryTick: currentTick + (m.tickRate * (m.expiryDelayMs / 1000)),
	}
	m.Unlock()
}

func (m *MatchJoinMarkerList) Mark(sessionID uuid.UUID) {
	m.Lock()
	delete(m.joinMarkers, sessionID)
	m.Unlock()
}

func (m *MatchJoinMarkerList) ClearExpired(tick int64) []*MatchPresence {
	presences := make([]*MatchPresence, 0)
	m.Lock()
	for sessionID, joinMarker := range m.joinMarkers {
		if joinMarker.expiryTick <= tick {
			presences = append(presences, joinMarker.presence)
			delete(m.joinMarkers, sessionID)
		}
	}
	m.Unlock()
	return presences
}

// Maintains the match presences for routing and validation purposes.
type MatchPresenceList struct {
	sync.RWMutex
	size        *atomic.Int32
	presences   []*MatchPresenceListItem
	presenceMap map[uuid.UUID]string
}

type MatchPresenceListItem struct {
	PresenceID *PresenceID
	Presence   *MatchPresence
}

func NewMatchPresenceList() *MatchPresenceList {
	return &MatchPresenceList{
		size:        atomic.NewInt32(0),
		presences:   make([]*MatchPresenceListItem, 0, 10),
		presenceMap: make(map[uuid.UUID]string, 10),
	}
}

func (m *MatchPresenceList) Join(joins []*MatchPresence) []*MatchPresence {
	processed := make([]*MatchPresence, 0, len(joins))
	m.Lock()
	for _, join := range joins {
		if _, ok := m.presenceMap[join.SessionID]; !ok {
			m.presences = append(m.presences, &MatchPresenceListItem{
				PresenceID: &PresenceID{
					Node:      join.Node,
					SessionID: join.SessionID,
				},
				Presence: join,
			})
			m.presenceMap[join.SessionID] = join.Node
			processed = append(processed, join)
		}
	}
	m.Unlock()
	if l := len(processed); l != 0 {
		m.size.Add(int32(l))
	}
	return processed
}

func (m *MatchPresenceList) Leave(leaves []*MatchPresence) []*MatchPresence {
	processed := make([]*MatchPresence, 0, len(leaves))
	m.Lock()
	for _, leave := range leaves {
		if _, ok := m.presenceMap[leave.SessionID]; ok {
			for i, presence := range m.presences {
				if presence.PresenceID.SessionID == leave.SessionID && presence.PresenceID.Node == leave.Node {
					m.presences = append(m.presences[:i], m.presences[i+1:]...)
					break
				}
			}
			delete(m.presenceMap, leave.SessionID)
			processed = append(processed, leave)
		}
	}
	m.Unlock()
	if l := len(processed); l != 0 {
		m.size.Sub(int32(l))
	}
	return processed
}

func (m *MatchPresenceList) Contains(presence *PresenceID) bool {
	var found bool
	m.RLock()
	if node, ok := m.presenceMap[presence.SessionID]; ok {
		found = node == presence.Node
	}
	m.RUnlock()
	return found
}

func (m *MatchPresenceList) ListPresenceIDs() []*PresenceID {
	m.RLock()
	list := make([]*PresenceID, 0, len(m.presences))
	for _, presence := range m.presences {
		list = append(list, presence.PresenceID)
	}
	m.RUnlock()
	return list
}

func (m *MatchPresenceList) ListPresences() []*MatchPresence {
	m.RLock()
	list := make([]*MatchPresence, 0, len(m.presences))
	for _, presence := range m.presences {
		list = append(list, presence.Presence)
	}
	m.RUnlock()
	return list
}

func (m *MatchPresenceList) Size() int {
	return int(m.size.Load())
}
