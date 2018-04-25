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
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"encoding/gob"
	"nakama/pkg/jsonpatch"

	"context"
	"github.com/cockroachdb/cockroach-go/crdb"
	"go.uber.org/zap"
)

type storageListCursor struct {
	Bucket     string
	Collection string
	Record     string
	UserID     string
	Read       int64
}

type StorageKey struct {
	Bucket     string
	Collection string
	Record     string
	UserId     string // this must be UserId not UserID
	// Version is used when returning results from write ops, does not apply to fetch ops.
	Version string
}

type StorageData struct {
	Bucket          string
	Collection      string
	Record          string
	UserId          string // this must be UserId not UserID
	Value           []byte
	Version         string
	PermissionRead  int64
	PermissionWrite int64
	CreatedAt       int64
	UpdatedAt       int64
	ExpiresAt       int64
}

type StorageKeyUpdate struct {
	Key             *StorageKey
	PermissionRead  int64
	PermissionWrite int64
	Patch           jsonpatch.ExtendedPatch
}

var (
	ErrRowsAffectedCount = errors.New("rows_affected_count")
	ErrBadInput          = errors.New("bad input")
	ErrRejected          = errors.New("rejected")
	ErrNoDeletes         = errors.New("no deletes")
)

// A type that wraps an outgoing client-facing error together with an underlying cause error.
type statusError struct {
	code   Error_Code
	status error
	cause  error
}

// Implement the error interface.
func (s *statusError) Error() string {
	return s.status.Error()
}

// Implement the crdb.ErrorCauser interface to allow the crdb.ExecuteInTx wrapper to figure out whether to retry or not.
func (s *statusError) Cause() error {
	return s.cause
}

func (s *statusError) Code() Error_Code {
	return s.code
}

func (s *statusError) Status() error {
	return s.status
}

func StatusError(code Error_Code, status, cause error) error {
	return &statusError{
		code:   code,
		status: status,
		cause:  cause,
	}
}

func StorageList(logger *zap.Logger, db *sql.DB, caller string, userID string, bucket string, collection string, limit int64, cursor string) ([]*StorageData, string, Error_Code, error) {
	// We list by at least User ID, or bucket as a list criteria.
	if userID == "" && bucket == "" {
		return nil, "", BAD_INPUT, errors.New("Either a User ID or a bucket is required as an initial list criteria")
	}
	if bucket == "" && collection != "" {
		return nil, "", BAD_INPUT, errors.New("Cannot list by collection without listing by bucket first")
	}

	// Validate the limit.
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		return nil, "", BAD_INPUT, errors.New("Limit must be between 10 and 100")
	}

	// Process the incoming cursor if one is provided.
	var incomingCursor *storageListCursor
	if len(cursor) != 0 {
		if cb, err := base64.StdEncoding.DecodeString(cursor); err != nil {
			return nil, "", BAD_INPUT, errors.New("Invalid cursor data")
		} else {
			incomingCursor = &storageListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(incomingCursor); err != nil {
				return nil, "", BAD_INPUT, errors.New("Invalid cursor data")
			}
		}
	}

	// Set up the query.
	query := "SELECT user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, expires_at FROM storage"
	params := make([]interface{}, 0)

	// If cursor is present, give keyset clause priority over other parameters.
	if incomingCursor != nil {
		if userID == "" {
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
		if userID != "" {
			params = append(params, userID)
			query += fmt.Sprintf(" AND user_id = $%v", len(params))
		}
		if bucket != "" {
			params = append(params, bucket)
			query += fmt.Sprintf(" AND bucket = $%v", len(params))
		}
		if collection != "" {
			params = append(params, collection)
			query += fmt.Sprintf(" AND collection = $%v", len(params))
		}
	}

	// Apply permissions as needed.
	if caller == "" {
		// Script runtime can list all data regardless of read permission.
		query += " AND read >= 0"
	} else if userID != "" && caller == userID {
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
		return nil, "", RUNTIME_EXCEPTION, err
	}
	defer rows.Close()

	storageData := make([]*StorageData, 0)
	var outgoingCursor string

	// Parse the results.
	var dataUserID sql.NullString
	var dataBucket sql.NullString
	var dataCollection sql.NullString
	var dataRecord sql.NullString
	var dataValue []byte
	var dataVersion sql.NullString
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
				UserID:     dataUserID.String,
				Read:       dataRead.Int64,
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Error creating storage list cursor", zap.Error(err))
				return nil, "", RUNTIME_EXCEPTION, errors.New("Error listing storage data")
			}
			outgoingCursor = base64.StdEncoding.EncodeToString(cursorBuf.Bytes())
			break
		}

		err := rows.Scan(&dataUserID, &dataBucket, &dataCollection, &dataRecord, &dataValue, &dataVersion,
			&dataRead, &dataWrite, &dataCreatedAt, &dataUpdatedAt, &dataExpiresAt)
		if err != nil {
			logger.Error("Could not execute storage list query", zap.Error(err))
			return nil, "", RUNTIME_EXCEPTION, err
		}

		// Accumulate the response.
		storageData = append(storageData, &StorageData{
			Bucket:          dataBucket.String,
			Collection:      dataCollection.String,
			Record:          dataRecord.String,
			UserId:          dataUserID.String,
			Value:           dataValue,
			Version:         dataVersion.String,
			PermissionRead:  dataRead.Int64,
			PermissionWrite: dataWrite.Int64,
			CreatedAt:       dataCreatedAt.Int64,
			UpdatedAt:       dataUpdatedAt.Int64,
			ExpiresAt:       dataExpiresAt.Int64,
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not execute storage list query", zap.Error(err))
		return nil, "", RUNTIME_EXCEPTION, err
	}

	return storageData, outgoingCursor, 0, nil
}

func StorageFetch(logger *zap.Logger, db *sql.DB, caller string, keys []*StorageKey) ([]*StorageData, Error_Code, error) {
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

		if i != 0 {
			query += " OR "
		}
		l := len(params)
		query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0", l+1, l+2, l+3, l+4)
		params = append(params, key.Bucket, key.Collection, key.UserId, key.Record)
		if caller != "" {
			query += fmt.Sprintf(" AND (read = 2 OR (read = 1 AND user_id = $%v))", len(params)+1)
			params = append(params, caller)
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
		var userID sql.NullString
		var bucket sql.NullString
		var collection sql.NullString
		var record sql.NullString
		var value []byte
		var version sql.NullString
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

		// Accumulate the response.
		storageData = append(storageData, &StorageData{
			Bucket:          bucket.String,
			Collection:      collection.String,
			Record:          record.String,
			UserId:          userID.String,
			Value:           value,
			Version:         version.String,
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

func StorageWrite(logger *zap.Logger, db *sql.DB, caller string, data []*StorageData) ([]*StorageKey, Error_Code, error) {
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

		if d.UserId != "" {
			if caller != "" && caller != d.UserId {
				// If the caller is a client, only allow them to write their own data.
				return nil, BAD_INPUT, errors.New("A client can only write their own records")
			}
		} else if caller != "" {
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

	err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		// Execute each storage write.
		for i, d := range data {
			id := generateNewId()
			version := fmt.Sprintf("%x", sha256.Sum256(d.Value))

			query := `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6::BYTEA, $7, $8, $9, $10, $10, 0`
			params := []interface{}{id, d.UserId, d.Bucket, d.Collection, d.Record, d.Value, version, d.PermissionRead, d.PermissionWrite, ts}

			if len(d.Version) == 0 {
				// Simple write.
				// If needed use an additional clause to enforce permissions.
				if caller != "" {
					query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3::VARCHAR AND collection = $4::VARCHAR AND record = $5::VARCHAR AND deleted_at = 0 AND write = 0)"
				}
				query += `
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6::BYTEA, version = $7, read = $8, write = $9, updated_at = $10`
			} else if d.Version == "*" {
				// if-none-match
				query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3::VARCHAR AND collection = $4::VARCHAR AND record = $5::VARCHAR AND deleted_at = 0)"
				// No additional clause needed to enforce permissions.
				// Any existing record, no matter its write permission, will cause this operation to be rejected.
			} else {
				// if-match
				query += " WHERE EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3::VARCHAR AND collection = $4::VARCHAR AND record = $5::VARCHAR AND deleted_at = 0 AND version = $11"
				// If needed use an additional clause to enforce permissions.
				if caller != "" {
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
				return err
			}

			// Check there was exactly 1 row affected.
			if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
				return StatusError(STORAGE_REJECTED, errors.New("Storage write rejected: not found, version check failed, or permission denied"), ErrRowsAffectedCount)
			}

			keys[i] = &StorageKey{
				Bucket:     d.Bucket,
				Collection: d.Collection,
				Record:     d.Record,
				UserId:     d.UserId,
				Version:    version,
			}
		}

		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, e.Code(), e.Status()
		}
		logger.Error("Could not write storage, transaction error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not write storage")
	}

	return keys, 0, nil
}

func StorageUpdate(logger *zap.Logger, db *sql.DB, caller string, updates []*StorageKeyUpdate) ([]*StorageKey, Error_Code, error) {
	// Ensure there is at least one update requested.
	if len(updates) == 0 {
		return nil, BAD_INPUT, errors.New("At least one update is required")
	}

	// Prepare response structure, expect to return as many keys as we're updating.
	keys := make([]*StorageKey, len(updates))

	// Use the same timestamp for all operations.
	ts := nowMs()

	// Start a transaction.
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not update storage, transaction error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not update storage")
	}

	err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		// Process each update one by one.
		for i, update := range updates {
			// Check the storage identifiers.
			if update.Key.Bucket == "" || update.Key.Collection == "" || update.Key.Record == "" {
				return StatusError(BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid values for bucket, collection, or record", i)), ErrBadInput)
			}

			// Check permission values.
			if update.PermissionRead < 0 || update.PermissionRead > 2 {
				return StatusError(BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid read permission", i)), ErrBadInput)
			}
			if update.PermissionWrite < 0 || update.PermissionWrite > 1 {
				return StatusError(BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid write permission", i)), ErrBadInput)
			}

			// If a user ID is provided, validate the format.
			if update.Key.UserId != "" {
				if caller != "" && caller != update.Key.UserId {
					// If the caller is a client, only allow them to write their own data.
					return StatusError(BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: A client can only write their own records", i)), ErrBadInput)
				}
			} else if caller != "" {
				// If the caller is a client, do not allow them to write global data.
				return StatusError(BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: A client cannot write global records", i)), ErrBadInput)
			}

			query := `
SELECT user_id, bucket, collection, record, value, version, write
FROM storage
WHERE bucket = $1 AND collection = $2 AND user_id = $3 AND record = $4 AND deleted_at = 0`

			// Query and decode the row.
			var userID string
			var bucket sql.NullString
			var collection sql.NullString
			var record sql.NullString
			var value []byte
			var version string
			var write sql.NullInt64
			err = tx.QueryRow(query, update.Key.Bucket, update.Key.Collection, update.Key.UserId, update.Key.Record).
				Scan(&userID, &bucket, &collection, &record, &value, &version, &write)
			if err != nil && err != sql.ErrNoRows {
				// Only fail on critical database or row scan errors.
				// If no row was available we still allow storage updates to perform fresh inserts.
				return err
			}

			// Check if we need an immediate version compare.
			// If-None-Match and there's an existing version OR If-Match and the existing version doesn't match.
			if update.Key.Version != "" && ((update.Key.Version == "*" && version != "") || (update.Key.Version != "*" && update.Key.Version != version)) {
				return StatusError(STORAGE_REJECTED, errors.New(fmt.Sprintf("Storage update index %v rejected: not found, version check failed, or permission denied", i)), ErrRejected)
			}

			// Check write permission if caller is not script runtime.
			if caller != "" && write.Valid && write.Int64 != 1 {
				return StatusError(STORAGE_REJECTED, errors.New(fmt.Sprintf("Storage update index %v rejected: not found, version check failed, or permission denied", i)), ErrRejected)
			}

			// Allow updates to create new records.
			if len(value) == 0 {
				value = []byte("{}")
			}

			// Apply the patch operations.
			newValue, err := update.Patch.Apply(value)
			if err != nil {
				return StatusError(STORAGE_REJECTED, errors.New(fmt.Sprintf("Storage update index %v rejected: %v", i, err.Error())), ErrRejected)
			}
			newVersion := fmt.Sprintf("%x", sha256.Sum256(newValue))

			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6::BYTEA, $7, $8, $9, $10, $10, 0`
			params := []interface{}{generateNewId(), update.Key.UserId, update.Key.Bucket, update.Key.Collection, update.Key.Record, newValue, newVersion, update.PermissionRead, update.PermissionWrite, ts}
			if version == "" {
				// Treat this as an if-none-match.
				query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3::VARCHAR AND collection = $4::VARCHAR AND record = $5::VARCHAR AND deleted_at = 0)"
			} else {
				// if-match
				query += " WHERE EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3::VARCHAR AND collection = $4::VARCHAR AND record = $5::VARCHAR AND deleted_at = 0 AND version = $11"
				// If needed use an additional clause to enforce permissions.
				if caller != "" {
					query += " AND write = 1"
				}
				query += `)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6::BYTEA, version = $7, read = $8, write = $9, updated_at = $10`
				params = append(params, version)
			}

			// Execute the query.
			res, err := tx.Exec(query, params...)
			if err != nil {
				return err
			}

			// Check there was exactly 1 row affected.
			if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
				return StatusError(STORAGE_REJECTED, errors.New(fmt.Sprintf("Storage update index %v rejected: not found, version check failed, or permission denied", i)), ErrRowsAffectedCount)
			}

			keys[i] = &StorageKey{
				Bucket:     update.Key.Bucket,
				Collection: update.Key.Collection,
				Record:     update.Key.Record,
				UserId:     update.Key.UserId,
				Version:    newVersion,
			}
		}

		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, e.Code(), e.Status()
		}
		logger.Error("Could not write storage, transaction error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not update storage")
	}

	return keys, 0, nil
}

func StorageRemove(logger *zap.Logger, db *sql.DB, caller string, keys []*StorageKey) (Error_Code, error) {
	// Ensure there is at least one key requested.
	if len(keys) == 0 {
		return BAD_INPUT, errors.New("At least one remove key is required")
	}

	query := "SELECT id, bucket, collection, record, user_id, write, version FROM storage WHERE "
	params := []interface{}{}

	ops := make(map[struct {
		bucket     string
		collection string
		record     string
		userId     string
	}]*StorageKey)

	// Accumulate the query clauses and corresponding parameters.
	for i, key := range keys {
		// Check the storage identifiers.
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			return BAD_INPUT, errors.New("Invalid values for bucket, collection, or record")
		}

		// If a user ID is provided, validate the format.
		if key.UserId != "" {
			if caller != "" && caller != key.UserId {
				// If the caller is a client, only allow them to write their own data.
				return BAD_INPUT, errors.New("A client can only remove their own records")
			}
		} else if caller != "" {
			// If the caller is a client, do not allow them to write global data.
			return BAD_INPUT, errors.New("A client cannot remove global records")
		}

		if i != 0 {
			query += " OR "
		}

		l := len(params)
		query += fmt.Sprintf("(bucket = $%v AND collection = $%v AND user_id = $%v AND record = $%v AND deleted_at = 0)", l+1, l+2, l+3, l+4)
		params = append(params, key.Bucket, key.Collection, key.UserId, key.Record)

		ops[struct {
			bucket     string
			collection string
			record     string
			userId     string
		}{
			bucket:     key.Bucket,
			collection: key.Collection,
			record:     key.Record,
			userId:     key.UserId,
		}] = key
	}

	// Start a transaction.
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not remove storage, transaction error", zap.Error(err))
		return RUNTIME_EXCEPTION, errors.New("Could not remove storage")
	}

	err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		// Execute the query.
		queryRes, err := tx.Query(query, params...)
		if err != nil {
			return err
		}
		defer queryRes.Close()

		query = "UPDATE storage SET deleted_at = $1, updated_at = $1 WHERE id IN ("
		params = []interface{}{nowMs()}

		var id sql.NullString
		var bucket sql.NullString
		var collection sql.NullString
		var record sql.NullString
		var userId sql.NullString
		var write sql.NullInt64
		var version sql.NullString
		for queryRes.Next() {
			err = queryRes.Scan(&id, &bucket, &collection, &record, &userId, &write, &version)
			if err != nil {
				return err
			}

			key := ops[struct {
				bucket     string
				collection string
				record     string
				userId     string
			}{
				bucket:     bucket.String,
				collection: collection.String,
				record:     record.String,
				userId:     userId.String,
			}]

			// Check permission.
			if caller != "" && write.Int64 != 1 {
				return StatusError(STORAGE_REJECTED, errors.New("Storage remove rejected: not found, version check failed, or permission denied"), ErrRejected)
			}

			// Check version.
			if key.Version != "" && key.Version != version.String {
				return StatusError(STORAGE_REJECTED, errors.New("Storage remove rejected: not found, version check failed, or permission denied"), ErrRejected)
			}

			l := len(params)
			if l != 1 {
				query += ", "
			}
			query += fmt.Sprintf("$%v", l+1)
			params = append(params, id.String)
		}

		// Nothing to delete.
		if len(params) == 1 {
			return StatusError(0, nil, ErrNoDeletes)
		}

		query += ")"
		_, err = tx.Exec(query, params...)
		if err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return e.Code(), e.Status()
		}
		logger.Error("Could not remove storage, transaction error", zap.Error(err))
		return RUNTIME_EXCEPTION, errors.New("Could not remove storage")
	}

	return 0, nil
}
