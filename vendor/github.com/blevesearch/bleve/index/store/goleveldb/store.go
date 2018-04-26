//  Copyright (c) 2014 Couchbase, Inc.
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

package goleveldb

import (
	"bytes"
	"fmt"
	"os"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/registry"
	"github.com/syndtr/goleveldb/leveldb"
	"github.com/syndtr/goleveldb/leveldb/opt"
	"github.com/syndtr/goleveldb/leveldb/util"
)

const (
	Name                    = "goleveldb"
	defaultCompactBatchSize = 250
)

type Store struct {
	path string
	opts *opt.Options
	db   *leveldb.DB
	mo   store.MergeOperator

	defaultWriteOptions *opt.WriteOptions
	defaultReadOptions  *opt.ReadOptions
}

func New(mo store.MergeOperator, config map[string]interface{}) (store.KVStore, error) {

	path, ok := config["path"].(string)
	if !ok {
		return nil, fmt.Errorf("must specify path")
	}
	if path == "" {
		return nil, os.ErrInvalid
	}

	opts, err := applyConfig(&opt.Options{}, config)
	if err != nil {
		return nil, err
	}

	db, err := leveldb.OpenFile(path, opts)
	if err != nil {
		return nil, err
	}

	rv := Store{
		path:                path,
		opts:                opts,
		db:                  db,
		mo:                  mo,
		defaultReadOptions:  &opt.ReadOptions{},
		defaultWriteOptions: &opt.WriteOptions{},
	}
	rv.defaultWriteOptions.Sync = true
	return &rv, nil
}

func (ldbs *Store) Close() error {
	return ldbs.db.Close()
}

func (ldbs *Store) Reader() (store.KVReader, error) {
	snapshot, _ := ldbs.db.GetSnapshot()
	return &Reader{
		store:    ldbs,
		snapshot: snapshot,
	}, nil
}

func (ldbs *Store) Writer() (store.KVWriter, error) {
	return &Writer{
		store: ldbs,
	}, nil
}

// CompactWithBatchSize removes DictionaryTerm entries with a count of zero (in batchSize batches), then
// compacts the underlying goleveldb store.  Removing entries is a workaround for github issue #374.
func (ldbs *Store) CompactWithBatchSize(batchSize int) error {
	// workaround for github issue #374 - remove DictionaryTerm keys with count=0
	batch := &leveldb.Batch{}
	for {
		t, err := ldbs.db.OpenTransaction()
		if err != nil {
			return err
		}
		iter := t.NewIterator(util.BytesPrefix([]byte("d")), ldbs.defaultReadOptions)

		for iter.Next() {
			if bytes.Equal(iter.Value(), []byte{0}) {
				k := append([]byte{}, iter.Key()...)
				batch.Delete(k)
			}
			if batch.Len() == batchSize {
				break
			}
		}
		iter.Release()
		if iter.Error() != nil {
			t.Discard()
			return iter.Error()
		}

		if batch.Len() > 0 {
			err := t.Write(batch, ldbs.defaultWriteOptions)
			if err != nil {
				t.Discard()
				return err
			}
			err = t.Commit()
			if err != nil {
				return err
			}
		} else {
			t.Discard()
			break
		}
		batch.Reset()
	}

	return ldbs.db.CompactRange(util.Range{Start: nil, Limit: nil})
}

// Compact compacts the underlying goleveldb store.  The current implementation includes a workaround
// for github issue #374 (see CompactWithBatchSize).
func (ldbs *Store) Compact() error {
	return ldbs.CompactWithBatchSize(defaultCompactBatchSize)
}

func init() {
	registry.RegisterKVStore(Name, New)
}
