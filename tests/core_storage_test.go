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

func TestStorageWritePipelineSingleClient(t *testing.T) {
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
	keys, code, err := server.StorageWrite(logger, db, uuid.Nil, data)

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

func TestStorageWriteRuntimeGlobalSameKey(t *testing.T) {

}
