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

	"go.uber.org/zap"
)

// PresenceNotifier is responsible for updating clients when a presence change occurs
type presenceNotifier struct {
	logger        *zap.Logger
	name          string
	tracker       Tracker
	messageRouter MessageRouter
}

// NewPresenceNotifier creates a new PresenceNotifier
func NewPresenceNotifier(logger *zap.Logger, name string, tracker Tracker, messageRouter MessageRouter) *presenceNotifier {
	return &presenceNotifier{
		logger:        logger,
		name:          name,
		tracker:       tracker,
		messageRouter: messageRouter,
	}
}

// HandleDiff notifies users in matches of changes in presences
func (pn *presenceNotifier) HandleDiff(joins, leaves []Presence) {
	pn.logger.Debug("Processing presence diff", zap.Int("joins", len(joins)), zap.Int("leaves", len(leaves)))
	topicJoins := make(map[string][]Presence, 0)
	topicLeaves := make(map[string][]Presence, 0)

	// Group joins and leaves by topic.
	for _, p := range joins {
		// The "notifications:..." topics are a special case that does not generate presence notifications.
		if strings.HasPrefix(p.Topic, "notifications") {
			continue
		}

		// Group presences by topic.
		if j, ok := topicJoins[p.Topic]; ok {
			topicJoins[p.Topic] = append(j, p)
		} else {
			topicJoins[p.Topic] = []Presence{p}
		}
	}
	for _, p := range leaves {
		// The "notifications:..." topics are a special case that does not generate presence notifications.
		if strings.HasPrefix(p.Topic, "notifications") {
			continue
		}

		// Group presences by topic.
		if l, ok := topicLeaves[p.Topic]; ok {
			topicLeaves[p.Topic] = append(l, p)
		} else {
			topicLeaves[p.Topic] = []Presence{p}
		}
	}
	pn.logger.Debug("Presence diff topic count", zap.Int("joins", len(topicJoins)), zap.Int("leaves", len(topicLeaves)))

	// Handle joins and any associated leaves.
	for topic, tjs := range topicJoins {
		// Get a list of local notification targets.
		to := pn.tracker.ListLocalByTopic(topic)

		// Check if there are any local presences to notify.
		if len(to) == 0 {
			pn.logger.Debug("No local presences to report diff", zap.String("topic", topic))
			continue
		}

		// Check the topic type.
		splitTopic := strings.SplitN(topic, ":", 2)
		switch splitTopic[0] {
		case "match":
			matchID := splitTopic[1]
			if tls, ok := topicLeaves[topic]; ok {
				// Make sure leaves aren't also processed separately if we were able to pair them here.
				delete(topicLeaves, topic)
				pn.handleDiffMatch(matchID, to, tjs, tls)
			} else {
				pn.handleDiffMatch(matchID, to, tjs, nil)
			}
		case "dm":
			t := &TopicId{Id: &TopicId_Dm{Dm: splitTopic[1]}}
			if tls, ok := topicLeaves[topic]; ok {
				// Make sure leaves aren't also processed separately if we were able to pair them here.
				delete(topicLeaves, topic)
				pn.handleDiffTopic(t, to, tjs, tls)
			} else {
				pn.handleDiffTopic(t, to, tjs, nil)
			}
		case "room":
			t := &TopicId{Id: &TopicId_Room{Room: splitTopic[1]}}
			if tls, ok := topicLeaves[topic]; ok {
				// Make sure leaves aren't also processed separately if we were able to pair them here.
				delete(topicLeaves, topic)
				pn.handleDiffTopic(t, to, tjs, tls)
			} else {
				pn.handleDiffTopic(t, to, tjs, nil)
			}
		case "group":
			t := &TopicId{Id: &TopicId_GroupId{GroupId: splitTopic[1]}}
			if tls, ok := topicLeaves[topic]; ok {
				// Make sure leaves aren't also processed separately if we were able to pair them here.
				delete(topicLeaves, topic)
				pn.handleDiffTopic(t, to, tjs, tls)
			} else {
				pn.handleDiffTopic(t, to, tjs, nil)
			}
		default:
			pn.logger.Warn("Skipping presence notifications for unknown topic", zap.Any("topic", topic))
		}
	}

	// Handle leaves that had no associated joins.
	for topic, tls := range topicLeaves {
		// Get a list of local notification targets.
		to := pn.tracker.ListLocalByTopic(topic)

		// Check if there are any local presences to notify.
		if len(to) == 0 {
			pn.logger.Debug("No local presences to report diff", zap.String("topic", topic))
			continue
		}

		// CHeck the topic type.
		splitTopic := strings.SplitN(topic, ":", 2)
		switch splitTopic[0] {
		case "match":
			pn.handleDiffMatch(splitTopic[1], to, nil, tls)
		case "dm":
			t := &TopicId{Id: &TopicId_Dm{Dm: splitTopic[1]}}
			pn.handleDiffTopic(t, to, nil, tls)
		case "room":
			t := &TopicId{Id: &TopicId_Room{Room: splitTopic[1]}}
			pn.handleDiffTopic(t, to, nil, tls)
		case "group":
			t := &TopicId{Id: &TopicId_GroupId{GroupId: splitTopic[1]}}
			pn.handleDiffTopic(t, to, nil, tls)
		default:
			pn.logger.Warn("Skipping presence notifications for unknown topic", zap.Any("topic", topic))
		}
	}
}

func (pn *presenceNotifier) handleDiffMatch(matchID string, to, joins, leaves []Presence) {
	// Tie together the joins and leaves for the same topic.
	msg := &MatchPresence{
		MatchId: matchID,
	}
	if joins != nil {
		muJoins := make([]*UserPresence, len(joins))
		for i := 0; i < len(joins); i++ {
			muJoins[i] = &UserPresence{
				UserId:    joins[i].UserID,
				SessionId: joins[i].ID.SessionID,
				Handle:    joins[i].Meta.Handle,
			}
		}
		msg.Joins = muJoins
	}
	if leaves != nil {
		muLeaves := make([]*UserPresence, len(leaves))
		for i := 0; i < len(leaves); i++ {
			muLeaves[i] = &UserPresence{
				UserId:    leaves[i].UserID,
				SessionId: leaves[i].ID.SessionID,
				Handle:    leaves[i].Meta.Handle,
			}
		}
		msg.Leaves = muLeaves
	}
	pn.logger.Debug("Routing match diff", zap.Any("to", to), zap.Any("msg", msg))

	// Send the presence notification.
	pn.messageRouter.Send(pn.logger, to, &Envelope{Payload: &Envelope_MatchPresence{MatchPresence: msg}}, true)
}

func (pn *presenceNotifier) handleDiffTopic(topic *TopicId, to, joins, leaves []Presence) {
	msg := &TopicPresence{
		Topic: topic,
	}
	if joins != nil {
		tuJoins := make([]*UserPresence, len(joins))
		for i := 0; i < len(joins); i++ {
			tuJoins[i] = &UserPresence{
				UserId:    joins[i].UserID,
				SessionId: joins[i].ID.SessionID,
				Handle:    joins[i].Meta.Handle,
			}
		}
		msg.Joins = tuJoins
	}
	if leaves != nil {
		tuLeaves := make([]*UserPresence, len(leaves))
		for i := 0; i < len(leaves); i++ {
			tuLeaves[i] = &UserPresence{
				UserId:    leaves[i].UserID,
				SessionId: leaves[i].ID.SessionID,
				Handle:    leaves[i].Meta.Handle,
			}
		}
		msg.Leaves = tuLeaves
	}
	pn.logger.Debug("Routing topic diff", zap.Any("to", to), zap.Any("msg", msg))

	// Send the presence notification.
	pn.messageRouter.Send(pn.logger, to, &Envelope{Payload: &Envelope_TopicPresence{TopicPresence: msg}}, true)
}
