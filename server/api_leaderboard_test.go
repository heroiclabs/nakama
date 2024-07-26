package server

import (
	"context"
	"database/sql"
	"fmt"
	"syscall"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/apigrpc"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func TestApiLeaderboard(t *testing.T) {
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

	verifyList := func(ctx context.Context, cl apigrpc.NakamaClient,
		lbId string, users []*testUser) {

		resp, err := cl.ListLeaderboardRecords(ctx, &api.ListLeaderboardRecordsRequest{
			LeaderboardId: lbId,
			Limit:         wrapperspb.Int32(int32(len(users))),
		})
		require.NoError(t, err)
		require.Len(t, resp.Records, len(users))

		for i, u := range users {
			require.Equal(t, u.id.String(), resp.Records[i].OwnerId)
			require.Equal(t, u.score, resp.Records[i].Score)
			require.Equal(t, u.subScore, resp.Records[i].Subscore)
			require.Equal(t, int64(i+1), resp.Records[i].Rank)
		}
	}

	populateLb := func(users []*testUser, lbId string) {
		for i := range users {
			u := users[i]
			conn, cl, ses, ctx := NewAuthenticatedAPIClient(t, newId().String())
			userId, err := UserIDFromSession(ses)
			require.NoError(t, err)

			u.id = userId
			u.conn = conn
			u.cl = cl
			u.ctx = ctx

			_, err = u.cl.WriteLeaderboardRecord(ctx, &api.WriteLeaderboardRecordRequest{
				LeaderboardId: lbId,
				Record: &api.WriteLeaderboardRecordRequest_LeaderboardRecordWrite{
					Score:    u.score,
					Subscore: u.subScore,
				},
			})
			require.NoError(t, err, "should write user leaderboard record")
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

	newAPI := func(lb *Leaderboard) (*grpc.ClientConn, apigrpc.NakamaClient, *ApiServer, context.Context) {

		modules := map[string]string{
			"lb-init": fmt.Sprintf(`
local nk = require("nakama")
local reset = ""
local metadata = {}
nk.leaderboard_create(%q, %t, %q, %q, reset, metadata, %t)
`, lb.Id, lb.Authoritative, lb.GetSortOrder(), lb.GetOperator(), lb.EnableRanks),
		}

		runtime, _, rtData, err := runtimeWithModulesWithData(t, modules)
		require.NoError(t, err)

		db := NewDB(t)
		router := &DummyMessageRouter{}
		tracker := &LocalTracker{}
		sessionCache := NewLocalSessionCache(1_000, 3_600)

		pipeline := NewPipeline(logger, cfg, db, protojsonMarshaler, protojsonUnmarshaler, nil, nil, nil, nil, nil, tracker, router, runtime)

		apiServer := StartApiServer(logger, logger, db, protojsonMarshaler,
			protojsonUnmarshaler, cfg, "3.0.0", nil, nil, rtData.leaderboardCache,
			rtData.leaderboardRankCache, nil, sessionCache,
			nil, nil, nil, tracker, router, nil, metrics, pipeline, runtime)

		WaitForSocket(nil, cfg)

		conn, client, _, ctx := NewAuthenticatedAPIClient(t, uuid.Must(uuid.NewV4()).String())

		return conn, client, apiServer, ctx
	}

	t.Run("create and list leaderboard", func(t *testing.T) {
		lbId := newId().String()
		conn, cl, srv, ctx := newAPI(&Leaderboard{
			Id: lbId,
		})
		defer conn.Close()
		defer srv.Stop()

		resp, err := cl.ListLeaderboardRecords(ctx, &api.ListLeaderboardRecordsRequest{
			LeaderboardId: lbId,
		})
		require.NoError(t, err)

		require.Empty(t, resp.Records)
	})

	t.Run("override records", func(t *testing.T) {
		lbId := newId().String()
		db := NewDB(t)
		conn, cl, srv, ctx := newAPI(&Leaderboard{
			Id:        lbId,
			SortOrder: LeaderboardSortOrderDescending,
			Operator:  LeaderboardOperatorSet,
		})

		users := newUsers()
		defer cleanup(db, srv, conn, users)

		populateLb(users, lbId)

		verifyList(ctx, cl, lbId, []*testUser{
			users[4], users[3], users[2], users[1], users[0],
		})

		// Update scores for u2 and u3
		users[2].score = 500
		users[2].subScore = 501
		_, err := users[2].cl.WriteLeaderboardRecord(
			users[2].ctx, &api.WriteLeaderboardRecordRequest{
				LeaderboardId: lbId,
				Record: &api.WriteLeaderboardRecordRequest_LeaderboardRecordWrite{
					Score:    users[2].score,
					Subscore: users[2].subScore,
				},
			})
		require.NoError(t, err, "should update user leaderboard record")

		users[3].score = 200
		users[3].subScore = 201
		_, err = users[3].cl.WriteLeaderboardRecord(
			users[3].ctx, &api.WriteLeaderboardRecordRequest{
				LeaderboardId: lbId,
				Record: &api.WriteLeaderboardRecordRequest_LeaderboardRecordWrite{
					Score:    users[3].score,
					Subscore: users[3].subScore,
				},
			})
		require.NoError(t, err, "should update user leaderboard record")

		// The order is now different
		verifyList(ctx, cl, lbId, []*testUser{
			users[2], users[3], users[4], users[1], users[0],
		})
	})

	t.Run("delete records", func(t *testing.T) {
		lbId := newId().String()
		db := NewDB(t)
		conn, cl, srv, ctx := newAPI(&Leaderboard{
			Id:        lbId,
			SortOrder: LeaderboardSortOrderDescending,
			Operator:  LeaderboardOperatorSet,
		})

		users := newUsers()
		defer cleanup(db, srv, conn, users)

		populateLb(users, lbId)

		verifyList(ctx, cl, lbId, []*testUser{
			users[4], users[3], users[2], users[1], users[0],
		})

		// Delete scores for u2 and u3
		_, err := users[2].cl.DeleteLeaderboardRecord(
			users[2].ctx, &api.DeleteLeaderboardRecordRequest{
				LeaderboardId: lbId,
			})
		require.NoError(t, err, "should delete user leaderboard record")

		_, err = users[3].cl.DeleteLeaderboardRecord(
			users[3].ctx, &api.DeleteLeaderboardRecordRequest{
				LeaderboardId: lbId,
			})
		require.NoError(t, err, "should delete user leaderboard record")

		// u2 and u3 should be missing from the list
		verifyList(ctx, cl, lbId, []*testUser{
			users[4], users[1], users[0],
		})
	})

	t.Run("list records around owner", func(t *testing.T) {
		lbId := newId().String()
		db := NewDB(t)
		conn, cl, srv, ctx := newAPI(&Leaderboard{
			Id:          lbId,
			SortOrder:   LeaderboardSortOrderDescending,
			Operator:    LeaderboardOperatorSet,
			EnableRanks: true,
		})

		users := newUsers()
		defer cleanup(db, srv, conn, users)

		populateLb(users, lbId)

		verifyList(ctx, cl, lbId, []*testUser{
			users[4], users[3], users[2], users[1], users[0],
		})

		// Fetch from the middle
		resp, err := cl.ListLeaderboardRecordsAroundOwner(ctx, &api.ListLeaderboardRecordsAroundOwnerRequest{
			LeaderboardId: lbId,
			Limit:         wrapperspb.UInt32(3),
			OwnerId:       users[2].id.String(),
		})
		require.NoError(t, err, "should list user leaderboard records around owner")

		require.Len(t, resp.Records, 3)
		require.Equal(t, users[3].id.String(), resp.Records[0].OwnerId)
		require.Equal(t, int64(2), resp.Records[0].Rank)

		require.Equal(t, users[2].id.String(), resp.Records[1].OwnerId)
		require.Equal(t, int64(3), resp.Records[1].Rank)

		require.Equal(t, users[1].id.String(), resp.Records[2].OwnerId)
		require.Equal(t, int64(4), resp.Records[2].Rank)

		// Fetch from the top
		resp, err = cl.ListLeaderboardRecordsAroundOwner(ctx, &api.ListLeaderboardRecordsAroundOwnerRequest{
			LeaderboardId: lbId,
			Limit:         wrapperspb.UInt32(3),
			OwnerId:       users[4].id.String(),
		})
		require.NoError(t, err, "should list user leaderboard records around owner")

		require.Len(t, resp.Records, 3)
		require.Equal(t, users[4].id.String(), resp.Records[0].OwnerId)
		require.Equal(t, int64(1), resp.Records[0].Rank)

		require.Equal(t, users[3].id.String(), resp.Records[1].OwnerId)
		require.Equal(t, int64(2), resp.Records[1].Rank)

		require.Equal(t, users[2].id.String(), resp.Records[2].OwnerId)
		require.Equal(t, int64(3), resp.Records[2].Rank)

		// Fetch from the bottom
		resp, err = cl.ListLeaderboardRecordsAroundOwner(ctx, &api.ListLeaderboardRecordsAroundOwnerRequest{
			LeaderboardId: lbId,
			Limit:         wrapperspb.UInt32(3),
			OwnerId:       users[0].id.String(),
		})
		require.NoError(t, err, "should list user leaderboard records around owner")

		require.Len(t, resp.Records, 3)
		require.Equal(t, users[2].id.String(), resp.Records[0].OwnerId)
		require.Equal(t, int64(3), resp.Records[0].Rank)

		require.Equal(t, users[1].id.String(), resp.Records[1].OwnerId)
		require.Equal(t, int64(4), resp.Records[1].Rank)

		require.Equal(t, users[0].id.String(), resp.Records[2].OwnerId)
		require.Equal(t, int64(5), resp.Records[2].Rank)
	})

	t.Run("disable ranks", func(t *testing.T) {
		lbId := newId().String()
		db := NewDB(t)
		conn, cl, srv, ctx := newAPI(&Leaderboard{
			Id:          lbId,
			SortOrder:   LeaderboardSortOrderDescending,
			Operator:    LeaderboardOperatorSet,
			EnableRanks: true,
		})

		users := newUsers()
		defer cleanup(db, srv, conn, users)

		populateLb(users, lbId)

		verifyList(ctx, cl, lbId, []*testUser{
			users[4], users[3], users[2], users[1], users[0],
		})

		if err := disableLeaderboardRanks(ctx, logger, db, srv.leaderboardCache, srv.leaderboardRankCache, lbId); err != nil {
			t.Fatal("should disable leaderboard ranks")
		}

		// Fetch from the middle
		resp, err := cl.ListLeaderboardRecordsAroundOwner(ctx, &api.ListLeaderboardRecordsAroundOwnerRequest{
			LeaderboardId: lbId,
			Limit:         wrapperspb.UInt32(3),
			OwnerId:       users[2].id.String(),
		})
		require.NoError(t, err, "should list user leaderboard records around owner")

		require.Len(t, resp.Records, 3)
		require.Equal(t, users[3].id.String(), resp.Records[0].OwnerId)
		require.Equal(t, int64(0), resp.Records[0].Rank)

		require.Equal(t, users[2].id.String(), resp.Records[1].OwnerId)
		require.Equal(t, int64(0), resp.Records[1].Rank)

		require.Equal(t, users[1].id.String(), resp.Records[2].OwnerId)
		require.Equal(t, int64(0), resp.Records[2].Rank)
	})
}
