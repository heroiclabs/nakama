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
	"encoding/json"
	"errors"
	"time"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
)

type storageCursor struct {
	Key    string
	UserID []byte
	Read   int32
}

func StorageObjectsListPublicRead(logger *zap.Logger, db *sql.DB, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
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
LIMIT $2
`

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: cursor}, nil
		} else {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return nil, err
		}
	}

	objects, err := storageObjectsList(rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func StorageObjectsListPublicReadUser(logger *zap.Logger, db *sql.DB, userID uuid.UUID, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
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
LIMIT $3
`

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: cursor}, nil
		} else {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return nil, err
		}
	}

	objects, err := storageObjectsList(rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func StorageObjectsListUser(logger *zap.Logger, db *sql.DB, userID uuid.UUID, collection string, limit int, cursor string, storageCursor *storageCursor) (*api.StorageObjectList, error) {
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
LIMIT $3
`

	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return &api.StorageObjectList{Objects: make([]*api.StorageObject, 0), Cursor: cursor}, nil
		} else {
			logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
			return nil, err
		}
	}

	objects, err := storageObjectsList(rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func storageObjectsList(rows *sql.Rows, cursor string) (*api.StorageObjectList, error) {
	objects := make([]*api.StorageObject, 0)
	for rows.Next() {
		o := &api.StorageObject{CreateTime: &timestamp.Timestamp{}, UpdateTime: &timestamp.Timestamp{}}
		var createTimeStr string
		var updateTimeStr string
		var userID sql.NullString
		if err := rows.Scan(&o.Collection, &o.Key, &userID, &o.Value, &o.Version, &o.PermissionRead, &o.PermissionWrite, &createTimeStr, &updateTimeStr); err != nil {
			return nil, err
		}

		createTime, _ := pq.ParseTimestamp(time.UTC, createTimeStr)
		o.CreateTime.Seconds = createTime.Unix()
		updateTime, _ := pq.ParseTimestamp(time.UTC, updateTimeStr)
		o.UpdateTime.Seconds = updateTime.Unix()

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

func StorageWriteObjects(logger *zap.Logger, db *sql.DB, writerUserID uuid.UUID, objects map[uuid.UUID][]*api.WriteStorageObject) (*api.StorageObjectAcks, codes.Code, error) {
	returnCode := codes.OK
	acks := &api.StorageObjectAcks{}

	if err := Transact(logger, db, func(tx *sql.Tx) error {
		for ownerID, userObjects := range objects {
			for _, object := range userObjects {
				ack, code, writeErr := storageWriteObject(logger, tx, writerUserID, ownerID, object)
				if writeErr != nil {
					returnCode = code
					return writeErr
				}
				acks.Acks = append(acks.Acks, ack)
			}
		}
		return nil
	}); err != nil {
		// in case it is a commit/rollback error
		if _, ok := err.(pq.Error); ok {
			return nil, codes.Internal, err
		}

		return nil, returnCode, err
	}

	return acks, returnCode, nil
}

func storageWriteObject(logger *zap.Logger, tx *sql.Tx, writerUserID uuid.UUID, ownerID uuid.UUID, object *api.WriteStorageObject) (*api.StorageObjectAck, codes.Code, error) {
	if object.GetCollection() == "" || object.GetKey() == "" {
		logger.Debug("Invalid collection or key value supplied. They must be set.", zap.Any("object", object))
		return nil, codes.InvalidArgument, errors.New("Invalid values for collection or key.")
	}

	if object.GetPermissionRead() != 0 && object.GetPermissionRead() != 1 && object.GetPermissionRead() != 2 {
		logger.Debug("Invalid Read permission supplied. It must be either 0, 1 or 2.", zap.Any("object", object))
		return nil, codes.InvalidArgument, errors.New("Invalid read permission value.")
	}

	if object.GetPermissionWrite() != 0 && object.GetPermissionWrite() != 1 {
		logger.Debug("Invalid Write permission supplied. It must be either 0 or 1.", zap.Any("object", object))
		return nil, codes.InvalidArgument, errors.New("Invalid write permission value.")
	}

	var maybeJSON interface{}
	if json.Unmarshal([]byte(object.GetValue()), &maybeJSON) != nil {
		return nil, codes.InvalidArgument, errors.New("Object value must be JSON.")
	}

	// Write storage objects authoritatively, disregarding permissions.
	authWrite := uuid.Equal(writerUserID, uuid.Nil)

	params := []interface{}{object.GetCollection(), object.GetKey(), object.GetValue(), object.GetValue(), object.GetPermissionRead(), object.GetPermissionWrite()}
	query, params := getStorageWriteQuery(authWrite, ownerID, object.GetVersion(), params)

	ack := &api.StorageObjectAck{}

	if err := tx.QueryRow(query, params...).Scan(&ack.Collection, &ack.Key, &ack.Version); err != nil {
		if err == sql.ErrNoRows {
			return nil, codes.InvalidArgument, errors.New("Storage write rejected - not found, version check failed, or permission denied.")
		}

		logger.Error("Could not write storage object.", zap.Error(err), zap.String("query", query), zap.Any("object", object))
		return nil, codes.Internal, err
	}

	return ack, codes.OK, nil
}

func getStorageWriteQuery(auth bool, ownerID uuid.UUID, version string, params []interface{}) (string, []interface{}) {
	query := ""

	// Write storage objects authoritatively, disregarding permissions.
	if auth {
		if version == "" {
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), NULL
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
			if uuid.Equal(ownerID, uuid.Nil) { // Writing object belonging to a user
				params = append(params, ownerID)
				query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
			}
		} else if version == "*" { // if-none-match
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), NULL
WHERE NOT EXISTS
	(SELECT key FROM storage
		WHERE user_id = NULL
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR)
RETURNING collection, key, version`
			if uuid.Equal(ownerID, uuid.Nil) { // Writing object belonging to a user
				params = append(params, ownerID)
				query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $7::UUID
WHERE NOT EXISTS
	(SELECT key FROM storage
		WHERE user_id = $7::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR)
RETURNING collection, key, version`
			}
		} else { // if-match
			params = append(params, version)
			query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), NULL
WHERE EXISTS
	(SELECT key FROM storage
		WHERE user_id = NULL
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR
		AND version = $7::VARCHAR)
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
			if !uuid.Equal(ownerID, uuid.Nil) { // Writing object belonging to a user
				params = append(params, ownerID)
				query = `
INSERT INTO storage (collection, key, value, version, read, write, create_time, update_time, user_id)
SELECT $1, $2, $3, md5($4::VARCHAR), $5, $6, now(), now(), $8::UUID
WHERE EXISTS
	(SELECT key FROM storage
		WHERE user_id = $8::UUID
		AND collection = $1::VARCHAR
		AND key = $2::VARCHAR
		AND version = $7::VARCHAR)
ON CONFLICT (collection, key, user_id)
DO UPDATE SET value = $3, version = md5($4::VARCHAR), read = $5, write = $6, update_time = now()
RETURNING collection, key, version`
			}
		}
	} else {
		params = append(params, ownerID)
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
