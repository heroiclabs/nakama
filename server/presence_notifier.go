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
	"strings"

	"github.com/satori/go.uuid"
	"github.com/uber-go/zap"
)

// PresenceNotifier is responsible for updating clients when a presence change occurs
type presenceNotifier struct {
	logger        zap.Logger
	name          string
	tracker       Tracker
	messageRouter MessageRouter
}

// NewPresenceNotifier creates a new PresenceNotifier
func NewPresenceNotifier(logger zap.Logger, name string, tracker Tracker, messageRouter MessageRouter) *presenceNotifier {
	return &presenceNotifier{
		logger:        logger,
		name:          name,
		tracker:       tracker,
		messageRouter: messageRouter,
	}
}

// HandleDiff notifies users in matches of changes in presences
func (pn *presenceNotifier) HandleDiff(joins, leaves []Presence) {
	topicJoins := make(map[string][]Presence, 0)
	topicLeaves := make(map[string][]Presence, 0)

	// Group joins and leaves by topic.
	for _, p := range joins {
		if j, ok := topicJoins[p.Topic]; ok {
			topicJoins[p.Topic] = append(j, p)
		} else {
			topicJoins[p.Topic] = []Presence{p}
		}
	}
	for _, p := range leaves {
		if l, ok := topicLeaves[p.Topic]; ok {
			topicLeaves[p.Topic] = append(l, p)
		} else {
			topicLeaves[p.Topic] = []Presence{p}
		}
	}

	// Handle joins and any associated leaves.
	for topic, tjs := range topicJoins {
		// Get a list of local notification targets.
		to := pn.tracker.ListLocalByTopic(topic)

		// Check if there are any local presences to notify.
		if len(to) == 0 {
			continue
		}

		// Check the topic type.
		splitTopic := strings.SplitN(topic, ":", 2)
		switch splitTopic[0] {
		case "match":
			matchID := uuid.FromStringOrNil(splitTopic[1]).Bytes()
			if tls, ok := topicLeaves[topic]; ok {
				pn.handleDiffMatch(matchID, to, tjs, tls)
			} else {
				pn.handleDiffMatch(matchID, to, tjs, nil)
			}
		case "dm":
			users := strings.SplitN(splitTopic[1], ":", 2)
			userID1 := uuid.FromStringOrNil(users[0]).Bytes()
			userID2 := uuid.FromStringOrNil(users[1]).Bytes()
			t := &TopicId{Id: &TopicId_Dm{Dm: append(userID1, userID2...)}}
			if tls, ok := topicLeaves[topic]; ok {
				pn.handleDiffTopic(t, to, tjs, tls)
			} else {
				pn.handleDiffTopic(t, to, tjs, nil)
			}
		case "room":
			t := &TopicId{Id: &TopicId_Room{Room: []byte(splitTopic[1])}}
			if tls, ok := topicLeaves[topic]; ok {
				pn.handleDiffTopic(t, to, tjs, tls)
			} else {
				pn.handleDiffTopic(t, to, tjs, nil)
			}
		case "group":
			t := &TopicId{Id: &TopicId_GroupId{GroupId: uuid.FromStringOrNil(splitTopic[1]).Bytes()}}
			if tls, ok := topicLeaves[topic]; ok {
				pn.handleDiffTopic(t, to, tjs, tls)
			} else {
				pn.handleDiffTopic(t, to, tjs, nil)
			}
		default:
			pn.logger.Warn("Skipping presence notifications for unknown topic", zap.Object("topic", topic))
		}
	}

	// Handle leaves that had no associated joins.
	for topic, tls := range topicLeaves {
		// Get a list of local notification targets.
		to := pn.tracker.ListLocalByTopic(topic)

		// Check if there are any local presences to notify.
		if len(to) == 0 {
			continue
		}

		// CHeck the topic type.
		splitTopic := strings.SplitN(topic, ":", 2)
		switch splitTopic[0] {
		case "match":
			matchID := uuid.FromStringOrNil(splitTopic[1]).Bytes()
			pn.handleDiffMatch(matchID, to, nil, tls)
		case "dm":
			users := strings.SplitN(splitTopic[1], ":", 2)
			userID1 := uuid.FromStringOrNil(users[0]).Bytes()
			userID2 := uuid.FromStringOrNil(users[1]).Bytes()
			t := &TopicId{Id: &TopicId_Dm{Dm: append(userID1, userID2...)}}
			pn.handleDiffTopic(t, to, nil, tls)
		case "room":
			t := &TopicId{Id: &TopicId_Room{Room: []byte(splitTopic[1])}}
			pn.handleDiffTopic(t, to, nil, tls)
		case "group":
			t := &TopicId{Id: &TopicId_GroupId{GroupId: uuid.FromStringOrNil(splitTopic[1]).Bytes()}}
			pn.handleDiffTopic(t, to, nil, tls)
		default:
			pn.logger.Warn("Skipping presence notifications for unknown topic", zap.Object("topic", topic))
		}
	}
}

func (pn *presenceNotifier) handleDiffMatch(matchID []byte, to, joins, leaves []Presence) {
	// Tie together the joins and leaves for the same topic.
	msg := &MatchPresence{
		MatchId: matchID,
	}
	if joins != nil {
		muJoins := make([]*UserPresence, len(joins))
		for i := 0; i < len(joins); i++ {
			muJoins[i] = &UserPresence{
				UserId:    joins[i].UserID.Bytes(),
				SessionId: joins[i].ID.SessionID.Bytes(),
			}
		}
		msg.Joins = muJoins
	}
	if leaves != nil {
		muLeaves := make([]*UserPresence, len(leaves))
		for i := 0; i < len(leaves); i++ {
			muLeaves[i] = &UserPresence{
				UserId:    leaves[i].UserID.Bytes(),
				SessionId: leaves[i].ID.SessionID.Bytes(),
			}
		}
		msg.Leaves = muLeaves
	}

	// Send the presence notification.
	pn.messageRouter.Send(pn.logger, to, &Envelope{Payload: &Envelope_MatchPresence{MatchPresence: msg}})
}

func (pn *presenceNotifier) handleDiffTopic(topic *TopicId, to, joins, leaves []Presence) {
	msg := &TopicPresence{
		Topic: topic,
	}
	if joins != nil {
		tuJoins := make([]*UserPresence, len(joins))
		for i := 0; i < len(joins); i++ {
			tuJoins[i] = &UserPresence{
				UserId:    joins[i].UserID.Bytes(),
				SessionId: joins[i].ID.SessionID.Bytes(),
			}
		}
		msg.Joins = tuJoins
	}
	if leaves != nil {
		tuLeaves := make([]*UserPresence, len(leaves))
		for i := 0; i < len(leaves); i++ {
			tuLeaves[i] = &UserPresence{
				UserId:    leaves[i].UserID.Bytes(),
				SessionId: leaves[i].ID.SessionID.Bytes(),
			}
		}
		msg.Leaves = tuLeaves
	}

	// Send the presence notification.
	pn.messageRouter.Send(pn.logger, to, &Envelope{Payload: &Envelope_TopicPresence{TopicPresence: msg}})
}
