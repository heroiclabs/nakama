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

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListNotifications(ctx context.Context, in *api.ListNotificationsRequest) (*api.NotificationList, error) {
	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	cursor := in.GetCacheableCursor()
	var nc *notificationCacheableCursor = nil
	if cursor != "" {
		nc = &notificationCacheableCursor{}
		if cb, err := base64.RawURLEncoding.DecodeString(cursor); err != nil {
			s.logger.Warn("Could not base64 decode notification cursor.", zap.String("cursor", cursor))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		} else {
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(nc); err != nil {
				s.logger.Warn("Could not decode notification cursor.", zap.String("cursor", cursor))
				return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
			}
		}
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	notificationList, err := NotificationList(s.logger, s.db, userID, limit, cursor, nc)
	if err != nil {
		return nil, status.Error(codes.Internal, "Error retrieving notifications.")
	}

	return notificationList, nil
}

func (s *ApiServer) DeleteNotifications(ctx context.Context, in *api.DeleteNotificationsRequest) (*empty.Empty, error) {
	if len(in.GetIds()) == 0 {
		return &empty.Empty{}, nil
	}

	userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
	if err := NotificationDelete(s.logger, s.db, userID, in.GetIds()); err != nil {
		return nil, status.Error(codes.Internal, "Error while deleting notifications.")
	}

	return &empty.Empty{}, nil
}
