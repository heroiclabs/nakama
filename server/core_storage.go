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

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
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

	objects, err := storageObjectsList(logger, rows, cursor)
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

	objects, err := storageObjectsList(logger, rows, cursor)
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

	objects, err := storageObjectsList(logger, rows, cursor)
	if err != nil {
		logger.Error("Could not list storage.", zap.Error(err), zap.String("collection", collection), zap.Int("limit", limit), zap.String("cursor", cursor))
	}

	return objects, err
}

func storageObjectsList(logger *zap.Logger, rows *sql.Rows, cursor string) (*api.StorageObjectList, error) {
	objects := make([]*api.StorageObject, 0)
	for rows.Next() {
		o := &api.StorageObject{CreateTime: &timestamp.Timestamp{}, UpdateTime: &timestamp.Timestamp{}}
		var userID sql.NullString
		if err := rows.Scan(&o.Collection, &o.Key, &userID, &o.Value, &o.Version, o.PermissionRead, o.PermissionWrite, &o.CreateTime.Seconds, &o.UpdateTime.Seconds); err != nil {
			logger.Error("Could not scan notification from database.", zap.Error(err))
			return nil, err
		}
		o.UserId = userID.String
		objects = append(objects, o)
	}

	if rows.Err() != nil {
		logger.Error("Could not list storage objects", zap.Error(rows.Err()))
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
			logger.Error("Could not create new cursor.", zap.Error(err))
			return nil, err
		}
		objectList.Cursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return objectList, nil
}
