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

	"encoding/gob"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

type storageListCursor struct {
	Bucket     string
	Collection string
	Record     string
	UserID     []byte
	Read       int64
}

//type StorageListOp struct {
//	UserId     []byte // this must be UserId not UserID
//	Bucket     string
//	Collection string
//	Limit      int64
//	Cursor     []byte
//}

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

func StorageList(logger *zap.Logger, db *sql.DB, caller uuid.UUID, userID []byte, bucket string, collection string, limit int64, cursor []byte) ([]*StorageData, []byte, Error_Code, error) {
	// We list by at least User ID, or bucket as a list criteria.
	if len(userID) == 0 && bucket == "" {
		return nil, nil, BAD_INPUT, errors.New("Either a User ID or a bucket is required as an initial list criteria")
	}
	if bucket == "" && collection != "" {
		return nil, nil, BAD_INPUT, errors.New("Cannot list by collection without listing by bucket first")
	}

	// If a user ID is provided, validate the format.
	owner := uuid.Nil
	if len(userID) != 0 {
		if uid, err := uuid.FromBytes(userID); err != nil {
			return nil, nil, BAD_INPUT, errors.New("Invalid user ID")
		} else {
			owner = uid
		}
	}

	// Validate the limit.
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		return nil, nil, BAD_INPUT, errors.New("Limit must be between 10 and 100")
	}

	// Process the incoming cursor if one is provided.
	var incomingCursor *storageListCursor
	if len(cursor) != 0 {
		incomingCursor = &storageListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cursor)).Decode(incomingCursor); err != nil {
			return nil, nil, BAD_INPUT, errors.New("Invalid cursor data")
		}
	}

	// Select the correct index. NOTE: should be removed when DB index selection is smarter.
	index := ""
	if len(userID) == 0 {
		if bucket == "" {
			index = "deleted_at_user_id_read_bucket_collection_record_idx"
		} else if collection == "" {
			index = "deleted_at_user_id_bucket_read_collection_record_idx"
		} else {
			index = "deleted_at_user_id_bucket_collection_read_record_idx"
		}
	} else {
		if collection == "" {
			index = "deleted_at_bucket_read_collection_record_user_id_idx"
		} else {
			index = "deleted_at_bucket_collection_read_record_user_id_idx"
		}
	}

	// Set up the query.
	query := "SELECT user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, expires_at FROM storage@" + index
	params := make([]interface{}, 0)

	// If cursor is present, give keyset clause priority over other parameters.
	if incomingCursor != nil {
		if len(userID) == 0 {
			if collection == "" {
				i := len(params)
				query += fmt.Sprintf(" WHERE (deleted_at, bucket, read, collection, record, user_id) > (0, $%v, $%v, $%v, $%v, $%v) AND deleted_at+deleted_at = 0 AND bucket = $%v", i+1, i+2, i+3, i+4, i+5, i+6)
				params = append(params, incomingCursor.Bucket, incomingCursor.Read, incomingCursor.Collection, incomingCursor.Record, incomingCursor.UserID, bucket)
			} else {
				i := len(params)
				query += fmt.Sprintf(" WHERE (deleted_at, bucket, collection, read, record, user_id) > (0, $%v, $%v, $%v, $%v, $%v) AND deleted_at+deleted_at = 0 AND bucket = $%v AND collection = $%v", i+1, i+2, i+3, i+4, i+5, i+6, i+7)
				params = append(params, incomingCursor.Bucket, incomingCursor.Collection, incomingCursor.Read, incomingCursor.Record, incomingCursor.UserID, bucket, collection)
			}
		} else {
			if bucket == "" {
				i := len(params)
				query += fmt.Sprintf(" WHERE (deleted_at, user_id, read, bucket, collection, record) > (0, $%v, $%v, $%v, $%v, $%v) AND deleted_at+deleted_at = 0 AND user_id = $%v", i+1, i+2, i+3, i+4, i+5, i+6)
				params = append(params, incomingCursor.UserID, incomingCursor.Read, incomingCursor.Bucket, incomingCursor.Collection, incomingCursor.Record, userID)
			} else if collection == "" {
				i := len(params)
				query += fmt.Sprintf(" WHERE (deleted_at, user_id, bucket, read, collection, record) > (0, $%v, $%v, $%v, $%v, $%v) AND deleted_at+deleted_at = 0 AND user_id = $%v AND bucket = $%v", i+1, i+2, i+3, i+4, i+5, i+6, i+7)
				params = append(params, incomingCursor.UserID, incomingCursor.Bucket, incomingCursor.Read, incomingCursor.Collection, incomingCursor.Record, userID, bucket)
			} else {
				i := len(params)
				query += fmt.Sprintf(" WHERE (deleted_at, user_id, bucket, collection, read, record) > (0, $%v, $%v, $%v, $%v, $%v) AND deleted_at+deleted_at = 0 AND user_id = $%v AND bucket = $%v AND collection = $%v", i+1, i+2, i+3, i+4, i+5, i+6, i+7, i+8)
				params = append(params, incomingCursor.UserID, incomingCursor.Bucket, incomingCursor.Collection, incomingCursor.Read, incomingCursor.Record, userID, bucket, collection)
			}
		}
	} else {
		// If no keyset, start all ranges with live records.
		query += " WHERE deleted_at = 0"
		// Apply filtering parameters as needed.
		if len(userID) != 0 {
			params = append(params, owner.Bytes())
			query += fmt.Sprintf(" AND user_id = $%v", len(params))
		}
		if bucket != "" {
			params = append(params, bucket)
			query += fmt.Sprintf(" AND bucket = $%v", len(params))
		}
		if collection != "" {
			params = append(params, bucket)
			query += fmt.Sprintf(" AND bucket = $%v", len(params))
		}
	}

	// Apply permissions as needed.
	if caller == uuid.Nil {
		// Script runtime can list all data regardless of read permission.
		query += " AND read >= 0"
	} else if len(userID) != 0 && caller == owner {
		// If listing by user first, and the caller is the user listing their own data.
		query += " AND read >= 1"
	} else {
		query += " AND read >= 2"
	}

	params = append(params, limit+1)
	query += fmt.Sprintf(" LIMIT $%v", len(params))

	// Execute the query.
	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Error in storage list", zap.Error(err))
		return nil, nil, RUNTIME_EXCEPTION, err
	}
	defer rows.Close()

	storageData := make([]*StorageData, 0)
	var outgoingCursor []byte

	// Parse the results.
	var dataUserID []byte
	var dataBucket sql.NullString
	var dataCollection sql.NullString
	var dataRecord sql.NullString
	var dataValue []byte
	var dataVersion []byte
	var dataRead sql.NullInt64
	var dataWrite sql.NullInt64
	var dataCreatedAt sql.NullInt64
	var dataUpdatedAt sql.NullInt64
	var dataExpiresAt sql.NullInt64
	for rows.Next() {
		if int64(len(storageData)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &storageListCursor{
				Bucket:     dataBucket.String,
				Collection: dataCollection.String,
				Record:     dataRecord.String,
				UserID:     dataUserID,
				Read:       dataRead.Int64,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating storage list cursor", zap.Error(err))
				return nil, nil, RUNTIME_EXCEPTION, errors.New("Error listing storage data")
			}
			outgoingCursor = cursorBuf.Bytes()
			break
		}

		err := rows.Scan(&dataUserID, &dataBucket, &dataCollection, &dataRecord, &dataValue, &dataVersion,
			&dataRead, &dataWrite, &dataCreatedAt, &dataUpdatedAt, &dataExpiresAt)
		if err != nil {
			logger.Error("Could not execute storage list query", zap.Error(err))
			return nil, nil, RUNTIME_EXCEPTION, err
		}

		// Potentially coerce zero-length global owner field.
		if len(dataUserID) == 0 {
			dataUserID = nil
		}

		// Accumulate the response.
		storageData = append(storageData, &StorageData{
			Bucket:          dataBucket.String,
			Collection:      dataCollection.String,
			Record:          dataRecord.String,
			UserId:          dataUserID,
			Value:           dataValue,
			Version:         dataVersion,
			PermissionRead:  dataRead.Int64,
			PermissionWrite: dataWrite.Int64,
			CreatedAt:       dataCreatedAt.Int64,
			UpdatedAt:       dataUpdatedAt.Int64,
			ExpiresAt:       dataExpiresAt.Int64,
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not execute storage list query", zap.Error(err))
		return nil, nil, RUNTIME_EXCEPTION, err
	}

	return storageData, outgoingCursor, 0, nil
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
			} else if caller != uuid.Nil && caller != uid {
				// If the caller is a client, only allow them to write their own data.
				return nil, BAD_INPUT, errors.New("A client can only write their own records")
			}
		} else if caller != uuid.Nil {
			// If the caller is a client, do not allow them to write global data.
			return nil, BAD_INPUT, errors.New("A client cannot write global records")
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
			// If needed use an additional clause to enforce permissions.
			if caller != uuid.Nil {
				query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0 AND write = 0)"
			}
			query += `
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
			} else if caller != uuid.Nil && caller != uid {
				// If the caller is a client, only allow them to write their own data.
				return BAD_INPUT, errors.New("A client can only remove their own records")
			} else {
				owner = uid.Bytes()
			}
		} else if caller != uuid.Nil {
			// If the caller is a client, do not allow them to write global data.
			return BAD_INPUT, errors.New("A client cannot remove global records")
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
