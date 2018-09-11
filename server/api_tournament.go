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
	"context"
	"strings"
	"time"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) JoinTournament(ctx context.Context, in *api.JoinTournamentRequest) (*empty.Empty, error) {
	tournamentId := in.GetTournamentId()
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	if err := TournamentJoin(s.logger, s.db, s.leaderboardCache, userID.String(), username, tournamentId); err != nil {
		if strings.Contains(err.Error(), "not found") {
			return nil, status.Error(codes.NotFound, "Tournament not found.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to join tournament.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ListTournamentRecords(ctx context.Context, in *api.ListTournamentRecordsRequest) (*api.TournamentRecordList, error) {
	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Tournament ID must be provided")
	}

	tournament := s.leaderboardCache.Get(in.GetTournamentId())
	if tournament == nil {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	}

	if tournament.EndTime <= time.Now().UTC().Unix() {
		return nil, status.Error(codes.NotFound, "Tournament not found or has ended.")
	}

	var limit *wrappers.Int32Value
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = in.GetLimit()
	} else if len(in.GetOwnerIds()) == 0 || in.GetCursor() != "" {
		limit = &wrappers.Int32Value{Value: 1}
	}

	records, err := LeaderboardRecordsList(s.logger, s.db, s.leaderboardCache, in.GetTournamentId(), limit, in.GetCursor(), in.GetOwnerIds())
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	} else if err == ErrLeaderboardInvalidCursor {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing records from tournament.")
	}

	return &api.TournamentRecordList{
		Records:      records.Records,
		OwnerRecords: records.OwnerRecords,
		NextCursor:   records.NextCursor,
		PrevCursor:   records.PrevCursor,
	}, nil

}

func (s *ApiServer) ListTournaments(ctx context.Context, in *api.ListTournamentsRequest) (*api.TournamentList, error) {

	return nil, nil
}

func (s *ApiServer) WriteTournamentRecord(ctx context.Context, in *api.WriteTournamentRecordRequest) (*api.LeaderboardRecord, error) {
	return nil, nil
}
