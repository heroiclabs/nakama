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
	"github.com/blevesearch/bleve/index/store"
	"github.com/syndtr/goleveldb/leveldb"
	"github.com/syndtr/goleveldb/leveldb/util"
)

type Reader struct {
	store    *Store
	snapshot *leveldb.Snapshot
}

func (r *Reader) Get(key []byte) ([]byte, error) {
	b, err := r.snapshot.Get(key, r.store.defaultReadOptions)
	if err == leveldb.ErrNotFound {
		return nil, nil
	}
	return b, err
}

func (r *Reader) MultiGet(keys [][]byte) ([][]byte, error) {
	return store.MultiGet(r, keys)
}

func (r *Reader) PrefixIterator(prefix []byte) store.KVIterator {
	byteRange := util.BytesPrefix(prefix)
	iter := r.snapshot.NewIterator(byteRange, r.store.defaultReadOptions)
	iter.First()
	rv := Iterator{
		store:    r.store,
		iterator: iter,
	}
	return &rv
}

func (r *Reader) RangeIterator(start, end []byte) store.KVIterator {
	byteRange := &util.Range{
		Start: start,
		Limit: end,
	}
	iter := r.snapshot.NewIterator(byteRange, r.store.defaultReadOptions)
	iter.First()
	rv := Iterator{
		store:    r.store,
		iterator: iter,
	}
	return &rv
}

func (r *Reader) Close() error {
	r.snapshot.Release()
	return nil
}
