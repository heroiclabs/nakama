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
	"sync"

	"github.com/couchbase/moss"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/registry"
)

// RegistryCollectionOptions should be treated as read-only after
// process init()'ialization.
var RegistryCollectionOptions = map[string]moss.CollectionOptions{}

const Name = "moss"

type Store struct {
	m       sync.Mutex
	ms      moss.Collection
	mo      store.MergeOperator
	llstore store.KVStore // May be nil.
	llstats statsFunc     // May be nil.

	s      *stats
	config map[string]interface{}
}

type statsFunc func() map[string]interface{}

// New initializes a moss storage with values from the optional
// config["mossCollectionOptions"] (a JSON moss.CollectionOptions).
// Next, values from the RegistryCollectionOptions, named by the
// optional config["mossCollectionOptionsName"], take precedence.
// Finally, base case defaults are taken from
// moss.DefaultCollectionOptions.
func New(mo store.MergeOperator, config map[string]interface{}) (
	store.KVStore, error) {
	options := moss.DefaultCollectionOptions // Copy.

	v, ok := config["mossCollectionOptionsName"]
	if ok {
		name, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("moss store,"+
				" could not parse config[mossCollectionOptionsName]: %v", v)
		}

		options, ok = RegistryCollectionOptions[name] // Copy.
		if !ok {
			return nil, fmt.Errorf("moss store,"+
				" could not find RegistryCollectionOptions, name: %s", name)
		}
	}

	options.MergeOperator = mo
	options.DeferredSort = true

	v, ok = config["mossCollectionOptions"]
	if ok {
		b, err := json.Marshal(v) // Convert from map[string]interface{}.
		if err != nil {
			return nil, fmt.Errorf("moss store,"+
				" could not marshal config[mossCollectionOptions]: %v, err: %v", v, err)
		}

		err = json.Unmarshal(b, &options)
		if err != nil {
			return nil, fmt.Errorf("moss store,"+
				" could not unmarshal config[mossCollectionOptions]: %v, err: %v", v, err)
		}
	}

	// --------------------------------------------------

	if options.Log == nil || options.Debug <= 0 {
		options.Log = func(format string, a ...interface{}) {}
	}

	// --------------------------------------------------

	mossLowerLevelStoreName := ""
	v, ok = config["mossLowerLevelStoreName"]
	if ok {
		mossLowerLevelStoreName, ok = v.(string)
		if !ok {
			return nil, fmt.Errorf("moss store,"+
				" could not parse config[mossLowerLevelStoreName]: %v", v)
		}
	}

	var llStore store.KVStore
	var llStats statsFunc

	if options.LowerLevelInit == nil &&
		options.LowerLevelUpdate == nil &&
		mossLowerLevelStoreName != "" {
		mossLowerLevelStoreConfig := map[string]interface{}{}
		v, ok := config["mossLowerLevelStoreConfig"]
		if ok {
			mossLowerLevelStoreConfig, ok = v.(map[string]interface{})
			if !ok {
				return nil, fmt.Errorf("moss store, initLowerLevelStore,"+
					" could parse mossLowerLevelStoreConfig: %v", v)
			}
		}

		mossLowerLevelMaxBatchSize := uint64(0)
		v, ok = config["mossLowerLevelMaxBatchSize"]
		if ok {
			mossLowerLevelMaxBatchSizeF, ok := v.(float64)
			if !ok {
				return nil, fmt.Errorf("moss store,"+
					" could not parse config[mossLowerLevelMaxBatchSize]: %v", v)
			}

			mossLowerLevelMaxBatchSize = uint64(mossLowerLevelMaxBatchSizeF)
		}

		lowerLevelInit, lowerLevelUpdate, lowerLevelStore, lowerLevelStats, err :=
			initLowerLevelStore(config,
				mossLowerLevelStoreName,
				mossLowerLevelStoreConfig,
				mossLowerLevelMaxBatchSize,
				options)
		if err != nil {
			return nil, err
		}

		options.LowerLevelInit = lowerLevelInit
		options.LowerLevelUpdate = lowerLevelUpdate

		llStore = lowerLevelStore
		llStats = lowerLevelStats
	}

	// --------------------------------------------------

	ms, err := moss.NewCollection(options)
	if err != nil {
		return nil, err
	}
	err = ms.Start()
	if err != nil {
		return nil, err
	}
	rv := Store{
		ms:      ms,
		mo:      mo,
		llstore: llStore,
		llstats: llStats,
		config:  config,
	}
	rv.s = &stats{s: &rv}
	return &rv, nil
}

func (s *Store) Close() error {
	if val, ok := s.config["mossAbortCloseEnabled"]; ok {
		if v, ok := val.(bool); ok && v {
			if msw, ok := s.llstore.(*mossStoreWrapper); ok {
				if s := msw.Actual(); s != nil {
					_ = s.CloseEx(moss.StoreCloseExOptions{Abort: true})
				}
			}
		}
	}
	return s.ms.Close()
}

func (s *Store) Reader() (store.KVReader, error) {
	ss, err := s.ms.Snapshot()
	if err != nil {
		return nil, err
	}
	return &Reader{ss: ss}, nil
}

func (s *Store) Writer() (store.KVWriter, error) {
	return &Writer{s: s}, nil
}

func (s *Store) Logf(fmt string, args ...interface{}) {
	options := s.ms.Options()
	if options.Log != nil {
		options.Log(fmt, args...)
	}
}

func (s *Store) Stats() json.Marshaler {
	return s.s
}

func (s *Store) StatsMap() map[string]interface{} {
	return s.s.statsMap()
}

func (s *Store) LowerLevelStore() store.KVStore {
	return s.llstore
}

func init() {
	registry.RegisterKVStore(Name, New)
}
