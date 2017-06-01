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
	"crypto/sha256"
	"database/sql"
	"fmt"
	"github.com/satori/go.uuid"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"nakama/server"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func setupDB() (*sql.DB, error) {
	rawurl := fmt.Sprintf("postgresql://%s?sslmode=disable", "root@localhost:26257/nakama")
	url, err := url.Parse(rawurl)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("postgres", url.String())
	if err != nil {
		return nil, err
	}
	return db, nil
}

func generateRecord() string {
	return strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
}

func TestStorageWriteRuntimeGlobalSingle(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.Nil(t, data[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(1), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageWriteRuntimeGlobalMultiple(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"qux\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 3, "keys length was not 3")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.Nil(t, keys[0].UserId, "user id 0 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.Nil(t, keys[1].UserId, "user id 1 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")
	assert.Equal(t, data[2].Bucket, keys[2].Bucket, "bucket 2 did not match")
	assert.Equal(t, data[2].Collection, keys[2].Collection, "collection 2 did not match")
	assert.Equal(t, data[2].Record, keys[2].Record, "record 2 did not match")
	assert.Nil(t, keys[2].UserId, "user id 2 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[2].Value))), keys[2].Version, "version 2 did not match")
}

func TestStorageWriteRuntimeUserMultiple(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uuid.NewV4().Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uuid.NewV4().Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uuid.NewV4().Bytes(),
			Value:           []byte("{\"foo\":\"qux\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 3, "keys length was not 3")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, keys[1].UserId, data[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")
	assert.Equal(t, data[2].Bucket, keys[2].Bucket, "bucket 2 did not match")
	assert.Equal(t, data[2].Collection, keys[2].Collection, "collection 2 did not match")
	assert.Equal(t, data[2].Record, keys[2].Record, "record 2 did not match")
	assert.EqualValues(t, keys[2].UserId, data[2].UserId, "user id 2 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[2].Value))), keys[2].Version, "version 2 did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchNotExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			Version:         []byte("fail"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          data[0].Record,
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         keys[0].Version,
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}

	keys, code, err = server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfMatchExistsFail(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          data[0].Record,
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         []byte("fail"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}

	keys, code, err = server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfNoneMatchNotExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			Version:         []byte("*"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")
}

func TestStorageWriteRuntimeGlobalSingleIfNoneMatchExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          data[0].Record,
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         []byte("*"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}

	keys, code, err = server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWriteRuntimeGlobalMultipleIfMatchNotExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         []byte("fail"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWritePipelineSingleGlobalNotAllowed(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.NewV4(), data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Clients cannot write global data", err.Error(), "error message did not match")
}

func TestStorageWritePipelineSingleOtherClientNotAllowed(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uuid.NewV4().Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.NewV4(), data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Clients can only write their own data", err.Error(), "error message did not match")
}

func TestStorageWritePipelineUserSingle(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")
}

func TestStorageWritePipelineUserMultiple(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"qux\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 3, "keys length was not 3")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")
	assert.Equal(t, data[2].Bucket, keys[2].Bucket, "bucket 2 did not match")
	assert.Equal(t, data[2].Collection, keys[2].Collection, "collection 2 did not match")
	assert.Equal(t, data[2].Record, keys[2].Record, "record 2 did not match")
	assert.EqualValues(t, data[2].UserId, keys[2].UserId, "user id 2 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[2].Value))), keys[2].Version, "version 2 did not match")
}

func TestStorageWriteRuntimeGlobalMultipleSameKey(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"qux\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 3, "keys length was not 3")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.Nil(t, keys[0].UserId, "user id 0 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.Nil(t, keys[1].UserId, "user id 1 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")
	assert.Equal(t, data[2].Bucket, keys[2].Bucket, "bucket 2 did not match")
	assert.Equal(t, data[2].Collection, keys[2].Collection, "collection 2 did not match")
	assert.Equal(t, data[2].Record, keys[2].Record, "record 2 did not match")
	assert.Nil(t, keys[2].UserId, "user id 2 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[2].Value))), keys[2].Version, "version 2 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}

	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, "testbucket", data[0].Bucket, "bucket did not match")
	assert.Equal(t, "testcollection", data[0].Collection, "collection did not match")
	assert.Equal(t, record, data[0].Record, "record did not match")
	assert.Nil(t, data[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256([]byte("{\"foo\":\"qux\"}")))), data[0].Version, "version did not match")
	assert.Equal(t, int64(1), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(1), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageWritePipelineUserMultipleSameKey(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, uid.Bytes(), keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, uid.Bytes(), keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}

	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, "testbucket", data[0].Bucket, "bucket did not match")
	assert.Equal(t, "testcollection", data[0].Collection, "collection did not match")
	assert.Equal(t, record, data[0].Record, "record did not match")
	assert.EqualValues(t, uid.Bytes(), data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256([]byte("{\"foo\":\"baz\"}")))), data[0].Version, "version did not match")
	assert.Equal(t, int64(1), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageWritePipelineIfMatchNotExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			Version:         []byte("fail"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWritePipelineIfMatchExistsFail(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         []byte("fail"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err = server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWritePipelineIfMatchExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         keys[0].Version,
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err = server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")
}

func TestStorageWritePipelineIfNoneMatchNotExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          generateRecord(),
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			Version:         []byte("*"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")
}

func TestStorageWritePipelineIfNoneMatchExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			Version:         []byte("*"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err = server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageWritePipelinePermissionFail(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	data = []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err = server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, keys, "keys was not nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, "Storage write rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageFetchRuntimeGlobalPrivate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.Nil(t, data[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(0), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchRuntimeMixed(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     "notfound",
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.Nil(t, data[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(0), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchRuntimeUserPrivate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(0), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineGlobalPrivate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.NewV4(), keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageFetchPipelineUserPrivate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uid, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageFetchPipelineUserRead(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uid, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(1), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserPublic(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uid, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserOtherRead(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.NewV4(), keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageFetchPipelineUserOtherPublic(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.NewV4(), keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageFetchPipelineUserOtherPublicMixed(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 0,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.NewV4(), keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 1, "data length was not 1")
	assert.Equal(t, keys[0].Bucket, data[0].Bucket, "bucket did not match")
	assert.Equal(t, keys[0].Collection, data[0].Collection, "collection did not match")
	assert.Equal(t, keys[0].Record, data[0].Record, "record did not match")
	assert.EqualValues(t, keys[0].UserId, data[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version did not match")
	assert.Equal(t, int64(2), data[0].PermissionRead, "permission read did not match")
	assert.Equal(t, int64(0), data[0].PermissionWrite, "permission write did not match")
}

func TestStorageRemoveRuntimeGlobalPublic(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")

	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageRemoveRuntimeGlobalPrivate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")

	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageRemoveRuntimeUserPublic(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")

	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageRemoveRuntimeUserPrivate(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  0,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")

	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)
	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.Len(t, data, 0, "data length was not 0")
}

func TestStorageRemovePipelineGlobalRejected(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.NewV4(), keys)

	assert.NotNil(t, err, "err was not nil")
	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
	assert.Equal(t, "Clients cannot remove global data", err.Error(), "error message did not match")
}

func TestStorageRemovePipelineUserOtherRejected(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uuid.NewV4().Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  2,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     data[0].UserId,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.NewV4(), keys)

	assert.NotNil(t, err, "err was not nil")
	assert.Equal(t, server.BAD_INPUT, code, "code did not match")
	assert.Equal(t, "Clients can only remove their own data", err.Error(), "error message did not match")
}

func TestStorageRemovePipelineUserWrite(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	code, err = server.StorageRemove(logger, db, uid, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code did not match")
}

func TestStorageRemovePipelineUserDenied(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			UserId:     uid.Bytes(),
		},
	}
	code, err = server.StorageRemove(logger, db, uid, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageRemoveRuntimeGlobalIfMatchNotExists(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	keys := []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     generateRecord(),
			Version:    []byte("fail"),
		},
	}
	code, err := server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageRemoveRuntimeGlobalIfMatchRejected(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			Version:    []byte("fail"),
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageRemoveRuntimeGlobalIfMatch(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record,
			Version:    keys[0].Version,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code did not match")
}

func TestStorageRemoveRuntimeGlobalMultiple(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.Nil(t, keys[0].UserId, "user id 0 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.Nil(t, keys[1].UserId, "user id 1 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code did not match")
}

func TestStorageRemoveRuntimeGlobalMultipleMixed(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 1, "keys length was not 1")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record did not match")
	assert.Nil(t, keys[0].UserId, "user id was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageRemoveRuntimeGlobalMultipleMixedIfMatch(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.Nil(t, keys[0].UserId, "user id 0 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.Nil(t, keys[1].UserId, "user id 1 was not nil")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			Version:    []byte("fail"),
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageRemovePipelineUserMultipleMixedDenied(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
		},
	}
	code, err = server.StorageRemove(logger, db, uid, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")
}

func TestStorageRemoveRuntimeUserMultipleMixed(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code did not match")
}

func TestStorageRemoveRuntimeUserMultipleIfMatchFail(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
			Version:    []byte("fail"),
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.NotNil(t, err, "err was nil")
	assert.Equal(t, server.STORAGE_REJECTED, code, "code did not match")
	assert.Equal(t, "Storage remove rejected: not found, version check failed, or permission denied", err.Error(), "error message did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 2, "data length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), data[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), data[1].Version, "version 1 did not match")
}

func TestStorageRemoveRuntimeUserMultipleIfMatch(t *testing.T) {
	db, err := setupDB()
	if err != nil {
		t.Error(err)
	}
	defer db.Close()
	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))

	record1 := generateRecord()
	record2 := generateRecord()
	uid := uuid.NewV4()

	data := []*server.StorageData{
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record1,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"bar\"}"),
			PermissionRead:  1,
			PermissionWrite: 1,
		},
		&server.StorageData{
			Bucket:          "testbucket",
			Collection:      "testcollection",
			Record:          record2,
			UserId:          uid.Bytes(),
			Value:           []byte("{\"foo\":\"baz\"}"),
			PermissionRead:  1,
			PermissionWrite: 0,
		},
	}
	keys, code, err := server.StorageWrite(logger, db, uid, data)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, keys, "keys was nil")
	assert.Len(t, keys, 2, "keys length was not 2")
	assert.Equal(t, data[0].Bucket, keys[0].Bucket, "bucket 0 did not match")
	assert.Equal(t, data[0].Collection, keys[0].Collection, "collection 0 did not match")
	assert.Equal(t, data[0].Record, keys[0].Record, "record 0 did not match")
	assert.EqualValues(t, data[0].UserId, keys[0].UserId, "user id 0 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[0].Value))), keys[0].Version, "version 0 did not match")
	assert.Equal(t, data[1].Bucket, keys[1].Bucket, "bucket 1 did not match")
	assert.Equal(t, data[1].Collection, keys[1].Collection, "collection 1 did not match")
	assert.Equal(t, data[1].Record, keys[1].Record, "record 1 did not match")
	assert.EqualValues(t, data[1].UserId, keys[1].UserId, "user id 1 did not match")
	assert.EqualValues(t, []byte(fmt.Sprintf("%x", sha256.Sum256(data[1].Value))), keys[1].Version, "version 1 did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
			Version:    keys[1].Version,
		},
	}
	code, err = server.StorageRemove(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was nil")
	assert.Equal(t, 0, int(code), "code did not match")

	keys = []*server.StorageKey{
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record1,
			UserId:     uid.Bytes(),
		},
		&server.StorageKey{
			Bucket:     "testbucket",
			Collection: "testcollection",
			Record:     record2,
			UserId:     uid.Bytes(),
		},
	}
	data, code, err = server.StorageFetch(logger, db, uuid.Nil, keys)

	assert.Nil(t, err, "err was not nil")
	assert.Equal(t, 0, int(code), "code was not 0")
	assert.NotNil(t, data, "data was nil")
	assert.Len(t, data, 0, "data length was not 0")
}
