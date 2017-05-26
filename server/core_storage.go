// Copyright 2017 The Nakama Authors
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
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func fetchStorageData(r scanner) (*TStorageData_StorageData, error) {
	var userID []byte
	var bucket sql.NullString
	var collection sql.NullString
	var record sql.NullString
	var value []byte
	var version []byte
	var read sql.NullInt64
	var write sql.NullInt64
	var createdAt sql.NullInt64
	var updatedAt sql.NullInt64
	var expiresAt sql.NullInt64

	err := r.Scan(&userID, &bucket, &collection, &record,
		&value, &version, &read, &write,
		&createdAt, &updatedAt, &expiresAt)

	if err != nil {
		return &TStorageData_StorageData{}, err
	}

	return &TStorageData_StorageData{
		Bucket:          bucket.String,
		Collection:      collection.String,
		Record:          record.String,
		UserId:          userID,
		Value:           value,
		Version:         version,
		PermissionRead:  read.Int64,
		PermissionWrite: write.Int64,
		CreatedAt:       createdAt.Int64,
		UpdatedAt:       updatedAt.Int64,
		ExpiresAt:       expiresAt.Int64,
	}, nil
}

func StorageFetch(logger *zap.Logger, db *sql.DB, userID uuid.UUID, keys []*TStorageFetch_StorageKey) ([]*TStorageData_StorageData, error) {
	//incoming := envelope.GetStorageFetch()
	storageData := make([]*TStorageData_StorageData, 0)

	for _, key := range keys {
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			logger.Error("Invalid values for Bucket or Collection or Record")
			return nil, errors.New("Invalid values for Bucket or Collection or Record")
		}

		if len(key.UserId) != 0 {
			forUserID, err := uuid.FromBytes(key.UserId)
			if err != nil {
				return nil, errors.New("Invalid User ID")
			}

			if forUserID != userID {
				logger.Error("Not allowed to fetch from storage of a different user")
				return nil, errors.New("Not allowed to fetch from storage of a different user")
			}
		}

		var row *sql.Row
		if len(key.UserId) == 0 {
			query := `
SELECT user_id, bucket, collection, record,
	value, version, read, write,
	created_at, updated_at, expires_at
FROM storage
WHERE bucket = $1 AND collection = $2 AND record = $4 AND user_id IS NULL AND deleted_at = 0 AND read = 1`
			row = db.QueryRow(query, key.Bucket, key.Collection, key.Record)
		} else {
			query := `
SELECT user_id, bucket, collection, record,
	value, version, read, write,
	created_at, updated_at, expires_at
FROM storage
WHERE bucket = $1 AND collection = $2 AND user_id = $3 AND record = $4 AND deleted_at = 0 AND read = 1`
			row = db.QueryRow(query, key.Bucket, key.Collection, userID.Bytes(), key.Record)
		}

		data, err := fetchStorageData(row)
		if err != nil {
			logger.Error("Could not fetch from storage",
				zap.Error(err),
				zap.String("bucket", key.Bucket),
				zap.String("collection", key.Collection),
				zap.String("record", key.Record))
		} else {
			storageData = append(storageData, data)
		}
	}

	return storageData, nil
}

func StorageWrite(logger *zap.Logger, db *sql.DB, userID uuid.UUID, data []*TStorageWrite_StorageData) ([]*TStorageKey_StorageKey, error) {
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not store data", zap.Error(err))
		return nil, errors.New("Could not store data")
	}

	keys := make([]*TStorageKey_StorageKey, 0)

	updatedAt := nowMs()

	for _, d := range data {

		if d.Bucket == "" {
			//errorMessage = "Bucket value is empty"
			err = errors.New("Bucket value is empty")
			logger.Error("Could not store data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return nil, err
		} else if d.Collection == "" {
			//errorMessage = "Collection value is empty"
			err = errors.New("Collection value is empty")
			logger.Error("Could not store data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return nil, err
		} else if d.Record == "" {
			//errorMessage = "Record value is empty"
			err = errors.New("Record value is empty")
			logger.Error("Could not store data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return nil, err
		}

		recordID := uuid.NewV4().Bytes()
		sha := fmt.Sprintf("%x", sha256.Sum256(d.Value))
		version := []byte(sha)

		query := ""
		params := []interface{}{}

		var errorMessage string
		if len(d.Version) == 0 {
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8, 0
WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0 AND write = 0)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6, version = $7, updated_at = $8
`
			params = []interface{}{recordID, userID.Bytes(), d.Bucket, d.Collection, d.Record, d.Value, version, updatedAt}
			errorMessage = "Could not store data"
		} else if bytes.Equal(d.Version, []byte("*")) {
			// if-none-match
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8, 0
WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0)
`
			params = []interface{}{recordID, userID.Bytes(), d.Bucket, d.Collection, d.Record, d.Value, version, updatedAt}
			errorMessage = "Could not store data. This could be caused by failure of if-none-match version check"
		} else {
			// if-match
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8, 0
WHERE EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 and record = $5 AND version = $9 AND deleted_at = 0 AND write = 1)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6, version = $7, updated_at = $8
`
			params = []interface{}{recordID, userID.Bytes(), d.Bucket, d.Collection, d.Record, d.Value, version, updatedAt, d.Version}
			errorMessage = "Could not store data. This could be caused by failure of if-match version check"
		}

		_, err = tx.Exec(query, params...)
		if err != nil {
			logger.Error("Could not store data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return nil, errors.New(errorMessage)
		}

		keys = append(keys, &TStorageKey_StorageKey{
			Bucket:     d.Bucket,
			Collection: d.Collection,
			Record:     d.Record,
			Version:    version[:],
		})
	}

	err = tx.Commit()
	if err != nil {
		logger.Error("Could not commit transaction", zap.Error(err))
		return nil, err
	}

	return keys, nil
}

func StorageRemove(logger *zap.Logger, db *sql.DB, userID uuid.UUID, keys []*TStorageRemove_StorageKey) error {
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not remove data", zap.Error(err))
		return err
	}

	updatedAt := nowMs()

	for _, key := range keys {
		var res sql.Result

		if key.Bucket == "" {
			err = errors.New("Bucket value is empty")
			logger.Error("Could not remove data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return err
		} else if key.Collection == "" {
			err = errors.New("Collection value is empty")
			logger.Error("Could not remove data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return err
		} else if key.Record == "" {
			err = errors.New("Record value is empty")
			logger.Error("Could not remove data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return err
		}

		if key.Version != nil {
			query := `
UPDATE storage SET deleted_at = $1, updated_at = $1
WHERE bucket = $2 AND collection = $3 AND record = $4 AND user_id = $5 AND version = $6 AND deleted_at = 0 AND write = 1`
			res, err = tx.Exec(query, updatedAt, key.Bucket, key.Collection, key.Record, userID.Bytes(), key.Version)
		} else {
			query := `
UPDATE storage SET deleted_at = $1, updated_at = $1
WHERE bucket = $2 AND collection = $3 AND record = $4 AND user_id = $5 AND deleted_at = 0 AND write = 1`
			res, err = tx.Exec(query, updatedAt, key.Bucket, key.Collection, key.Record, userID.Bytes())
		}

		if err != nil {
			logger.Error("Could not remove data", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not rollback transaction", zap.Error(e))
			}
			return err
		}

		rowsAffected, _ := res.RowsAffected()
		logger.Info("Soft deleted record sent as part of an uncommitted transaction",
			zap.Int64("count", rowsAffected),
			zap.String("bucket", key.Bucket),
			zap.String("collection", key.Collection),
			zap.String("record", key.Record),
			zap.String("version", string(key.Version)))
	}

	err = tx.Commit()
	if err != nil {
		logger.Error("Could not commit transaction", zap.Error(err))
		return errors.New("Could not remove data") // FIXME
	} else {
		logger.Info("Removed data successfully")
	}

	return nil
}
