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
	"crypto/md5"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type storageCursor struct {
	Key    string
	UserID uuid.UUID
	Read   int32
}

// Internal representation for a batch of storage write operations.
type StorageOpWrites []*StorageOpWrite

type StorageOpWrite struct {
	OwnerID string
	Object  *api.WriteStorageObject
}

// Desired `read` persmission after this Op completes
func (op *StorageOpWrite) permissionRead() int32 {
	if op.Object.PermissionRead != nil {
		return op.Object.PermissionRead.Value
	}
	return 1
}

// Desired `write` persmission after this Op completes
func (op *StorageOpWrite) permissionWrite() int32 {
	if op.Object.PermissionWrite != nil {
		return op.Object.PermissionWrite.Value
	}
	return 1
}

// Expected object version after this Op completes
func (op *StorageOpWrite) expectedVersion() string {
	hash := md5.Sum([]byte(op.Object.Value))
	return hex.EncodeToString(hash[:])
}

func (s StorageOpWrites) Len() int {
	return len(s)
}
func (s StorageOpWrites) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}
func (s StorageOpWrites) Less(i, j int) bool {
	s1, s2 := s[i], s[j]
	if s1.Object.Collection != s2.Object.Collection {
		return s1.Object.Collection < s2.Object.Collection
	}
	if s1.Object.Key != s2.Object.Key {
		return s1.Object.Key < s2.Object.Key
	}
	return s1.OwnerID < s2.OwnerID
}

// Internal representation for a batch of storage delete operations.
type StorageOpDeletes []*StorageOpDelete

type StorageOpDelete struct {
	OwnerID  string
	ObjectID *api.DeleteStorageObjectId
}

func (s StorageOpDeletes) Len() int {
	return len(s)
}
func (s StorageOpDeletes) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}
func (s StorageOpDeletes) Less(i, j int) bool {
	s1, s2 := s[i], s[j]
	if s1.ObjectID.Collection != s2.ObjectID.Collection {
		return s1.ObjectID.Collection < s2.ObjectID.Collection
	}
	if s1.ObjectID.Key != s2.ObjectID.Key {
		return s1.ObjectID.Key < s2.ObjectID.Key
	}
	return s1.OwnerID < s2.OwnerID
}

func StorageListObjects(ctx context.Context, logger *zap.Logger, db *sql.DB, caller uuid.UUID, ownerID *uuid.UUID, collection string, limit int, cursor string) (*api.StorageObjectList, codes.Code, error) {
	if limit <= 0 {
		return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: ""}, codes.OK, nil
	}

	var sc *storageCursor
	if cursor != "" {
		sc = &storageCursor{}
		cb, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			logger.Warn("Could not base64 decode storage cursor.", zap.String("cursor", cursor))
			return nil, codes.InvalidArgument, errors.New("Malformed cursor was used.")
		}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(sc); err != nil {
			logger.Warn("Could not decode storage cursor.", zap.String("cursor", cursor))
			return nil, codes.InvalidArgument, errors.New("Malformed cursor was used.")
		}
	}

	var result *api.StorageObjectList
	var resultErr error

	if caller == uuid.Nil {
		// Call from the runtime.
		if ownerID == nil {
			// List storage regardless of user.
			result, resultErr = StorageListObjectsAll(ctx, logger, db, true, collection, limit, cursor, sc)
		} else {
			// List for a particular user ID.
			result, resultErr = StorageListObjectsUser(ctx, logger, db, true, *ownerID, collection, limit, cursor, sc)
		}
	} else {
		// Call from a client.
		if ownerID == nil {
			// List publicly readable storage regardless of owner.
			result, resultErr = StorageListObjectsAll(ctx, logger, db, false, collection, limit, cursor, sc)
		} else if o := *ownerID; caller == o {
			// User listing their own data.
			result, resultErr = StorageListObjectsUser(ctx, logger, db, false, o, collection, limit, cursor, sc)
		} else {
			// User listing someone else's data.
			result, resultErr = StorageListObjectsPublicReadUser(ctx, logger, db, o, collection, limit, cursor, sc)
		}
	}

	if resultErr != nil {
		return nil, codes.Internal, resultErr
	}

	if cursor != "" && result.Cursor == cursor {
		result.Cursor = ""
	}
	return result, codes.OK, nil
}

func StorageListObjectsAll(ctx context.Context, logger *zap.Logger, db *sql.DB, authoritative bool, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
	cursorQuery := ""
	params := []interface{}{collection, limit + 1}
	if storageCursor != nil {
		if authoritative {
			// Authoritative listings observe the read permission in the cursor.
			cursorQuery = ` AND (collection, read, key, user_id) > ($1, $3, $4, $5) `
			params = append(params, storageCursor.Read, storageCursor.Key, storageCursor.UserID)
		} else {
			// Non-authoritative listings can only ever list for read permission 2 in this type of listing.
			cursorQuery = ` AND (collection, read, key, user_id) > ($1, 2, $3, $4) `
			params = append(params, storageCursor.Key, storageCursor.UserID)
		}
	}

	var query string
	if authoritative {
		query = `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1` + cursorQuery + `
ORDER BY read ASC, key ASC, user_id ASC
LIMIT $2`
	} else {
		query = `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND read >= 2` + cursorQuery + `
ORDER BY read ASC, key ASC, user_id ASC
LIMIT $2`
	}

	var objects *api.StorageObjectList
	err := ExecuteRetryable(func() error {
		rows, err := db.QueryContext(ctx, query, params...)
		if err != nil {
			if err == sql.ErrNoRows {
				objects = &api.StorageObjectList{Objects: make([]*api.StorageObject, 0)}
				return nil
			}
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return err
		}
		// rows.Close() called in storageListObjects

		objects, err = storageListObjects(rows, limit)
		if err != nil {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return err
		}
		return nil
	})

	return objects, err
}

func StorageListObjectsPublicReadUser(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
	cursorQuery := ""
	params := []interface{}{collection, userID, limit + 1}
	if storageCursor != nil {
		// Ignore cursor read permission and user ID, the listing operation itself is only scoped to one user and public read permission.
		cursorQuery = ` AND (collection, read, user_id, key) > ($1, 2, $2, $4) `
		params = append(params, storageCursor.Key)
	}

	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND read = 2 AND user_id = $2 ` + cursorQuery + `
ORDER BY key ASC
LIMIT $3`

	var objects *api.StorageObjectList
	err := ExecuteRetryable(func() error {
		rows, err := db.QueryContext(ctx, query, params...)
		if err != nil {
			if err == sql.ErrNoRows {
				objects = &api.StorageObjectList{Objects: make([]*api.StorageObject, 0)}
				return nil
			}
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return err
		}
		// rows.Close() called in storageListObjects

		objects, err = storageListObjects(rows, limit)
		if err != nil {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return err
		}
		return nil
	})

	return objects, err
}

func StorageListObjectsUser(ctx context.Context, logger *zap.Logger, db *sql.DB, authoritative bool, userID uuid.UUID, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
	cursorQuery := ""
	params := []interface{}{collection, userID, limit + 1}
	if storageCursor != nil {
		// User ID is always a known user based on the type of the listing operation.
		cursorQuery = ` AND (collection, user_id, read, key) > ($1, $2, $4, $5) `
		params = append(params, storageCursor.Read, storageCursor.Key)
	}

	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND user_id = $2 AND read >= 1 ` + cursorQuery + `
ORDER BY read ASC, key ASC
LIMIT $3`
	if authoritative {
		// List across all read permissions.
		query = `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND user_id = $2 AND read >= 0 ` + cursorQuery + `
ORDER BY read ASC, key ASC
LIMIT $3`
	}

	var objects *api.StorageObjectList
	err := ExecuteRetryable(func() error {
		rows, err := db.QueryContext(ctx, query, params...)
		if err != nil {
			if err == sql.ErrNoRows {
				objects = &api.StorageObjectList{Objects: make([]*api.StorageObject, 0)}
				return nil
			}
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return err
		}
		// rows.Close() called in storageListObjects

		objects, err = storageListObjects(rows, limit)
		if err != nil {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return err
		}
		return nil
	})

	return objects, err
}

func StorageReadAllUserObjects(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*api.StorageObject, error) {
	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE user_id = $1`

	var objects []*api.StorageObject
	err := ExecuteRetryable(func() error {
		rows, err := db.QueryContext(ctx, query, userID)
		if err != nil {
			if err == sql.ErrNoRows {
				objects = make([]*api.StorageObject, 0)
				return nil
			}
			logger.Error("Could not read storage objects.", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		}
		defer rows.Close()

		funcObjects := make([]*api.StorageObject, 0, 10)
		for rows.Next() {
			o := &api.StorageObject{CreateTime: &timestamppb.Timestamp{}, UpdateTime: &timestamppb.Timestamp{}}
			var createTime pgtype.Timestamptz
			var updateTime pgtype.Timestamptz

			if err := rows.Scan(&o.Collection, &o.Key, &o.UserId, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
				return err
			}

			o.CreateTime.Seconds = createTime.Time.Unix()
			o.UpdateTime.Seconds = updateTime.Time.Unix()

			funcObjects = append(funcObjects, o)
		}

		if rows.Err() != nil {
			logger.Error("Could not read storage objects.", zap.Error(err), zap.String("user_id", userID.String()))
			return rows.Err()
		}
		objects = funcObjects
		return nil
	})

	return objects, err
}

func storageListObjects(rows *sql.Rows, limit int) (*api.StorageObjectList, error) {
	var lastObject *api.StorageObject
	var newCursor *storageCursor
	objects := make([]*api.StorageObject, 0, limit)
	for rows.Next() {
		// If we've read enough, but there is at least 1 more, use the last read as the cursor and stop here.
		if len(objects) >= limit && lastObject != nil {
			newCursor = &storageCursor{
				Key:  lastObject.Key,
				Read: lastObject.PermissionRead,
			}
			if lastObject.UserId != "" {
				newCursor.UserID = uuid.FromStringOrNil(lastObject.UserId)
			}
			break
		}

		// There is still room for more objects, read the next one.
		o := &api.StorageObject{CreateTime: &timestamppb.Timestamp{}, UpdateTime: &timestamppb.Timestamp{}}
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz

		if err := rows.Scan(&o.Collection, &o.Key, &o.UserId, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
			_ = rows.Close()
			return nil, err
		}

		o.CreateTime.Seconds = createTime.Time.Unix()
		o.UpdateTime.Seconds = updateTime.Time.Unix()

		objects = append(objects, o)
		lastObject = o
	}
	_ = rows.Close()

	if rows.Err() != nil {
		return nil, rows.Err()
	}

	// Prepare the response and include the cursor, if any.
	objectList := &api.StorageObjectList{
		Objects: objects,
	}
	if newCursor != nil {
		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			return nil, err
		}
		objectList.Cursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return objectList, nil
}

type storageQueryArg struct {
	name   string
	dbType string
	param  any
}

func StorageReadObjects(ctx context.Context, logger *zap.Logger, db *sql.DB, caller uuid.UUID, objectIDs []*api.ReadStorageObjectId) (*api.StorageObjects, error) {
	if len(objectIDs) == 0 {
		return &api.StorageObjects{}, nil
	}

	collectionParams := make([]string, 0, len(objectIDs))
	keyParams := make([]string, 0, len(objectIDs))
	userIdParams := make([]uuid.UUID, 0, len(objectIDs))

	isCollectionSetUnique := true
	isKeySetUnique := true
	isUserIdSetUnique := true

	distinctArgs := make([]storageQueryArg, 0, 3)
	uniqueArgs := make([]storageQueryArg, 0, 3)

	for _, id := range objectIDs {
		collectionParams = append(collectionParams, id.Collection)
		if isCollectionSetUnique {
			if id.Collection != collectionParams[0] {
				isCollectionSetUnique = false
				distinctArgs = append(distinctArgs, storageQueryArg{name: "collection", dbType: "text[]", param: &collectionParams})
			}
		}

		keyParams = append(keyParams, id.Key)
		if isKeySetUnique {
			if id.Key != keyParams[0] {
				isKeySetUnique = false
				distinctArgs = append(distinctArgs, storageQueryArg{name: "key", dbType: "text[]", param: &keyParams})
			}
		}

		var reqUid uuid.UUID
		if uid := id.GetUserId(); uid != "" {
			if uid, err := uuid.FromString(uid); err == nil {
				reqUid = uid
			} else {
				logger.Error("Could not read storage objects. Unable to parse requested user_id", zap.Error(err))
				return nil, err
			}
		}
		userIdParams = append(userIdParams, reqUid)
		if isUserIdSetUnique {
			if reqUid != userIdParams[0] {
				isUserIdSetUnique = false
				distinctArgs = append(distinctArgs, storageQueryArg{name: "user_id", dbType: "uuid[]", param: &userIdParams})
			}
		}
	}

	if isCollectionSetUnique {
		uniqueArgs = append(uniqueArgs, storageQueryArg{name: "collection", param: collectionParams[0]})
	}
	if isKeySetUnique {
		uniqueArgs = append(uniqueArgs, storageQueryArg{name: "key", param: keyParams[0]})
	}
	if isUserIdSetUnique {
		uniqueArgs = append(uniqueArgs, storageQueryArg{name: "user_id", param: userIdParams[0]})
	}

	var query string
	var params []any
	switch len(distinctArgs) {
	case 0:
		query = fmt.Sprintf(`
SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE %s = $1 AND %s = $2 AND %s = $3`,
			uniqueArgs[0].name, uniqueArgs[1].name, uniqueArgs[2].name)
		params = []any{uniqueArgs[0].param, uniqueArgs[1].param, uniqueArgs[2].param}
	case 1:
		query = fmt.Sprintf(`
SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage WHERE %s = $1 AND %s = $2 AND %s = ANY($3::%s)`,
			uniqueArgs[0].name, uniqueArgs[1].name, distinctArgs[0].name, distinctArgs[0].dbType)
		params = []any{uniqueArgs[0].param, uniqueArgs[1].param, distinctArgs[0].param}
	case 2:
		query = fmt.Sprintf(`
SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage NATURAL JOIN ROWS FROM (
  unnest($1::%s),
  unnest($2::%s)
) t(%s, %s)
WHERE %s = $3`,
			distinctArgs[0].dbType, distinctArgs[1].dbType, distinctArgs[0].name, distinctArgs[1].name, uniqueArgs[0].name)
		params = []any{distinctArgs[0].param, distinctArgs[1].param, uniqueArgs[0].param}
	case 3:
		// When selecting a variable number of objects we'd like to keep number of
		// SQL query arguments constant, otherwise query statistics explode, because
		// from PostgreSQL perspective query with different number of arguments is a distinct query
		//
		// To keep number of arguments static instead of building
		// WHERE (a = $1 and b = $2) OR (a = $3 and b = $4) OR ...
		// we use JOIN with "virtual" table built from columns provided as arrays:
		//
		// JOIN ROWS FROM (
		//		unnest($1::type_of_a[]),
		//      unnest($2::type_of_b[])
		// ) v(a, b)
		//
		// This way regardless of how many objects we query, we pass same number of args: one per column
		query = fmt.Sprintf(`
SELECT collection, key, user_id, value, version, read, write, create_time, update_time FROM storage NATURAL JOIN ROWS FROM (
  unnest($1::%s),
  unnest($2::%s),
  unnest($3::%s)
) t(%s, %s, %s)`,
			distinctArgs[0].dbType, distinctArgs[1].dbType, distinctArgs[2].dbType, distinctArgs[0].name, distinctArgs[1].name, distinctArgs[2].name)
		params = []any{distinctArgs[0].param, distinctArgs[1].param, distinctArgs[2].param}
	default:
		logger.Error("Unexpected code path.", zap.Int("multipleArgs", len(distinctArgs)))
		return nil, errors.New("unexpected code path")
	}

	if caller != uuid.Nil {
		if len(distinctArgs) == 3 {
			query += ` WHERE `
		} else {
			query += ` AND `
		}
		// Caller is not nil: either read public (read=2) object from requested user
		// or private (read=1) object owned by caller
		query += `(read = 2 or (read = 1 and storage.user_id = $4))`
		params = append(params, caller)
	}

	var objects *api.StorageObjects
	err := ExecuteRetryablePgx(ctx, db, func(conn *pgx.Conn) error {
		rows, _ := conn.Query(ctx, query, params...)
		defer rows.Close()
		funcObjects := &api.StorageObjects{Objects: make([]*api.StorageObject, 0, len(objectIDs))}
		for rows.Next() {
			o := &api.StorageObject{CreateTime: &timestamppb.Timestamp{}, UpdateTime: &timestamppb.Timestamp{}}
			var createTime pgtype.Timestamptz
			var updateTime pgtype.Timestamptz

			if err := rows.Scan(&o.Collection, &o.Key, &o.UserId, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
				return err
			}

			o.CreateTime.Seconds = createTime.Time.Unix()
			o.UpdateTime.Seconds = updateTime.Time.Unix()

			funcObjects.Objects = append(funcObjects.Objects, o)
		}
		if err := rows.Err(); err != nil {
			logger.Error("Could not read storage objects.", zap.Error(err))
			return err
		}
		objects = funcObjects
		return nil
	})

	return objects, err
}

func StorageWriteObjects(ctx context.Context, logger *zap.Logger, db *sql.DB, metrics Metrics, storageIndex StorageIndex, authoritativeWrite bool, ops StorageOpWrites) (*api.StorageObjectAcks, codes.Code, error) {
	var acks []*api.StorageObjectAck
	var sortedWrites StorageOpWrites

	if err := ExecuteInTxPgx(ctx, db, func(tx pgx.Tx) error {
		// If the transaction is retried ensure we wipe any acks that may have been prepared by previous attempts.
		var writeErr error
		sortedWrites, acks, writeErr = storageWriteObjects(ctx, logger, metrics, tx, authoritativeWrite, ops)
		if writeErr != nil {
			if writeErr == runtime.ErrStorageRejectedVersion || writeErr == runtime.ErrStorageRejectedPermission {
				logger.Debug("Error writing storage objects.", zap.Error(writeErr))
				return StatusError(codes.InvalidArgument, "Storage write rejected.", writeErr)
			} else {
				logger.Error("Error writing storage objects.", zap.Error(writeErr))
			}
			return writeErr
		}

		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, e.Code(), e.Cause()
		}
		logger.Error("Error writing storage objects.", zap.Error(err))
		return nil, codes.Internal, err
	}

	storageIndexWrite(ctx, storageIndex, sortedWrites, acks)

	return &api.StorageObjectAcks{Acks: acks}, codes.OK, nil
}

func storageWriteObjects(ctx context.Context, logger *zap.Logger, metrics Metrics, tx pgx.Tx, authoritativeWrite bool, ops StorageOpWrites) (StorageOpWrites, []*api.StorageObjectAck, error) {
	// Ensure writes are processed in a consistent order to avoid deadlocks from concurrent operations.
	// Sorting done on a copy to ensure we don't modify the input, which may be re-used on transaction retries.
	sortedOps := make(StorageOpWrites, 0, len(ops))
	indexedOps := make(map[*StorageOpWrite]int, len(ops))
	for i, op := range ops {
		sortedOps = append(sortedOps, op)
		indexedOps[op] = i
	}
	sort.Sort(sortedOps)
	// Run operations in the sorted order.
	acks := make([]*api.StorageObjectAck, ops.Len())

	batch := &pgx.Batch{}
	for _, op := range sortedOps {
		storagePrepBatch(batch, authoritativeWrite, op)
	}

	br := tx.SendBatch(ctx, batch)
	defer br.Close() // TODO: need to "drain" batch, otherwise it logs all unprocessed queries
	for _, op := range sortedOps {
		object := op.Object
		var resultRead int32
		var resultWrite int32
		var resultVersion string
		var createTime time.Time
		var updateTime time.Time
		var isUpsert bool
		err := br.QueryRow().Scan(&resultRead, &resultWrite, &resultVersion, &createTime, &updateTime, &isUpsert)
		var pgErr *pgconn.PgError
		if err != nil && errors.As(err, &pgErr) {
			if pgErr.Code == dbErrorUniqueViolation {
				metrics.StorageWriteRejectCount(map[string]string{"collection": object.Collection, "reason": "version"}, 1)
				return nil, nil, runtime.ErrStorageRejectedVersion
			}
			return nil, nil, err
		} else if err == pgx.ErrNoRows {
			// Not every case from storagePrepWriteObject can return NoRows, but those
			// which do are always ErrStorageRejectedVersion
			metrics.StorageWriteRejectCount(map[string]string{"collection": object.Collection, "reason": "version"}, 1)
			return nil, nil, runtime.ErrStorageRejectedVersion
		} else if err != nil {
			return nil, nil, err
		}

		if !isUpsert {
			// Conditions for successful update or insert were not met in the query, following checks are needed to disambiguate
			// which error to return.
			if !authoritativeWrite && resultWrite != 1 {
				// - permission: non-authoritative write & original row write != 1
				metrics.StorageWriteRejectCount(map[string]string{"collection": object.Collection, "reason": "permission"}, 1)
				return nil, nil, runtime.ErrStorageRejectedPermission
			} else if object.Version != "" {
				// - version mismatch
				metrics.StorageWriteRejectCount(map[string]string{"collection": object.Collection, "reason": "version"}, 1)
				return nil, nil, runtime.ErrStorageRejectedVersion
			}
		}

		ack := &api.StorageObjectAck{
			Collection: object.Collection,
			Key:        object.Key,
			Version:    resultVersion,
			UserId:     op.OwnerID,
			CreateTime: timestamppb.New(createTime),
			UpdateTime: timestamppb.New(updateTime),
		}
		acks[indexedOps[op]] = ack
	}

	return sortedOps, acks, nil
}

func storagePrepBatch(batch *pgx.Batch, authoritativeWrite bool, op *StorageOpWrite) {
	object := op.Object
	ownerID := op.OwnerID

	newVersion := op.expectedVersion()
	newPermissionRead := op.permissionRead()
	newPermissionWrite := op.permissionWrite()

	params := []interface{}{object.Collection, object.Key, ownerID, object.Value, newVersion, newPermissionRead, newPermissionWrite}
	var query string

	writeCheck := ""
	// Respect permissions in non-authoritative writes.
	if !authoritativeWrite {
		writeCheck = " AND storage.write = 1"
	}

	switch {
	case object.Version != "" && object.Version != "*":
		// OCC if-match.

		// Query pattern
		// (UPDATE t ... RETURNING) UNION ALL (SELECT FROM t) LIMIT 1
		// allows us to fetch row state after update even if update itself fails WHERE
		// condition.
		// That is returned values are final state of the row regardless of UPDATE success
		query = `
		WITH upd AS (
			UPDATE storage SET value = $4, version = $5, read = $6, write = $7, update_time = now()
			WHERE collection = $1 AND key = $2 AND user_id = $3 AND version = $8
		` + writeCheck + `
			RETURNING read, write, version, create_time, update_time
		)
		(SELECT read, write, version, create_time, update_time, true AS update FROM upd)
		UNION ALL
		(SELECT read, write, version, create_time, update_time, false AS update FROM storage WHERE collection = $1 and key = $2 and user_id = $3 AND NOT EXISTS (SELECT 1 FROM upd))
		LIMIT 1`

		params = append(params, object.Version)

		// Outcomes:
		// - No rows: if no rows returned, then object was not found in DB and can't be updated
		// - We have row returned, but now we need to know if update happened, that is if WHERE matched
		//	 * write != 1 means no permission to write
		//	 * dbVersion != original version means OCC failure

	case object.Version == "":
		// non-OCC write, "last write wins" kind of write

		// Similar pattern as in case above, but supports case when row
		// didn't exist in the database. Another difference is that there is no version
		// check for existing row.
		query = `
		WITH upd AS (
			INSERT INTO storage (collection, key, user_id, value, version, read, write, create_time, update_time)
				VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
			ON CONFLICT (collection, key, user_id) DO
				UPDATE SET value = $4, version = $5, read = $6, write = $7, update_time = now()
				WHERE TRUE` + writeCheck + `
				AND NOT (storage.version = $5 AND storage.read = $6 AND storage.write = $7) -- micro optimization: don't update row unnecessarily
			RETURNING read, write, version, create_time, update_time
		)
		(SELECT read, write, version, create_time, update_time, true AS upsert FROM upd)
		UNION ALL
		(SELECT read, write, version, create_time, update_time, false AS upsert FROM storage WHERE collection = $1 and key = $2 and user_id = $3 AND NOT EXISTS (SELECT 1 FROM upd))
		LIMIT 1`

		// Outcomes:
		// - Row is always returned, need to know if update happened, that WHERE matches
		// - write != 1 means no permission to write

	case object.Version == "*":
		// OCC if-not-exists, and all other non-OCC cases.
		// Existing permission checks are not applicable for new storage objects.
		query = `
		INSERT INTO storage (collection, key, user_id, value, version, read, write, create_time, update_time)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
		RETURNING read, write, version, create_time, update_time, true AS upsert`

		// Outcomes:
		// - NoRows - insert failed due to constraint violation (concurrent insert)
	}

	batch.Queue(query, params...)
}

func StorageDeleteObjects(ctx context.Context, logger *zap.Logger, db *sql.DB, storageIndex StorageIndex, authoritativeDelete bool, ops StorageOpDeletes) (codes.Code, error) {
	if err := ExecuteInTxPgx(ctx, db, func(tx pgx.Tx) error {
		deleteErr := storageDeleteObjects(ctx, logger, tx, authoritativeDelete, ops)
		if deleteErr != nil {
			return deleteErr
		}
		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			return e.Code(), e.Cause()
		}
		logger.Error("Error deleting storage objects.", zap.Error(err))
		return codes.Internal, err
	}

	storageIndex.Delete(ctx, ops)

	return codes.OK, nil
}

func storageDeleteObjects(ctx context.Context, logger *zap.Logger, tx pgx.Tx, authoritativeDelete bool, ops StorageOpDeletes) error {
	// Ensure deletes are processed in a consistent order.
	sort.Sort(ops)

	for _, op := range ops {
		params := []interface{}{op.ObjectID.Collection, op.ObjectID.Key, op.OwnerID}
		var query string
		if authoritativeDelete {
			// Deleting from the runtime.
			query = "DELETE FROM storage WHERE collection = $1 AND key = $2 AND user_id = $3"
		} else {
			// Direct client request to delete.
			query = "DELETE FROM storage WHERE collection = $1 AND key = $2 AND user_id = $3 AND write > 0"
		}
		if op.ObjectID.GetVersion() != "" {
			// Conditional delete.
			params = append(params, op.ObjectID.Version)
			query += " AND version = $4"
		}

		result, err := tx.Exec(ctx, query, params...)
		if err != nil {
			logger.Debug("Could not delete storage object.", zap.Error(err), zap.String("query", query), zap.Any("object_id", op.ObjectID))
			return err
		}

		if authoritativeDelete && op.ObjectID.GetVersion() == "" {
			// If it's an authoritative delete and there is no OCC, the only reason rows affected would be 0 is having
			// nothing to delete. In that case it's safe to assume the deletion was just a no-op and there's no need
			// to check anything further. Should apply something similar to non-authoritative deletes too.
			continue
		}
		if rowsAffected := result.RowsAffected(); rowsAffected == 0 {
			return StatusError(codes.InvalidArgument, "Storage delete rejected.", errors.New("Storage delete rejected - not found, version check failed, or permission denied."))
		}
	}

	return nil
}

func storageIndexWrite(ctx context.Context, storageIndex StorageIndex, ops StorageOpWrites, acks []*api.StorageObjectAck) {
	sw := make([]*api.StorageObject, 0, len(ops))
	for i, o := range ops {
		sw = append(sw, &api.StorageObject{
			Collection:      o.Object.Collection,
			Key:             o.Object.Key,
			UserId:          o.OwnerID,
			Value:           o.Object.Value,
			Version:         acks[i].Version,
			PermissionRead:  o.Object.PermissionRead.GetValue(),
			PermissionWrite: o.Object.PermissionRead.GetValue(),
			CreateTime:      acks[i].CreateTime,
			UpdateTime:      acks[i].UpdateTime,
		})
	}

	storageIndex.Write(ctx, sw)
}
