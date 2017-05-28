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
	"encoding/json"
	"errors"
	"fmt"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type StorageKey struct {
	Bucket     string `structs:"bucket,omitempty"`
	Collection string `structs:"collection,omitempty"`
	Record     string `structs:"record,omitempty"`
	UserID     []byte `structs:"user_id,omitempty"`
	// Version is used when returning results from write ops, does not apply to fetch ops.
	Version []byte `structs:"version,omitempty"`
}

type StorageData struct {
	Bucket          string `structs:"bucket,omitempty"`
	Collection      string `structs:"collection,omitempty"`
	Record          string `structs:"record,omitempty"`
	UserID          []byte `structs:"user_id,omitempty"`
	Value           []byte `structs:"value,omitempty"`
	Version         []byte `structs:"version,omitempty"`
	PermissionRead  int64  `structs:"permission_read,omitempty"`
	PermissionWrite int64  `structs:"permission_write,omitempty"`
	CreatedAt       int64  `structs:"created_at,omitempty"`
	UpdatedAt       int64  `structs:"updated_at,omitempty"`
	ExpiresAt       int64  `structs:"expires_at,omitempty"`
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
		// Check the storage identifiers.
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			return nil, errors.New("Invalid values for bucket, collection, or record")
		}

		// If a user ID is provided, validate the format.
		if len(key.UserID) != 0 {
			if _, err := uuid.FromBytes(key.UserID); err != nil {
				return nil, errors.New("Invalid user ID")
			}
		}

		if i != 0 {
			query += " OR "
		}
		l := len(params)
		if len(key.UserID) == 0 {
			// Global data.
			query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id IS NULL AND record = $%v AND deleted_at = 0", l+1, l+2, l+3)
			params = append(params, key.Bucket, key.Collection, key.Record)
		} else {
			// User-owned data.
			query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0", l+1, l+2, l+3, l+4)
			params = append(params, key.Bucket, key.Collection, key.UserID, key.Record)
		}
		if caller != uuid.Nil {
			query += fmt.Sprintf(" AND (read == 2 OR (read == 1 AND user_id = $%v))", len(params)+1)
			params = append(params, caller.Bytes())
		}
		query += ")"
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

		// Accumulate the response.
		storageData = append(storageData, &StorageData{
			Bucket:          bucket.String,
			Collection:      collection.String,
			Record:          record.String,
			UserID:          userID,
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

func StorageWrite(logger *zap.Logger, db *sql.DB, caller uuid.UUID, data []*StorageData) ([]*StorageKey, error) {
	// Ensure there is at least one value requested.
	if len(data) == 0 {
		return nil, errors.New("At least one write value is required")
	}

	// Validate all input before starting DB operations.
	for _, d := range data {
		// Check the storage identifiers.
		if d.Bucket == "" || d.Collection == "" || d.Record == "" {
			return nil, errors.New("Invalid values for bucket, collection, or record")
		}

		// Check the read permission value.
		if d.PermissionRead != 0 && d.PermissionRead != 1 && d.PermissionRead != 2 {
			return nil, errors.New("Invalid read permission value")
		}

		// Check the write permission value.
		if d.PermissionWrite != 0 && d.PermissionWrite != 1 {
			return nil, errors.New("Invalid write permission value")
		}

		// If a user ID is provided, validate the format.
		if len(d.UserID) != 0 {
			if uid, err := uuid.FromBytes(d.UserID); err != nil {
				return nil, errors.New("Invalid user ID")
			} else if caller != uid {
				// If the caller is a client, only allow them to write their own data.
				return nil, errors.New("Clients can only write their own data")
			}
		} else if caller != uuid.Nil {
			// If the caller is a client, do not allow them to write global data.
			return nil, errors.New("Clients cannot write global data")
		}

		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal(d.Value, &maybeJSON) != nil {
			return nil, errors.New("All values must be valid JSON objects")
		}
	}

	// Prepare response structure, expect to return as many keys as we're writing.
	keys := make([]*StorageKey, len(data))

	// Use same timestamp for all operations in this batch.
	ts := nowMs()

	// Start a transaction.
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not write storage, transaction error", zap.Error(err))
		return nil, errors.New("Could not write storage")
	}

	// Execute each storage write.
	for i, d := range data {
		id := uuid.NewV4().Bytes()
		//sha := fmt.Sprintf("%x", sha256.Sum256(d.Value))
		version := []byte(fmt.Sprintf("%x", sha256.Sum256(d.Value)))

		var query string
		var params []interface{}

		// Determine if it's global or user-owned data.
		if len(d.UserID) == 0 {
			// Global data.
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, deleted_at)
SELECT $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $9, 0`
			params = []interface{}{id, d.Bucket, d.Collection, d.Record, d.Value, version, d.PermissionRead, d.PermissionWrite, ts}
		} else {
			// User-owned data.
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, deleted_at)
SELECT $1, $10, $2, $3, $4, $5, $6, $7, $8, $9, $9, 0`
			params = []interface{}{id, d.Bucket, d.Collection, d.Record, d.Value, version, d.PermissionRead, d.PermissionWrite, ts, d.UserID}
		}

		// If needed use an additional clause to enforce permissions.
		var permissionQuery string
		if caller != uuid.Nil {
			permissionQuery = " AND write = 0"
		}

		if len(d.Version) == 0 {
			// Simple write.
			if len(d.UserID) == 0 {
				// Global data.
				query += " WHERE NOT EXISTS (SELECT id FROM storage WHERE user_id IS NULL AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0"
			} else {
				// User-owned data.
				query += " WHERE NOT EXISTS (SELECT id FROM storage WHERE user_id = $10 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0"
			}
			query += permissionQuery
			query += `)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $5, version = $6, read = $7, write = $8, updated_at = $9`
		} else if bytes.Equal(d.Version, []byte("*")) {
			// if-none-match
			if len(d.UserID) == 0 {
				// Global data.
				query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id IS NULL AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0"
			} else {
				// User-owned data.
				query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $10 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0"
			}
			query += permissionQuery
			query += ")"
		} else {
			// if-match
			if len(d.UserID) == 0 {
				// Global data.
				query += " WHERE EXISTS (SELECT record FROM storage WHERE user_id IS NULL AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0 AND version = $10"
			} else {
				// User-owned data.
				query += " WHERE EXISTS (SELECT record FROM storage WHERE user_id = $10 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0 AND version = $11"
			}
			query += permissionQuery
			query += `)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $5, version = $6, read = $7, write = $8, updated_at = $9`
			params = append(params, d.Version)
		}

		// Execute the query.
		res, err := tx.Exec(query, params...)
		if err != nil {
			logger.Error("Could not write storage, exec error", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not write storage, rollback error", zap.Error(e))
			}
			return nil, errors.New("Could not write storage")
		}

		// Check there was exactly 1 row affected.
		if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not write storage, rollback error", zap.Error(err))
				return nil, errors.New("Storage write rejected: not found, version check failed, or permission denied")
			}
		}

		keys[i] = &StorageKey{
			Bucket:     d.Bucket,
			Collection: d.Collection,
			Record:     d.Record,
			UserID:     d.UserID,
			Version:    version[:],
		}
	}

	err = tx.Commit()
	if err != nil {
		logger.Error("Could not write storage, commit error", zap.Error(err))
		return nil, errors.New("Could not write storage")
	}

	return keys, nil
}

func StorageRemove(logger *zap.Logger, db *sql.DB, caller uuid.UUID, keys []*StorageKey) error {
	// Ensure there is at least one key requested.
	if len(keys) == 0 {
		return errors.New("At least one remove key is required")
	}

	query := `
UPDATE storage SET deleted_at = $1, updated_at = $1
WHERE `
	params := []interface{}{nowMs()}

	// Accumulate the query clauses and corresponding parameters.
	for i, key := range keys {
		// Check the storage identifiers.
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			return errors.New("Invalid values for bucket, collection, or record")
		}

		// If a user ID is provided, validate the format.
		if len(key.UserID) != 0 {
			if _, err := uuid.FromBytes(key.UserID); err != nil {
				return errors.New("Invalid user ID")
			}
		}

		if i != 0 {
			query += " OR "
		}
		l := len(params)
		if len(key.UserID) == 0 {
			// Global data.
			query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id IS NULL AND record = $%v AND deleted_at = 0", l+1, l+2, l+3)
			params = append(params, key.Bucket, key.Collection, key.Record)
		} else {
			// User-owned data.
			query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0", l+1, l+2, l+3, l+4)
			params = append(params, key.Bucket, key.Collection, key.UserID, key.Record)
		}
		// Permission.
		if caller != uuid.Nil {
			query += fmt.Sprintf(" AND write == 1 AND user_id = $%v", len(params)+1)
			params = append(params, caller.Bytes())
		}
		// Version.
		if len(key.Version) != 0 {
			query += fmt.Sprintf(" AND version = $%v", len(params)+1)
			params = append(params, key.Version)
		}
		query += ")"
	}

	// Start a transaction.
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not remove storage, transaction error", zap.Error(err))
		return errors.New("Could not remove storage")
	}

	// Execute the query.
	res, err := tx.Exec(query, params...)
	if err != nil {
		logger.Error("Could not remove storage, exec error", zap.Error(err))
		return errors.New("Could not remove storage")
	}

	// If not all keys resulted in a delete, rollback and return an error an error.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != int64(len(keys)) {
		err = tx.Rollback()
		if err != nil {
			logger.Error("Could not remove storage, rollback error", zap.Error(err))
			return errors.New("Storage remove rejected: not found, version check failed, or permission denied")
		}
	}

	err = tx.Commit()
	if err != nil {
		logger.Error("Could not remove storage, commit error", zap.Error(err))
		return errors.New("Could not remove storage")
	}

	return nil
}
