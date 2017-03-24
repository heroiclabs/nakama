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
	"github.com/uber-go/zap"
)

func (p *pipeline) fetchStorageData(r scanner) (*TStorageData_StorageData, error) {
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

func (p *pipeline) storageFetch(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageFetch()
	storageData := make([]*TStorageData_StorageData, 0)

	for _, key := range incoming.Keys {
		if key.Bucket == "" || key.Collection == "" || key.Record == "" {
			logger.Error("Invalid values for Bucket or Collection or Record")
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid values for Bucket or Collection or Record"))
			return
		}

		if len(key.UserId) != 0 {
			userID, err := uuid.FromBytes(key.UserId)
			if err != nil {
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid User ID"))
				return
			}

			if userID != session.userID {
				logger.Error("Not allowed to fetch from storage of a different user")
				session.Send(ErrorMessage(envelope.CollationId, STORAGE_FETCH_DISALLOWED, "Not allowed to fetch from storage of a different user"))
				return
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
			row = p.db.QueryRow(query, key.Bucket, key.Collection, key.Record)
		} else {
			query := `
SELECT user_id, bucket, collection, record,
	value, version, read, write,
	created_at, updated_at, expires_at
FROM storage
WHERE bucket = $1 AND collection = $2 AND user_id = $3 AND record = $4 AND deleted_at = 0 AND read = 1`
			row = p.db.QueryRow(query, key.Bucket, key.Collection, session.userID.Bytes(), key.Record)
		}

		data, err := p.fetchStorageData(row)
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

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageData{StorageData: &TStorageData{Data: storageData}}})
}

func (p *pipeline) storageWrite(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageWrite()

	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not store data", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not store data"))
		return
	}

	response := make([]*TStorageKey_StorageKey, 0)

	errorMessage := "Could not store data"

	defer func() {
		if err != nil {
			logger.Error("Could not store data", zap.Error(err))
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}

			session.Send(ErrorMessageRuntimeException(envelope.CollationId, errorMessage))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, errorMessage))
			} else {
				logger.Info("Stored data successfully")
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageKey{StorageKey: &TStorageKey{Keys: response}}})
			}
		}
	}()

	updatedAt := nowMs()

	for _, data := range incoming.Data {

		if data.Bucket == "" {
			errorMessage = "Bucket value is empty"
			err = errors.New(errorMessage)
			return
		} else if data.Collection == "" {
			errorMessage = "Collection value is empty"
			err = errors.New(errorMessage)
			return
		} else if data.Record == "" {
			errorMessage = "Record value is empty"
			err = errors.New(errorMessage)
			return
		}

		recordID := uuid.NewV4().Bytes()
		sha := fmt.Sprintf("%x", sha256.Sum256(data.Value))
		version := []byte(sha)

		query := ""
		params := []interface{}{}

		if len(data.Version) == 0 {
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8, 0
WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0 AND write = 0)
ON CONFLICT (bucket, collection, user_id, record, deleted_at)
DO UPDATE SET value = $6, version = $7, updated_at = $8
`
			params = []interface{}{recordID, session.userID.Bytes(), data.Bucket, data.Collection, data.Record, data.Value, version, updatedAt}
			errorMessage = "Could not store data"
		} else if bytes.Equal(data.Version, []byte("*")) {
			// if-none-match
			query = `
INSERT INTO storage (id, user_id, bucket, collection, record, value, version, created_at, updated_at, deleted_at)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $8, 0
WHERE NOT EXISTS (SELECT record FROM storage WHERE user_id = $2 AND bucket = $3 AND collection = $4 AND record = $5 AND deleted_at = 0)
`
			params = []interface{}{recordID, session.userID.Bytes(), data.Bucket, data.Collection, data.Record, data.Value, version, updatedAt}
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
			params = []interface{}{recordID, session.userID.Bytes(), data.Bucket, data.Collection, data.Record, data.Value, version, updatedAt, data.Version}
			errorMessage = "Could not store data. This could be caused by failure of if-match version check"
		}

		_, err = tx.Exec(query, params...)
		if err != nil {
			return
		}

		response = append(response, &TStorageKey_StorageKey{
			Bucket:     data.Bucket,
			Collection: data.Collection,
			Record:     data.Record,
			Version:    version[:],
		})
	}
}

func (p *pipeline) storageRemove(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageRemove()

	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not remove data", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not remove data"))
		return
	}

	errorMessage := "Could not remove data"

	defer func() {
		if err != nil {
			logger.Error("Could not remove data", zap.Error(err))
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}

			session.Send(ErrorMessageRuntimeException(envelope.CollationId, errorMessage))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, errorMessage))
			} else {
				logger.Info("Removed data successfully")
				session.Send(&Envelope{CollationId: envelope.CollationId})
			}
		}
	}()

	updatedAt := nowMs()

	for _, key := range incoming.Keys {
		var res sql.Result

		if key.Bucket == "" {
			errorMessage = "Bucket value is empty"
			err = errors.New(errorMessage)
			return
		} else if key.Collection == "" {
			errorMessage = "Collection value is empty"
			err = errors.New(errorMessage)
			return
		} else if key.Record == "" {
			errorMessage = "Record value is empty"
			err = errors.New(errorMessage)
			return
		}

		if key.Version != nil {
			query := `
UPDATE storage SET deleted_at = $1, updated_at = $1
WHERE bucket = $2 AND collection = $3 AND record = $4 AND user_id = $5 AND version = $6 AND deleted_at = 0 AND write = 1`
			res, err = tx.Exec(query, updatedAt, key.Bucket, key.Collection, key.Record, session.userID.Bytes(), key.Version)
		} else {
			query := `
UPDATE storage SET deleted_at = $1, updated_at = $1
WHERE bucket = $2 AND collection = $3 AND record = $4 AND user_id = $5 AND deleted_at = 0 AND write = 1`
			res, err = tx.Exec(query, updatedAt, key.Bucket, key.Collection, key.Record, session.userID.Bytes())
		}

		if err != nil {
			return
		}

		rowsAffected, _ := res.RowsAffected()
		logger.Info("Soft deleted record sent as part of an uncommitted transaction",
			zap.Int64("count", rowsAffected),
			zap.String("bucket", key.Bucket),
			zap.String("collection", key.Collection),
			zap.String("record", key.Record),
			zap.String("version", string(key.Version)))
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}
