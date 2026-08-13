// Copyright 2026 The Nakama Authors
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
	"database/sql"
	"fmt"
	"syscall"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func TestApiTournamentHaystack(t *testing.T) {
	// Tokens in the test config expire after 60s, which is too short for a
	// full API server bootstrap and data population in slow environments.
	// Match the CI configuration that passes --session.token_expiry_sec 7200.
	oldTokenExpiry := cfg.GetSession().TokenExpirySec
	cfg.GetSession().TokenExpirySec = 7_200
	defer func() { cfg.GetSession().TokenExpirySec = oldTokenExpiry }()

	newId := func() uuid.UUID { return uuid.Must(uuid.NewV4()) }
	type testUser struct {
		id       uuid.UUID
		score    int64
		subScore int64
		conn     *grpc.ClientConn
		cl       apigrpc.NakamaClient
		ctx      context.Context
	}

	newUsers := func() []*testUser {
		return []*testUser{
			{score: 10, subScore: 11},
			{score: 20, subScore: 21},
			{score: 30, subScore: 31},
			{score: 40, subScore: 41},
			{score: 50, subScore: 51},
		}
	}

	cleanup := func(db *sql.DB, srv *ApiServer,
		conn *grpc.ClientConn, users []*testUser) {

		_ = db.Close()
		srv.Stop()
		_ = conn.Close()

		for _, u := range users {
			if u.conn != nil {
				_ = u.conn.Close()
			}
		}

		// Wait until the socket is closed to avoid conflicts for the following tests
		WaitForSocket(syscall.ECONNREFUSED, cfg)
	}

	newTournamentAPI := func(tournamentID string) (*grpc.ClientConn, apigrpc.NakamaClient, *ApiServer, context.Context) {
		now := time.Now().UTC()
		startTime := now.Add(-time.Hour).Unix()

		modules := map[string]string{
			"trn-init": fmt.Sprintf(`
local nk = require("nakama")
local metadata = {}
nk.tournament_create(%q, false, "desc", "best", 7200, "", metadata, "", "", 0, %d, 0, 0, 0, false, true)
`, tournamentID, startTime),
		}

		runtime, _, rtData, err := runtimeWithModulesWithData(t, modules)
		require.NoError(t, err)

		db := NewDB(t)
		router := &DummyMessageRouter{}
		tracker := &LocalTracker{}
		sessionCache := NewLocalSessionCache(1_000, 3_600)

		pipeline := NewPipeline(logger, cfg, db, protojsonMarshaler, protojsonUnmarshaler, nil, nil, nil, nil, nil, tracker, router, runtime, metrics)

		apiServer := StartApiServer(logger, logger, db, protojsonMarshaler,
			protojsonUnmarshaler, cfg, "3.0.0", nil, nil, rtData.leaderboardCache,
			rtData.leaderboardRankCache, nil, sessionCache,
			nil, nil, nil, nil, tracker, router, nil, metrics, pipeline, runtime)

		WaitForSocket(nil, cfg)

		conn, client, _, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())

		return conn, client, apiServer, ctx
	}

	populateTournament := func(users []*testUser, tournamentID string) {
		for i := range users {
			u := users[i]
			conn, cl, ses, ctx := NewAuthenticatedAPIClient(t, newId().String())
			userId, err := UserIDFromSession(ses)
			require.NoError(t, err)

			u.id = userId
			u.conn = conn
			u.cl = cl
			u.ctx = ctx

			_, err = u.cl.WriteTournamentRecord(
				u.ctx, &api.WriteTournamentRecordRequest{
					TournamentId: tournamentID,
					Record: &api.WriteTournamentRecordRequest_TournamentRecordWrite{
						Score:    u.score,
						Subscore: u.subScore,
					},
				})
			require.NoError(t, err, "should write user tournament record")
		}
	}

	t.Run("list records around owner cursors", func(t *testing.T) {
		tournamentID := newId().String()
		db := NewDB(t)
		conn, cl, srv, ctx := newTournamentAPI(tournamentID)

		users := newUsers()
		defer cleanup(db, srv, conn, users)

		populateTournament(users, tournamentID)

		// Fetch from the middle with a small limit so both the previous and
		// next cursors are populated.
		resp, err := cl.ListTournamentRecordsAroundOwner(ctx, &api.ListTournamentRecordsAroundOwnerRequest{
			TournamentId: tournamentID,
			Limit:        wrapperspb.UInt32(3),
			OwnerId:      users[2].id.String(),
		})
		require.NoError(t, err, "should list user tournament records around owner")

		require.NotEmpty(t, resp.PrevCursor, "expected a previous cursor")
		require.NotEmpty(t, resp.NextCursor, "expected a next cursor")
		require.NotEqual(t, resp.PrevCursor, resp.NextCursor, "previous and next cursors must differ")

		// Following the previous cursor should return a valid page without error.
		prevResp, err := cl.ListTournamentRecordsAroundOwner(ctx, &api.ListTournamentRecordsAroundOwnerRequest{
			TournamentId: tournamentID,
			Limit:        wrapperspb.UInt32(3),
			OwnerId:      users[2].id.String(),
			Cursor:       resp.PrevCursor,
		})
		require.NoError(t, err, "should list user tournament records around owner with previous cursor")

		require.NotEmpty(t, prevResp.Records, "previous page should contain records")
	})
}
