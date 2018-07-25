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

package tests

import (
	"crypto/md5"
	"fmt"
	"testing"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/server"
	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc/codes"
)

func TestStorageWriteRuntimeGlobalSingle(t *testing.T) {
	db := NewDB(t)

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{
		{
			Collection: "testcollection",
			Key:        key,
		}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData.Objects, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")
	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, "", readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageWriteRuntimeUserMultiple(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	u0 := uuid.Must(uuid.NewV4())
	InsertUser(t, db, u0)
	u1 := uuid.Must(uuid.NewV4())
	InsertUser(t, db, u1)
	u2 := uuid.Must(uuid.NewV4())
	InsertUser(t, db, u2)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		u0: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
		u1: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"baz\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
		u2: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"qux\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	for i, ack := range acks.Acks {
		var user uuid.UUID
		switch ack.UserId {
		case u0.String():
			user = u0
		case u1.String():
			user = u1
		case u2.String():
			user = u2
		default:
			t.Fatal("did not match any user ids")
		}
		d := data[user][0]
		assert.Equal(t, d.Collection, ack.Collection, "collection %v did not match", i)
		assert.Equal(t, d.Key, ack.Key, "key %v did not match", i)
		assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((d.Value))))), ack.Version, "version %v did not match", i)
	}
}

func TestStorageWriteRuntimeGlobalSingleIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			Version:         "fail",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             data[uuid.Nil][0].Key,
			Value:           "{\"foo\":\"baz\"}",
			Version:         acks.Acks[0].Version,
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}

	acks, code, err = server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchExistsFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             data[uuid.Nil][0].Key,
			Value:           "{\"foo\":\"baz\"}",
			Version:         "fail",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}

	acks, code, err = server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfNoneMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			Version:         "*",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfNoneMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             data[uuid.Nil][0].Key,
			Value:           "{\"foo\":\"baz\"}",
			Version:         "*",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}

	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalMultipleIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}, {
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"baz\"}",
			Version:         "fail",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWritePipelineUserSingle(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWritePipelineUserMultiple(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		},
			{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrappers.Int32Value{Value: 0},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
			{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"qux\"}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 1},
			}}}
	allAcks, code, err := server.StorageWriteObjects(logger, db, false, data)
	acks := allAcks.Acks

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks, 3, "acks length was not 3")
	assert.Equal(t, data[uid][0].Collection, acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[uid][0].Key, acks[0].Key, "key 0 did not match")
	assert.EqualValues(t, uid.String(), acks[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks[0].Version, "version 0 did not match")
	assert.Equal(t, data[uid][1].Collection, acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[uid][1].Key, acks[1].Key, "record 1 did not match")
	assert.EqualValues(t, uid.String(), acks[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][1].Value))))), acks[1].Version, "version 1 did not match")
	assert.Equal(t, data[uid][2].Collection, acks[2].Collection, "collection 2 did not match")
	assert.Equal(t, data[uid][2].Key, acks[2].Key, "record 2 did not match")
	assert.EqualValues(t, uid.String(), acks[2].UserId, "user id 2 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][2].Value))))), acks[2].Version, "version 2 did not match")
}

func TestStorageWriteRuntimeGlobalMultipleSameKey(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		},
			{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrappers.Int32Value{Value: 0},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
			{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"qux\"}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 1},
			}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key 0 did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id 0 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")

	assert.Equal(t, data[uuid.Nil][1].Collection, acks.Acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[uuid.Nil][1].Key, acks.Acks[1].Key, "record 1 did not match")
	assert.Equal(t, "", acks.Acks[1].UserId, "user id 1 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][1].Value))))), acks.Acks[1].Version, "version 1 did not match")

	assert.Equal(t, data[uuid.Nil][2].Collection, acks.Acks[2].Collection, "collection 2 did not match")
	assert.Equal(t, data[uuid.Nil][2].Key, acks.Acks[2].Key, "record 2 did not match")
	assert.Equal(t, "", acks.Acks[2].UserId, "user id 2 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][2].Value))))), acks.Acks[2].Version, "version 0 did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	}}

	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)
	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")
	assert.Equal(t, "testcollection", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, key, readData.Objects[0].Key, "key did not match")
	assert.Equal(t, "", readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte("{\"foo\":\"qux\"}")))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageWritePipelineUserMultipleSameKey(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		},
			{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 2, "acks length was not 2")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key 0 did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
	assert.Equal(t, data[uid][1].Collection, acks.Acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[uid][1].Key, acks.Acks[1].Key, "record 1 did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][1].Value))))), acks.Acks[1].Version, "version 1 did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}

	readData, err := server.StorageReadObjects(logger, db, uid, ids)
	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")
	assert.Equal(t, "testcollection", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, uid.String(), readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte("{\"foo\":\"baz\"}")))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageWritePipelineIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			Version:         "fail",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWritePipelineIfMatchExistsFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"baz\"}",
			Version:         "fail",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWritePipelineIfMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"baz\"}",
			Version:         acks.Acks[0].Version,
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err = server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWritePipelineIfNoneMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             GenerateString(),
			Value:           "{\"foo\":\"bar\"}",
			Version:         "*",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWritePipelineIfNoneMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"baz\"}",
			Version:         "*",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageWritePipelinePermissionFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, _, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	data = map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"baz\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

func TestStorageFetchRuntimeGlobalPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, "", readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchRuntimeMixed(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	},
		{
			Collection: "testcollection",
			Key:        "notfound",
		}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, "", readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchRuntimeUserPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineGlobalPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 0, "data length was not 0")
}

func TestStorageFetchPipelineUserPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := server.StorageReadObjects(logger, db, uid, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 0, "data length was not 0")
}

func TestStorageFetchPipelineUserRead(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := server.StorageReadObjects(logger, db, uid, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	dataRead, err := server.StorageReadObjects(logger, db, uid, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, dataRead.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, dataRead.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, dataRead.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), dataRead.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), dataRead.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), dataRead.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserOtherRead(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 0, "data length was not 0")
}

func TestStorageFetchPipelineUserOtherPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{

		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := server.StorageReadObjects(logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserOtherPublicMixed(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	record1 := GenerateString()
	record2 := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             record1,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		},
			{
				Collection:      "testcollection",
				Key:             record2,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
		}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 2, "acks length was not 2")
	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key 0 did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
	assert.Equal(t, data[uid][1].Collection, acks.Acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[uid][1].Key, acks.Acks[1].Key, "record 1 did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][1].Value))))), acks.Acks[1].Version, "version 1 did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        record1,
		UserId:     uid.String(),
	},
		{
			Collection: "testcollection",
			Key:        record2,
			UserId:     uid.String(),
		},
	}
	readData, err := server.StorageReadObjects(logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageRemoveRuntimeGlobalPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uuid.Nil: {{
			Collection: "testcollection",
			Key:        key,
		}},
	}

	_, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemoveRuntimeGlobalPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uuid.Nil: {{
			Collection: "testcollection",
			Key:        key,
		}},
	}
	_, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemoveRuntimeUserPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uid: {{
			Collection: "testcollection",
			Key:        key,
		}},
	}
	_, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemoveRuntimeUserPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uid: {{
			Collection: "testcollection",
			Key:        key,
		}},
	}
	_, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.Nil(t, err, "err was not nil")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}

	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 0, "data length was not 0")
}

func TestStorageRemovePipelineUserWrite(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uid: {{
			Collection: "testcollection",
			Key:        key,
		}},
	}
	_, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemovePipelineUserDenied(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uid][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uid][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uid][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uid: {{
			Collection: "testcollection",
			Key:        key,
		}},
	}
	code, err = server.StorageDeleteObjects(logger, db, false, deleteIDs)
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, code, codes.InvalidArgument, "code did not match InvalidArgument.")
}

func TestStorageRemoveRuntimeGlobalIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uuid.Nil: {{
			Collection: "testcollection",
			Key:        GenerateString(),
			Version:    "fail",
		}},
	}
	code, err := server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, code, codes.InvalidArgument, "code did not match InvalidArgument.")
}

func TestStorageRemoveRuntimeGlobalIfMatchRejected(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, "", acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uuid.Nil: {{
			Collection: "testcollection",
			Key:        key,
			Version:    "fail",
		}},
	}
	code, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.NotNil(t, err, "err was not nil")
	assert.Equal(t, code, codes.InvalidArgument, "code did not match InvalidArgument.")
}

func TestStorageRemoveRuntimeGlobalIfMatch(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, "", acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	deleteIDs := map[uuid.UUID][]*api.DeleteStorageObjectId{
		uuid.Nil: {{
			Collection: "testcollection",
			Key:        key,
			Version:    acks.Acks[0].Version,
		}},
	}
	code, err = server.StorageDeleteObjects(logger, db, true, deleteIDs)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, code, codes.OK, "code did not match OK.")
}

func TestStorageListRuntimeUser(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      "testcollection",
			Key:             "b",
			Value:           "{}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		},
			{
				Collection:      "testcollection",
				Key:             "a",
				Value:           "{}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
			{
				Collection:      "testcollection",
				Key:             "c",
				Value:           "{}",
				PermissionRead:  &wrappers.Int32Value{Value: 0},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
		}}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	list, code, err := server.StorageListObjects(logger, db, uuid.Nil, uid, "testcollection", 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, list, "list was nil")
	assert.Len(t, list.Objects, 3, "values length was not 3")
	assert.NotEmpty(t, list.Cursor, "cursor was empty")
}

func TestStorageListPipelineUserSelf(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      collection,
			Key:             "b",
			Value:           "{}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		},
			{
				Collection:      collection,
				Key:             "a",
				Value:           "{}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
			{
				Collection:      collection,
				Key:             "c",
				Value:           "{}",
				PermissionRead:  &wrappers.Int32Value{Value: 0},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	list, code, err := server.StorageListObjects(logger, db, uid, uid, collection, 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, list, "values was nil")
	assert.Len(t, list.Objects, 2, "values length was not 2")
	assert.Equal(t, "a", list.Objects[0].Key, "values[0].Key was not a")
	assert.Equal(t, "b", list.Objects[1].Key, "values[1].Key was not b")
	assert.NotEmpty(t, list.Cursor, "cursor was empty")
}

func TestStorageListPipelineUserOther(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uid: {{
			Collection:      collection,
			Key:             "b",
			Value:           "{}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		},
			{
				Collection:      collection,
				Key:             "a",
				Value:           "{}",
				PermissionRead:  &wrappers.Int32Value{Value: 1},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			},
			{
				Collection:      collection,
				Key:             "c",
				Value:           "{}",
				PermissionRead:  &wrappers.Int32Value{Value: 0},
				PermissionWrite: &wrappers.Int32Value{Value: 0},
			}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	values, code, err := server.StorageListObjects(logger, db, uuid.Must(uuid.NewV4()), uid, collection, 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, values, "values was nil")
	assert.Len(t, values.Objects, 0, "values length was not 0")
	assert.Equal(t, "", values.Cursor, "cursor was not nil")
}
