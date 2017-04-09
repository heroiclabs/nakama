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
	Bucket     string
	Collection string
	Record     string
	UserId     []byte // this must be UserId not UserID
	// Version is used when returning results from write ops, does not apply to fetch ops.
	Version []byte
}

type StorageData struct {
	Bucket          string
	Collection      string
	Record          string
	UserId          []byte // this must be UserId not UserID
	Value           []byte
	Version         []byte
	PermissionRead  int64
	PermissionWrite int64
	CreatedAt       int64
	UpdatedAt       int64
	ExpiresAt       int64
}

func StorageFetch(logger *zap.Logger, db *sql.DB, caller uuid.UUID, keys []*StorageKey) ([]*StorageData, Error_Code, error) {
	// Ensure there is at least one key requested.
	if len(keys) == 0 {
		return nil, BAD_INPUT, errors.New("At least one fetch key is required")
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
			return nil, BAD_INPUT, errors.New("Invalid values for bucket, collection, or record")
		}

		// If a user ID is provided, validate the format.
		owner := []byte{}
		if len(key.UserId) != 0 {
			if uid, err := uuid.FromBytes(key.UserId); err != nil {
				return nil, BAD_INPUT, errors.New("Invalid user ID")
			} else {
				owner = uid.Bytes()
			}
		}

		if i != 0 {
			query += " OR "
		}
		l := len(params)
		query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0", l+1, l+2, l+3, l+4)
		params = append(params, key.Bucket, key.Collection, owner, key.Record)
		if caller != uuid.Nil {
			query += fmt.Sprintf(" AND (read = 2 OR (read = 1 AND user_id = $%v))", len(params)+1)
			params = append(params, caller.Bytes())
		}
		query += ")"
	}

	// Execute the query.
	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Error in storage fetch", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, err
	}
	defer rows.Close()

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
			return nil, RUNTIME_EXCEPTION, err
		}

		// Potentially coerce zero-length global owner field.
		if len(userID) == 0 {
			userID = nil
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
		return nil, RUNTIME_EXCEPTION, err
	}

	return storageData, 0, nil
}

func StorageWrite(logger *zap.Logger, db *sql.DB, caller uuid.UUID, data []*StorageData) ([]*StorageKey, Error_Code, error) {
	// Ensure there is at least one value requested.
	if len(data) == 0 {
		return nil, BAD_INPUT, errors.New("At least one write value is required")
	}

	// Validate all input before starting DB operations.
	for _, d := range data {
		// Check the storage identifiers.
		if d.Bucket == "" || d.Collection == "" || d.Record == "" {
			return nil, BAD_INPUT, errors.New("Invalid values for bucket, collection, or record")
		}

		// Check the read permission value.
		if d.PermissionRead != 0 && d.PermissionRead != 1 && d.PermissionRead != 2 {
			return nil, BAD_INPUT, errors.New("Invalid read permission value")
		}

		// Check the write permission value.
		if d.PermissionWrite != 0 && d.PermissionWrite != 1 {
			return nil, BAD_INPUT, errors.New("Invalid write permission value")
		}

		// If a user ID is provided, validate the format.
		if len(d.UserId) != 0 {
			if uid, err := uuid.FromBytes(d.UserId); err != nil {
				return nil, BAD_INPUT, errors.New("Invalid user ID")
			} else if caller != uid {
				// If the caller is a client, only allow them to write their own data.
				return nil, BAD_INPUT, errors.New("Clients can only write their own data")
			}
		} else if caller != uuid.Nil {
			// If the caller is a client, do not allow them to write global data.
			return nil, BAD_INPUT, errors.New("Clients cannot write global data")
		}

		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal(d.Value, &maybeJSON) != nil {
			return nil, BAD_INPUT, errors.New("All values must be valid JSON objects")
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
		return nil, RUNTIME_EXCEPTION, errors.New("Could not write storage")
	}

	// Execute each storage write.
	for i, d := range data {
		id := uuid.NewV4().Bytes()
		//sha := fmt.Sprintf("%x", sha256.Sum256(d.Value))
		version := []byte(fmt.Sprintf("%x", sha256.Sum256(d.Value)))

		// Check if it's global or user-owned data.
		owner := []byte{}
		if len(d.UserId) != 0 {
			owner = d.UserId
		}

		query := `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6::BYTEA, $7, $8, $9, $10, $10, 0`
		params := []interface{}{id, owner, d.Bucket, d.Collection, d.Record, d.Value, version, d.PermissionRead, d.PermissionWrite, ts}

		if len(d.Version) == 0 {
			// Simple write.
			query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0"
			// If needed use an additional clause to enforce permissions.
			if caller != uuid.Nil {
				query += " AND write = 0"
			}
			query += `)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6::BYTEA, version = $7, read = $8, write = $9, updated_at = $10`
		} else if bytes.Equal(d.Version, []byte("*")) {
			// if-none-match
			query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0)"
			// No additional clause needed to enforce permissions.
			// Any existing record, no matter its write permission, will cause this operation to be rejected.
		} else {
			// if-match
			query += " WHERE EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0 AND version = $11"
			// If needed use an additional clause to enforce permissions.
			if caller != uuid.Nil {
				query += " AND write = 1"
			}
			query += `)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6::BYTEA, version = $7, read = $8, write = $9, updated_at = $10`
			params = append(params, d.Version)
		}

		// Execute the query.
		res, err := tx.Exec(query, params...)
		if err != nil {
			logger.Error("Could not write storage, exec error", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not write storage, rollback error", zap.Error(e))
			}
			return nil, RUNTIME_EXCEPTION, errors.New("Could not write storage")
		}

		// Check there was exactly 1 row affected.
		if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not write storage, rollback error", zap.Error(err))
			}
			return nil, STORAGE_REJECTED, errors.New("Storage write rejected: not found, version check failed, or permission denied")
		}

		keys[i] = &StorageKey{
			Bucket:     d.Bucket,
			Collection: d.Collection,
			Record:     d.Record,
			UserId:     d.UserId,
			Version:    version[:],
		}
	}

	err = tx.Commit()
	if err != nil {
		logger.Error("Could not write storage, commit error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not write storage")
	}

	return keys, 0, nil
}

func StorageRemove(logger *zap.Logger, db *sql.DB, caller uuid.UUID, keys []*StorageKey) (Error_Code, error) {
	// Ensure there is at least one key requested.
	if len(keys) == 0 {
		return BAD_INPUT, errors.New("At least one remove key is required")
	}

	query := `
UPDATE storage SET deleted_at = $1, updated_at = $1
WHERE `
	params := []interface{}{nowMs()}

	// Accumulate the query clauses and corresponding parameters.
	for i, key := range keys {
		// Check the storage identifiers.
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			return BAD_INPUT, errors.New("Invalid values for bucket, collection, or record")
		}

		// If a user ID is provided, validate the format.
		owner := []byte{}
		if len(key.UserId) != 0 {
			if uid, err := uuid.FromBytes(key.UserId); err != nil {
				return BAD_INPUT, errors.New("Invalid user ID")
			} else {
				owner = uid.Bytes()
			}
		}

		if i != 0 {
			query += " OR "
		}
		l := len(params)
		query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0", l+1, l+2, l+3, l+4)
		params = append(params, key.Bucket, key.Collection, owner, key.Record)
		// Permission.
		if caller != uuid.Nil {
			query += fmt.Sprintf(" AND write = 1 AND user_id = $%v", len(params)+1)
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
		return RUNTIME_EXCEPTION, errors.New("Could not remove storage")
	}

	// Execute the query.
	res, err := tx.Exec(query, params...)
	if err != nil {
		logger.Error("Could not remove storage, exec error", zap.Error(err))
		return RUNTIME_EXCEPTION, errors.New("Could not remove storage")
	}

	// If not all keys resulted in a delete, rollback and return an error an error.
	if rowsAffected, _ := res.RowsAffected(); rowsAffected != int64(len(keys)) {
		err = tx.Rollback()
		if err != nil {
			logger.Error("Could not remove storage, rollback error", zap.Error(err))
		}
		return STORAGE_REJECTED, errors.New("Storage remove rejected: not found, version check failed, or permission denied")
	}

	err = tx.Commit()
	if err != nil {
		logger.Error("Could not remove storage, commit error", zap.Error(err))
		return RUNTIME_EXCEPTION, errors.New("Could not remove storage")
	}

	return 0, nil
}
