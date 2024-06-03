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
	"encoding/json"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func (s *ApiServer) DeleteLeaderboardRecord(ctx context.Context, in *api.DeleteLeaderboardRecordRequest) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeDeleteLeaderboardRecord(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	if err := LeaderboardRecordDelete(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, userID, in.LeaderboardId, userID.String()); err != nil {
		switch err {
		case ErrLeaderboardNotFound:
			return nil, status.Error(codes.NotFound, "Leaderboard not found.")
		case ErrLeaderboardAuthoritative:
			return nil, status.Error(codes.PermissionDenied, "Leaderboard only allows authoritative score deletions.")
		default:
			return nil, status.Error(codes.Internal, "Error deleting score from leaderboard.")
		}
	}

	// After hook.
	if fn := s.runtime.AfterDeleteLeaderboardRecord(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) ListLeaderboardRecords(ctx context.Context, in *api.ListLeaderboardRecordsRequest) (*api.LeaderboardRecordList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListLeaderboardRecords(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	var limit *wrapperspb.Int32Value
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 1000 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 1000.")
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
	if err != nil {
		switch err {
		case ErrLeaderboardNotFound:
			return nil, status.Error(codes.NotFound, "Leaderboard not found.")
		case ErrLeaderboardInvalidCursor:
			return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
		default:
			return nil, status.Error(codes.Internal, "Error listing records from leaderboard.")
		}
	}

	// After hook.
	if fn := s.runtime.AfterListLeaderboardRecords(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, records, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return records, nil
}

func (s *ApiServer) WriteLeaderboardRecord(ctx context.Context, in *api.WriteLeaderboardRecordRequest) (*api.LeaderboardRecord, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	// Before hook.
	if fn := s.runtime.BeforeWriteLeaderboardRecord(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, userID.String(), username, ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", userID.String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if in.LeaderboardId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	} else if in.Record == nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid input, record score value is required.")
	} else if in.Record.Metadata != "" {
		if maybeJSON := []byte(in.Record.Metadata); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
			return nil, status.Error(codes.InvalidArgument, "Metadata value must be JSON, if provided.")
		}
	}

	record, err := LeaderboardRecordWrite(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, userID, in.LeaderboardId, userID.String(), username, in.Record.Score, in.Record.Subscore, in.Record.Metadata, in.Record.Operator)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err == ErrLeaderboardAuthoritative {
		return nil, status.Error(codes.PermissionDenied, "Leaderboard only allows authoritative score submissions.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error writing score to leaderboard.")
	}

	// After hook.
	if fn := s.runtime.AfterWriteLeaderboardRecord(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), username, ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, record, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return record, nil
}

func (s *ApiServer) ListLeaderboardRecordsAroundOwner(ctx context.Context, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.LeaderboardRecordList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListLeaderboardRecordsAroundOwner(); fn != nil {
		beforeFn := func(clientIP, clientPort string) error {
			result, err, code := fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
			if err != nil {
				return status.Error(code, err.Error())
			}
			if result == nil {
				// If result is nil, requested resource is disabled.
				s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", ctx.Value(ctxFullMethodKey{}).(string)), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
				return status.Error(codes.NotFound, "Requested resource was not found.")
			}
			in = result
			return nil
		}

		// Execute the before function lambda wrapped in a trace for stats measurement.
		err := traceApiBefore(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), beforeFn)
		if err != nil {
			return nil, err
		}
	}

	if in.GetLeaderboardId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid leaderboard ID.")
	}

	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	if in.GetOwnerId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Owner ID must be provided for a haystack query.")
	}

	ownerID, err := uuid.FromString(in.GetOwnerId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid owner ID provided.")
	}

	overrideExpiry := int64(0)
	if in.Expiry != nil {
		overrideExpiry = in.Expiry.Value
	}

	records, err := LeaderboardRecordsHaystack(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.GetLeaderboardId(), in.Cursor, ownerID, limit, overrideExpiry)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Leaderboard not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error querying records from leaderboard.")
	}

	// After hook.
	if fn := s.runtime.AfterListLeaderboardRecordsAroundOwner(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, records, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return records, nil
}
