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

	"go.uber.org/zap"
)

func (p *pipeline) storageList(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetStorageList()

	data, cursor, code, err := StorageList(logger, p.db, session.UserID(), incoming.UserId, incoming.Bucket, incoming.Collection, incoming.Limit, incoming.Cursor)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
		return
	}

	storageData := make([]*TStorageData_StorageData, len(data))
	for i, d := range data {
		storageData[i] = &TStorageData_StorageData{
			Bucket:          d.Bucket,
			Collection:      d.Collection,
			Record:          d.Record,
			UserId:          d.UserId,
			Value:           string(d.Value),
			Version:         d.Version,
			PermissionRead:  int32(d.PermissionRead),
			PermissionWrite: int32(d.PermissionWrite),
			CreatedAt:       d.CreatedAt,
			UpdatedAt:       d.UpdatedAt,
			ExpiresAt:       d.ExpiresAt,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageData{StorageData: &TStorageData{Data: storageData, Cursor: cursor}}}, true)
}

func (p *pipeline) storageFetch(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetStorageFetch()
	if len(incoming.Keys) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one fetch key is required"), true)
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

	data, code, err := StorageFetch(logger, p.db, session.UserID(), keys)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
		return
	}

	storageData := make([]*TStorageData_StorageData, len(data))
	for i, d := range data {
		storageData[i] = &TStorageData_StorageData{
			Bucket:          d.Bucket,
			Collection:      d.Collection,
			Record:          d.Record,
			UserId:          d.UserId,
			Value:           string(d.Value),
			Version:         d.Version,
			PermissionRead:  int32(d.PermissionRead),
			PermissionWrite: int32(d.PermissionWrite),
			CreatedAt:       d.CreatedAt,
			UpdatedAt:       d.UpdatedAt,
			ExpiresAt:       d.ExpiresAt,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageData{StorageData: &TStorageData{Data: storageData}}}, true)
}

func (p *pipeline) storageWrite(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetStorageWrite()
	if len(incoming.Data) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one write value is required"), true)
		return
	}

	data := make([]*StorageData, len(incoming.Data))
	for i, d := range incoming.Data {
		data[i] = &StorageData{
			Bucket:          d.Bucket,
			Collection:      d.Collection,
			Record:          d.Record,
			UserId:          session.UserID(),
			Value:           []byte(d.Value),
			Version:         d.Version,
			PermissionRead:  int64(d.PermissionRead),
			PermissionWrite: int64(d.PermissionWrite),
		}
	}

	keys, code, err := StorageWrite(logger, p.db, session.UserID(), data)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
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

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageKeys{StorageKeys: &TStorageKeys{Keys: storageKeys}}}, true)
}

func (p *pipeline) storageRemove(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetStorageRemove()
	if len(incoming.Keys) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one remove key is required"), true)
		return
	}

	keys := make([]*StorageKey, len(incoming.Keys))
	for i, key := range incoming.Keys {
		keys[i] = &StorageKey{
			Bucket:     key.Bucket,
			Collection: key.Collection,
			Record:     key.Record,
			UserId:     session.UserID(),
			Version:    key.Version,
		}
	}

	code, err := StorageRemove(logger, p.db, session.UserID(), keys)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, code, err.Error()), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId}, true)
}

func (p *pipeline) storageUpdate(logger *zap.Logger, session session, envelope *Envelope) {
	incoming := envelope.GetStorageUpdate()
	if len(incoming.Updates) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one update is required"), true)
		return
	}

	keyUpdates := make([]*StorageKeyUpdate, len(incoming.Updates))
	for i, update := range incoming.Updates {
		keyUpdate := &StorageKeyUpdate{
			PermissionRead:  int64(update.PermissionRead),
			PermissionWrite: int64(update.PermissionWrite),
			Key: &StorageKey{
				Bucket:     update.Key.Bucket,
				Collection: update.Key.Collection,
				Record:     update.Key.Record,
				Version:    update.Key.Version,
				UserId:     session.UserID(),
			},
		}

		jsonOps := make([]map[string]*json.RawMessage, len(update.Ops))
		for i, op := range update.Ops {
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
			//TODO Add patch support for client operations
			//case PATCH:
			//	opString = "patch"
			case REMOVE:
				opString = "remove"
			case REPLACE:
				opString = "replace"
			case TEST:
				opString = "test"
			case COMPARE:
				opString = "compare"
			default:
				session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid update operation supplied"), true)
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
			jsonOps[i] = jsonOp
		}

		p, err := jsonpatch.NewExtendedPatch(jsonOps)
		if err != nil {
			logger.Warn("Invalid patch operation", zap.Error(err))
			session.Send(ErrorMessageBadInput(envelope.CollationId, fmt.Sprintf("Invalid patch operation: %s", err.Error())), true)
			return
		}
		keyUpdate.Patch = p
		keyUpdates[i] = keyUpdate
	}

	updatedKeys, errCode, err := StorageUpdate(logger, p.db, session.UserID(), keyUpdates)
	if err != nil {
		session.Send(ErrorMessage(envelope.CollationId, errCode, err.Error()), true)
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
	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageKeys{StorageKeys: &TStorageKeys{Keys: storageKeys}}}, true)
}
