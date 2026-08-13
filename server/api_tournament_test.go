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
	// Tokens in the test config expire after 60s, which can be too short for a
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

	// newTournamentAPI creates a tournament through a runtime init module, boots
	// an API server against a fresh database and returns that database together
	// with the connected client so the caller can close it.
	newTournamentAPI := func(tournamentID string) (*grpc.ClientConn, apigrpc.NakamaClient, *ApiServer, *sql.DB, context.Context) {
		now := time.Now().UTC()
		startTime := now.Add(-time.Hour).Unix()

		modules := map[string]string{
			// nk.tournament_create(id, authoritative, sort_order, operator, duration, reset_schedule, metadata, title, description, category, start_time, end_time, max_size, max_num_score, join_required, enable_ranks)
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

		return conn, client, apiServer, db, ctx
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

	tournamentID := newId().String()
	conn, cl, srv, db, ctx := newTournamentAPI(tournamentID)

	users := newUsers()
	defer cleanup(db, srv, conn, users)

	populateTournament(users, tournamentID)

	// With the "best" operator and "desc" sort order higher scores rank first:
	// the owner (score 30) sits at rank 3, so a limit of 3 pages ranks 2..4
	// and leaves exactly one record above (score 50) and one below (score 10).
	owner := users[2]
	resp, err := cl.ListTournamentRecordsAroundOwner(ctx, &api.ListTournamentRecordsAroundOwnerRequest{
		TournamentId: tournamentID,
		Limit:        wrapperspb.UInt32(3),
		OwnerId:      owner.id.String(),
	})
	require.NoError(t, err, "should list user tournament records around owner")

	require.Len(t, resp.Records, 3, "middle page should contain the owner and one record on each side")

	scores := make([]int64, 0, len(resp.Records))
	ranks := make([]int64, 0, len(resp.Records))
	for i, r := range resp.Records {
		scores = append(scores, r.Score)
		ranks = append(ranks, r.Rank)
		require.Equal(t, users[3-i].id.String(), r.OwnerId, "records must be ordered best first")
	}
	require.Equal(t, []int64{40, 30, 20}, scores, "middle page should be the three records around the owner")
	require.Equal(t, []int64{2, 3, 4}, ranks, "middle page should carry the correct ranks")

	require.NotEmpty(t, resp.PrevCursor, "expected a previous cursor")
	require.NotEmpty(t, resp.NextCursor, "expected a next cursor")
	require.NotEqual(t, resp.PrevCursor, resp.NextCursor, "previous and next cursors must differ")

	// Following the previous cursor must return the single record ranked above
	// the middle page (score 50). With the bug (PrevCursor = NextCursor) this
	// instead returns the record below the page (score 10), so this assertion
	// fails on the buggy code and passes with the fix.
	prevResp, err := cl.ListTournamentRecordsAroundOwner(ctx, &api.ListTournamentRecordsAroundOwnerRequest{
		TournamentId: tournamentID,
		Limit:        wrapperspb.UInt32(3),
		OwnerId:      owner.id.String(),
		Cursor:       resp.PrevCursor,
	})
	require.NoError(t, err, "should list user tournament records around owner with previous cursor")

	require.Len(t, prevResp.Records, 1, "previous page should contain the single record above the middle page")
	require.Equal(t, int64(50), prevResp.Records[0].Score, "previous page must be the record ranked above, not the next page")
	require.Equal(t, int64(1), prevResp.Records[0].Rank, "previous page record should carry rank 1")

	// Following the next cursor must return the single record ranked below the
	// middle page (score 10).
	nextResp, err := cl.ListTournamentRecordsAroundOwner(ctx, &api.ListTournamentRecordsAroundOwnerRequest{
		TournamentId: tournamentID,
		Limit:        wrapperspb.UInt32(3),
		OwnerId:      owner.id.String(),
		Cursor:       resp.NextCursor,
	})
	require.NoError(t, err, "should list user tournament records around owner with next cursor")

	require.Len(t, nextResp.Records, 1, "next page should contain the single record below the middle page")
	require.Equal(t, int64(10), nextResp.Records[0].Score, "next page must be the record ranked below")
	require.Equal(t, int64(5), nextResp.Records[0].Rank, "next page record should carry rank 5")

	// The middle page plus both cursor pages cover all five records exactly once.
	allScores := append(scores, prevResp.Records[0].Score, nextResp.Records[0].Score)
	require.ElementsMatch(t, []int64{10, 20, 30, 40, 50}, allScores, "previous, middle and next pages should cover all records")
}
