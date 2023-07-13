// Copyright 2023 The Nakama Authors
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
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/index"
	"github.com/blugelabs/bluge/search"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"time"
)

type StorageIndex interface {
	Write(ctx context.Context, objects StorageOpWrites)
	Delete(ctx context.Context, objects StorageOpDeletes)
	List(ctx context.Context, indexName, query string, limit int) (*api.StorageObjects, error)
	Load(ctx context.Context) error
	Start(runtime *Runtime)
}

// TODO: Return the modified values so that it can be propagated to other nodes in the cluster

type storageIndex struct {
	StorageIndexConfig
	EntryCount *atomic.Uint64
	Index      *bluge.Writer
}

type LocalStorageIndex struct {
	logger                *zap.Logger
	db                    *sql.DB
	indexByName           *MapOf[string, *storageIndex]
	indicesByCollection   *MapOf[string, []*storageIndex] // TODO: Support multiple indices per collection
	customFilterFunctions *MapOf[string, RuntimeStorageIndexFilterFunction]
}

func NewLocalStorageIndex(logger *zap.Logger, db *sql.DB, config []StorageIndexConfig) (StorageIndex, error) {
	blugeCfg := BlugeInMemoryConfig()

	idxByName := &MapOf[string, *storageIndex]{}
	indicesByCollection := &MapOf[string, []*storageIndex]{}

	for _, idxConfig := range config {
		idx, err := bluge.OpenWriter(blugeCfg)
		if err != nil {
			return nil, err
		}

		storageIdx := &storageIndex{
			StorageIndexConfig: idxConfig,
			EntryCount:         atomic.NewUint64(0),
			Index:              idx,
		}

		idxByName.Store(idxConfig.Name, storageIdx)
		if indices, ok := indicesByCollection.Load(idxConfig.Collection); !ok {
			indicesByCollection.Store(idxConfig.Collection, []*storageIndex{storageIdx})
		} else {
			indicesByCollection.Store(idxConfig.Collection, append(indices, storageIdx))
		}

		logger.Info("Initialized storage engine index", zap.Any("config", idxConfig))
	}

	lsc := &LocalStorageIndex{
		logger:                logger,
		db:                    db,
		indexByName:           idxByName,
		indicesByCollection:   indicesByCollection,
		customFilterFunctions: &MapOf[string, RuntimeStorageIndexFilterFunction]{},
	}

	return lsc, nil
}

func (si *LocalStorageIndex) Write(ctx context.Context, storageWrites StorageOpWrites) {
	batches := make(map[*storageIndex]*index.Batch, 0)

	for _, so := range storageWrites {
		indices, found := si.indicesByCollection.Load(so.Object.Collection)
		if !found {
			continue
		}

		for _, idx := range indices {
			if idx.Key == "" || idx.Key == so.Object.Key {
				batch, ok := batches[idx]
				if !ok {
					batch = bluge.NewBatch()
					batches[idx] = batch
				}

				if fn, ok := si.customFilterFunctions.Load(idx.Name); ok {
					insertWrite, err := fn(ctx, so) // true = upsert, false = delete
					if err != nil {
						si.logger.Error("Failed to run custom Storage Index Filter function", zap.String("index_name", idx.Name), zap.Error(err))
						continue
					}

					if !insertWrite {
						// Delete existing document from index, if any.
						docId := si.storageIndexDocumentId(so.Object.Collection, so.Object.Key, so.OwnerID)
						batch.Delete(docId)
						continue
					}
				}

				doc, err := si.mapIndexStorageFields(so.OwnerID, so.Object.Collection, so.Object.Key, so.Object.Version, so.Object.Value, idx.Fields)
				if err != nil {
					si.logger.Error("Failed to map storage object values to index", zap.Error(err))
					continue
				}

				if doc == nil {
					continue
				}

				batch.Update(doc.ID(), doc)
			}
		}
	}

	for idx, b := range batches {
		if err := idx.Index.Batch(b); err != nil {
			si.logger.Error("Failed to update index", zap.String("index_name", idx.Name), zap.Error(err))
			continue
		}

		reader, err := idx.Index.Reader()
		if err != nil {
			si.logger.Error("Failed to get index storage reader", zap.Error(err))
			continue
		}
		count, _ := reader.Count() // cannot return err

		// Apply eviction strategy if size of index is +10% than max size
		if count > uint64(float32(idx.MaxEntries)*(1+0.1)) {
			deleteCount := count - uint64(idx.MaxEntries)

			req := bluge.NewTopNSearch(int(deleteCount), bluge.NewMatchAllQuery())
			req.SortBy([]string{"update_time"})

			results, err := reader.Search(ctx, req)
			if err != nil {
				si.logger.Error("Failed to evict storage index documents", zap.String("index_name", idx.Name))
				continue
			}

			ids, err := si.queryMatchesToDocumentIds(results)
			if err != nil {
				si.logger.Error("Failed to get query results document ids", zap.Error(err))
				continue
			}

			evictBatch := bluge.NewBatch()
			for _, docID := range ids {
				evictBatch.Delete(bluge.Identifier(docID))
			}
			if err = idx.Index.Batch(evictBatch); err != nil {
				si.logger.Error("Failed to update index", zap.String("index_name", idx.Name), zap.Error(err))
			}
		}
	}

	return
}

func (si *LocalStorageIndex) Delete(ctx context.Context, deletes StorageOpDeletes) {
	batches := make(map[*storageIndex]*index.Batch, 0)

	for _, d := range deletes {
		indices, found := si.indicesByCollection.Load(d.ObjectID.Collection)
		if !found {
			return
		}

		for _, idx := range indices {
			batch, ok := batches[idx]
			if !ok {
				batch = bluge.NewBatch()
				batches[idx] = batch
			}

			docId := si.storageIndexDocumentId(d.ObjectID.Collection, d.ObjectID.Key, d.OwnerID)
			batch.Delete(docId)
		}
	}

	for idx, b := range batches {
		if err := idx.Index.Batch(b); err != nil {
			si.logger.Error("Failed to evict entries from index", zap.String("index_name", idx.Name), zap.Error(err))
			continue
		}

		reader, err := idx.Index.Reader()
		if err != nil {
			si.logger.Error("Failed to get index storage reader", zap.Error(err))
			return
		}

		count, _ := reader.Count() // cannot return err
		idx.EntryCount.Store(count)
	}
}

func (si *LocalStorageIndex) List(ctx context.Context, indexName, query string, limit int) (*api.StorageObjects, error) {
	idx, found := si.indexByName.Load(indexName)
	if !found {
		return nil, fmt.Errorf("index %q not found", indexName)
	}

	if limit > idx.MaxEntries {
		si.logger.Warn("Attempted to list more index entries than configured maximum index size", zap.String("index_name", idx.Name), zap.Int("limit", limit), zap.Int("max_entries", idx.MaxEntries))
	}

	parsedQuery, err := ParseQueryString(query)
	if err != nil {
		return nil, err
	}

	searchReq := bluge.NewTopNSearch(limit, parsedQuery)

	indexReader, err := idx.Index.Reader()
	if err != nil {
		return nil, err
	}

	results, err := indexReader.Search(ctx, searchReq)
	if err != nil {
		return nil, err
	}

	indexResults, err := si.queryMatchesToStorageIndexResults(results)
	if err != nil {
		return nil, err
	}

	if len(indexResults) == 0 {
		return &api.StorageObjects{Objects: []*api.StorageObject{}}, nil
	}

	storageReads := make([]*api.ReadStorageObjectId, 0, len(indexResults))
	for _, idxResult := range indexResults {
		storageReads = append(storageReads, &api.ReadStorageObjectId{
			Collection: idxResult.Collection,
			Key:        idxResult.Key,
			UserId:     idxResult.UserID,
		})
	}

	objects, err := StorageReadObjects(ctx, si.logger, si.db, uuid.Nil, storageReads)
	if err != nil {
		return nil, err
	}

	return objects, nil
}

func (si *LocalStorageIndex) Load(ctx context.Context) error {
	var rangeError error
	si.indexByName.Range(func(idxName string, idx *storageIndex) bool {
		t := time.Now()
		loaded := make(map[string]struct{})

		if err := si.load(ctx, idx, loaded); err != nil {
			rangeError = err
			return false
		}

		elapsedTimeMs := time.Since(t).Milliseconds()
		si.logger.Info("Storage index loaded.", zap.Any("config", idx.StorageIndexConfig), zap.Int64("elapsed_time_ms", elapsedTimeMs))

		return true
	})

	return rangeError
}

func (si *LocalStorageIndex) load(ctx context.Context, idx *storageIndex, loaded map[string]struct{}) error {
	query := `
SELECT user_id, key, version, value
FROM storage
WHERE collection = $1
LIMIT $2`
	params := []any{idx.Collection, 10_000}

	if idx.Key != "" {
		query = `
SELECT user_id, key, version, value
FROM storage
WHERE collection = $1 AND key = $3
LIMIT $2`
		params = append(params, idx.Key)
	}

	for {
		rows, err := si.db.QueryContext(ctx, query, params...)
		if err != nil {
			return err
		}

		var rowsRead bool
		batch := bluge.NewBatch()
		var newEntries int64
		var dbUserID *uuid.UUID
		var dbKey string
		for rows.Next() {
			rowsRead = true
			var version string
			var dbValue string
			if err = rows.Scan(&dbUserID, &dbKey, &version, &dbValue); err != nil {
				rows.Close()
				return err
			}

			doc, err := si.mapIndexStorageFields(dbUserID.String(), idx.Collection, dbKey, version, dbValue, idx.Fields)
			if err != nil {
				si.logger.Error("Failed to map storage object values to index", zap.Error(err))
				return err
			}

			if doc == nil {
				continue
			}

			batch.Insert(doc)
			newEntries++

			loadedId := fmt.Sprintf("%s.%s.%s", idx.Collection, dbKey, dbUserID)
			if _, found := loaded[loadedId]; !found {
				loaded[loadedId] = struct{}{}
			}
		}
		rows.Close()

		if err = idx.Index.Batch(batch); err != nil {
			return err
		}
		idx.EntryCount.Add(uint64(newEntries))

		if len(loaded) >= idx.MaxEntries || !rowsRead {
			break
		}

		query = `
SELECT user_id, key, version, value
FROM storage
WHERE collection = $1
AND (collection, key, user_id) > ($1, $3, $4)
LIMIT $2`
		if idx.Key != "" {
			query = `
SELECT user_id, key, version, value
FROM storage
WHERE collection = $1
AND key = $3
AND (collection, key, user_id) > ($1, $3, $4)
LIMIT $2`
		}
		params = []any{idx.Collection, 10_000, dbKey, dbUserID}
	}

	return nil
}

func (sc *LocalStorageIndex) mapIndexStorageFields(userID, collection, key, version, value string, filters []string) (*bluge.Document, error) {
	if collection == "" || key == "" || userID == "" {
		return nil, errors.New("insufficient fields to create index document id")
	}

	var mapValue map[string]any
	if err := json.Unmarshal([]byte(value), &mapValue); err != nil {
		return nil, err
	}

	if len(filters) > 0 {
		// Store only subset fields of storage object value
		filteredValues := make(map[string]any, len(filters))
		for _, f := range filters {
			if _, found := mapValue[f]; found {
				filteredValues[f] = mapValue[f]
			}
		}
		mapValue = filteredValues
	}

	if len(mapValue) == 0 {
		return nil, nil
	}

	rv := bluge.NewDocument(string(sc.storageIndexDocumentId(collection, key, userID)))
	rv.AddField(bluge.NewDateTimeField("update_time", time.Now()).StoreValue().Sortable())
	rv.AddField(bluge.NewKeywordField("collection", collection).StoreValue())
	rv.AddField(bluge.NewKeywordField("key", key).StoreValue())
	rv.AddField(bluge.NewKeywordField("user_id", userID).StoreValue())
	rv.AddField(bluge.NewKeywordField("version", version).StoreValue())

	BlugeWalkDocument(mapValue, []string{}, rv)

	return rv, nil
}

type indexResult struct {
	Collection string
	Key        string
	UserID     string
	Value      string
	Version    string
	UpdateTime time.Time
}

func (si *LocalStorageIndex) queryMatchesToStorageIndexResults(dmi search.DocumentMatchIterator) ([]*indexResult, error) {
	idxResults := make([]*indexResult, 0)
	next, err := dmi.Next()
	for err == nil && next != nil {
		idxResult := &indexResult{}
		err = next.VisitStoredFields(func(field string, value []byte) bool {
			switch field {
			case "collection":
				idxResult.Collection = string(value)
			case "key":
				idxResult.Key = string(value)
			case "user_id":
				idxResult.UserID = string(value)
			case "value":
				idxResult.Value = string(value)
			case "version":
				idxResult.Version = string(value)
			case "updateTime":
				updateTime, vErr := bluge.DecodeDateTime(value)
				if err != nil {
					err = vErr
					return false
				}
				idxResult.UpdateTime = updateTime
			}
			return true
		})
		if err != nil {
			return nil, err
		}
		idxResults = append(idxResults, idxResult)
		next, err = dmi.Next()
	}
	if err != nil {
		return nil, err
	}
	return idxResults, nil
}

func (si *LocalStorageIndex) queryMatchesToDocumentIds(dmi search.DocumentMatchIterator) ([]string, error) {
	next, err := dmi.Next()
	ids := make([]string, 0)
	for err == nil && next != nil {
		next.VisitStoredFields(func(field string, value []byte) bool {
			if field == "_id" {
				ids = append(ids, string(value))
				return false
			}
			return true
		})
		next, err = dmi.Next()
	}
	if err != nil {
		return nil, err
	}
	return ids, nil
}

func (si *LocalStorageIndex) Start(runtime *Runtime) {
	si.indexByName.Range(func(key string, _ *storageIndex) bool {
		fn := runtime.StorageIndexFilterFunction(key)
		if fn != nil {
			si.customFilterFunctions.Store(key, fn)
		}
		return true
	})
}

func (si *LocalStorageIndex) storageIndexDocumentId(collection, key, userID string) bluge.Identifier {
	id := fmt.Sprintf("%s.%s.%s", collection, key, userID)

	return bluge.Identifier(id)
}
