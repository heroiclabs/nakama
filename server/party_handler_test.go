// Copyright 2022 The Nakama Authors
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
	"testing"

	"github.com/gofrs/uuid/v5"
	"go.uber.org/zap"
)

// should add and remove from PartyMatchmaker
func TestPartyMatchmakerAddAndRemove(t *testing.T) {
	consoleLogger := loggerForTest(t)
	partyHandler, cleanup := createTestPartyHandler(t, consoleLogger)
	defer cleanup()

	sessionID, _ := uuid.NewV4()
	userID, _ := uuid.NewV4()
	node := "node1"

	partyHandler.Join([]*Presence{&Presence{
		ID: PresenceID{
			Node:      node,
			SessionID: sessionID,
		},
		// Presence stream not needed.
		UserID: userID,
		Meta: PresenceMeta{
			Username: "username",
			// Other meta fields not needed.
		},
	}})

	ticket, _, err := partyHandler.MatchmakerAdd(sessionID.String(), node, "", 1, 1, 1, nil, nil)
	if err != nil {
		t.Fatalf("MatchmakerAdd error %s", err)
	}

	err = partyHandler.MatchmakerRemove(sessionID.String(), node, ticket)
	if err != nil {
		t.Fatalf("MatchmakerRemove error %s", err)
	}
}

func createTestPartyHandler(t *testing.T, logger *zap.Logger) (*PartyHandler, func() error) {
	node := "node1"

	mm, cleanup, _ := createTestMatchmaker(t, logger, true, nil)
	tt := testTracker{}
	tsm := testStreamManager{}

	dmr := DummyMessageRouter{}

	pr := NewLocalPartyRegistry(logger, cfg, mm, &tt, &tsm, &dmr, node)
	ph := NewPartyHandler(logger, pr, mm, &tt, &tsm, &dmr, uuid.UUID{}, node, true, 10, nil)
	return ph, cleanup
}
