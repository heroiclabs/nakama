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

type StorageKey struct {
	Bucket     string `structs:"bucket,omitempty"`
	Collection string `structs:"collection,omitempty"`
	Record     string `structs:"record,omitempty"`
	UserId     []byte `structs:"user_id,omitempty"`
	// Version is used when returning results from write ops, does not apply to fetch ops.
	Version []byte `structs:"version,omitempty"`
}

type StorageData struct {
	Bucket          string
	Collection      string
	Record          string
	UserId          []byte
	Value           []byte
	Version         []byte
	PermissionRead  int64
	PermissionWrite int64
	CreatedAt       int64
	UpdatedAt       int64
	ExpiresAt       int64
}

func StorageFetch(logger *zap.Logger, db *sql.DB, caller uuid.UUID, keys []*StorageKey) ([]*StorageData, error) {
	// Ensure there is at least one key requested.
	if len(keys) == 0 {
		return nil, errors.New("At least one fetch key is required")
	}

	query := `
SELECT user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, expires_at
FROM storage
WHERE `
	params := make([]interface{}, 0)

	// Accumulate the query clauses and corresponding parameters.
	for i, key := range keys {
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			return nil, errors.New("Invalid values for Bucket, Collection, or Record")
		}

		// If a user ID is provided, validate the format.
		if len(key.UserId) != 0 {
			if _, err := uuid.FromBytes(key.UserId); err != nil {
				return nil, errors.New("Invalid User ID")
			}
		}

		if i != 0 {
			query += " OR "
		}
		l := len(params)
		if len(key.UserId) == 0 {
			// Global data.
			query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id IS NULL AND record = $%v AND deleted_at = 0)", l+1, l+2, l+3)
			params = append(params, key.Bucket, key.Collection, key.Record)
		} else {
			// User-owned data.
			query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0)", l+1, l+2, l+3, l+4)
			params = append(params, key.Bucket, key.Collection, key.UserId, key.Record)
		}
	}

	// Execute the query.
	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Error in storage fetch", zap.Error(err))
		return nil, err
	}

	storageData := make([]*StorageData, 0)

	// Parse the results.
	for rows.Next() {
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

		err := rows.Scan(&userID, &bucket, &collection, &record, &value, &version,
			&read, &write, &createdAt, &updatedAt, &expiresAt)
		if err != nil {
			logger.Error("Could not execute storage fetch query", zap.Error(err))
			return nil, err
		}

		// Check permissions. Allowed if at least one of the following is true:
		// 1. The caller is the script runtime.
		// 2. The read permission is 1 (owner read) and the caller is the owner of the data.
		// 3. The read permission is 2 (public read).
		owner := uuid.FromBytesOrNil(userID)
		if caller != uuid.Nil && (read.Int64 == 0 || (read.Int64 == 1 && caller != owner)) {
			// Return a nicely formatted error.
			if owner == uuid.Nil {
				return nil, errors.New(fmt.Sprintf("Fetch permission denied for %v %v %v", bucket, collection, record))
			} else {
				return nil, errors.New(fmt.Sprintf("Fetch permission denied for %v %v %v %v", bucket, collection, record, owner.String()))
			}
		}

		// Accumulate the response.
		storageData = append(storageData, &StorageData{
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
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not execute storage fetch query", zap.Error(err))
		return nil, err
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
