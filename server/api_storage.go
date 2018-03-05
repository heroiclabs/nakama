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
	"encoding/base64"
	"encoding/gob"

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListStorageObjects(ctx context.Context, in *api.ListStorageObjectsRequest) (*api.StorageObjectList, error) {
	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	cursor := in.GetCursor()
	var storageCursor *storageCursor = nil
	if cursor != "" {
		storageCursor = &storageCursor{}
		if cb, err := base64.RawURLEncoding.DecodeString(cursor); err != nil {
			s.logger.Warn("Could not base64 decode storage cursor.", zap.String("cursor", cursor))
			return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
		} else {
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(storageCursor); err != nil {
				s.logger.Warn("Could not decode storage cursor.", zap.String("cursor", cursor))
				return nil, status.Error(codes.InvalidArgument, "Malformed cursor was used.")
			}
		}
	}

	var storageObjectList *api.StorageObjectList
	var listingError error
	if in.GetUserId() != "" {
		uid, err := uuid.FromString(in.GetUserId())
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "Invalid user ID - make sure user ID is a valid UUID.")
		}

		userID := ctx.Value(ctxUserIDKey{}).(uuid.UUID)
		if uuid.Equal(userID, uid) {
			storageObjectList, listingError = StorageObjectsListUser(s.logger, s.db, userID, in.GetCollection(), limit, cursor, storageCursor)
		} else {
			storageObjectList, listingError = StorageObjectsListPublicReadUser(s.logger, s.db, uid, in.GetCollection(), limit, cursor, storageCursor)
		}
	} else {
		storageObjectList, listingError = StorageObjectsListPublicRead(s.logger, s.db, in.GetCollection(), limit, cursor, storageCursor)
	}

	if listingError != nil {
		return nil, status.Error(codes.Internal, "Error listing storage objects.")
	}

	return storageObjectList, nil
}

func (s *ApiServer) ReadStorageObjects(ctx context.Context, in *api.ReadStorageObjectsRequest) (*api.StorageObjects, error) {
	return nil, nil
}

func (s *ApiServer) WriteStorageObjects(ctx context.Context, in *api.WriteStorageObjectsRequest) (*api.StorageObjectAcks, error) {
	if in.GetObjects() == nil || len(in.GetObjects()) == 0 {
		return &api.StorageObjectAcks{}, nil
	}

	return nil, nil
}

func (s *ApiServer) DeleteStorageObjects(ctx context.Context, in *api.DeleteStorageObjectsRequest) (*empty.Empty, error) {
	return &empty.Empty{}, nil
}
