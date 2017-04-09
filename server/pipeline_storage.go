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

import "go.uber.org/zap"

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
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "At least one write value is required"))
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

	storageKeys := make([]*TStorageKey_StorageKey, len(keys))
	for i, key := range keys {
		storageKeys[i] = &TStorageKey_StorageKey{
			Bucket:     key.Bucket,
			Collection: key.Collection,
			Record:     key.Record,
			Version:    key.Version,
		}
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_StorageKey{StorageKey: &TStorageKey{Keys: storageKeys}}})
}

func (p *pipeline) storageRemove(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetStorageRemove()
	if len(incoming.Keys) == 0 {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "At least one remove key is required"))
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
