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
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListChannelMessages(ctx context.Context, in *api.ListChannelMessagesRequest) (*api.ChannelMessageList, error) {
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

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	messageList, err := ChannelMessagesList(s.logger, s.db, userID, streamConversionResult.Stream, in.ChannelId, limit, forward, in.Cursor)
	if err == ErrChannelCursorInvalid {
		return nil, status.Error(codes.InvalidArgument, "Cursor is invalid or expired.")
	} else if err == ErrChannelGroupNotFound {
		return nil, status.Error(codes.InvalidArgument, "Group not found.")
	} else if err != nil {
		return nil, status.Error(codes.Internal, "Error listing messages from channel.")
	}

	return messageList, nil
}
