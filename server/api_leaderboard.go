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
	"encoding/json"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) DeleteLeaderboardRecord(ctx context.Context, in *api.DeleteLeaderboardRecordRequest) (*empty.Empty, error) {
	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	err := LeaderboardRecordDelete(s.logger, s.db, s.leaderboardCache, userID, in.LeaderboardId, userID.String())
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err == ErrLeaderboardAuthoritative {
		return nil, status.Error(codes.PermissionDenied, "Leaderboard only allows authoritative score deletions.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error deleting score from leaderboard.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ListLeaderboardRecords(ctx context.Context, in *api.ListLeaderboardRecordsRequest) (*api.LeaderboardRecords, error) {
	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	records, err := LeaderboardRecordsList(s.logger, s.db, s.leaderboardCache, in.LeaderboardId, limit, in.Cursor)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err == ErrLeaderboardInvalidCursor {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing records from leaderboard.")
	}

	return records, nil
}

func (s *ApiServer) ReadLeaderboardRecords(ctx context.Context, in *api.ReadLeaderboardRecordsRequest) (*api.LeaderboardRecords, error) {
	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	for _, ownerId := range in.OwnerIds {
		if _, err := uuid.FromString(ownerId); err != nil {
			return nil, status.Error(codes.InvalidArgument, "One or more owner IDs are invalid.")
		}
	}

	records, err := LeaderboardRecordsRead(s.logger, s.db, s.leaderboardCache, in.LeaderboardId, in.OwnerIds)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err == ErrLeaderboardInvalidCursor {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing records from leaderboard.")
	}

	return records, nil
}

func (s *ApiServer) WriteLeaderboardRecord(ctx context.Context, in *api.WriteLeaderboardRecordRequest) (*api.LeaderboardRecord, error) {
	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	} else if in.Score < 0 {
		return nil, status.Error(codes.InvalidArgument, "Invalid score value, must be >= 0.")
	} else if in.Subscore < 0 {
		return nil, status.Error(codes.InvalidArgument, "Invalid subscore value, must be >= 0.")
	} else if in.Metadata != "" {
		var maybeJSON map[string]interface{}
		if json.Unmarshal([]byte(in.Metadata), &maybeJSON) != nil {
			return nil, status.Error(codes.InvalidArgument, "Metadata value must be JSON, if provided.")
		}
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	record, err := LeaderboardRecordWrite(s.logger, s.db, s.leaderboardCache, userID, in.LeaderboardId, userID.String(), username, in.Score, in.Subscore, in.Metadata)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err == ErrLeaderboardAuthoritative {
		return nil, status.Error(codes.PermissionDenied, "Leaderboard only allows authoritative score submissions.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error writing score to leaderboard.")
	}

	return record, nil
}
