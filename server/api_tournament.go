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
	"bytes"
	"context"
	"encoding/base64"
	"encoding/gob"
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

	if len(in.GetOwnerIds()) != 0 {
		for _, ownerId := range in.OwnerIds {
			if _, err := uuid.FromString(ownerId); err != nil {
				return nil, status.Error(codes.InvalidArgument, "One or more owner IDs are invalid.")
			}
		}
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
	var incomingCursor *tournamentListCursor

	if in.GetOwnerId() != "" {
		if _, err := uuid.FromString(in.GetOwnerId()); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Owner ID is invalid.")
		}
	}

	if in.GetCursor() != "" {
		if cb, err := base64.StdEncoding.DecodeString(in.GetCursor()); err != nil {
			return nil, ErrLeaderboardInvalidCursor
		} else {
			incomingCursor = &tournamentListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
				return nil, ErrLeaderboardInvalidCursor
			}
		}
	}

	categoryStart := -1
	if in.GetCategoryStart() != nil {
		categoryStart = int(in.GetCategoryStart().GetValue())
	}

	categoryEnd := -1
	if in.GetCategoryEnd() != nil {
		categoryEnd = int(in.GetCategoryEnd().GetValue())
		if categoryEnd < categoryStart {
			return nil, status.Error(codes.InvalidArgument, "Tournament category end must be greater than category start.")
		}
	}

	startTime := -1
	if in.GetStartTime() != nil {
		startTime = int(in.GetStartTime().GetValue())
	}

	endTime := -1
	if in.GetEndTime() != nil {
		endTime = int(in.GetEndTime().GetValue())
		if endTime < startTime {
			return nil, status.Error(codes.InvalidArgument, "Tournament end time must be greater than start time.")
		}
	}

	limit := 1
	if in.GetLimit() != nil {
		limit := int(in.GetLimit().GetValue())
		if limit < 1 || limit > 100 {
			return nil, status.Error(codes.InvalidArgument, "Limit must be between 1 and 100.")
		}
	}

	full := false
	if in.GetFull() != nil {
		full = in.GetFull().GetValue()
	}

	records, err := TournamentList(s.logger, s.db, in.GetOwnerId(), full, categoryStart, categoryEnd, startTime, endTime, limit, incomingCursor)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error listing tournaments.")
	}
	return records, nil
}

func (s *ApiServer) WriteTournamentRecord(ctx context.Context, in *api.WriteTournamentRecordRequest) (*api.LeaderboardRecord, error) {
	return nil, nil
}
