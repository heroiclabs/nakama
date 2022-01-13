package server

import (
	"github.com/gofrs/uuid"
	"go.uber.org/zap"
	"testing"
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

	ticket, _, err := partyHandler.MatchmakerAdd(sessionID.String(), node, "", 1, 1, nil, nil)
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

	mm, cleanup, _ := createTestMatchmaker(t, logger, nil)
	tt := testTracker{}
	tsm := testStreamManager{}
	dmr := DummyMessageRouter{}

	pr := NewLocalPartyRegistry(logger, mm, &tt, &tsm, &dmr, node)
	ph := NewPartyHandler(logger, pr, mm, &tt, &tsm, &dmr, uuid.UUID{}, node, true, 10, nil)
	return ph, cleanup
}
