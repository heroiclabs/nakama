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
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"errors"
	"fmt"

	"context"
	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
)

type storageCursor struct {
	Key    string
	UserID []byte
	Read   int32
}

func StorageListObjects(logger *zap.Logger, db *sql.DB, caller uuid.UUID, ownerID uuid.UUID, collection string, limit int, cursor string) (*api.StorageObjectList, codes.Code, error) {
	var sc *storageCursor = nil
	if cursor != "" {
		sc = &storageCursor{}
		if cb, err := base64.RawURLEncoding.DecodeString(cursor); err != nil {
			logger.Warn("Could not base64 decode storage cursor.", zap.String("cursor", cursor))
			return nil, codes.InvalidArgument, errors.New("Malformed cursor was used.")
		} else {
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(sc); err != nil {
				logger.Warn("Could not decode storage cursor.", zap.String("cursor", cursor))
				return nil, codes.InvalidArgument, errors.New("Malformed cursor was used.")
			}
		}
	}

	var result *api.StorageObjectList
	var resultErr error
	if uuid.Equal(caller, uuid.Nil) {
		// disregard permissions
		result, resultErr = StorageListObjectsUser(logger, db, true, ownerID, collection, limit, cursor, sc)
	} else if uuid.Equal(ownerID, uuid.Nil) {
		// not authoritative but trying to list global data from context of a user.
		result, resultErr = StorageListObjectsPublicRead(logger, db, collection, limit, cursor, sc)
	} else {
		if uuid.Equal(caller, ownerID) {
			// trying to list own user data
			result, resultErr = StorageListObjectsUser(logger, db, false, ownerID, collection, limit, cursor, sc)
		} else {
			// trying to list someone else's data
			result, resultErr = StorageListObjectsPublicReadUser(logger, db, ownerID, collection, limit, cursor, sc)
		}
	}

	if resultErr != nil {
		return nil, codes.Internal, resultErr
	}

	return result, codes.OK, nil
}

func StorageListObjectsPublicRead(logger *zap.Logger, db *sql.DB, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
	cursorQuery := ""
	params := []interface{}{collection, limit}
	if storageCursor != nil {
		cursorQuery = ` AND (collection, read, key, user_id) > ($1, 2, $3, $4) `
		params = append(params, storageCursor.Key, storageCursor.UserID)
	}

	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND read = 2` + cursorQuery + `
LIMIT $2`

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: cursor}, nil
		} else {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return nil, err
		}
	}
	defer rows.Close()

	objects, err := storageListObjects(rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func StorageListObjectsPublicReadUser(logger *zap.Logger, db *sql.DB, userID uuid.UUID, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
	cursorQuery := ""
	params := []interface{}{collection, userID, limit}
	if storageCursor != nil {
		cursorQuery = ` AND (collection, read, key, user_id) > ($1, 2, $4, $5) `
		params = append(params, storageCursor.Key, storageCursor.UserID)
	}

	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND read = 2 AND user_id = $2 ` + cursorQuery + `
LIMIT $3`

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: cursor}, nil
		} else {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return nil, err
		}
	}
	defer rows.Close()

	objects, err := storageListObjects(rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func StorageListObjectsUser(logger *zap.Logger, db *sql.DB, authoritative bool, userID uuid.UUID, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
	cursorQuery := ""
	params := []interface{}{collection, userID, limit}
	if storageCursor != nil {
		cursorQuery = ` AND (collection, read, key, user_id) > ($1, $4, $5, $6) `
		params = append(params, storageCursor.Read, storageCursor.Key, storageCursor.UserID)
	}

	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND read > 0 AND user_id = $2 ` + cursorQuery + `
LIMIT $3`
	if authoritative {
		// disregard permissions
		query = `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND user_id = $2 ` + cursorQuery + `
LIMIT $3`
	}

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: cursor}, nil
		} else {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return nil, err
		}
	}
	defer rows.Close()

	objects, err := storageListObjects(rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func StorageReadAllUserObjects(logger *zap.Logger, db *sql.DB, userID uuid.UUID) ([]*api.StorageObject, error) {
	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE user_id = $1`

	rows, err := db.Query(query, userID)
	if err != nil {
		if err == sql.ErrNoRows {
			return make([]*api.StorageObject, 0), nil
		} else {
			logger.Error("Could not read storage objects.", zap.Error(err), zap.String("user_id", userID.String()))
			return nil, err
		}
	}
	defer rows.Close()

	objects := make([]*api.StorageObject, 0)
	for rows.Next() {
		o := &api.StorageObject{CreateTime: &timestamp.Timestamp{}, UpdateTime: &timestamp.Timestamp{}}
		var createTime pq.NullTime
		var updateTime pq.NullTime
		var userID sql.NullString
		if err := rows.Scan(&o.Collection, &o.Key, &userID, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
			return nil, err
		}

		o.CreateTime.Seconds = createTime.Time.Unix()
		o.UpdateTime.Seconds = updateTime.Time.Unix()

		o.UserId = userID.String
		objects = append(objects, o)
	}

	if rows.Err() != nil {
		logger.Error("Could not read storage objects.", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, rows.Err()
	}

	return objects, err
}

func storageListObjects(rows *sql.Rows, cursor string) (*api.StorageObjectList, error) {
	objects := make([]*api.StorageObject, 0)
	for rows.Next() {
		o := &api.StorageObject{CreateTime: &timestamp.Timestamp{}, UpdateTime: &timestamp.Timestamp{}}
		var createTime pq.NullTime
		var updateTime pq.NullTime
		var userID sql.NullString
		if err := rows.Scan(&o.Collection, &o.Key, &userID, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
			return nil, err
		}

		o.CreateTime.Seconds = createTime.Time.Unix()
		o.UpdateTime.Seconds = updateTime.Time.Unix()

		o.UserId = userID.String
		objects = append(objects, o)
	}

	if rows.Err() != nil {
		return nil, rows.Err()
	}

	objectList := &api.StorageObjectList{
		Objects: objects,
		Cursor:  cursor,
	}

	if len(objects) > 0 {
		lastObject := objects[len(objects)-1]
		newCursor := &storageCursor{
			Key:  lastObject.Key,
			Read: lastObject.PermissionRead,
		}

		if lastObject.UserId != "" {
			newCursor.UserID = uuid.FromStringOrNil(lastObject.UserId).Bytes()
		}

		cursorBuf := new(bytes.Buffer)
		if err := gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
			return nil, err
		}
		objectList.Cursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return objectList, nil
}

func StorageReadObjects(logger *zap.Logger, db *sql.DB, caller uuid.UUID, objectIDs []*api.ReadStorageObjectId) (*api.StorageObjects, error) {
	params := make([]interface{}, 0)

	whereClause := ""
	for _, id := range objectIDs {
		l := len(params)
		if whereClause != "" {
			whereClause += " OR "
		}

		if uuid.Equal(caller, uuid.Nil) { // Disregard permissions if called authoritatively.
			whereClause += fmt.Sprintf(" (collection = $%v AND key = $%v AND user_id = $%v) ", l+1, l+2, l+3)
			if id.UserId == "" {
				params = append(params, id.Collection, id.Key, uuid.Nil)
			} else {
				params = append(params, id.Collection, id.Key, id.UserId)
			}
		} else if id.GetUserId() == "" {
			whereClause += fmt.Sprintf(" (collection = $%v AND key = $%v AND user_id = $%v AND read = 2) ", l+1, l+2, l+3)
			params = append(params, id.Collection, id.Key, uuid.Nil)
		} else {
			whereClause += fmt.Sprintf(" (collection = $%v AND key = $%v AND user_id = $%v AND (read = 2 OR (read = 1 AND user_id = $%v))) ", l+1, l+2, l+3, l+4)
			params = append(params, id.Collection, id.Key, id.UserId, caller)
		}
	}

	query := `
SELECT collection, key, user_id, value, version, read, write, create_time, update_time
FROM storage
WHERE
` + whereClause

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjects{Objects: make([]*api.StorageObject, 0)}, nil
		} else {
			logger.Error("Could not read storage objects.", zap.Error(err))
			return nil, err
		}
	}
	defer rows.Close()

	objects := &api.StorageObjects{Objects: make([]*api.StorageObject, 0)}
	for rows.Next() {
		o := &api.StorageObject{CreateTime: &timestamp.Timestamp{}, UpdateTime: &timestamp.Timestamp{}}
		var createTime pq.NullTime
		var updateTime pq.NullTime

		var userID sql.NullString
		if err := rows.Scan(&o.Collection, &o.Key, &userID, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTime, &updateTime); err != nil {
			return nil, err
		}

		o.CreateTime.Seconds = createTime.Time.Unix()
		o.UpdateTime.Seconds = updateTime.Time.Unix()

		if !uuid.Equal(uuid.FromStringOrNil(userID.String), uuid.Nil) {
			o.UserId = userID.String
		}
		objects.Objects = append(objects.Objects, o)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not read storage objects.", zap.Error(err))
		return nil, err
	}

	return objects, nil
}

func StorageWriteObjects(logger *zap.Logger, db *sql.DB, authoritativeWrite bool, objects map[uuid.UUID][]*api.WriteStorageObject) (*api.StorageObjectAcks, codes.Code, error) {
	acks := &api.StorageObjectAcks{}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, codes.Internal, err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		for ownerID, userObjects := range objects {
			for _, object := range userObjects {
				ack, writeErr := storageWriteObject(logger, tx, authoritativeWrite, ownerID, object)
				if writeErr != nil {
					if writeErr == sql.ErrNoRows {
						return StatusError(codes.InvalidArgument, "Storage write rejected.", errors.New("Storage write rejected - not found, version check failed, or permission denied."))
					}

					logger.Debug("Error writing storage objects.", zap.Error(err))
					return err
				}

				acks.Acks = append(acks.Acks, ack)
			}
		}
		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, e.Code(), e.Cause()
		}
		logger.Error("Error writing storage objects.", zap.Error(err))
		return nil, codes.Internal, err
	}

	return acks, codes.OK, nil
}

func storageWriteObject(logger *zap.Logger, tx *sql.Tx, authoritativeWrite bool, ownerID uuid.UUID, object *api.WriteStorageObject) (*api.StorageObjectAck, error) {
	permissionRead := int32(1)
	if object.GetPermissionRead() != nil {
		permissionRead = object.GetPermissionRead().GetValue()
	}

	permissionWrite := int32(1)
	if object.GetPermissionWrite() != nil {
		permissionWrite = object.GetPermissionWrite().GetValue()
	}

	params := []interface{}{object.GetCollection(), object.GetKey(), object.GetValue(), object.GetValue(), permissionRead, permissionWrite, ownerID}
	query, params := getStorageWriteQuery(authoritativeWrite, object.GetVersion(), params)

	ack := &api.StorageObjectAck{}
	if !uuid.Equal(ownerID, uuid.Nil) {
		ack.UserId = ownerID.String()
	}

	if err := tx.QueryRow(query, params...).Scan(&ack.Collection, &ack.Key, &ack.Version); err != nil {
		if err != sql.ErrNoRows {
			logger.Debug("Could not write storage object.", zap.Error(err), zap.String("query", query), zap.Any("object", object))
		}

		return nil, err
	}

	return ack, nil
}

func getStorageWriteQuery(authoritativeWrite bool, version string, params []interface{}) (string, []interface{}) {
	query := ""

	// Write storage objects authoritatively, disregarding permissions.
	if authoritativeWrite {
		if version == "" {
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
		} else if version == "*" { // if-none-match
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
WHERE NOT EXISTS
	(SELECT key FROM storage
		WHERE user_id = $7::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR)
RETURNING collection, key, version`
		} else { // if-match
			params = append(params, version)
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
WHERE EXISTS
	(SELECT key FROM storage
		WHERE user_id = $7::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR
		AND version = $8::VARCHAR)
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
		}
	} else {
		if version == "" {
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
WHERE NOT EXISTS
	(SELECT key FROM storage
		WHERE user_id = $7::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR
		AND write = 0)
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
		} else if version == "*" { // if-none-match
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
WHERE NOT EXISTS
	(SELECT key FROM storage
		WHERE user_id = $7::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR)
RETURNING collection, key, version`
		} else { // if-match
			params = append(params, version)
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
WHERE EXISTS
	(SELECT key FROM storage
		WHERE user_id = $7::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR
		AND version = $8::VARCHAR
		AND write = 1)
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
		}
	}

	return query, params
}

func StorageDeleteObjects(logger *zap.Logger, db *sql.DB, authoritativeDelete bool, userObjectIDs map[uuid.UUID][]*api.DeleteStorageObjectId) (codes.Code, error) {
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return codes.Internal, err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		for ownerID, objectIDs := range userObjectIDs {
			for _, objectID := range objectIDs {
				params := []interface{}{objectID.GetCollection(), objectID.GetKey(), ownerID}
				query := "DELETE FROM storage WHERE collection = $1 AND key = $2 AND user_id = $3"

				if !authoritativeDelete {
					query = "DELETE FROM storage WHERE collection = $1 AND key = $2 AND user_id = $3 AND write > 0"
				}

				if objectID.GetVersion() != "" {
					params = append(params, objectID.Version)
					query += fmt.Sprintf(" AND version = $4")
				}

				result, err := tx.Exec(query, params...)
				if err != nil {
					logger.Debug("Could not delete storage object.", zap.Error(err), zap.String("query", query), zap.Any("object_id", objectID))
					return err
				}

				if rowsAffected, _ := result.RowsAffected(); rowsAffected == 0 {
					return StatusError(codes.InvalidArgument, "Storage delete rejected.", errors.New("Storage delete rejected - not found, version check failed, or permission denied."))
				}
			}
		}
		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			return e.Code(), e.Cause()
		}
		logger.Error("Error deleting storage objects.", zap.Error(err))
		return codes.Internal, err
	}

	return codes.OK, nil
}
