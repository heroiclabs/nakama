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
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func (s *ConsoleServer) ListLeaderboards(ctx context.Context, _ *emptypb.Empty) (*console.LeaderboardList, error) {
	leaderboards := s.leaderboardCache.GetAllLeaderboards()

	resultList := make([]*console.Leaderboard, 0, len(leaderboards))
	for _, l := range leaderboards {
		resultList = append(resultList, &console.Leaderboard{
			Id:            l.Id,
			SortOrder:     uint32(l.SortOrder),
			Operator:      uint32(l.Operator),
			ResetSchedule: l.ResetScheduleStr,
			Authoritative: l.Authoritative,
			Tournament:    l.IsTournament(),
		})
	}

	return &console.LeaderboardList{Leaderboards: resultList}, nil
}

func (s *ConsoleServer) GetLeaderboard(ctx context.Context, in *console.LeaderboardRequest) (*console.Leaderboard, error) {
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Tournament ID must be set.")
	}

	l := s.leaderboardCache.Get(in.Id)
	if l == nil {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	}

	var t *api.Tournament
	if l.IsTournament() {
		results, err := TournamentList(ctx, s.logger, s.db, s.leaderboardCache, l.Category, l.Category, int(l.StartTime), int(l.EndTime), 1, nil)
		if err != nil {
			s.logger.Error("Error retrieving tournament.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error retrieving tournament.")
		}

		if len(results.Tournaments) == 0 {
			return nil, status.Error(codes.NotFound, "Leaderboard not found.")
		}

		t = results.Tournaments[0]
	}

	result := &console.Leaderboard{
		Id:            l.Id,
		SortOrder:     uint32(l.SortOrder),
		Operator:      uint32(l.Operator),
		ResetSchedule: l.ResetScheduleStr,
		CreateTime:    &timestamppb.Timestamp{Seconds: l.CreateTime},
		Authoritative: l.Authoritative,
		Metadata:      l.Metadata,
		Tournament:    false,
	}

	if t != nil {
		result.Tournament = true
		result.StartTime = t.StartTime
		result.EndTime = t.EndTime
		result.Duration = t.Duration
		result.StartActive = t.StartActive
		result.JoinRequired = l.JoinRequired
		result.Title = t.Title
		result.Description = t.Description
		result.Category = t.Category
		result.Size = t.Size
		result.MaxSize = t.MaxSize
		result.MaxNumScore = t.MaxNumScore
		result.EndActive = t.EndActive
	}

	return result, nil
}

func (s *ConsoleServer) ListLeaderboardRecords(ctx context.Context, in *api.ListLeaderboardRecordsRequest) (*api.LeaderboardRecordList, error) {
	var limit *wrapperspb.Int32Value
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = in.GetLimit()
	} else if len(in.GetOwnerIds()) == 0 || in.GetCursor() != "" {
		limit = &wrapperspb.Int32Value{Value: 1}
	}

	if len(in.GetOwnerIds()) != 0 {
		for _, ownerID := range in.OwnerIds {
			if _, err := uuid.FromString(ownerID); err != nil {
				return nil, status.Error(codes.InvalidArgument, "One or more owner IDs are invalid.")
			}
		}
	}

	overrideExpiry := int64(0)
	if in.Expiry != nil {
		overrideExpiry = in.Expiry.Value
	}

	records, err := LeaderboardRecordsList(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.LeaderboardId, limit, in.Cursor, in.OwnerIds, overrideExpiry)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err == ErrLeaderboardInvalidCursor {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing records from leaderboard.")
	}

	return records, nil
}

func (s *ConsoleServer) DeleteLeaderboard(ctx context.Context, in *console.LeaderboardRequest) (*emptypb.Empty, error) {
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Expects a leaderboard ID")
	}

	if err := s.leaderboardCache.Delete(ctx, in.Id); err != nil {
		// Logged internally
		return nil, status.Error(codes.Internal, "Error deleting leaderboard.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) DeleteLeaderboardRecord(ctx context.Context, in *console.DeleteLeaderboardRecordRequest) (*emptypb.Empty, error) {
	if in.Id == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	// Pass uuid.Nil as userID to bypass leaderboard Authoritative check.
	err := LeaderboardRecordDelete(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, uuid.Nil, in.Id, in.OwnerId)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error deleting score from leaderboard.")
	}

	return &emptypb.Empty{}, nil
}
