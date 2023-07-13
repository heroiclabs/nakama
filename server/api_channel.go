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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListChannelMessages(ctx context.Context, in *api.ListChannelMessagesRequest) (*api.ChannelMessageList, error) {
	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)

	// Before hook.
	if fn := s.runtime.BeforeListChannelMessages(); fn != nil {
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

	messageList, err := ChannelMessagesList(ctx, s.logger, s.db, userID, streamConversionResult.Stream, in.ChannelId, limit, forward, in.Cursor)
	if err == runtime.ErrChannelCursorInvalid {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err == runtime.ErrChannelGroupNotFound {
		return nil, status.Error(codes.InvalidArgument, "Group not found.")
	} else if err == runtime.ErrChannelIDInvalid {
		return nil, status.Error(codes.InvalidArgument, "Channel not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing messages from channel.")
	}

	// After hook.
	if fn := s.runtime.AfterListChannelMessages(); fn != nil {
		afterFn := func(clientIP, clientPort string) error {
			return fn(ctx, s.logger, userID.String(), ctx.Value(ctxUsernameKey{}).(string), ctx.Value(ctxVarsKey{}).(map[string]string), ctx.Value(ctxExpiryKey{}).(int64), clientIP, clientPort, messageList, in)
		}

		// Execute the after function lambda wrapped in a trace for stats measurement.
		traceApiAfter(ctx, s.logger, s.metrics, ctx.Value(ctxFullMethodKey{}).(string), afterFn)
	}

	return messageList, nil
}
