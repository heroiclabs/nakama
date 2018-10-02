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

func (s *ApiServer) ListChannelMessages(ctx context.Context, in *api.ListChannelMessagesRequest) (*api.ChannelMessageList, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeListChannelMessages(); fn != nil {
		// Stats measurement start boundary.
		fullMethod := ctx.Value(ctxFullMethodKey{}).(string)
		name := fmt.Sprintf("%v-before", fullMethod)
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		result, err, code := fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, in)
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

	if in.ChannelId == "" {
		return nil, status.Error(codes.InvalidArgument, "Invalid channel ID.")
	}

	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	forward := true
	if in.GetForward() != nil {
		forward = in.GetForward().Value
	}

	streamConversionResult, err := ChannelIdToStream(in.ChannelId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid channel ID.")
	}

	messageList, err := ChannelMessagesList(s.logger, s.db, userID, streamConversionResult.Stream, in.ChannelId, limit, forward, in.Cursor)
	if err == ErrChannelCursorInvalid {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err == ErrChannelGroupNotFound {
		return nil, status.Error(codes.InvalidArgument, "Group not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing messages from channel.")
	}

	// After hook.
	if fn := s.runtime.AfterListChannelMessages(); fn != nil {
		// Stats measurement start boundary.
		name := fmt.Sprintf("%v-after", ctx.Value(ctxFullMethodKey{}).(string))
		statsCtx, _ := tag.New(context.Background(), tag.Upsert(MetricsFunction, name))
		startNanos := time.Now().UTC().UnixNano()
		span := trace.NewSpan(name, nil, trace.StartOptions{})

		// Extract request information and execute the hook.
		clientIP, clientPort := extractClientAddress(s.logger, ctx)
		fn(s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, messageList)

		// Stats measurement end boundary.
		span.End()
		stats.Record(statsCtx, MetricsApiTimeSpentMsec.M(float64(time.Now().UTC().UnixNano()-startNanos)/1000), MetricsApiCount.M(1))
	}

	return messageList, nil
}
