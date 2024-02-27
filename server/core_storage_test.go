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
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func TestStorageWriteRuntimeGlobalSingle(t *testing.T) {
	db := NewDB(t)

	key := GenerateString()

	ops := StorageOpWrites{&StorageOpWrite{
		OwnerID: uuid.Nil.String(),
		Object: &api.WriteStorageObject{
			Collection:      "testcollection",
			Key:             key,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrapperspb.Int32Value{Value: 2},
			PermissionWrite: &wrapperspb.Int32Value{Value: 1},
		},
	}}
	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{
		{
			Collection: "testcollection",
			Key:        key,
		}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData.Objects, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")
	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, uuid.Nil.String(), readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
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

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: u0.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: u2.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"qux\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}
	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	for i, ack := range acks.Acks {
		d := ops[i]
		assert.Equal(t, d.Object.Collection, ack.Collection, "collection %v did not match", i)
		assert.Equal(t, d.Object.Key, ack.Key, "key %v did not match", i)
		assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((d.Object.Value))))), ack.Version, "version %v did not match", i)
	}
}

func TestStorageWriteRuntimeGlobalSingleIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				Version:         "fail",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             ops[0].Object.Key,
				Value:           "{\"foo\":\"baz\"}",
				Version:         acks.Acks[0].Version,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchExistsFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             ops[0].Object.Key,
				Value:           "{\"foo\":\"baz\"}",
				Version:         "fail",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfNoneMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				Version:         "*",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfNoneMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             ops[0].Object.Key,
				Value:           "{\"foo\":\"baz\"}",
				Version:         "*",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalMultipleIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"baz\"}",
				Version:         "fail",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWritePipelineUserSingle(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWritePipelineUserMultiple(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"qux\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	allAcks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)
	if err != nil {
		t.Fatal(err.Error())
	}
	acks := allAcks.Acks

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks, 3, "acks length was not 3")
	assert.Equal(t, ops[0].Object.Collection, acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, ops[0].Object.Key, acks[0].Key, "key 0 did not match")
	assert.EqualValues(t, uid.String(), acks[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks[0].Version, "version 0 did not match")
	assert.Equal(t, ops[1].Object.Collection, acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, ops[1].Object.Key, acks[1].Key, "record 1 did not match")
	assert.EqualValues(t, uid.String(), acks[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[1].Object.Value))))), acks[1].Version, "version 1 did not match")
	assert.Equal(t, ops[2].Object.Collection, acks[2].Collection, "collection 2 did not match")
	assert.Equal(t, ops[2].Object.Key, acks[2].Key, "record 2 did not match")
	assert.EqualValues(t, uid.String(), acks[2].UserId, "user id 2 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[2].Object.Value))))), acks[2].Version, "version 2 did not match")
}

func TestStorageWriteRuntimeGlobalMultipleSameKey(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"qux\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key 0 did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id 0 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version 0 did not match")

	assert.Equal(t, ops[1].Object.Collection, acks.Acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, ops[1].Object.Key, acks.Acks[1].Key, "record 1 did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[1].UserId, "user id 1 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[1].Object.Value))))), acks.Acks[1].Version, "version 1 did not match")

	assert.Equal(t, ops[2].Object.Collection, acks.Acks[2].Collection, "collection 2 did not match")
	assert.Equal(t, ops[2].Object.Key, acks.Acks[2].Key, "record 2 did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[2].UserId, "user id 2 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[2].Object.Value))))), acks.Acks[2].Version, "version 0 did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Nil, ids)
	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")
	assert.Equal(t, "testcollection", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, key, readData.Objects[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), readData.Objects[0].UserId, "user id was not nil")
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

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 2, "acks length was not 2")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection 0 did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key 0 did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version 0 did not match")
	assert.Equal(t, ops[1].Object.Collection, acks.Acks[1].Collection, "collection 1 did not match")
	assert.Equal(t, ops[1].Object.Key, acks.Acks[1].Key, "record 1 did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[1].Object.Value))))), acks.Acks[1].Version, "version 1 did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uid, ids)
	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")
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

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				Version:         "fail",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWritePipelineIfMatchExistsFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"baz\"}",
				Version:         "fail",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWritePipelineIfMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				Version:         acks.Acks[0].Version,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWritePipelineIfNoneMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             GenerateString(),
				Value:           "{\"foo\":\"bar\"}",
				Version:         "*",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")
}

func TestStorageWritePipelineIfNoneMatchExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				Version:         "*",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error(), "error message did not match")
}

func TestStorageWritePipelinePermissionFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, uid.String(), "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"baz\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected - permission denied.", err.Error(), "error message did not match")
}

func TestStorageFetchRuntimeGlobalPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")
	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, uuid.Nil.String(), readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchRuntimeMixed(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	},
		{
			Collection: "testcollection",
			Key:        "notfound",
		}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, uuid.Nil.String(), readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchRuntimeUserPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineGlobalPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 0, "readData length was not 0")
}

func TestStorageFetchPipelineUserPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uid, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 0, "readData length was not 0")
}

func TestStorageFetchPipelineUserRead(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uid, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uid, ids)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserOtherRead(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 0, "readData length was not 0")
}

func TestStorageFetchPipelineUserOtherPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{{

		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")

	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, acks.Acks[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
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

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             record1,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             record2,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 2, "acks length was not 2")
	expected := []*api.StorageObjectAck{
		{
			Collection: ops[0].Object.Collection,
			Key:        ops[0].Object.Key,
			UserId:     uid.String(),
			Version:    fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value)))),
		},
		{
			Collection: ops[1].Object.Collection,
			Key:        ops[1].Object.Key,
			UserId:     uid.String(),
			Version:    fmt.Sprintf("%x", md5.Sum([]byte((ops[1].Object.Value)))),
		},
	}
	assert.Equal(t, expected[0].Collection, acks.Acks[0].Collection)
	assert.Equal(t, expected[0].Key, acks.Acks[0].Key)
	assert.Equal(t, expected[0].UserId, acks.Acks[0].UserId)
	assert.Equal(t, expected[0].Version, acks.Acks[0].Version)
	assert.NotNil(t, acks.Acks[0].CreateTime)
	assert.NotNil(t, acks.Acks[0].UpdateTime)
	assert.Equal(t, expected[1].Collection, acks.Acks[1].Collection)
	assert.Equal(t, expected[1].Key, acks.Acks[1].Key)
	assert.Equal(t, expected[1].UserId, acks.Acks[1].UserId)
	assert.Equal(t, expected[1].Version, acks.Acks[1].Version)
	assert.NotNil(t, acks.Acks[1].CreateTime)
	assert.NotNil(t, acks.Acks[1].UpdateTime)

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
	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Must(uuid.NewV4()), ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData, "readData was nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")

	assert.Equal(t, ids[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, ids[0].Key, readData.Objects[0].Key, "record did not match")
	assert.EqualValues(t, ids[0].UserId, readData.Objects[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(0), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageRemoveRuntimeGlobalPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uuid.Nil.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
			},
		},
	}

	_, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemoveRuntimeGlobalPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.Equal(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uuid.Nil.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
			},
		},
	}

	_, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemoveRuntimeUserPublic(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uid.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
			},
		},
	}

	_, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemoveRuntimeUserPrivate(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uid.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
			},
		},
	}

	_, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.Nil(t, err, "err was not nil")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection",
		Key:        key,
		UserId:     uid.String(),
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uuid.Nil, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 0, "data length was not 0")
}

func TestStorageRemovePipelineUserWrite(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uid.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
			},
		},
	}

	_, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.Nil(t, err, "err was not nil")
}

func TestStorageRemovePipelineUserDenied(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uid.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uid.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
			},
		},
	}

	code, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, false, deleteOps)
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, code, codes.InvalidArgument, "code did not match InvalidArgument.")
}

func TestStorageRemoveRuntimeGlobalIfMatchNotExists(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uuid.Nil.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        GenerateString(),
				Version:    "fail",
			},
		},
	}

	code, err := StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, code, codes.InvalidArgument, "code did not match InvalidArgument.")
}

func TestStorageRemoveRuntimeGlobalIfMatchRejected(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uuid.Nil.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
				Version:    "fail",
			},
		},
	}

	code, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.NotNil(t, err, "err was not nil")
	assert.Equal(t, code, codes.InvalidArgument, "code did not match InvalidArgument.")
}

func TestStorageRemoveRuntimeGlobalIfMatch(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uuid.Nil.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             key,
				Value:           "{\"foo\":\"bar\"}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	assert.Equal(t, ops[0].Object.Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, ops[0].Object.Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, uuid.Nil.String(), acks.Acks[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((ops[0].Object.Value))))), acks.Acks[0].Version, "version did not match")

	deleteOps := StorageOpDeletes{
		&StorageOpDelete{
			OwnerID: uuid.Nil.String(),
			ObjectID: &api.DeleteStorageObjectId{
				Collection: "testcollection",
				Key:        key,
				Version:    acks.Acks[0].Version,
			},
		},
	}

	code, err = StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, deleteOps)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, code, codes.OK, "code did not match OK.")
}

func TestStorageListRuntimeUser(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             "b",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             "a",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection",
				Key:             "c",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	list, code, err := StorageListObjects(context.Background(), logger, db, uuid.Nil, &uid, "testcollection", 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, list, "list was nil")
	assert.Len(t, list.Objects, 3, "values length was not 3")
	assert.Empty(t, list.Cursor, "cursor was not empty")
}

func TestStorageListPipelineUserSelf(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "b",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "a",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "c",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	list, code, err := StorageListObjects(context.Background(), logger, db, uid, &uid, collection, 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, list, "values was nil")
	assert.Len(t, list.Objects, 2, "values length was not 2")
	assert.Equal(t, "a", list.Objects[0].Key, "values[0].Key was not a")
	assert.Equal(t, "b", list.Objects[1].Key, "values[1].Key was not b")
	assert.Empty(t, list.Cursor, "cursor was not empty")
}

func TestStorageListPipelineUserOther(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "b",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "a",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "c",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 0},
				PermissionWrite: &wrapperspb.Int32Value{Value: 0},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 3, "acks length was not 3")

	values, code, err := StorageListObjects(context.Background(), logger, db, uuid.Must(uuid.NewV4()), &uid, collection, 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, values, "values was nil")
	assert.Len(t, values.Objects, 0, "values length was not 0")
	assert.Equal(t, "", values.Cursor, "cursor was not nil")
}

func TestStorageListNoRepeats(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "1",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "2",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "3",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "4",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "5",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "6",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "7",
				Value:           "{}",
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 7, "acks length was not 7")

	values, code, err := StorageListObjects(context.Background(), logger, db, uuid.Must(uuid.NewV4()), &uid, collection, 10, "")

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, values, "values was nil")
	assert.Len(t, values.Objects, 7, "values length was not 7")
	assert.Equal(t, "", values.Cursor, "cursor was not nil")
}

func TestStorageOverrwriteEmptyAndNonEmptyVersions(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "7",
				Value:           `{"testKey":"testValue1"}`,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
				Version:         "",
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "7",
				Value:           `{"testKey":"testValue2"}`,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
				Version:         "",
			},
		},
	}

	acks, code, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")

	ops = StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      collection,
				Key:             "7",
				Value:           `{"testKey":"testValue3"}`,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
				Version:         acks.Acks[0].Version,
			},
		},
	}

	acks, code, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not OK")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
}

// DB State and expected outcome when performing write op
type writeTestDBState struct {
	write         int
	v             string
	expectedCode  codes.Code
	expectedError error
	descr         string
}

// Test no OCC, last write wins ("")
func TestNonOCCNonAuthoritative(t *testing.T) {
	v := "{}"

	statesOutcomes := []writeTestDBState{
		{0, "", codes.OK, nil, "did not exists"},
		{1, v, codes.OK, nil, "existed and permission allows write, version match"},
		{1, `{"a":1}`, codes.OK, nil, "existed and permission allows write, version does not match"},
		{0, v, codes.InvalidArgument, runtime.ErrStorageRejectedPermission, "existed and permission reject, version match"},
		{0, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedPermission, "existed and permission reject, version does not match"},
	}
	testWrite(t, `{"newV": true}`, "", 1, false, statesOutcomes)
}

// Test no OCC, last write wins ("")
func TestNonOCCAuthoritative(t *testing.T) {
	v := "{}"

	statesOutcomes := []writeTestDBState{
		{0, "", codes.OK, nil, "did not exists"},
		{1, v, codes.OK, nil, "existed and permission allows write, version match"},
		{1, `{"a":1}`, codes.OK, nil, "existed and permission allows write, version does not match"},
		{0, v, codes.OK, nil, "existed and permission reject, version match"},
		{0, `{"a":1}`, codes.OK, nil, "existed and permission reject, version does not match"},
	}
	testWrite(t, `{"newV": true}`, "", 1, true, statesOutcomes)
}

// Test when OCC requires non-existing object ("*")
func TestOCCNotExistsAuthoritative(t *testing.T) {
	v := "{}"

	statesOutcomes := []writeTestDBState{
		{0, "", codes.OK, nil, "did not exists"},
		{1, v, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission allows write, version match"},
		{1, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission allows write, version does not match"},
		{0, v, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission reject, version match"},
		{0, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission reject, version does not match"},
	}
	testWrite(t, `{"newV": true}`, "*", 1, true, statesOutcomes)
}

// Test when OCC requires non-existing object ("*")
func TestOCCNotExistsNonAuthoritative(t *testing.T) {
	v := "{}"

	statesOutcomes := []writeTestDBState{
		{0, "", codes.OK, nil, "did not exists"},
		{1, v, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission allows write, version match"},
		{1, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission allows write, version does not match"},
		{0, v, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission reject, version match"},
		{0, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission reject, version does not match"},
	}
	testWrite(t, `{"newV": true}`, "*", 1, false, statesOutcomes)
}

// Test when OCC requires existing object with known version ('#hash#')
func TestOCCWriteNonAuthoritative(t *testing.T) {
	v := "{}"

	statesOutcomes := []writeTestDBState{
		{0, "", codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "did not exists"},
		{1, v, codes.OK, nil, "existed and permission allows write, version match"},
		{1, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission allows write, version does not match"},
		{0, v, codes.InvalidArgument, runtime.ErrStorageRejectedPermission, "existed and permission reject, version match"},
		{0, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedPermission, "existed and permission reject, version does not match"},
	}
	testWrite(t, `{"newV": true}`, v, 1, false, statesOutcomes)
}

// Test when OCC requires existing object with known version ('#hash#')
func TestOCCWriteAuthoritative(t *testing.T) {
	v := "{}"

	statesOutcomes := []writeTestDBState{
		{0, "", codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "did not exists"},
		{1, v, codes.OK, nil, "existed and permission allows write, version match"},
		{1, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission allows write, version does not match"},
		{0, v, codes.OK, nil, "existed and permission reject, version match"},
		{0, `{"a":1}`, codes.InvalidArgument, runtime.ErrStorageRejectedVersion, "existed and permission reject, version does not match"},
	}
	testWrite(t, `{"newV": true}`, v, 1, true, statesOutcomes)
}

func testWrite(t *testing.T, newVal, prevVal string, permWrite int, authoritative bool, states []writeTestDBState) {
	db := NewDB(t)
	defer db.Close()

	collection, userId := "testcollection", uuid.Must(uuid.NewV4())
	InsertUser(t, db, userId)

	for _, w := range states {
		t.Run(w.descr, func(t *testing.T) {
			key := GenerateString()
			// Prepare DB with expected state
			if w.v != "" {
				if _, _, err := writeObject(t, db, collection, key, userId, w.write, w.v, "", true); err != nil {
					t.Fatal(err)
				}
			}

			var version string
			if prevVal != "" && prevVal != "*" {
				hash := md5.Sum([]byte(prevVal))
				version = hex.EncodeToString(hash[:])
			} else {
				version = prevVal
			}

			// Test writing object and assert expected result
			_, code, err := writeObject(t, db, collection, key, userId, permWrite, newVal, version, authoritative)
			if code != w.expectedCode || err != w.expectedError {
				t.Errorf("Failed: code=%d (expected=%d) err=%v", code, w.expectedCode, err)
			}
		})
	}
}

func writeObject(t *testing.T, db *sql.DB, collection, key string, owner uuid.UUID, writePerm int, newV, version string, authoritative bool) (*api.StorageObjectAcks, codes.Code, error) {
	t.Helper()
	ops := StorageOpWrites{&StorageOpWrite{
		OwnerID: owner.String(),
		Object: &api.WriteStorageObject{
			Collection:      collection,
			Key:             key,
			Value:           newV,
			Version:         version,
			PermissionRead:  &wrapperspb.Int32Value{Value: 2},
			PermissionWrite: &wrapperspb.Int32Value{Value: int32(writePerm)},
		},
	}}
	return StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, authoritative, ops)
}

func TestOCCWriteSameValueWithOutdatedVersionFail(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()
	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      `{"closed":false}`,
				Version:    "",
			},
		},
	}

	// Create object
	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)
	assert.Nil(t, err)
	assert.Len(t, acks.Acks, 1)

	// Change object value
	version := acks.Acks[0].Version
	ops[0].Object.Version = version
	ops[0].Object.Value = `{"closed":true}`

	acks, _, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)
	assert.Nil(t, err)
	assert.Len(t, acks.Acks, 1)

	// Rewrite object to same value with now invalid version -- must fail
	_, _, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)
	assert.NotNil(t, err)
	assert.Equal(t, "Storage write rejected - version check failed.", err.Error())
}

func TestOCCWriteSameValueCorrectVersionSuccess(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	uid := uuid.Must(uuid.NewV4())
	InsertUser(t, db, uid)
	collection := GenerateString()
	key := GenerateString()

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      `{"closed":false}`,
				Version:    "",
			},
		},
	}

	// Create object
	acks, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)
	assert.Nil(t, err)
	assert.Len(t, acks.Acks, 1)

	// Change object value
	ops[0].Object.Version = acks.Acks[0].Version
	ops[0].Object.Value = `{"closed":true}`

	acks, _, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)
	assert.Nil(t, err)
	assert.Len(t, acks.Acks, 1)

	// Rewrite object to same value with correct version -- must succeed
	ops[0].Object.Version = acks.Acks[0].Version

	acks, _, err = StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, ops)
	assert.Nil(t, err)
	assert.Len(t, acks.Acks, 1)
}

func TestStorageReadObjectsSameArgs(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key := GenerateString()
	uid := uuid.Must(uuid.NewV4())
	value := "{\"foo\": \"bar\"}"
	InsertUser(t, db, uid)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key,
				Value:           value,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection2",
				Key:             key,
				Value:           value,
				PermissionRead:  &wrapperspb.Int32Value{Value: 1},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key,
		UserId:     uid.String(),
	}, {
		Collection: "testcollection1",
		Key:        key,
		UserId:     uid.String(),
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uid, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")
	assert.Equal(t, "testcollection1", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, uid.String(), readData.Objects[0].UserId, "user id did not match")
	assert.Equal(t, value, readData.Objects[0].Value, "value did not match")

	ids = []*api.ReadStorageObjectId{{
		Collection: "testcollection2",
		Key:        key,
		UserId:     uid.String(),
	}, {
		Collection: "testcollection2",
		Key:        key,
		UserId:     uid.String(),
	}}

	readData, err = StorageReadObjects(context.Background(), logger, db, uid, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 1, "readData length was not 1")
	assert.Equal(t, "testcollection2", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, uid.String(), readData.Objects[0].UserId, "user id did not match")
	assert.Equal(t, value, readData.Objects[0].Value, "value did not match")
}

func TestStorageReadObjectsOneDistinctArg(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key1 := GenerateString()
	key2 := GenerateString()
	uid1 := uuid.Must(uuid.NewV4())
	uid2 := uuid.Must(uuid.NewV4())
	value1 := "{\"foo\": \"bar\"}"
	InsertUser(t, db, uid1)
	InsertUser(t, db, uid2)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key1,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid2.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key1,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key2,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection2",
				Key:             key1,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection2",
		Key:        key1,
		UserId:     uid1.String(),
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.ElementsMatch(t, []string{"testcollection1", "testcollection2"}, []string{readData.Objects[0].Collection, readData.Objects[1].Collection}, "collection did not match")
	assert.Equal(t, key1, readData.Objects[0].Key, "key did not match")
	assert.Equal(t, key1, readData.Objects[1].Key, "key did not match")
	assert.Equal(t, uid1.String(), readData.Objects[0].UserId, "user id did not match")
	assert.Equal(t, uid1.String(), readData.Objects[1].UserId, "user id did not match")

	ids = []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection1",
		Key:        key2,
		UserId:     uid1.String(),
	}}

	readData, err = StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.Equal(t, "testcollection1", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, "testcollection1", readData.Objects[1].Collection, "collection did not match")
	assert.ElementsMatch(t, []string{key1, key2}, []string{readData.Objects[0].Key, readData.Objects[1].Key}, "key did not match")
	assert.Equal(t, uid1.String(), readData.Objects[0].UserId, "user id did not match")
	assert.Equal(t, uid1.String(), readData.Objects[1].UserId, "user id did not match")

	ids = []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid2.String(),
	}}

	readData, err = StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.Equal(t, "testcollection1", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, "testcollection1", readData.Objects[1].Collection, "collection did not match")
	assert.Equal(t, key1, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, key1, readData.Objects[1].Key, "record did not match")
	assert.ElementsMatch(t, []string{uid1.String(), uid2.String()}, []string{readData.Objects[0].UserId, readData.Objects[1].UserId}, "user id did not match")
}

func TestStorageReadObjectsTwoDistinctArgs(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key1 := GenerateString()
	key2 := GenerateString()
	uid1 := uuid.Must(uuid.NewV4())
	uid2 := uuid.Must(uuid.NewV4())
	value1 := "{\"foo\": \"bar\"}"
	InsertUser(t, db, uid1)
	InsertUser(t, db, uid2)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key1,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection2",
				Key:             key2,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid2.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key2,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid2.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection2",
				Key:             key1,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection2",
		Key:        key2,
		UserId:     uid1.String(),
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.ElementsMatch(t, []string{"testcollection1", "testcollection2"}, []string{readData.Objects[0].Collection, readData.Objects[1].Collection}, "collection did not match")
	assert.ElementsMatch(t, []string{key1, key2}, []string{readData.Objects[0].Key, readData.Objects[1].Key}, "key did not match")
	assert.Equal(t, uid1.String(), readData.Objects[0].UserId, "user id did not match")
	assert.Equal(t, uid1.String(), readData.Objects[1].UserId, "user id did not match")

	ids = []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection1",
		Key:        key2,
		UserId:     uid2.String(),
	}}

	readData, err = StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.Equal(t, "testcollection1", readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, "testcollection1", readData.Objects[1].Collection, "collection did not match")
	assert.ElementsMatch(t, []string{key1, key2}, []string{readData.Objects[0].Key, readData.Objects[1].Key}, "key did not match")
	assert.ElementsMatch(t, []string{uid1.String(), uid2.String()}, []string{readData.Objects[0].UserId, readData.Objects[1].UserId}, "user id did not match")

	ids = []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection2",
		Key:        key1,
		UserId:     uid2.String(),
	}}

	readData, err = StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.ElementsMatch(t, []string{"testcollection1", "testcollection2"}, []string{readData.Objects[0].Collection, readData.Objects[1].Collection}, "collection did not match")
	assert.Equal(t, key1, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, key1, readData.Objects[1].Key, "record did not match")
	assert.ElementsMatch(t, []string{uid1.String(), uid2.String()}, []string{readData.Objects[0].UserId, readData.Objects[1].UserId}, "user id did not match")
}

func TestStorageReadObjectsAllDistinctArgs(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	key1 := GenerateString()
	key2 := GenerateString()
	uid1 := uuid.Must(uuid.NewV4())
	uid2 := uuid.Must(uuid.NewV4())
	value1 := "{\"foo\": \"bar\"}"
	InsertUser(t, db, uid1)
	InsertUser(t, db, uid2)

	ops := StorageOpWrites{
		&StorageOpWrite{
			OwnerID: uid1.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection1",
				Key:             key1,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
		&StorageOpWrite{
			OwnerID: uid2.String(),
			Object: &api.WriteStorageObject{
				Collection:      "testcollection2",
				Key:             key2,
				Value:           value1,
				PermissionRead:  &wrapperspb.Int32Value{Value: 2},
				PermissionWrite: &wrapperspb.Int32Value{Value: 1},
			},
		},
	}

	acks, code, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, false, ops)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, codes.OK, code, "code was not 0")
	assert.NotNil(t, acks, "acks was nil")

	ids := []*api.ReadStorageObjectId{{
		Collection: "testcollection1",
		Key:        key1,
		UserId:     uid1.String(),
	}, {
		Collection: "testcollection2",
		Key:        key2,
		UserId:     uid2.String(),
	}}

	readData, err := StorageReadObjects(context.Background(), logger, db, uid1, ids)
	assert.Nil(t, err, "err was not nil")
	assert.Len(t, readData.Objects, 2, "readData length was not 2")
	assert.ElementsMatch(t, []string{"testcollection1", "testcollection2"}, []string{readData.Objects[0].Collection, readData.Objects[1].Collection}, "collection did not match")
	assert.ElementsMatch(t, []string{key1, key2}, []string{readData.Objects[0].Key, readData.Objects[1].Key}, "key did not match")
	assert.ElementsMatch(t, []string{uid1.String(), uid2.String()}, []string{readData.Objects[0].UserId, readData.Objects[1].UserId}, "user id did not match")
}
