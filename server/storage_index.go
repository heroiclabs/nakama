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
	"time"

	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/index"
	"github.com/blugelabs/bluge/search"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type StorageIndex interface {
	Write(ctx context.Context, objects []*api.StorageObject) (creates int, deletes int)
	Delete(ctx context.Context, objects StorageOpDeletes) (deletes int)
	List(ctx context.Context, callerID uuid.UUID, indexName, query string, limit int, order []string) (*api.StorageObjects, error)
	Load(ctx context.Context) error
	CreateIndex(ctx context.Context, name, collection, key string, fields []string, sortFields []string, maxEntries int, indexOnly bool) error
	RegisterFilters(runtime *Runtime)
}

type storageIndex struct {
	Name           string
	MaxEntries     int
	Collection     string
	Key            string
	Fields         []string
	SortableFields []string
	IndexOnly      bool
	Index          *bluge.Writer
}

type LocalStorageIndex struct {
	logger                *zap.Logger
	db                    *sql.DB
	metrics               Metrics
	indexByName           map[string]*storageIndex
	indicesByCollection   map[string][]*storageIndex
	customFilterFunctions map[string]RuntimeStorageIndexFilterFunction
	config                *StorageConfig
}

func NewLocalStorageIndex(logger *zap.Logger, db *sql.DB, config *StorageConfig, metrics Metrics) (StorageIndex, error) {
	si := &LocalStorageIndex{
		logger:                logger,
		db:                    db,
		metrics:               metrics,
		indexByName:           make(map[string]*storageIndex),
		indicesByCollection:   make(map[string][]*storageIndex),
		customFilterFunctions: make(map[string]RuntimeStorageIndexFilterFunction),
		config:                config,
	}

	return si, nil
}

func (si *LocalStorageIndex) Write(ctx context.Context, objects []*api.StorageObject) (updates int, deletes int) {
	batches := make(map[*storageIndex]*index.Batch, 0)

	for _, so := range objects {
		indices, found := si.indicesByCollection[so.Collection]
		if !found {
			continue
		}

		for _, idx := range indices {
			if idx.Key == "" || idx.Key == so.Key {
				batch, ok := batches[idx]
				if !ok {
					batch = bluge.NewBatch()
					batches[idx] = batch
				}

				if fn, ok := si.customFilterFunctions[idx.Name]; ok {
					sw := &StorageOpWrite{
						OwnerID: so.UserId,
						Object: &api.WriteStorageObject{
							Collection:      so.Collection,
							Key:             so.Key,
							Value:           so.Value,
							Version:         so.Version,
							PermissionRead:  wrapperspb.Int32(so.PermissionRead),
							PermissionWrite: wrapperspb.Int32(so.PermissionWrite),
						},
					}

					insertWrite, err := fn(ctx, sw) // true: upsert, false: delete
					if err != nil {
						si.logger.Error("Error invoking custom Storage Index Filter function", zap.String("index_name", idx.Name), zap.Error(err))
						continue
					}

					if !insertWrite {
						// Delete existing document from index, if any.
						docId := si.storageIndexDocumentId(so.Collection, so.Key, so.UserId)
						batch.Delete(docId)

						deletes++

						continue
					}
				}

				doc, err := si.mapIndexStorageFields(so.UserId, so.Collection, so.Key, so.Version, so.Value, so.PermissionRead, so.PermissionWrite, so.CreateTime.AsTime(), so.UpdateTime.AsTime(), idx.Fields, idx.SortableFields, idx.IndexOnly)
				if err != nil {
					si.logger.Error("Failed to map storage object values to index", zap.Error(err))
					continue
				}
				if doc == nil {
					continue
				}

				batch.Update(doc.ID(), doc)

				updates++
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

		si.metrics.GaugeStorageIndexEntries(idx.Name, float64(count))

		// Apply eviction strategy if size of index is +10% than max size
		if count > uint64(float32(idx.MaxEntries)*(1.1)) {
			deleteCount := int(count - uint64(idx.MaxEntries))
			req := bluge.NewTopNSearch(deleteCount, bluge.NewMatchAllQuery())
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

	return updates, deletes
}

func (si *LocalStorageIndex) Delete(ctx context.Context, objects StorageOpDeletes) (deletes int) {
	batches := make(map[*storageIndex]*index.Batch, 0)

	for _, d := range objects {
		indices, found := si.indicesByCollection[d.ObjectID.Collection]
		if !found {
			continue
		}

		for _, idx := range indices {
			batch, ok := batches[idx]
			if !ok {
				batch = bluge.NewBatch()
				batches[idx] = batch
			}

			docId := si.storageIndexDocumentId(d.ObjectID.Collection, d.ObjectID.Key, d.OwnerID)
			batch.Delete(docId)

			deletes++
		}
	}

	for idx, b := range batches {
		if err := idx.Index.Batch(b); err != nil {
			si.logger.Error("Failed to evict entries from index", zap.String("index_name", idx.Name), zap.Error(err))
			continue
		}
	}

	return deletes
}

func (si *LocalStorageIndex) List(ctx context.Context, callerID uuid.UUID, indexName, query string, limit int, order []string) (*api.StorageObjects, error) {
	idx, found := si.indexByName[indexName]
	if !found {
		return nil, fmt.Errorf("index %q not found", indexName)
	}

	if limit > idx.MaxEntries {
		si.logger.Warn("Attempted to list more index entries than configured maximum index size", zap.String("index_name", idx.Name), zap.Int("limit", limit), zap.Int("max_entries", idx.MaxEntries))
	}

	if query == "" {
		query = "*"
	}

	parsedQuery, err := ParseQueryString(query)
	if err != nil {
		return nil, err
	}

	searchReq := bluge.NewTopNSearch(limit, parsedQuery)

	if len(order) != 0 {
		searchReq.SortBy(order)
	}

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

	if !si.config.DisableIndexOnly && idx.IndexOnly {
		objects := make([]*api.StorageObject, 0, len(indexResults))
		for _, idxResult := range indexResults {
			if callerID != uuid.Nil && !(idxResult.Read == 2 || idxResult.UserID == callerID.String()) {
				continue
			}

			objects = append(objects, &api.StorageObject{
				Collection:      idxResult.Collection,
				Key:             idxResult.Key,
				UserId:          idxResult.UserID,
				Value:           idxResult.Value,
				Version:         idxResult.Version,
				PermissionRead:  idxResult.Read,
				PermissionWrite: idxResult.Write,
				CreateTime:      timestamppb.New(idxResult.CreateTime),
				UpdateTime:      timestamppb.New(idxResult.UpdateTime),
			})
		}

		return &api.StorageObjects{Objects: objects}, nil
	}

	storageReads := make([]*api.ReadStorageObjectId, 0, len(indexResults))
	for _, idxResult := range indexResults {
		storageReads = append(storageReads, &api.ReadStorageObjectId{
			Collection: idxResult.Collection,
			Key:        idxResult.Key,
			UserId:     idxResult.UserID,
		})
	}

	objects, err := StorageReadObjects(ctx, si.logger, si.db, callerID, storageReads)
	if err != nil {
		return nil, err
	}

	// Sort the objects read from the db according to the results from the index as StorageReadObjects does not guarantee ordering of the results
	objectIdToIdx := make(map[string]int, len(objects.Objects))
	for i, o := range objects.Objects {
		// Map storage object to its current index.
		objectIdToIdx[fmt.Sprintf("%s.%s.%s", o.Collection, o.Key, o.UserId)] = i
	}

	sortedObjects := make([]*api.StorageObject, 0, len(objects.Objects))
	for _, r := range indexResults {
		if index, ok := objectIdToIdx[fmt.Sprintf("%s.%s.%s", r.Collection, r.Key, r.UserID)]; ok {
			sortedObjects = append(sortedObjects, objects.Objects[index])
		}
	}

	objects.Objects = sortedObjects

	return objects, nil
}

func (si *LocalStorageIndex) Load(ctx context.Context) error {
	var rangeError error
	for _, idx := range si.indexByName {
		t := time.Now()
		if err := si.load(ctx, idx); err != nil {
			return err
		}

		elapsedTimeMs := time.Since(t).Milliseconds()
		si.logger.Info("Storage index loaded.", zap.Any("config", idx), zap.Int64("elapsed_time_ms", elapsedTimeMs))
	}

	return rangeError
}

func (si *LocalStorageIndex) load(ctx context.Context, idx *storageIndex) error {
	query := `
SELECT user_id, key, version, value, read, write, create_time, update_time
FROM storage
WHERE collection = $1
ORDER BY collection, key, user_id
LIMIT $2`
	params := []any{idx.Collection, 10_000}

	if idx.Key != "" {
		query = `
SELECT user_id, key, version, value, read, write, create_time, update_time
FROM storage
WHERE collection = $1 AND key = $3
ORDER BY collection, key, user_id
LIMIT $2`
		params = append(params, idx.Key)
	}

	filterFn := si.customFilterFunctions[idx.Name]

	var count int
	for {
		rows, err := si.db.QueryContext(ctx, query, params...)
		if err != nil {
			return err
		}
		defer rows.Close()

		var rowsRead bool
		batch := bluge.NewBatch()
		var dbUserID *uuid.UUID
		var dbKey string
		for rows.Next() {
			rowsRead = true
			var dbVersion string
			var dbValue string
			var dbRead int32
			var dbWrite int32
			var dbCreateTime time.Time
			var dbUpdateTime time.Time
			if err = rows.Scan(&dbUserID, &dbKey, &dbVersion, &dbValue, &dbRead, &dbWrite, &dbCreateTime, &dbUpdateTime); err != nil {
				rows.Close()
				return err
			}

			if filterFn != nil {
				ok, err := filterFn(ctx, &StorageOpWrite{
					OwnerID: dbUserID.String(),
					Object: &api.WriteStorageObject{
						Collection:      idx.Collection,
						Key:             dbKey,
						Value:           dbValue,
						Version:         dbVersion,
						PermissionRead:  wrapperspb.Int32(dbRead),
						PermissionWrite: wrapperspb.Int32(dbWrite),
					},
				})
				if err != nil {
					si.logger.Error("Error invoking custom Storage Index Filter function", zap.String("index_name", idx.Name), zap.Error(err))
				}
				if !ok {
					continue
				}
			}

			doc, err := si.mapIndexStorageFields(dbUserID.String(), idx.Collection, dbKey, dbVersion, dbValue, dbRead, dbWrite, dbCreateTime, dbUpdateTime, idx.Fields, idx.SortableFields, idx.IndexOnly)
			if err != nil {
				rows.Close()
				si.logger.Error("Failed to map storage object values to index", zap.Error(err))
				return err
			}

			if doc == nil {
				continue
			}

			batch.Update(doc.ID(), doc)
			count++
			if count >= idx.MaxEntries {
				break
			}
		}
		rows.Close()

		if err = idx.Index.Batch(batch); err != nil {
			return err
		}

		if count >= idx.MaxEntries || !rowsRead {
			break
		}

		query = `
SELECT user_id, key, version, value, read, write, create_time, update_time
FROM storage
WHERE collection = $1
AND (collection, key, user_id) > ($1, $3, $4)
ORDER BY collection, key, user_id
LIMIT $2`
		if idx.Key != "" {
			query = `
SELECT user_id, key, version, value, read, write, create_time, update_time
FROM storage
WHERE collection = $1
AND key = $3
AND user_id > $4
ORDER BY collection, key, user_id
LIMIT $2`
		}
		params = []any{idx.Collection, 10_000, dbKey, dbUserID}
	}

	return nil
}

func (si *LocalStorageIndex) mapIndexStorageFields(userID, collection, key, version, value string, read, write int32, createTime, updateTime time.Time, filters []string, sortFilters []string, indexOnly bool) (*bluge.Document, error) {
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

	rv := bluge.NewDocument(string(si.storageIndexDocumentId(collection, key, userID)))
	rv.AddField(bluge.NewDateTimeField("create_time", createTime).StoreValue().Sortable())
	rv.AddField(bluge.NewDateTimeField("update_time", updateTime).StoreValue().Sortable())
	rv.AddField(bluge.NewKeywordField("collection", collection).StoreValue())
	rv.AddField(bluge.NewKeywordField("key", key).StoreValue())
	rv.AddField(bluge.NewKeywordField("user_id", userID).StoreValue())
	rv.AddField(bluge.NewKeywordField("version", version).StoreValue())
	rv.AddField(bluge.NewNumericField("read", float64(read)).StoreValue())
	rv.AddField(bluge.NewNumericField("write", float64(write)).StoreValue())

	if !si.config.DisableIndexOnly && indexOnly {
		json, err := json.Marshal(mapValue)
		if err != nil {
			return nil, err
		}
		rv.AddField(bluge.NewStoredOnlyField("json", json))
	}

	sortMap := make(map[string]bool, len(sortFilters))
	for i := range sortFilters {
		sortMap["value."+sortFilters[i]] = true
	}
	BlugeWalkDocument(mapValue, []string{"value"}, sortMap, rv)

	return rv, nil
}

type indexResult struct {
	Collection string
	Key        string
	UserID     string
	Value      string // Only returned for indices created with indexOnly == true
	Read       int32
	Write      int32
	Version    string
	CreateTime time.Time
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
			case "version":
				idxResult.Version = string(value)
			case "read":
				read, vErr := bluge.DecodeNumericFloat64(value)
				if vErr != nil {
					err = vErr
					return false
				}
				idxResult.Read = int32(read)
			case "write":
				read, vErr := bluge.DecodeNumericFloat64(value)
				if vErr != nil {
					err = vErr
					return false
				}
				idxResult.Write = int32(read)
			case "create_time":
				createTime, vErr := bluge.DecodeDateTime(value)
				if vErr != nil {
					err = vErr
					return false
				}
				idxResult.CreateTime = createTime
			case "update_time":
				updateTime, vErr := bluge.DecodeDateTime(value)
				if vErr != nil {
					err = vErr
					return false
				}
				idxResult.UpdateTime = updateTime
			case "json":
				idxResult.Value = string(value)
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
		_ = next.VisitStoredFields(func(field string, value []byte) bool {
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

func (si *LocalStorageIndex) CreateIndex(ctx context.Context, name, collection, key string, fields []string, sortableFields []string, maxEntries int, indexOnly bool) error {
	if name == "" {
		return errors.New("storage index 'name' must be set")
	}
	if collection == "" {
		return errors.New("storage index 'collection' must be set")
	}
	if maxEntries < 1 {
		return errors.New("storage Index 'max_entries' must be > 0")
	}
	if len(fields) < 1 {
		return errors.New("storage Index 'fields' must contain at least one top level key to index")
	}

	if _, ok := si.indexByName[name]; ok {
		return fmt.Errorf("cannot create index: index with name %q already exists", name)
	}

	idx, err := bluge.OpenWriter(BlugeInMemoryConfig())
	if err != nil {
		return err
	}

	storageIdx := &storageIndex{
		Name:           name,
		Collection:     collection,
		Key:            key,
		Fields:         fields,
		SortableFields: sortableFields,
		MaxEntries:     maxEntries,
		Index:          idx,
		IndexOnly:      indexOnly,
	}
	si.indexByName[name] = storageIdx

	if indices, ok := si.indicesByCollection[collection]; ok {
		si.indicesByCollection[collection] = append(indices, storageIdx)
	} else {
		si.indicesByCollection[collection] = []*storageIndex{storageIdx}
	}

	cfgKey := key
	if key == "" {
		cfgKey = "*"
	}
	si.logger.Info("Initialized storage engine index", zap.Any("configuration", map[string]any{
		"name":        name,
		"collection":  collection,
		"key":         cfgKey,
		"fields":      fields,
		"max_entries": maxEntries,
		"index_only":  indexOnly,
	}))

	return nil
}

func (si *LocalStorageIndex) RegisterFilters(runtime *Runtime) {
	for name := range si.indexByName {
		fn := runtime.StorageIndexFilterFunction(name)
		if fn != nil {
			si.customFilterFunctions[name] = fn
		}
	}
}

func (si *LocalStorageIndex) storageIndexDocumentId(collection, key, userID string) bluge.Identifier {
	id := fmt.Sprintf("%s.%s.%s", collection, key, userID)

	return bluge.Identifier(id)
}
