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
	"context"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

// should add and remove from PartyMatchmaker
func TestPartyMatchmakerAddAndRemove(t *testing.T) {
	consoleLogger := loggerForTest(t)
	presence := &rtapi.UserPresence{
		UserId:    uuid.Must(uuid.NewV4()).String(),
		SessionId: uuid.Must(uuid.NewV4()).String(),
		Username:  "username1",
	}
	partyHandler, cleanup := createTestPartyHandler(t, consoleLogger, presence)
	defer cleanup()

	sessionID := uuid.FromStringOrNil(presence.SessionId)
	userID := uuid.FromStringOrNil(presence.UserId)
	node := "node1"

	partyHandler.Join([]*Presence{&Presence{
		ID: PresenceID{
			Node:      node,
			SessionID: sessionID,
		},
		// Presence stream not needed.
		UserID: userID,
		Meta: PresenceMeta{
			Username: presence.Username,
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

func createTestPartyHandler(t *testing.T, logger *zap.Logger, presence *rtapi.UserPresence) (*PartyHandler, func() error) {
	node := "node1"

	mm, cleanup, _ := createTestMatchmaker(t, logger, true, nil)
	tt := testTracker{}
	tsm := testStreamManager{}

	dmr := DummyMessageRouter{}

	pr := NewLocalPartyRegistry(context.Background(), logger, logger, cfg, node, &testMetrics{})
	pr.Init(mm, &tt, &tsm, &dmr)
	ph := NewPartyHandler(logger, pr, mm, &tt, &tsm, &dmr, uuid.UUID{}, node, true, 10, presence)
	return ph, cleanup
}
