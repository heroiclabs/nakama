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
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v2/console"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"sort"
	"strings"
	"sync"

	"github.com/golang/protobuf/ptypes/empty"
)

type consoleStorageCursor struct {
	Key        string
	UserID     uuid.UUID
	Collection string
}

var collectionSetCache map[string]bool
var collectionSetCacheRwMutex = new(sync.RWMutex)

func maybeUpdateCollectionSetCache(collection string) {
	collectionSetCacheRwMutex.Lock()
	defer collectionSetCacheRwMutex.Unlock()
	if collectionSetCache == nil {
		collectionSetCache = make(map[string]bool)
	}
	collectionSetCache[collection] = true
}

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
	if collectionSetCache != nil {
		collectionSetCacheRwMutex.RLock()
		defer collectionSetCacheRwMutex.RUnlock()
		result := &console.StorageCollectionsList{
			Collections: make([]string, 0, len(collectionSetCache)),
		}
		for collection := range collectionSetCache {
			result.Collections = append(result.Collections, collection)
		}
		return result, nil
	}
	collectionSetCacheRwMutex.Lock()
	collectionSetCache = make(map[string]bool, 0)
	collectionSetCacheRwMutex.Unlock()
	collections := make([]string, 0)
	query := "SELECT DISTINCT collection FROM storage"
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		s.logger.Error("Error querying storage collections.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list storage collections.")
	}
	for rows.Next() {
		var dbCollection string
		if err := rows.Scan(&dbCollection); err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning storage collections.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list storage collecctions.")
		}
		collectionSetCacheRwMutex.Lock()
		collectionSetCache[dbCollection] = true
		collectionSetCacheRwMutex.Unlock()
		collections = append(collections, dbCollection)
	}

	sort.Strings(collections)

	return &console.StorageCollectionsList{
		Collections: collections,
	}, nil

}

func (s *ConsoleServer) ListStorage(ctx context.Context, in *console.ListStorageRequest) (*console.StorageList, error) {
	const limit = 100
	var userID *uuid.UUID
	if in.UserId != "" {
		uid, err := uuid.FromString(in.UserId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID when provided.")
		}
		userID = &uid
	}
	var query string

	args := make([]string, 0)
	params := make([]interface{}, 0, 1)
	query = ""
	if userID != nil {
		args = append(args, "user_id =")
		params = append(params, *userID)
	}
	if in.Key != "" {
		args = append(args, "key =")
		params = append(params, in.Key)
	}
	if in.Collection != "" {
		args = append(args, "collection =")
		params = append(params, in.Collection)
	}
	for i, arg := range args {
		if query == "" {
			query += " WHERE "
		} else {
			query += " AND "
		}
		query += fmt.Sprintf("%s $%d", arg, i+1)
	}

	var prevCursor *consoleStorageCursor = nil
	var nextCursor *consoleStorageCursor = nil
	if in.Cursor != "" {
		cb, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Warn("Could not base64 decode storage cursor.", zap.String("cursor", in.Cursor))
			return nil, errors.New("Malformed cursor was used.")
		}
		sc := &consoleStorageCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(sc); err != nil {
			s.logger.Error("Error decoding storage list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode storage list request cursor.")
		}

		cursorParam := make([]string, 0)
		params = append(params, sc.Collection)
		cursorParam = append(cursorParam, fmt.Sprintf("$%d", len(params)))
		params = append(params, sc.Key)
		cursorParam = append(cursorParam, fmt.Sprintf("$%d", len(params)))
		params = append(params, sc.UserID)
		cursorParam = append(cursorParam, fmt.Sprintf("$%d", len(params)))

		prevPageExistsQuery := fmt.Sprintf("SELECT collection, key, user_id FROM storage WHERE (collection, key, user_id) < ($1, $2, $3) ORDER BY (collection, key, user_id) ASC LIMIT %d", limit)
		rows, err := s.db.QueryContext(ctx, prevPageExistsQuery, sc.Collection, sc.Key, sc.UserID)
		if err != nil {
			s.logger.Warn("Failed to query previous page cursor.", zap.Error(err))
			return nil, errors.New("Failed to query previous page cursor.")
		}
		if rows.Next() {
			var dbCollection string
			var dbKey string
			var dbUserId string
			err := rows.Scan(&dbCollection, &dbKey, &dbUserId)
			if err != nil {
				s.logger.Warn("Failed to scan previous page cursor.", zap.Error(err))
				return nil, errors.New("Failed to scan previous page cursor.")
			}
			prevCursor = &consoleStorageCursor{
				Key:        dbKey,
				UserID:     uuid.FromStringOrNil(dbUserId),
				Collection: dbCollection,
			}
		}
		rows.Close()

		if query == "" {
			query += " WHERE "
		} else {
			query += " AND "
		}
		query += fmt.Sprintf("(collection, key, user_id) >= (%s)", strings.Join(cursorParam, ","))
	}

	countQuery := "SELECT COUNT(1) FROM storage " + query
	query = "SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage " + query
	query += fmt.Sprintf(" ORDER BY (collection, key, user_id) ASC LIMIT %d", limit+1)


	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		s.logger.Error("Error querying storage objects.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list storage objects.")
	}

	objects := make([]*api.StorageObject, 0, limit)

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

		if len(objects) == limit {
			nextCursor = &consoleStorageCursor{
				Key:        o.Key,
				UserID:     uuid.FromStringOrNil(o.UserId),
				Collection: o.Collection,
			}
		} else {
			objects = append(objects, o)
		}
	}
	_ = rows.Close()

	encodeCursor := func(sc *consoleStorageCursor) (string, error) {
		if sc == nil {
			return "", nil
		}
		buf := bytes.NewBuffer([]byte{})
		err := gob.NewEncoder(buf).Encode(sc)
		if err != nil {
			return "", nil
		}
		return base64.RawURLEncoding.EncodeToString(buf.Bytes()), nil
	}
	scPrevEncoded, err := encodeCursor(prevCursor)
	if err != nil {
		s.logger.Error("Error encoding storage list cursor.", zap.Any("cursor", prevCursor), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to encoding storage list request cursor.")
	}
	scNextEncoded, err := encodeCursor(nextCursor)
	if err != nil {
		s.logger.Error("Error encoding storage list cursor.", zap.Any("cursor", nextCursor), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to encoding storage list request cursor.")
	}

	var count sql.NullInt64
	if err := s.db.QueryRowContext(ctx, countQuery, params...).Scan(&count); err != nil {
		s.logger.Warn("Error counting storage objects.", zap.Error(err))
		if err == context.Canceled {
			return nil, nil
		}
	}
	var countint int32
	if count.Valid && count.Int64 != 0 {
		countint = int32(count.Int64)
	}

	return &console.StorageList{
		Objects:    objects,
		PrevCursor: scPrevEncoded,
		NextCursor: scNextEncoded,
		TotalCount: countint,
	}, nil

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
