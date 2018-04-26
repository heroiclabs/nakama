//  Copyright (c) 2016 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package moss provides a KVStore implementation based on the
// github.com/couchbase/moss library.

package moss

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/couchbase/moss"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/registry"
)

func initLowerLevelStore(
	config map[string]interface{},
	lowerLevelStoreName string,
	lowerLevelStoreConfig map[string]interface{},
	lowerLevelMaxBatchSize uint64,
	options moss.CollectionOptions,
) (moss.Snapshot, moss.LowerLevelUpdate, store.KVStore, statsFunc, error) {
	if lowerLevelStoreConfig == nil {
		lowerLevelStoreConfig = map[string]interface{}{}
	}

	for k, v := range config {
		_, exists := lowerLevelStoreConfig[k]
		if !exists {
			lowerLevelStoreConfig[k] = v
		}
	}

	if lowerLevelStoreName == "mossStore" {
		return InitMossStore(lowerLevelStoreConfig, options)
	}

	constructor := registry.KVStoreConstructorByName(lowerLevelStoreName)
	if constructor == nil {
		return nil, nil, nil, nil, fmt.Errorf("moss store, initLowerLevelStore,"+
			" could not find lower level store: %s", lowerLevelStoreName)
	}

	kvStore, err := constructor(options.MergeOperator, lowerLevelStoreConfig)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	llStore := &llStore{
		refs:     0,
		config:   config,
		llConfig: lowerLevelStoreConfig,
		kvStore:  kvStore,
		logf:     options.Log,
	}

	llUpdate := func(ssHigher moss.Snapshot) (ssLower moss.Snapshot, err error) {
		return llStore.update(ssHigher, lowerLevelMaxBatchSize)
	}

	llSnapshot, err := llUpdate(nil)
	if err != nil {
		_ = kvStore.Close()
		return nil, nil, nil, nil, err
	}

	return llSnapshot, llUpdate, kvStore, nil, nil // llStore.refs is now 1.
}

// ------------------------------------------------

// llStore is a lower level store and provides ref-counting around a
// bleve store.KVStore.
type llStore struct {
	kvStore store.KVStore

	config   map[string]interface{}
	llConfig map[string]interface{}

	logf func(format string, a ...interface{})

	m    sync.Mutex // Protects fields that follow.
	refs int
}

// llSnapshot represents a lower-level snapshot, wrapping a bleve
// store.KVReader, and implements the moss.Snapshot interface.
type llSnapshot struct {
	llStore        *llStore // Holds 1 refs on the llStore.
	kvReader       store.KVReader
	childSnapshots map[string]*llSnapshot

	m    sync.Mutex // Protects fields that follow.
	refs int
}

// llIterator represents a lower-level iterator, wrapping a bleve
// store.KVIterator, and implements the moss.Iterator interface.
type llIterator struct {
	llSnapshot *llSnapshot // Holds 1 refs on the llSnapshot.

	// Some lower-level KVReader implementations need a separate
	// KVReader clone, due to KVReader single-threaded'ness.
	kvReader store.KVReader

	kvIterator store.KVIterator
}

type readerSource interface {
	Reader() (store.KVReader, error)
}

// ------------------------------------------------

func (s *llStore) addRef() *llStore {
	s.m.Lock()
	s.refs += 1
	s.m.Unlock()

	return s
}

func (s *llStore) decRef() {
	s.m.Lock()
	s.refs -= 1
	if s.refs <= 0 {
		err := s.kvStore.Close()
		if err != nil {
			s.logf("llStore kvStore.Close err: %v", err)
		}
	}
	s.m.Unlock()
}

// update() mutates this lower level store with latest data from the
// given higher level moss.Snapshot and returns a new moss.Snapshot
// that the higher level can use which represents this lower level
// store.
func (s *llStore) update(ssHigher moss.Snapshot, maxBatchSize uint64) (
	ssLower moss.Snapshot, err error) {
	if ssHigher != nil {
		iter, err := ssHigher.StartIterator(nil, nil, moss.IteratorOptions{
			IncludeDeletions: true,
			SkipLowerLevel:   true,
		})
		if err != nil {
			return nil, err
		}

		defer func() {
			err = iter.Close()
			if err != nil {
				s.logf("llStore iter.Close err: %v", err)
			}
		}()

		kvWriter, err := s.kvStore.Writer()
		if err != nil {
			return nil, err
		}

		defer func() {
			err = kvWriter.Close()
			if err != nil {
				s.logf("llStore kvWriter.Close err: %v", err)
			}
		}()

		batch := kvWriter.NewBatch()

		defer func() {
			if batch != nil {
				err = batch.Close()
				if err != nil {
					s.logf("llStore batch.Close err: %v", err)
				}
			}
		}()

		var readOptions moss.ReadOptions

		i := uint64(0)
		for {
			if i%1000000 == 0 {
				s.logf("llStore.update, i: %d", i)
			}

			ex, key, val, err := iter.CurrentEx()
			if err == moss.ErrIteratorDone {
				break
			}
			if err != nil {
				return nil, err
			}

			switch ex.Operation {
			case moss.OperationSet:
				batch.Set(key, val)

			case moss.OperationDel:
				batch.Delete(key)

			case moss.OperationMerge:
				val, err = ssHigher.Get(key, readOptions)
				if err != nil {
					return nil, err
				}

				if val != nil {
					batch.Set(key, val)
				} else {
					batch.Delete(key)
				}

			default:
				return nil, fmt.Errorf("moss store, update,"+
					" unexpected operation, ex: %v", ex)
			}

			i++

			err = iter.Next()
			if err == moss.ErrIteratorDone {
				break
			}
			if err != nil {
				return nil, err
			}

			if maxBatchSize > 0 && i%maxBatchSize == 0 {
				err = kvWriter.ExecuteBatch(batch)
				if err != nil {
					return nil, err
				}

				err = batch.Close()
				if err != nil {
					return nil, err
				}

				batch = kvWriter.NewBatch()
			}
		}

		if i > 0 {
			s.logf("llStore.update, ExecuteBatch,"+
				" path: %s, total: %d, start", s.llConfig["path"], i)

			err = kvWriter.ExecuteBatch(batch)
			if err != nil {
				return nil, err
			}

			s.logf("llStore.update, ExecuteBatch,"+
				" path: %s: total: %d, done", s.llConfig["path"], i)
		}
	}

	kvReader, err := s.kvStore.Reader()
	if err != nil {
		return nil, err
	}

	s.logf("llStore.update, new reader")

	return &llSnapshot{
		llStore:  s.addRef(),
		kvReader: kvReader,
		refs:     1,
	}, nil
}

// ------------------------------------------------

func (llss *llSnapshot) addRef() *llSnapshot {
	llss.m.Lock()
	llss.refs += 1
	llss.m.Unlock()

	return llss
}

func (llss *llSnapshot) decRef() {
	llss.m.Lock()
	llss.refs -= 1
	if llss.refs <= 0 {
		if llss.kvReader != nil {
			err := llss.kvReader.Close()
			if err != nil {
				llss.llStore.logf("llSnapshot kvReader.Close err: %v", err)
			}

			llss.kvReader = nil
		}

		if llss.llStore != nil {
			llss.llStore.decRef()
			llss.llStore = nil
		}
	}
	llss.m.Unlock()
}

// ChildCollectionNames returns an array of child collection name strings.
func (llss *llSnapshot) ChildCollectionNames() ([]string, error) {
	var childCollections = make([]string, len(llss.childSnapshots))
	idx := 0
	for name, _ := range llss.childSnapshots {
		childCollections[idx] = name
		idx++
	}
	return childCollections, nil
}

// ChildCollectionSnapshot returns a Snapshot on a given child
// collection by its name.
func (llss *llSnapshot) ChildCollectionSnapshot(childCollectionName string) (
	moss.Snapshot, error) {
	childSnapshot, exists := llss.childSnapshots[childCollectionName]
	if !exists {
		return nil, nil
	}
	childSnapshot.addRef()
	return childSnapshot, nil
}

func (llss *llSnapshot) Close() error {
	llss.decRef()

	return nil
}

func (llss *llSnapshot) Get(key []byte,
	readOptions moss.ReadOptions) ([]byte, error) {
	rs, ok := llss.kvReader.(readerSource)
	if ok {
		r2, err := rs.Reader()
		if err != nil {
			return nil, err
		}

		val, err := r2.Get(key)

		_ = r2.Close()

		return val, err
	}

	return llss.kvReader.Get(key)
}

func (llss *llSnapshot) StartIterator(
	startKeyInclusive, endKeyExclusive []byte,
	iteratorOptions moss.IteratorOptions) (moss.Iterator, error) {
	rs, ok := llss.kvReader.(readerSource)
	if ok {
		r2, err := rs.Reader()
		if err != nil {
			return nil, err
		}

		i2 := r2.RangeIterator(startKeyInclusive, endKeyExclusive)

		return &llIterator{llSnapshot: llss.addRef(), kvReader: r2, kvIterator: i2}, nil
	}

	i := llss.kvReader.RangeIterator(startKeyInclusive, endKeyExclusive)

	return &llIterator{llSnapshot: llss.addRef(), kvReader: nil, kvIterator: i}, nil
}

// ------------------------------------------------

func (lli *llIterator) Close() error {
	var err0 error
	if lli.kvIterator != nil {
		err0 = lli.kvIterator.Close()
		lli.kvIterator = nil
	}

	var err1 error
	if lli.kvReader != nil {
		err1 = lli.kvReader.Close()
		lli.kvReader = nil
	}

	lli.llSnapshot.decRef()
	lli.llSnapshot = nil

	if err0 != nil {
		return err0
	}

	if err1 != nil {
		return err1
	}

	return nil
}

func (lli *llIterator) Next() error {
	lli.kvIterator.Next()

	return nil
}

func (lli *llIterator) SeekTo(k []byte) error {
	lli.kvIterator.Seek(k)

	return nil
}

func (lli *llIterator) Current() (key, val []byte, err error) {
	key, val, ok := lli.kvIterator.Current()
	if !ok {
		return nil, nil, moss.ErrIteratorDone
	}

	return key, val, nil
}

func (lli *llIterator) CurrentEx() (
	entryEx moss.EntryEx, key, val []byte, err error) {
	return moss.EntryEx{}, nil, nil, moss.ErrUnimplemented
}

// ------------------------------------------------

func InitMossStore(config map[string]interface{}, options moss.CollectionOptions) (
	moss.Snapshot, moss.LowerLevelUpdate, store.KVStore, statsFunc, error) {
	path, ok := config["path"].(string)
	if !ok {
		return nil, nil, nil, nil, fmt.Errorf("lower: missing path for InitMossStore config")
	}
	if path == "" {
		return nil, nil, nil, nil, os.ErrInvalid
	}

	err := os.MkdirAll(path, 0700)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("lower: InitMossStore mkdir,"+
			" path: %s, err: %v", path, err)
	}

	storeOptions := moss.StoreOptions{
		CollectionOptions: options,
	}
	v, ok := config["mossStoreOptions"]
	if ok {
		b, err := json.Marshal(v) // Convert from map[string]interface{}.
		if err != nil {
			return nil, nil, nil, nil, err
		}

		err = json.Unmarshal(b, &storeOptions)
		if err != nil {
			return nil, nil, nil, nil, err
		}
	}

	s, err := moss.OpenStore(path, storeOptions)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("lower: moss.OpenStore,"+
			" path: %s, err: %v", path, err)
	}

	sw := &mossStoreWrapper{s: s}

	llUpdate := func(ssHigher moss.Snapshot) (moss.Snapshot, error) {
		ss, err := sw.s.Persist(ssHigher, moss.StorePersistOptions{
			CompactionConcern: moss.CompactionAllow,
		})
		if err != nil {
			return nil, err
		}

		sw.AddRef() // Ref-count to be owned by snapshot wrapper.

		return moss.NewSnapshotWrapper(ss, sw), nil
	}

	llSnapshot, err := llUpdate(nil)
	if err != nil {
		_ = s.Close()
		return nil, nil, nil, nil, err
	}

	llStats := func() map[string]interface{} {
		stats, err := s.Stats()
		if err != nil {
			return nil
		}
		return stats
	}

	return llSnapshot, llUpdate, sw, llStats, nil
}

// mossStoreWrapper implements the bleve.index.store.KVStore
// interface, but only barely enough to allow it to be passed around
// as a lower-level store.  Advanced apps will likely cast the
// mossStoreWrapper to access the Actual() method.
type mossStoreWrapper struct {
	m    sync.Mutex
	refs int
	s    *moss.Store
}

func (w *mossStoreWrapper) AddRef() {
	w.m.Lock()
	w.refs++
	w.m.Unlock()
}

func (w *mossStoreWrapper) Close() (err error) {
	w.m.Lock()
	w.refs--
	if w.refs <= 0 {
		err = w.s.Close()
		w.s = nil
	}
	w.m.Unlock()
	return err
}

func (w *mossStoreWrapper) Reader() (store.KVReader, error) {
	return nil, fmt.Errorf("unexpected")
}

func (w *mossStoreWrapper) Writer() (store.KVWriter, error) {
	return nil, fmt.Errorf("unexpected")
}

func (w *mossStoreWrapper) Actual() *moss.Store {
	w.m.Lock()
	rv := w.s
	w.m.Unlock()
	return rv
}
