// Copyright 2024 The Nakama Authors
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
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/stretchr/testify/assert"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestLocalStorageIndex_Write(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ctx := context.Background()

	nilUid := uuid.Nil

	u1 := uuid.Must(uuid.NewV4())
	u2 := uuid.Must(uuid.NewV4())
	u3 := uuid.Must(uuid.NewV4())
	u4 := uuid.Must(uuid.NewV4())
	u5 := uuid.Must(uuid.NewV4())

	InsertUser(t, db, u1)
	InsertUser(t, db, u2)
	InsertUser(t, db, u3)
	InsertUser(t, db, u4)
	InsertUser(t, db, u5)

	indexName1 := "test_index_1"
	indexName2 := "test_index_2"
	collection1 := "test_collection_1"
	collection2 := "test_collection_2"
	key := "key"
	maxEntries1 := 10
	maxEntries2 := 3

	valueOneBytes, _ := json.Marshal(map[string]any{
		"one": 1,
	})
	valueOne := string(valueOneBytes)
	valueTwoBytes, _ := json.Marshal(map[string]any{
		"two": 2,
	})
	valueTwo := string(valueTwoBytes)
	valueThreeBytes, _ := json.Marshal(map[string]any{
		"three": 3,
	})
	valueThree := string(valueThreeBytes)

	storageIdx, err := NewLocalStorageIndex(logger, db, &StorageConfig{}, metrics)
	if err != nil {
		t.Fatal(err.Error())
	}

	if err := storageIdx.CreateIndex(ctx, indexName1, collection1, key, []string{"one", "two"}, []string{}, maxEntries1, false); err != nil {
		t.Fatal(err.Error())
	}

	// Matches all keys
	if err := storageIdx.CreateIndex(ctx, indexName2, collection1, "", []string{"three"}, []string{}, maxEntries2, false); err != nil {
		t.Fatal(err.Error())
	}

	t.Run("indexes storage objects matching configured index collection key and fields to correct indices", func(t *testing.T) {
		so1 := &StorageOpWrite{
			OwnerID: nilUid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        key,
				Value:      valueOne,
			},
		}
		so2 := &StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        "key_no_match",
				Value:      valueOne,
			},
		}
		so3 := &StorageOpWrite{
			OwnerID: u2.String(),
			Object: &api.WriteStorageObject{
				Collection: "collection_no_match",
				Key:        key,
				Value:      valueOne,
			},
		}
		so4 := &StorageOpWrite{
			OwnerID: u3.String(),
			Object: &api.WriteStorageObject{
				Collection: collection2,
				Key:        key,
				Value:      valueThree,
			},
		}
		so5 := &StorageOpWrite{
			OwnerID: u4.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        key,
				Value:      valueTwo,
			},
		}
		so6 := &StorageOpWrite{
			OwnerID: u5.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        "key2",
				Value:      valueThree,
			},
		}

		writeOps := StorageOpWrites{so1, so2, so3, so4, so5, so6}

		if _, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, writeOps); err != nil {
			t.Fatal(err.Error())
		}

		entries, err := storageIdx.List(ctx, uuid.Nil, indexName1, "", maxEntries1, []string{}) // Match all
		if err != nil {
			t.Fatal(err.Error())
		}
		assert.Len(t, entries.Objects, 2, "indexed results length was not 2")

		entries, err = storageIdx.List(ctx, uuid.Nil, indexName2, "", maxEntries1, []string{}) // Match all
		if err != nil {
			t.Fatal(err.Error())
		}
		assert.Len(t, entries.Objects, 1, "indexed results length was not 1")

		delOps := make(StorageOpDeletes, 0, len(writeOps))
		for _, op := range writeOps {
			delOps = append(delOps, &StorageOpDelete{
				OwnerID: op.OwnerID,
				ObjectID: &api.DeleteStorageObjectId{
					Collection: op.Object.Collection,
					Key:        op.Object.Key,
				},
			})
		}
		if _, err = StorageDeleteObjects(ctx, logger, db, storageIdx, true, delOps); err != nil {
			t.Fatalf("Failed to teardown: %s", err.Error())
		}
	})

	t.Run("only indexes the values of matching fields", func(t *testing.T) {
		valueBytes, _ := json.Marshal(map[string]any{
			"one":   1,
			"three": 3,
		})
		value := string(valueBytes)

		so1 := &StorageOpWrite{
			OwnerID: nilUid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        key,
				Value:      value,
			},
		}

		if _, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, StorageOpWrites{so1}); err != nil {
			t.Fatal(err.Error())
		}

		entries, err := storageIdx.List(ctx, uuid.Nil, indexName1, "+value.three:3", maxEntries1, []string{})
		if err != nil {
			t.Fatal(err.Error())
		}
		assert.Emptyf(t, entries.Objects, "indexed results was not empty")

		deletes := StorageOpDeletes{
			&StorageOpDelete{
				OwnerID: so1.OwnerID,
				ObjectID: &api.DeleteStorageObjectId{
					Collection: so1.Object.Collection,
					Key:        so1.Object.Key,
				},
			},
		}
		if _, err = StorageDeleteObjects(ctx, logger, db, storageIdx, true, deletes); err != nil {
			t.Fatalf("Failed to teardown: %s", err.Error())
		}
	})

	t.Run("allows concurrent writes to index", func(t *testing.T) {
		ts := time.Now()

		so1 := &api.StorageObject{
			Collection:      collection1,
			Key:             key,
			UserId:          nilUid.String(),
			Value:           valueOne,
			Version:         "some_version",
			PermissionRead:  0,
			PermissionWrite: 0,
			CreateTime:      timestamppb.New(ts),
			UpdateTime:      timestamppb.New(ts),
		}

		storageIdx, err := NewLocalStorageIndex(logger, db, &StorageConfig{}, metrics)
		if err != nil {
			t.Fatal(err.Error())
		}

		writeFn := func() {
			storageIdx.Write(ctx, []*api.StorageObject{so1})
		}
		assert.NotPanicsf(t, writeFn, "Panic running concurrent storage index writes")

		wg := sync.WaitGroup{}
		wg.Add(2)
		go func() {
			for i := 0; i < 1_000; i++ {
				writeFn()
			}
			wg.Done()
		}()
		go func() {
			for i := 0; i < 1_000; i++ {
				writeFn()
			}
			wg.Done()
		}()

		wg.Wait()
	})

	t.Run("evicts oldest entries after indexed count is 10% above index max entries", func(t *testing.T) {
		so1 := &StorageOpWrite{
			OwnerID: nilUid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        key,
				Value:      valueThree,
			},
		}
		so2 := &StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        collection1,
				Value:      valueThree,
			},
		}
		so3 := &StorageOpWrite{
			OwnerID: u2.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        key,
				Value:      valueThree,
			},
		}
		so4 := &StorageOpWrite{
			OwnerID: u3.String(),
			Object: &api.WriteStorageObject{
				Collection: collection1,
				Key:        key,
				Value:      valueThree,
			},
		}

		writeOps := StorageOpWrites{so1, so2, so3, so4}

		if _, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, writeOps); err != nil {
			t.Fatal(err.Error())
		}

		entries, err := storageIdx.List(ctx, uuid.Nil, indexName2, "", maxEntries2, []string{})
		if err != nil {
			t.Fatal(err.Error())
		}

		assert.Len(t, entries.Objects, 3, "oldest entry was not evicted from index")
		for _, e := range entries.Objects {
			assert.NotEqualf(t, e.UserId, uuid.Nil.String(), "so1 should've been evicted from the cache")
		}

		delOps := make(StorageOpDeletes, 0, len(writeOps))
		for _, op := range writeOps {
			delOps = append(delOps, &StorageOpDelete{
				OwnerID: op.OwnerID,
				ObjectID: &api.DeleteStorageObjectId{
					Collection: op.Object.Collection,
					Key:        op.Object.Key,
				},
			})
		}
		if _, err = StorageDeleteObjects(ctx, logger, db, storageIdx, true, delOps); err != nil {
			t.Fatalf("Failed to teardown: %s", err.Error())
		}
	})
}

func TestLocalStorageIndex_List(t *testing.T) {
	t.Run("when indexOnly is false, returns all matching results for query from the db", func(t *testing.T) {
		db := NewDB(t)
		defer db.Close()

		ctx := context.Background()

		nilUid := uuid.Nil

		u1 := uuid.Must(uuid.NewV4())
		InsertUser(t, db, u1)

		indexName := "test_index_only"
		collection := "test_collection"
		key := "key"
		maxEntries := 10

		valueOneBytes, _ := json.Marshal(map[string]any{
			"one": 1,
		})
		valueOne := string(valueOneBytes)
		valueTwoBytes, _ := json.Marshal(map[string]any{
			"two": 2,
		})
		valueTwo := string(valueTwoBytes)
		valueThreeBytes, _ := json.Marshal(map[string]any{
			"three": 3,
		})
		valueThree := string(valueThreeBytes)

		storageIdx, err := NewLocalStorageIndex(logger, db, &StorageConfig{}, metrics)
		if err != nil {
			t.Fatal(err.Error())
		}

		if err := storageIdx.CreateIndex(ctx, indexName, collection, key, []string{"one", "two", "three"}, []string{}, maxEntries, true); err != nil {
			t.Fatal(err.Error())
		}

		so1 := &StorageOpWrite{
			OwnerID: nilUid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      valueOne,
			},
		}
		so2 := &StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      valueTwo,
			},
		}
		so3 := &StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      valueThree,
			},
		}

		writeOps := StorageOpWrites{so1, so2, so3}

		if _, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, writeOps); err != nil {
			t.Fatal(err.Error())
		}

		entries, err := storageIdx.List(ctx, uuid.Nil, indexName, "value.one:1 value.three:3", 10, []string{})
		if err != nil {
			t.Fatal(err.Error())
		}

		assert.Len(t, entries.Objects, 2, "indexed results did not match query params")
		assert.Equal(t, valueOne, strings.ReplaceAll(entries.Objects[0].Value, " ", ""), "expected value retrieved from db did not match")
		assert.Equal(t, valueThree, strings.ReplaceAll(entries.Objects[1].Value, " ", ""), "expected value retrieved from db did not match")

		delOps := make(StorageOpDeletes, 0, len(writeOps))
		for _, op := range writeOps {
			delOps = append(delOps, &StorageOpDelete{
				OwnerID: op.OwnerID,
				ObjectID: &api.DeleteStorageObjectId{
					Collection: op.Object.Collection,
					Key:        op.Object.Key,
				},
			})
		}
		if _, err = StorageDeleteObjects(ctx, logger, db, storageIdx, true, delOps); err != nil {
			t.Fatalf("Failed to teardown: %s", err.Error())
		}
	})

	t.Run("when indexOnly is true, returns all matching results from the index", func(t *testing.T) {
		db := NewDB(t)
		defer db.Close()

		ctx := context.Background()

		nilUid := uuid.Nil

		u1 := uuid.Must(uuid.NewV4())
		InsertUser(t, db, u1)

		indexName := "test_index"
		collection := "test_collection"
		key := "key"
		maxEntries := 10

		valueOneBytes, _ := json.Marshal(map[string]any{
			"one":  1,
			"sort": 1,
		})
		valueOne := string(valueOneBytes)
		valueTwoBytes, _ := json.Marshal(map[string]any{
			"two":  2,
			"sort": 2,
		})
		valueTwo := string(valueTwoBytes)
		valueThreeBytes, _ := json.Marshal(map[string]any{
			"three": 3,
			"sort":  3,
		})
		valueThree := string(valueThreeBytes)

		storageIdx, err := NewLocalStorageIndex(logger, db, &StorageConfig{}, metrics)
		if err != nil {
			t.Fatal(err.Error())
		}

		if err := storageIdx.CreateIndex(ctx, indexName, collection, key, []string{"one", "two", "three", "sort"}, []string{"sort"}, maxEntries, true); err != nil {
			t.Fatal(err.Error())
		}

		so1 := &StorageOpWrite{
			OwnerID: nilUid.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      valueOne,
			},
		}
		so2 := &StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      valueTwo,
			},
		}
		so3 := &StorageOpWrite{
			OwnerID: u1.String(),
			Object: &api.WriteStorageObject{
				Collection: collection,
				Key:        key,
				Value:      valueThree,
			},
		}

		writeOps := StorageOpWrites{so1, so2, so3}

		if _, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, writeOps); err != nil {
			t.Fatal(err.Error())
		}

		entries, err := storageIdx.List(ctx, uuid.Nil, indexName, "value.one:1 value.three:3", 10, []string{})
		if err != nil {
			t.Fatal(err.Error())
		}

		assert.Len(t, entries.Objects, 2, "indexed results did not match query params")
		assert.Equal(t, valueOne, entries.Objects[0].Value, "expected value retrieved from db did not match")
		assert.Equal(t, valueThree, entries.Objects[1].Value, "expected value retrieved from db did not match")

		sortEntries, err := storageIdx.List(ctx, uuid.Nil, indexName, "value.one:1 value.three:3", 10, []string{"value.sort"})
		if err != nil {
			t.Fatal(err.Error())
		}
		assert.Len(t, sortEntries.Objects, 2, "indexed results did not match query params")
		assert.Equal(t, valueOne, sortEntries.Objects[0].Value, "expected value retrieved from db did not match")
		assert.Equal(t, valueThree, sortEntries.Objects[1].Value, "expected value retrieved from db did not match")

		sortDescEntries, err := storageIdx.List(ctx, uuid.Nil, indexName, "value.one:1 value.three:3", 10, []string{"-value.sort"})
		if err != nil {
			t.Fatal(err.Error())
		}
		assert.Len(t, sortDescEntries.Objects, 2, "indexed results did not match query params")
		assert.Equal(t, valueOne, sortDescEntries.Objects[1].Value, "expected value retrieved from db did not match")
		assert.Equal(t, valueThree, sortDescEntries.Objects[0].Value, "expected value retrieved from db did not match")

		delOps := make(StorageOpDeletes, 0, len(writeOps))
		for _, op := range writeOps {
			delOps = append(delOps, &StorageOpDelete{
				OwnerID: op.OwnerID,
				ObjectID: &api.DeleteStorageObjectId{
					Collection: op.Object.Collection,
					Key:        op.Object.Key,
				},
			})
		}
		if _, err = StorageDeleteObjects(ctx, logger, db, storageIdx, true, delOps); err != nil {
			t.Fatalf("Failed to teardown: %s", err.Error())
		}
	})
}

func TestLocalStorageIndex_Delete(t *testing.T) {
	db := NewDB(t)
	defer db.Close()

	ctx := context.Background()

	nilUid := uuid.Nil
	u1 := uuid.Must(uuid.NewV4())
	InsertUser(t, db, u1)

	indexName := "test_index"
	collection := "test_collection"
	maxEntries := 10

	valueOneBytes, _ := json.Marshal(map[string]any{
		"one": 1,
	})
	valueOne := string(valueOneBytes)

	storageIdx, err := NewLocalStorageIndex(logger, db, &StorageConfig{}, metrics)
	if err != nil {
		t.Fatal(err.Error())
	}

	if err := storageIdx.CreateIndex(ctx, indexName, collection, "", []string{"one"}, []string{}, maxEntries, false); err != nil {
		t.Fatal(err.Error())
	}

	so1 := &StorageOpWrite{
		OwnerID: nilUid.String(),
		Object: &api.WriteStorageObject{
			Collection: collection,
			Key:        "key1",
			Value:      valueOne,
		},
	}
	so2 := &StorageOpWrite{
		OwnerID: u1.String(),
		Object: &api.WriteStorageObject{
			Collection: collection,
			Key:        "key2",
			Value:      valueOne,
		},
	}

	writeOps := StorageOpWrites{so1, so2}

	if _, _, err := StorageWriteObjects(context.Background(), logger, db, metrics, storageIdx, true, writeOps); err != nil {
		t.Fatal(err.Error())
	}

	entries, err := storageIdx.List(ctx, uuid.Nil, indexName, "", 10, []string{})
	if err != nil {
		t.Fatal(err.Error())
	}
	assert.Len(t, entries.Objects, 2)

	delOp := &StorageOpDelete{
		OwnerID: u1.String(),
		ObjectID: &api.DeleteStorageObjectId{
			Collection: so2.Object.Collection,
			Key:        "key2",
		},
	}
	if _, err := StorageDeleteObjects(context.Background(), logger, db, storageIdx, true, StorageOpDeletes{delOp}); err != nil {
		t.Fatal(err.Error())
	}

	entries, err = storageIdx.List(ctx, uuid.Nil, indexName, "", 10, []string{})
	if err != nil {
		t.Fatal(err.Error())
	}
	assert.Len(t, entries.Objects, 1)
	assert.Equal(t, entries.Objects[0].UserId, nilUid.String())

	delOps := make(StorageOpDeletes, 0, len(writeOps))
	for _, op := range writeOps {
		delOps = append(delOps, &StorageOpDelete{
			OwnerID: op.OwnerID,
			ObjectID: &api.DeleteStorageObjectId{
				Collection: op.Object.Collection,
				Key:        op.Object.Key,
			},
		})
	}
	if _, err = StorageDeleteObjects(ctx, logger, db, storageIdx, true, delOps); err != nil {
		t.Fatalf("Failed to teardown: %s", err.Error())
	}
}
