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
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/api"
	"go.opencensus.io/stats"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"time"
)

func (s *ApiServer) ListMatches(ctx context.Context, in *api.ListMatchesRequest) (*api.MatchList, error) {
	// Before hook.
	if fn := s.runtime.BeforeListMatches(); fn != nil {
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

	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	if in.Label != nil && (in.Authoritative != nil && !in.Authoritative.Value) {
		return nil, status.Error(codes.InvalidArgument, "Label filtering is not supported for non-authoritative matches.")
	}

	if in.MinSize != nil && in.MinSize.Value < 0 {
		return nil, status.Error(codes.InvalidArgument, "Minimum size must be 0 or above.")
	}
	if in.MaxSize != nil && in.MaxSize.Value < 0 {
		return nil, status.Error(codes.InvalidArgument, "Maximum size must be 0 or above.")
	}
	if in.MinSize != nil && in.MaxSize != nil && in.MinSize.Value > in.MaxSize.Value {
		return nil, status.Error(codes.InvalidArgument, "Maximum size must be greater than or equal to minimum size when both are specified.")
	}

	results := s.matchRegistry.ListMatches(limit, in.Authoritative, in.Label, in.MinSize, in.MaxSize)

	list := &api.MatchList{Matches: results}

	// After hook.
	if fn := s.runtime.AfterListMatches(); fn != nil {
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
