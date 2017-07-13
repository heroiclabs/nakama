package server

import (
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"nakama/pkg/jsonpatch"
	"reflect"
)

// FIXME move this to core_storage.go

type StorageUpdateOp struct {
	op          string
	from        string
	path        string
	value       interface{}
	assert      int
	conditional bool
}

type StorageKeyUpdate struct {
	key             StorageKey
	permissionRead  int64
	permissionWrite int64
	patch           jsonpatch.Patch
}

func StorageUpdate(logger *zap.Logger, db *sql.DB, caller uuid.UUID, updates []*StorageKeyUpdate) ([]*StorageKey, Error_Code, error) {
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

	// Process each update one by one.
	for i, update := range updates {
		// Check the storage identifiers.
		if update.key.Bucket == "" || update.key.Collection == "" || update.key.Record == "" {
			return nil, BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid values for bucket, collection, or record", i))
		}

		// Check permission values.
		if update.permissionRead < 0 || update.permissionRead > 2 {
			return nil, BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid read permission", i))
		}
		if update.permissionWrite < 0 || update.permissionWrite > 1 {
			return nil, BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid write permission", i))
		}

		// If a user ID is provided, validate the format.
		owner := []byte{}
		if len(update.key.UserId) != 0 {
			if uid, err := uuid.FromBytes(update.key.UserId); err != nil {
				return nil, BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: Invalid user ID", i))
			} else if caller != uuid.Nil && caller != uid {
				// If the caller is a client, only allow them to write their own data.
				return nil, BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: A client can only write their own records", i))
			} else {
				owner = uid.Bytes()
			}
		} else if caller != uuid.Nil {
			// If the caller is a client, do not allow them to write global data.
			return nil, BAD_INPUT, errors.New(fmt.Sprintf("Invalid update index %v: A client cannot write global records", i))
		}

		query := `
SELECT user_id, bucket, collection, record, value, version
FROM storage
WHERE (bucket = $1 AND collection = $2 AND user_id = $3 AND record = $4 AND deleted_at = 0`
		if caller != uuid.Nil {
			query += " AND write = 1"
		}

		// Query and decode the row.
		var userID []byte
		var bucket sql.NullString
		var collection sql.NullString
		var record sql.NullString
		var value []byte
		var version []byte
		err = tx.QueryRow(query, update.key.Bucket, update.key.Collection, owner, update.key.Record).
			Scan(&userID, &bucket, &collection, &record, &value, &version)
		if err != nil && err != sql.ErrNoRows {
			// Only fail on critical database or row scan errors.
			// If no row was available we still allow storage updates to perform fresh inserts.
			logger.Error("Could not update storage, query row error", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not update storage, rollback error", zap.Error(e))
			}
			return nil, RUNTIME_EXCEPTION, errors.New("Could not update storage")
		}

		// Check if we need an immediate version compare.
		if len(update.key.Version) != 0 && !reflect.DeepEqual(update.key.Version, version) {
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not update storage, rollback error", zap.Error(e))
			}
			return nil, STORAGE_REJECTED, errors.New(fmt.Sprintf("Version check failed on update index %v: no existing value", i))
		}

		if len(value) == 0 {
			value = []byte("{}")
		}

		// Apply the patch operations.
		newValue, err := update.patch.Apply(value)
		if err != nil {
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not update storage, rollback error", zap.Error(e))
			}
			return nil, STORAGE_REJECTED, errors.New(fmt.Sprintf("Storage update index %v rejected: %v", i, err.Error()))
		}
		newVersion := []byte(fmt.Sprintf("%x", sha256.Sum256(newValue)))

		query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, read, write, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6::BYTEA, $7, $8, $9, $10, $10, 0`
		params := []interface{}{uuid.NewV4().Bytes(), owner, update.key.Bucket, update.key.Collection, update.key.Record, newValue, newVersion, update.permissionRead, update.permissionWrite, ts}
		if len(version) == 0 {
			// Treat this as an if-none-match.
			query += " WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0)"
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
			params = append(params, version)
		}

		// Execute the query.
		res, err := tx.Exec(query, params...)
		if err != nil {
			logger.Error("Could not update storage, exec error", zap.Error(err))
			if e := tx.Rollback(); e != nil {
				logger.Error("Could not update storage, rollback error", zap.Error(e))
			}
			return nil, RUNTIME_EXCEPTION, errors.New("Could not update storage")
		}

		// Check there was exactly 1 row affected.
		if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not update storage, rollback error", zap.Error(err))
			}
			return nil, STORAGE_REJECTED, errors.New(fmt.Sprintf("Storage update index %v rejected: not found, version check failed, or permission denied", i))
		}

		keys[i] = &StorageKey{
			Bucket:     update.key.Bucket,
			Collection: update.key.Collection,
			Record:     update.key.Record,
			UserId:     update.key.UserId,
			Version:    newVersion[:],
		}
	}

	// Commit the transaction.
	err = tx.Commit()
	if err != nil {
		logger.Error("Could not update storage, commit error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not update storage")
	}

	return keys, 0, nil
}
