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
	"encoding/json"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func (s *ApiServer) DeleteTournamentRecord(ctx context.Context, in *api.DeleteTournamentRecordRequest) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeDeleteTournamentRecord(); fn != nil {
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

	if in.TournamentId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid tournament ID.")
	}

	if err := TournamentRecordDelete(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, userID, in.TournamentId, userID.String()); err != nil {
		switch err {
		case ErrLeaderboardNotFound:
			return nil, status.Error(codes.NotFound, "Tournament not found.")
		case ErrLeaderboardAuthoritative:
			return nil, status.Error(codes.PermissionDenied, "Tournament only allows authoritative score deletions.")
		default:
			return nil, status.Error(codes.Internal, "Error deleting score from tournament.")
		}
	}

	// After hook.
	if fn := s.runtime.AfterDeleteTournamentRecord(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) JoinTournament(ctx context.Context, in *api.JoinTournamentRequest) (*emptypb.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	// Before hook.
	if fn := s.runtime.BeforeJoinTournament(); fn != nil {
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

	tournamentID := in.GetTournamentId()

	if err := TournamentJoin(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, userID, username, tournamentID); err != nil {
		if err == runtime.ErrTournamentNotFound {
			return nil, status.Error(codes.NotFound, "Tournament not found.")
		} else if err == runtime.ErrTournamentMaxSizeReached {
			return nil, status.Error(codes.InvalidArgument, "Tournament cannot be joined as it has reached its max size.")
		} else if err == runtime.ErrTournamentOutsideDuration {
			return nil, status.Error(codes.InvalidArgument, "Tournament is not active and cannot accept new joins.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to join tournament.")
	}

	// After hook.
	if fn := s.runtime.AfterJoinTournament(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), username, ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return &emptypb.Empty{}, nil
}

func (s *ApiServer) ListTournamentRecords(ctx context.Context, in *api.ListTournamentRecordsRequest) (*api.TournamentRecordList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListTournamentRecords(); fn != nil {
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

	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Tournament ID must be provided")
	}

	if len(in.GetOwnerIds()) != 0 {
		for _, ownerID := range in.OwnerIds {
			if _, err := uuid.FromString(ownerID); err != nil {
				return nil, status.Error(codes.InvalidArgument, "One or more owner IDs are invalid.")
			}
		}
	}

	var limit *wrapperspb.Int32Value
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = in.GetLimit()
	} else if len(in.GetOwnerIds()) == 0 || in.GetCursor() == "" {
		limit = &wrapperspb.Int32Value{Value: 10}
	}

	overrideExpiry := int64(0)
	if in.Expiry != nil {
		overrideExpiry = in.Expiry.Value
	}

	recordList, err := TournamentRecordsList(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.GetTournamentId(), in.OwnerIds, limit, in.Cursor, overrideExpiry)
	if err == runtime.ErrTournamentNotFound {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	} else if err == runtime.ErrTournamentOutsideDuration {
		return nil, status.Error(codes.NotFound, "Tournament has ended.")
	} else if err == ErrLeaderboardInvalidCursor {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing records from tournament.")
	}

	// After hook.
	if fn := s.runtime.AfterListTournamentRecords(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, recordList, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return recordList, nil
}

func (s *ApiServer) ListTournaments(ctx context.Context, in *api.ListTournamentsRequest) (*api.TournamentList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListTournaments(); fn != nil {
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

	var incomingCursor *TournamentListCursor

	if in.GetCursor() != "" {
		cb, err := base64.StdEncoding.DecodeString(in.GetCursor())
		if err != nil {
			return nil, ErrLeaderboardInvalidCursor
		}
		incomingCursor = &TournamentListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
			return nil, ErrLeaderboardInvalidCursor
		}
	}

	categoryStart := 0
	if in.GetCategoryStart() != nil {
		categoryStart = int(in.GetCategoryStart().GetValue())
	}

	categoryEnd := 127
	if in.GetCategoryEnd() != nil {
		categoryEnd = int(in.GetCategoryEnd().GetValue())
		if categoryEnd >= 128 {
			return nil, status.Error(codes.InvalidArgument, "Tournament category end must be >=0 and <128.")
		}
		if categoryEnd < categoryStart {
			return nil, status.Error(codes.InvalidArgument, "Tournament category end must be greater than category start.")
		}
	}

	// If startTime and endTime are both not set the API will only return active or future tournaments.
	startTime := -1 // Don't include start time in query by default.
	if in.GetStartTime() != nil {
		startTime = int(in.GetStartTime().GetValue())
	}

	endTime := -1 // Don't include end time in query by default.
	if in.GetEndTime() != nil {
		endTime = int(in.GetEndTime().GetValue())
		if endTime != 0 && endTime < startTime { // Allow 0 value to explicitly request tournaments with no end time set.
			return nil, status.Error(codes.InvalidArgument, "Tournament end time must be greater than start time.")
		}
	}

	limit := 100
	if in.GetLimit() != nil {
		limit = int(in.GetLimit().GetValue())
		if limit < 1 || limit > 100 {
			return nil, status.Error(codes.InvalidArgument, "Limit must be between 1 and 100.")
		}
	}

	records, err := TournamentList(ctx, s.logger, s.db, s.leaderboardCache, categoryStart, categoryEnd, startTime, endTime, limit, incomingCursor)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error listing tournaments.")
	}

	// After hook.
	if fn := s.runtime.AfterListTournaments(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, records, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return records, nil
}

func (s *ApiServer) WriteTournamentRecord(ctx context.Context, in *api.WriteTournamentRecordRequest) (*api.LeaderboardRecord, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	// Before hook.
	if fn := s.runtime.BeforeWriteTournamentRecord(); fn != nil {
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

	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Tournament ID must be provided.")
	} else if in.GetRecord() == nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid input, record score value is required.")
	} else if in.GetRecord().GetMetadata() != "" {
		if maybeJSON := []byte(in.GetRecord().GetMetadata()); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
			return nil, status.Error(codes.InvalidArgument, "Metadata value must be JSON, if provided.")
		}
	}

	tournament := s.leaderboardCache.Get(in.GetTournamentId())
	if tournament == nil {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	}

	if tournament.EndTime > 0 && tournament.EndTime <= time.Now().UTC().Unix() {
		return nil, status.Error(codes.NotFound, "Tournament not found or has ended.")
	}

	record, err := TournamentRecordWrite(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, userID, in.GetTournamentId(), userID, username, in.GetRecord().GetScore(), in.GetRecord().GetSubscore(), in.GetRecord().GetMetadata(), in.GetRecord().GetOperator())
	if err != nil {
		switch err {
		case runtime.ErrTournamentMaxSizeReached:
			return nil, status.Error(codes.FailedPrecondition, "Tournament has reached max size.")
		case runtime.ErrTournamentAuthoritative:
			return nil, status.Error(codes.PermissionDenied, "Tournament only allows authoritative score submissions.")
		case runtime.ErrTournamentWriteMaxNumScoreReached:
			return nil, status.Error(codes.FailedPrecondition, "Reached allowed max number of score attempts.")
		case runtime.ErrTournamentWriteJoinRequired:
			return nil, status.Error(codes.FailedPrecondition, "Must join tournament before attempting to write value.")
		case runtime.ErrTournamentOutsideDuration:
			return nil, status.Error(codes.FailedPrecondition, "Tournament is not active and cannot accept new scores.")
		default:
			return nil, status.Error(codes.Internal, "Error writing score to tournament.")
		}
	}

	// After hook.
	if fn := s.runtime.AfterWriteTournamentRecord(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), username, ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, record, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return record, nil
}

func (s *ApiServer) ListTournamentRecordsAroundOwner(ctx context.Context, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.TournamentRecordList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListTournamentRecordsAroundOwner(); fn != nil {
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

	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid tournament ID.")
	}

	limit := 100
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

	records, err := TournamentRecordsHaystack(ctx, s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.GetTournamentId(), in.Cursor, ownerID, limit, overrideExpiry)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error querying records from leaderboard.")
	}

	// After hook.
	if fn := s.runtime.AfterListTournamentRecordsAroundOwner(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, records, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return records, nil
}
