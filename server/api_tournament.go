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
	"fmt"
	"time"

	"go.opencensus.io/stats"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"
	"go.uber.org/zap"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) JoinTournament(ctx context.Context, in *api.JoinTournamentRequest) (*empty.Empty, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	// Before hook.
	if fn := s.runtime.BeforeJoinTournament(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), username, ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", userID.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	tournamentId := in.GetTournamentId()

	if err := TournamentJoin(s.logger, s.db, s.leaderboardCache, userID.String(), username, tournamentId); err != nil {
		if err == ErrTournamentNotFound {
			return nil, status.Error(codes.NotFound, "Tournament not found.")
		} else if err == ErrTournamentMaxSizeReached {
			return nil, status.Error(codes.InvalidArgument, "Tournament cannot be joined as it has reached its max size.")
		} else if err == ErrTournamentOutsideDuration {
			return nil, status.Error(codes.InvalidArgument, "Tournament is not active and cannot accept new joins.")
		}
		return nil, status.Error(codes.Internal, "Error while trying to join tournament.")
	}

	// After hook.
	if fn := s.runtime.AfterJoinTournament(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), username, ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, &empty.Empty{})

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) ListTournamentRecords(ctx context.Context, in *api.ListTournamentRecordsRequest) (*api.TournamentRecordList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListTournamentRecords(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

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

	records, err := LeaderboardRecordsList(s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.GetTournamentId(), limit, in.GetCursor(), in.GetOwnerIds(), 0)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	} else if err == ErrLeaderboardInvalidCursor {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing records from tournament.")
	}

	recordList := &api.TournamentRecordList{
		Records:      records.Records,
		OwnerRecords: records.OwnerRecords,
		NextCursor:   records.NextCursor,
		PrevCursor:   records.PrevCursor,
	}

	// After hook.
	if fn := s.runtime.AfterListTournamentRecords(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, recordList)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return recordList, nil

}

func (s *ApiServer) ListTournaments(ctx context.Context, in *api.ListTournamentsRequest) (*api.TournamentList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListTournaments(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	var incomingCursor *tournamentListCursor

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

	startTime := -1 // don't include start time in query
	if in.GetStartTime() != nil {
		startTime = int(in.GetStartTime().GetValue())
	}

	endTime := int(time.Now().UTC().AddDate(1, 0, 0).Unix()) // one year from now
	if in.GetEndTime() != nil {
		endTime = int(in.GetEndTime().GetValue())
		if endTime < startTime {
			return nil, status.Error(codes.InvalidArgument, "Tournament end time must be greater than start time.")
		}
	}

	limit := 1
	if in.GetLimit() != nil {
		limit = int(in.GetLimit().GetValue())
		if limit < 1 || limit > 100 {
			return nil, status.Error(codes.InvalidArgument, "Limit must be between 1 and 100.")
		}
	}

	records, err := TournamentList(s.logger, s.db, categoryStart, categoryEnd, startTime, endTime, limit, incomingCursor)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error listing tournaments.")
	}

	// After hook.
	if fn := s.runtime.AfterListTournaments(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, records)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return records, nil
}

func (s *ApiServer) WriteTournamentRecord(ctx context.Context, in *api.WriteTournamentRecordRequest) (*api.LeaderboardRecord, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	username := ctx.Value(ctxUsernameKey{}).(string)

	// Before hook.
	if fn := s.runtime.BeforeWriteTournamentRecord(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), username, ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", userID.String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Tournament ID must be provided")
	}

	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid tournament ID.")
	} else if in.GetRecord() == nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid input, record score value is required.")
	} else if in.GetRecord().GetMetadata() != "" {
		var maybeJSON map[string]interface{}
		if json.Unmarshal([]byte(in.GetRecord().GetMetadata()), &maybeJSON) != nil {
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

	record, err := TournamentRecordWrite(s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.GetTournamentId(), userID, username, in.GetRecord().GetScore(), in.GetRecord().GetSubscore(), in.GetRecord().GetMetadata())
	if err != nil {
		if err == ErrTournamentMaxSizeReached {
			return nil, status.Error(codes.InvalidArgument, "Tournament has reached max size.")
		} else if err == ErrTournamentWriteMaxNumScoreReached {
			return nil, status.Error(codes.InvalidArgument, "Reached allowed max number of score attempts.")
		} else if err == ErrTournamentWriteJoinRequired {
			return nil, status.Error(codes.InvalidArgument, "Must join tournament before attempting to write value.")
		} else if err == ErrTournamentOutsideDuration {
			return nil, status.Error(codes.InvalidArgument, "Tournament is not active and cannot accept new scores.")
		} else {
			return nil, status.Error(codes.Internal, "Error writing score to tournament.")
		}
	}

	// After hook.
	if fn := s.runtime.AfterWriteTournamentRecord(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), username, ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, record)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return record, nil
}

func (s *ApiServer) ListTournamentRecordsAroundOwner(ctx context.Context, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.TournamentRecordList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListTournamentRecordsAroundOwner(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
		if err != nil {
			return nil, status.Error(code, err.Error())
		}
		if result == nil {
			// If result is nil, requested resource is disabled.
			s.logger.Warn("Intercepted a disabled resource.", zap.Any("resource", fullMethod), zap.String("uid", ctx.Value(ctxUserIDKey{}).(uuid.UUID).String()))
			return nil, status.Error(codes.NotFound, "Requested resource was not found.")
		}
		in = result

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	if in.GetTournamentId() == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid tournament ID.")
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

	ownerId, err := uuid.FromString(in.GetOwnerId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid owner ID provided.")
	}

	records, err := TournamentRecordsHaystack(s.logger, s.db, s.leaderboardCache, s.leaderboardRankCache, in.GetTournamentId(), ownerId, limit)
	if err == ErrLeaderboardNotFound {
		return nil, status.Error(codes.NotFound, "Tournament not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error querying records from leaderboard.")
	}

	list := &api.TournamentRecordList{Records: records}

	// After hook.
	if fn := s.runtime.AfterListTournamentRecordsAroundOwner(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, ctx.Value(ctxUserIDKey{}).(uuid.UUID).String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, list)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return list, nil
}
