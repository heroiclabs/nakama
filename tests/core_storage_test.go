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
	"strconv"
	"testing"
	"time"

	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/server"
	"github.com/satori/go.uuid"
	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc/codes"
)

func generateString() string {
	return strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
}

func TestStorageWriteRuntimeGlobalSingle(t *testing.T) {
	db := db(t)

	record := generateString()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.Nil: {{
			Collection:      "testcollection",
			Key:             record,
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, acks, "acks was nil")
	assert.Len(t, acks.Acks, 1, "acks length was not 1")
	assert.Equal(t, data[uuid.Nil][0].Collection, acks.Acks[0].Collection, "collection did not match")
	assert.Equal(t, data[uuid.Nil][0].Key, acks.Acks[0].Key, "key did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")

	ids := []*api.ReadStorageObjectId{
		{
			Collection: "testcollection",
			Key:        record,
		},
	}
	readData, err := server.StorageReadObjects(logger, db, uuid.Nil, ids)

	assert.Nil(t, err, "err was not nil")
	assert.NotNil(t, readData.Objects, "data was nil")
	assert.Len(t, readData.Objects, 1, "data length was not 1")
	assert.Equal(t, acks.Acks[0].Collection, readData.Objects[0].Collection, "collection did not match")
	assert.Equal(t, acks.Acks[0].Key, readData.Objects[0].Key, "record did not match")
	assert.Equal(t, uuid.Nil.String(), readData.Objects[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), readData.Objects[0].Version, "version did not match")
	assert.Equal(t, int32(2), readData.Objects[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int32(1), readData.Objects[0].PermissionWrite, "permission write did not match")
}

func TestStorageWriteRuntimeUserMultiple(t *testing.T) {
	db := db(t)
	defer db.Close()

	u0 := uuid.NewV4()
	u1 := uuid.NewV4()
	u2 := uuid.NewV4()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		u0: {{
			Collection:      "testcollection",
			Key:             generateString(),
			Value:           "{\"foo\":\"bar\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
		u1: {{
			Collection:      "testcollection",
			Key:             generateString(),
			Value:           "{\"foo\":\"baz\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 0},
			PermissionWrite: &wrappers.Int32Value{Value: 0},
		}},
		u2: {{
			Collection:      "testcollection",
			Key:             generateString(),
			Value:           "{\"foo\":\"qux\"}",
			PermissionRead:  &wrappers.Int32Value{Value: 1},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, false, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
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
	db := db(t)
	defer db.Close()

	data := map[uuid.UUID][]*api.WriteStorageObject{
		uuid.NewV4(): {{
			Collection:      "testcollection",
			Key:             generateString(),
			Value:           "{\"foo\":\"bar\"}",
			Version:         "fail",
			PermissionRead:  &wrappers.Int32Value{Value: 2},
			PermissionWrite: &wrappers.Int32Value{Value: 1},
		}},
	}
	acks, code, err := server.StorageWriteObjects(logger, db, true, data)

	assert.Nil(t, acks, "acks was not nil")
	assert.Equal(t, codes.InvalidArgument, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected -  not found, version check failed, or permission denied.", err.Error(), "error message did not match")
}

//func TestStorageWriteRuntimeGlobalSingleIfMatchExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//			Collection:      "testcollection",
//			Key:             generateString(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead:  &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//			Collection:      "testcollection",
//			Key:             data[0].Key,
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         acks.Acks[0].Version,
//			PermissionRead:  &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//
//	acks, code, err = server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//}

//func TestStorageWriteRuntimeGlobalSingleIfMatchExistsFail(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          data[0].Key,
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         "fail",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//
//	acks, code, err = server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageWriteRuntimeGlobalSingleIfNoneMatchNotExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			Value:           "{\"foo\":\"bar\"}",
//			Version:         "*",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//}
//
//func TestStorageWriteRuntimeGlobalSingleIfNoneMatchExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          data[0].Key,
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         "*",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//
//	acks, code, err = server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageWriteRuntimeGlobalMultipleIfMatchNotExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         "fail",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageWritePipelineSingleGlobalNotAllowed(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uuid.NewV4().String(), data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "A client cannot write global records", err.Error(), "error message did not match")
//}
//
//func TestStorageWritePipelineSingleOtherClientNotAllowed(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uuid.NewV4().String(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uuid.NewV4().String(), data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "A client can only write their own records", err.Error(), "error message did not match")
//}
//
//func TestStorageWritePipelineUserSingle(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//}
//
//func TestStorageWritePipelineUserMultiple(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"qux\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 3, "acks length was not 3")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//	assert.Equal(t, data[2].Bucket, acks[2].Bucket, "bucket 2 did not match")
//	assert.Equal(t, data[2].Collection, acks[2].Collection, "collection 2 did not match")
//	assert.Equal(t, data[2].Key, acks[2].Key, "record 2 did not match")
//	assert.EqualValues(t, data[2].UserId, acks[2].UserId, "user id 2 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[2].Value))), acks[2].Version, "version 2 did not match")
//}
//
//func TestStorageWriteRuntimeGlobalMultipleSameKey(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"qux\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 3, "acks length was not 3")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id 0 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.Equal(t, "", acks[1].UserId, "user id 1 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//	assert.Equal(t, data[2].Bucket, acks[2].Bucket, "bucket 2 did not match")
//	assert.Equal(t, data[2].Collection, acks[2].Collection, "collection 2 did not match")
//	assert.Equal(t, data[2].Key, acks[2].Key, "record 2 did not match")
//	assert.Equal(t, "", acks[2].UserId, "user id 2 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[2].Value))), acks[2].Version, "version 2 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//	}
//
//	data, code, err = server.StorageReadObjects(logger, db, uuid.Nil, ids)
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, "testbucket", data[0].Bucket, "bucket did not match")
//	assert.Equal(t, "testcollection", data[0].Collection, "collection did not match")
//	assert.Equal(t, record, data[0].Key, "record did not match")
//	assert.Equal(t, "", data[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256("{\"foo\":\"qux\"}"))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(1), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(1), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageWritePipelineUserMultipleSameKey(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, uid, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, uid, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, "testbucket", data[0].Bucket, "bucket did not match")
//	assert.Equal(t, "testcollection", data[0].Collection, "collection did not match")
//	assert.Equal(t, record, data[0].Key, "record did not match")
//	assert.EqualValues(t, uid, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256("{\"foo\":\"baz\"}"))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(1), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageWritePipelineIfMatchNotExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			Version:         "fail",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageWritePipelineIfMatchExistsFail(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         "fail",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err = server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageWritePipelineIfMatchExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         acks.Acks[0].Version,
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err = server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//}
//
//func TestStorageWritePipelineIfNoneMatchNotExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          generateString(),
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			Version:         "*",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//}
//
//func TestStorageWritePipelineIfNoneMatchExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			Version:         "*",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err = server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageWritePipelinePermissionFail(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	data = []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err = server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, acks, "acks was not nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageFetchRuntimeGlobalPrivate(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.Equal(t, "", data[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(0), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageFetchRuntimeMixed(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     "notfound",
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.Equal(t, "", data[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(0), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageFetchRuntimeUserPrivate(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(0), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageFetchPipelineGlobalPrivate(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uuid.NewV4().String(), acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageFetchPipelineUserPrivate(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uid, acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageFetchPipelineUserRead(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uid, acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(1), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageFetchPipelineUserPublic(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uid, acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageFetchPipelineUserOtherRead(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uuid.NewV4().String(), acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageFetchPipelineUserOtherPublic(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uuid.NewV4().String(), acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageFetchPipelineUserOtherPublicMixed(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, uuid.NewV4().String(), acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 1, "data length was not 1")
//	assert.Equal(t, acks.Acks[0].Bucket, data[0].Bucket, "bucket did not match")
//	assert.Equal(t, acks.Acks[0].Collection, data[0].Collection, "collection did not match")
//	assert.Equal(t, acks.Acks[0].Key, data[0].Key, "record did not match")
//	assert.EqualValues(t, acks.Acks[0].UserId, data[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version did not match")
//	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
//	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalPublic(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageRemoveRuntimeGlobalPrivate(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageRemoveRuntimeUserPublic(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageRemoveRuntimeUserPrivate(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageRemovePipelineGlobalRejected(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, uuid.NewV4().String(), acks)
//
//	assert.NotNil(t, err, "err was not nil")
//	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
//	assert.Equal(t, "A client cannot remove global records", err.Error(), "error message did not match")
//}
//
//func TestStorageRemovePipelineUserOtherRejected(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uuid.NewV4().String(),
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 2},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     data[0].UserId,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, uuid.NewV4().String(), acks)
//
//	assert.NotNil(t, err, "err was not nil")
//	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
//	assert.Equal(t, "A client can only remove their own records", err.Error(), "error message did not match")
//}
//
//func TestStorageRemovePipelineUserWrite(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, uid, acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//}
//
//func TestStorageRemovePipelineUserDenied(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			UserId:     uid,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, uid, acks)
//
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalIfMatchNotExists(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	acks := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     generateString(),
//			Version:    "fail",
//		},
//	}
//	code, err := server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalIfMatchRejected(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			Version:    "fail",
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalIfMatch(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record,
//			Version:    acks.Acks[0].Version,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalMultiple(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id 0 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.Equal(t, "", acks[1].UserId, "user id 1 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalMultipleMixed(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 1, "acks length was not 1")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//}
//
//func TestStorageRemoveRuntimeGlobalMultipleMixedIfMatch(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, "", data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.Equal(t, "", acks.Acks[0].UserId, "user id 0 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.Equal(t, "", acks[1].UserId, "user id 1 was not nil")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			Version:    "fail",
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageRemovePipelineUserMultipleMixedDenied(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, uid, acks)
//
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//}
//
//func TestStorageRemoveRuntimeUserMultipleMixed(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//}
//
//func TestStorageRemoveRuntimeUserMultipleIfMatchFail(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//			Version:    "fail",
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.NotNil(t, err, "err was nil")
//	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
//	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 2, "data length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), data[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), data[1].Version, "version 1 did not match")
//}
//
//func TestStorageRemoveRuntimeUserMultipleIfMatch(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	record1 := generateString()
//	record2 := generateString()
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record1,
//			UserId:          uid,
//			Value:           "{\"foo\":\"bar\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          record2,
//			UserId:          uid,
//			Value:           "{\"foo\":\"baz\"}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 2, "acks length was not 2")
//	assert.Equal(t, data[0].Bucket, acks.Acks[0].Bucket, "bucket 0 did not match")
//	assert.Equal(t, data[0].Collection, acks.Acks[0].Collection, "collection 0 did not match")
//	assert.Equal(t, data[0].Key, acks.acks.Acks[0].Key, "key 0 did not match")
//	assert.EqualValues(t, data[0].UserId, acks.Acks[0].UserId, "user id 0 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", md5.Sum([]byte((data[uuid.Nil][0].Value))))), acks.Acks[0].Version, "version 0 did not match")
//	assert.Equal(t, data[1].Bucket, acks[1].Bucket, "bucket 1 did not match")
//	assert.Equal(t, data[1].Collection, acks[1].Collection, "collection 1 did not match")
//	assert.Equal(t, data[1].Key, acks[1].Key, "record 1 did not match")
//	assert.EqualValues(t, data[1].UserId, acks[1].UserId, "user id 1 did not match")
//	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), acks[1].Version, "version 1 did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//			Version:    acks[1].Version,
//		},
//	}
//	code, err = server.StorageRemove(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was nil")
//	assert.Equal(t, 0, int(code), "code did not match")
//
//	ids := []*server.StorageKey{
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record1,
//			UserId:     uid,
//		},
//		&server.StorageKey{
//			Bucket:     "testbucket",
//			Collection: "testcollection",
//			Key:     record2,
//			UserId:     uid,
//		},
//	}
//	data, code, err = server.StorageReadObjects(logger, db, "", acks)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, data, "data was nil")
//	assert.Len(t, data, 0, "data length was not 0")
//}
//
//func TestStorageListRuntimeUser(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          "b",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          "a",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//		&server.StorageData{
//						Collection:      "testcollection",
//			Key:          "c",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 3, "acks length was not 3")
//
//	values, cursor, code, err := server.StorageList(logger, db, "", uid, "testbucket", "testcollection", 10, "")
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, values, "values was nil")
//	assert.Len(t, values, 3, "values length was not 3")
//	assert.Equal(t, "a", values[0].Key, "values[0].Key was not a")
//	assert.Equal(t, "b", values[1].Key, "values[1].Key was not b")
//	assert.Equal(t, "c", values[2].Key, "values[2].Key was not c")
//	assert.Equal(t, "", cursor, "cursor was not nil")
//}
//
//func TestStorageListPipelineUserSelf(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//	collection := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      collection,
//			Key:          "b",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      collection,
//			Key:          "a",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//		&server.StorageData{
//						Collection:      collection,
//			Key:          "c",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 3, "acks length was not 3")
//
//	values, cursor, code, err := server.StorageList(logger, db, uid, uid, "testbucket", collection, 10, "")
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, values, "values was nil")
//	assert.Len(t, values, 2, "values length was not 2")
//	assert.Equal(t, "a", values[0].Key, "values[0].Key was not a")
//	assert.Equal(t, "b", values[1].Key, "values[1].Key was not b")
//	assert.Equal(t, "", cursor, "cursor was not nil")
//}
//
//func TestStorageListPipelineUserOther(t *testing.T) {
//	db := db(t)
//	defer db.Close()
//
//	uid := uuid.NewV4().String()
//	collection := generateString()
//
//	data := []*server.StorageData{
//		&server.StorageData{
//						Collection:      collection,
//			Key:          "b",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 1},
//		},
//		&server.StorageData{
//						Collection:      collection,
//			Key:          "a",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 1},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//		&server.StorageData{
//						Collection:      collection,
//			Key:          "c",
//			UserId:          uid,
//			Value:           "{}",
//			PermissionRead: &wrappers.Int32Value{Value: 0},
//			PermissionWrite: &wrappers.Int32Value{Value: 0},,
//		},
//	}
//	acks, code, err := server.StorageWriteObjects(logger, db, uid, data)
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, acks, "acks was nil")
//	assert.Len(t, acks, 3, "acks length was not 3")
//
//	values, cursor, code, err := server.StorageList(logger, db, uuid.NewV4().String(), uid, "testbucket", collection, 10, "")
//
//	assert.Nil(t, err, "err was not nil")
//	assert.Equal(t, 0, int(code), "code was not 0")
//	assert.NotNil(t, values, "values was nil")
//	assert.Len(t, values, 0, "values length was not 0")
//	assert.Equal(t, "", cursor, "cursor was not nil")
//}
