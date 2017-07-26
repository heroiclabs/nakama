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
	"nakama/pkg/jsonpatch"

	"encoding/json"

	"fmt"

	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func (p *pipeline) storageList(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageList()

	data, cursor, code, err := StorageList(logger, p.db, session.userID, incoming.UserId, incoming.Bucket, incoming.Collection, incoming.Limit, incoming.Cursor)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()))
		return
	}

	storageData := make([]*TStorageData_StorageData, len(data))
	for i, d := range data {
		storageData[i] = &TStorageData_StorageData{
			Bucket:          d.Bucket,
			Collection:      d.Collection,
			Record:          d.Record,
			UserId:          d.UserId,
			Value:           d.Value,
			Version:         d.Version,
			PermissionRead:  int32(d.PermissionRead),
			PermissionWrite: int32(d.PermissionWrite),
			CreatedAt:       d.CreatedAt,
			UpdatedAt:       d.UpdatedAt,
			ExpiresAt:       d.ExpiresAt,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageData{StorageData: &TStorageData{Data: storageData, Cursor: cursor}}})
}

func (p *pipeline) storageFetch(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageFetch()
	if len(incoming.Keys) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one fetch key is required"))
		return
	}

	keys := make([]*StorageKey, len(incoming.Keys))
	for i, key := range incoming.Keys {
		keys[i] = &StorageKey{
			Bucket:     key.Bucket,
			Collection: key.Collection,
			Record:     key.Record,
			UserId:     key.UserId,
		}
	}

	data, code, err := StorageFetch(logger, p.db, session.userID, keys)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()))
		return
	}

	storageData := make([]*TStorageData_StorageData, len(data))
	for i, d := range data {
		storageData[i] = &TStorageData_StorageData{
			Bucket:          d.Bucket,
			Collection:      d.Collection,
			Record:          d.Record,
			UserId:          d.UserId,
			Value:           d.Value,
			Version:         d.Version,
			PermissionRead:  int32(d.PermissionRead),
			PermissionWrite: int32(d.PermissionWrite),
			CreatedAt:       d.CreatedAt,
			UpdatedAt:       d.UpdatedAt,
			ExpiresAt:       d.ExpiresAt,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageData{StorageData: &TStorageData{Data: storageData}}})
}

func (p *pipeline) storageWrite(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageWrite()
	if len(incoming.Data) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one write value is required"))
		return
	}

	data := make([]*StorageData, len(incoming.Data))
	for i, d := range incoming.Data {
		data[i] = &StorageData{
			Bucket:          d.Bucket,
			Collection:      d.Collection,
			Record:          d.Record,
			UserId:          session.userID.Bytes(),
			Value:           d.Value,
			Version:         d.Version,
			PermissionRead:  int64(d.PermissionRead),
			PermissionWrite: int64(d.PermissionWrite),
		}
	}

	keys, code, err := StorageWrite(logger, p.db, session.userID, data)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()))
		return
	}

	storageKeys := make([]*TStorageKeys_StorageKey, len(keys))
	for i, key := range keys {
		storageKeys[i] = &TStorageKeys_StorageKey{
			Bucket:     key.Bucket,
			Collection: key.Collection,
			Record:     key.Record,
			Version:    key.Version,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageKeys{StorageKeys: &TStorageKeys{Keys: storageKeys}}})
}

func (p *pipeline) storageRemove(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageRemove()
	if len(incoming.Keys) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one remove key is required"))
		return
	}

	keys := make([]*StorageKey, len(incoming.Keys))
	for i, key := range incoming.Keys {
		keys[i] = &StorageKey{
			Bucket:     key.Bucket,
			Collection: key.Collection,
			Record:     key.Record,
			UserId:     session.userID.Bytes(),
			Version:    key.Version,
		}
	}

	code, err := StorageRemove(logger, p.db, session.userID, keys)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) storageUpdate(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageUpdate()
	if len(incoming.Updates) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one update is required"))
		return
	}

	keyUpdates := make([]*StorageKeyUpdate, 0)
	for _, update := range incoming.Updates {
		if _, err := uuid.FromBytes(update.Key.UserId); err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "UserID is not valid UUID"))
			return
		}

		keyUpdate := &StorageKeyUpdate{
			PermissionRead:  int64(update.PermissionRead),
			PermissionWrite: int64(update.PermissionWrite),
			Key: &StorageKey{
				Bucket:     update.Key.Bucket,
				Collection: update.Key.Collection,
				Record:     update.Key.Record,
				Version:    update.Key.Version,
				UserId:     session.userID.Bytes(),
			},
		}

		jsonOps := make([]map[string]*json.RawMessage, 0)
		for _, op := range update.Ops {
			opString := ""
			switch TStorageUpdate_StorageUpdate_UpdateOp_UpdateOpCode(op.Op) {
			case ADD:
				opString = "add"
			case APPEND:
				opString = "append"
			case COPY:
				opString = "copy"
			case INCR:
				opString = "incr"
			case INIT:
				opString = "init"
			case MERGE:
				opString = "merge"
			case MOVE:
				opString = "move"
			case PATCH:
				opString = "patch"
			case REMOVE:
				opString = "remove"
			case REPLACE:
				opString = "replace"
			case TEST:
				opString = "test"
			case COMPARE:
				opString = "compare"
			default:
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid update operation supplied"))
				return
			}

			opRaw := json.RawMessage(fmt.Sprintf(`"%s"`, opString))
			value := json.RawMessage(op.Value)
			path := json.RawMessage(fmt.Sprintf(`"%s"`, op.Path))
			from := json.RawMessage(fmt.Sprintf(`"%s"`, op.From))
			conditional := json.RawMessage(fmt.Sprintf(`%t`, op.Conditional))
			assert := json.RawMessage(fmt.Sprintf(`%d`, op.Assert))

			jsonOp := map[string]*json.RawMessage{
				"op":          &opRaw,
				"value":       &value,
				"path":        &path,
				"from":        &from,
				"conditional": &conditional,
				"assert":      &assert,
			}
			jsonOps = append(jsonOps, jsonOp)
		}

		p, err := jsonpatch.NewExtendedPatch(jsonOps)
		if err != nil {
			logger.Warn("Invalid patch operation", zap.Error(err))
			session.Send(ErrorMessageBadInput(envelope.CollationId, fmt.Sprintf("Invalid patch operation: %s", err.Error())))
			return
		}
		keyUpdate.Patch = p
		keyUpdates = append(keyUpdates, keyUpdate)
	}

	updatedKeys, errCode, err := StorageUpdate(logger, p.db, session.userID, keyUpdates)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, errCode, err.Error()))
		return
	}

	storageKeys := make([]*TStorageKeys_StorageKey, len(updatedKeys))
	for i, key := range updatedKeys {
		storageKeys[i] = &TStorageKeys_StorageKey{
			Bucket:     key.Bucket,
			Collection: key.Collection,
			Record:     key.Record,
			Version:    key.Version,
		}
	}
	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageKeys{StorageKeys: &TStorageKeys{Keys: storageKeys}}})
}
