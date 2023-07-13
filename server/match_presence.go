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
	"sync"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/atomic"
)

var _ runtime.Presence = &MatchPresence{}

// Represents routing and identify information for a single match participant.
type MatchPresence struct {
	Node      string
	UserID    uuid.UUID
	SessionID uuid.UUID
	Username  string
	Reason    runtime.PresenceReason
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
func (p *MatchPresence) GetReason() runtime.PresenceReason {
	return p.Reason
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
	presences := make([]*MatchPresence, 0, 1)
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
	size            *atomic.Int32
	presences       []*MatchPresenceListItem
	presenceMap     map[uuid.UUID]string
	presencesRead   *atomic.Value
	presenceIDsRead *atomic.Value
}

type MatchPresenceListItem struct {
	PresenceID *PresenceID
	Presence   *MatchPresence
}

func NewMatchPresenceList() *MatchPresenceList {
	m := &MatchPresenceList{
		size:            atomic.NewInt32(0),
		presences:       make([]*MatchPresenceListItem, 0, 10),
		presenceMap:     make(map[uuid.UUID]string, 10),
		presencesRead:   &atomic.Value{},
		presenceIDsRead: &atomic.Value{},
	}
	m.presencesRead.Store(make([]*MatchPresence, 0))
	m.presenceIDsRead.Store(make([]*PresenceID, 0))
	return m
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
	l := len(processed)
	if l != 0 {
		presencesRead := make([]*MatchPresence, 0, len(m.presences))
		presenceIDsRead := make([]*PresenceID, 0, len(m.presences))
		for _, presence := range m.presences {
			presencesRead = append(presencesRead, presence.Presence)
			presenceIDsRead = append(presenceIDsRead, presence.PresenceID)
		}
		m.presencesRead.Store(presencesRead)
		m.presenceIDsRead.Store(presenceIDsRead)
	}
	m.Unlock()
	if l != 0 {
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
					m.presences[i] = m.presences[len(m.presences)-1]
					m.presences[len(m.presences)-1] = nil
					m.presences = m.presences[:len(m.presences)-1]
					break
				}
			}
			delete(m.presenceMap, leave.SessionID)
			processed = append(processed, leave)
		}
	}
	l := len(processed)
	if l != 0 {
		presencesRead := make([]*MatchPresence, 0, len(m.presences))
		presenceIDsRead := make([]*PresenceID, 0, len(m.presences))
		for _, presence := range m.presences {
			presencesRead = append(presencesRead, presence.Presence)
			presenceIDsRead = append(presenceIDsRead, presence.PresenceID)
		}
		m.presencesRead.Store(presencesRead)
		m.presenceIDsRead.Store(presenceIDsRead)
	}
	m.Unlock()
	if l != 0 {
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

func (m *MatchPresenceList) FilterPresenceIDs(ids []*PresenceID) []*PresenceID {
	m.RLock()
	for i := 0; i < len(ids); i++ {
		if node, ok := m.presenceMap[ids[i].SessionID]; !ok || node != ids[i].Node {
			ids[i] = ids[len(ids)-1]
			ids[len(ids)-1] = nil
			ids = ids[:len(ids)-1]
			i--
		}
	}
	m.RUnlock()
	return ids
}

func (m *MatchPresenceList) ListPresences() []*MatchPresence {
	return m.presencesRead.Load().([]*MatchPresence)
}

func (m *MatchPresenceList) ListPresenceIDs() []*PresenceID {
	return m.presenceIDsRead.Load().([]*PresenceID)
}

func (m *MatchPresenceList) Size() int {
	return int(m.size.Load())
}
