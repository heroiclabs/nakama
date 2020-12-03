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
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"strconv"
	"sync/atomic"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v2/console"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type consoleStorageCursor struct {
	Key        string
	UserID     uuid.UUID
	Collection string
	Read       int32
}

var collectionSetCache = &atomic.Value{}

func (s *ConsoleServer) DeleteStorage(ctx context.Context, in *empty.Empty) (*empty.Empty, error) {
	_, err := s.db.ExecContext(ctx, "TRUNCATE TABLE storage")
	if err != nil {
		s.logger.Error("Failed to truncate Storage table.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while deleting storage objects.")
	}
	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteStorageObject(ctx context.Context, in *console.DeleteStorageObjectRequest) (*empty.Empty, error) {
	if in.Collection == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid collection.")
	}
	if in.Key == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid key.")
	}
	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	code, err := StorageDeleteObjects(ctx, s.logger, s.db, true, StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: in.UserId,
			ObjectID: &api.DeleteStorageObjectId{
				Collection: in.Collection,
				Key:        in.Key,
				Version:    in.Version,
			},
		},
	})

	if err != nil {
		if code == codes.Internal {
			s.logger.Error("Failed to delete storage object.", zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while deleting storage object.")
		}

		// OCC error or storage not found, no need to log.
		return nil, err
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) GetStorage(ctx context.Context, in *api.ReadStorageObjectId) (*api.StorageObject, error) {
	if in.Collection == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid collection.")
	}
	if in.Key == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid key.")
	}
	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	objects, err := StorageReadObjects(ctx, s.logger, s.db, uuid.Nil, []*api.ReadStorageObjectId{in})
	if err != nil {
		// Errors already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while reading storage object.")
	}

	if objects.Objects == nil || len(objects.Objects) < 1 {
		// Not found.
		return nil, status.Error(codes.NotFound, "Storage object not found.")
	}

	return objects.Objects[0], nil
}

func (s *ConsoleServer) ListStorageCollections(ctx context.Context, in *empty.Empty) (*console.StorageCollectionsList, error) {
	collectionSetCache := collectionSetCache.Load()
	if collectionSetCache == nil {
		return &console.StorageCollectionsList{
			Collections: make([]string, 0),
		}, nil
	}

	collections, ok := collectionSetCache.([]string)
	if !ok {
		s.logger.Error("Error reading collection set cache, not a []string.")
		return &console.StorageCollectionsList{
			Collections: make([]string, 0),
		}, nil
	}

	return &console.StorageCollectionsList{
		Collections: collections,
	}, nil
}

func (s *ConsoleServer) ListStorage(ctx context.Context, in *console.ListStorageRequest) (*console.StorageList, error) {
	const defaultLimit = 100

	// Validate user ID, if provided.
	var userID *uuid.UUID
	if in.UserId != "" {
		uid, err := uuid.FromString(in.UserId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID when provided.")
		}
		userID = &uid
	}

	// Validate cursor, if provided.
	var cursor *consoleStorageCursor
	if in.Cursor != "" {
		// Pagination not allowed when filtering only by user ID. Don't process the cursor further.
		if in.Collection == "" && in.Key == "" {
			return nil, status.Error(codes.InvalidArgument, "Cursor not allowed when filter only contains user ID.")
		}
		// Pagination not allowed when filtering by collection, key, and user ID all at once. Don't process the cursor further.
		if in.Collection != "" && in.Key != "" && userID != nil {
			return nil, status.Error(codes.InvalidArgument, "Cursor not allowed when filter only contains collection, key, and user ID.")
		}

		cb, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Warn("Could not base64 decode console storage list cursor.", zap.String("cursor", in.Cursor))
			return nil, errors.New("Malformed cursor was used.")
		}
		cursor = &consoleStorageCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
			s.logger.Error("Error decoding console storage list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode console storage list request cursor.")
		}

		// If cursor was provided it must not clash with filter parameters.
		if in.Collection != "" && in.Collection != cursor.Collection {
			return nil, status.Error(codes.InvalidArgument, "Requires a matching cursor and collection filter property.")
		}
		if in.Key != "" && in.Key != cursor.Key {
			return nil, status.Error(codes.InvalidArgument, "Requires a matching cursor and key filter property.")
		}
		if in.UserId != "" && in.UserId != cursor.UserID.String() {
			return nil, status.Error(codes.InvalidArgument, "Requires a matching cursor and user ID filter property.")
		}
	}

	limit := defaultLimit
	var params []interface{}
	var query string

	// Allowed input filter combinations are:
	// - (no filter)
	// - user_id
	// - collection
	// - collection + key
	// - collection + user_id
	// - collection + key + user_id
	switch {
	case in.Collection == "" && in.Key == "" && userID == nil:
		// No filter. Querying and paginating on primary key (collection, read, key, user_id).
		query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage"
		if cursor != nil {
			params = append(params, cursor.Collection, cursor.Read, cursor.Key, cursor.UserID)
			query += " WHERE (collection, read, key, user_id) > ($1, $2, $3, $4)"
		}
		params = append(params, limit+1)
		query += " ORDER BY collection ASC, read ASC, key ASC, user_id ASC LIMIT $" + strconv.Itoa(len(params))
	case in.Collection == "" && in.Key == "" && userID != nil:
		// Filtering by user ID only returns all results, no pagination or limit.
		limit = 0
		params = []interface{}{*userID}
		query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE user_id = $1"
	case in.Collection != "" && in.Key == "" && userID == nil:
		// Collection only. Querying and paginating on primary key (collection, read, key, user_id).
		params = []interface{}{in.Collection}
		query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE collection = $1"
		if cursor != nil {
			params = append(params, cursor.Read, cursor.Key, cursor.UserID)
			query += " AND (collection, read, key, user_id) > ($1, $2, $3, $4)"
		}
		params = append(params, limit+1)
		query += " ORDER BY read ASC, key ASC, user_id ASC LIMIT $" + strconv.Itoa(len(params))
	case in.Collection != "" && in.Key != "" && userID == nil:
		// Collection and key. Querying and paginating on unique index (collection, key, user_id).
		params = []interface{}{in.Collection, in.Key}
		query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE collection = $1 AND key = $2"
		if cursor != nil {
			params = append(params, cursor.UserID)
			query += " AND (collection, key, user_id) > ($1, $2, $3)"
		}
		params = append(params, limit+1)
		query += " ORDER BY user_id ASC LIMIT $" + strconv.Itoa(len(params))
	case in.Collection != "" && in.Key == "" && userID != nil:
		// Collection and user ID. Querying and paginating on index (collection, user_id, read, key).
		params = []interface{}{in.Collection, *userID}
		query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE collection = $1 AND user_id = $2"
		if cursor != nil {
			params = append(params, cursor.Read, cursor.Key)
			query += " AND (collection, user_id, read, key) > ($1, $2, $3, $4)"
		}
		params = append(params, limit+1)
		query += " ORDER BY read ASC, key ASC LIMIT $" + strconv.Itoa(len(params))
	case in.Collection != "" && in.Key != "" && userID != nil:
		// Filtering by collection, key, user ID returns 0 or 1 results, no pagination or limit. Querying on unique index (collection, key, user_id).
		limit = 0
		params = []interface{}{in.Collection, in.Key, *userID}
		query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE collection = $1 AND key = $2 AND user_id = $3"
	default:
		return nil, status.Error(codes.InvalidArgument, "Requires a valid combination of filters.")
	}

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		s.logger.Error("Error querying storage objects.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list storage objects.")
	}

	objects := make([]*api.StorageObject, 0, defaultLimit)
	var nextCursor *consoleStorageCursor

	for rows.Next() {
		o := &api.StorageObject{CreateTime: &timestamp.Timestamp{}, UpdateTime: &timestamp.Timestamp{}}
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz

		if err := rows.Scan(&o.Collection, &o.Key, &o.UserId, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning storage objects.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list storage objects.")
		}

		o.CreateTime.Seconds = createTime.Time.Unix()
		o.UpdateTime.Seconds = updateTime.Time.Unix()

		objects = append(objects, o)
		if limit > 0 && len(objects) >= limit {
			nextCursor = &consoleStorageCursor{
				Key:        o.Key,
				UserID:     uuid.FromStringOrNil(o.UserId),
				Collection: o.Collection,
				Read:       o.PermissionRead,
			}
			break
		}
	}
	_ = rows.Close()

	response := &console.StorageList{
		Objects:    objects,
		PrevCursor: "",
		TotalCount: countStorage(ctx, s.logger, s.db),
	}

	if nextCursor != nil {
		cursorBuf := &bytes.Buffer{}
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			return nil, err
		}
		response.NextCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return response, nil
}

func (s *ConsoleServer) WriteStorageObject(ctx context.Context, in *console.WriteStorageObjectRequest) (*api.StorageObjectAck, error) {
	if in.Collection == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid collection.")
	}
	if in.Key == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid key.")
	}
	_, err := uuid.FromString(in.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if in.PermissionRead != nil {
		permissionRead := in.PermissionRead.GetValue()
		if permissionRead < 0 || permissionRead > 2 {
			return nil, status.Error(codes.InvalidArgument, "Requires a valid read permission read if supplied (0-2).")
		}
	}
	if in.PermissionWrite != nil {
		permissionWrite := in.PermissionWrite.GetValue()
		if permissionWrite < 0 || permissionWrite > 1 {
			return nil, status.Error(codes.InvalidArgument, "Requires a valid write permission if supplied (0-1).")
		}
	}

	if maybeJSON := []byte(in.Value); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid JSON object value.")
	}

	acks, code, err := StorageWriteObjects(ctx, s.logger, s.db, true, StorageOpWrites{
		&StorageOpWrite{
			OwnerID: in.UserId,
			Object: &api.WriteStorageObject{
				Collection:      in.Collection,
				Key:             in.Key,
				Value:           in.Value,
				Version:         in.Version,
				PermissionRead:  in.PermissionRead,
				PermissionWrite: in.PermissionWrite,
			},
		},
	})

	if err != nil {
		if code == codes.Internal {
			s.logger.Error("Failed to write storage object.", zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while writing storage object.")
		}

		// OCC error, no need to log.
		return nil, err
	}

	if acks == nil || len(acks.Acks) < 1 {
		s.logger.Error("Failed to get storage object acks.")
		return nil, status.Error(codes.Internal, "An error occurred while writing storage object.")
	}

	return acks.Acks[0], nil
}

func countStorage(ctx context.Context, logger *zap.Logger, db *sql.DB) int32 {
	var count sql.NullInt64
	// First try a fast count on table metadata.
	if err := db.QueryRowContext(ctx, "SELECT reltuples::BIGINT FROM pg_class WHERE relname = 'storage'").Scan(&count); err != nil {
		logger.Warn("Error counting storage objects.", zap.Error(err))
		if err == context.Canceled {
			// If the context was cancelled do not attempt any further counts.
			return 0
		}
	}
	if count.Valid && count.Int64 != 0 {
		// Use this count result.
		return int32(count.Int64)
	}

	// If the first fast count failed, returned NULL, or returned 0 try a fast count on partitioned table metadata.
	if err := db.QueryRowContext(ctx, "SELECT sum(reltuples::BIGINT) FROM pg_class WHERE relname ilike 'storage%_pkey'").Scan(&count); err != nil {
		logger.Warn("Error counting storage objects.", zap.Error(err))
		if err == context.Canceled {
			// If the context was cancelled do not attempt any further counts.
			return 0
		}
	}
	if count.Valid && count.Int64 != 0 {
		// Use this count result.
		return int32(count.Int64)
	}

	// If both fast counts failed, returned NULL, or returned 0 try a full count.
	if err := db.QueryRowContext(ctx, "SELECT count(collection) FROM storage").Scan(&count); err != nil {
		logger.Warn("Error counting storage objects.", zap.Error(err))
	}
	return int32(count.Int64)
}
