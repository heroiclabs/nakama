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

package null

import (
	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/registry"
)

const Name = "null"

type Store struct{}

func New(mo store.MergeOperator, config map[string]interface{}) (store.KVStore, error) {
	return &Store{}, nil
}

func (i *Store) Close() error {
	return nil
}

func (i *Store) Reader() (store.KVReader, error) {
	return &reader{}, nil
}

func (i *Store) Writer() (store.KVWriter, error) {
	return &writer{}, nil
}

type reader struct{}

func (r *reader) Get(key []byte) ([]byte, error) {
	return nil, nil
}

func (r *reader) MultiGet(keys [][]byte) ([][]byte, error) {
	return make([][]byte, len(keys)), nil
}

func (r *reader) PrefixIterator(prefix []byte) store.KVIterator {
	return &iterator{}
}

func (r *reader) RangeIterator(start, end []byte) store.KVIterator {
	return &iterator{}
}

func (r *reader) Close() error {
	return nil
}

type iterator struct{}

func (i *iterator) SeekFirst()    {}
func (i *iterator) Seek(k []byte) {}
func (i *iterator) Next()         {}

func (i *iterator) Current() ([]byte, []byte, bool) {
	return nil, nil, false
}

func (i *iterator) Key() []byte {
	return nil
}

func (i *iterator) Value() []byte {
	return nil
}

func (i *iterator) Valid() bool {
	return false
}

func (i *iterator) Close() error {
	return nil
}

type batch struct{}

func (i *batch) Set(key, val []byte)   {}
func (i *batch) Delete(key []byte)     {}
func (i *batch) Merge(key, val []byte) {}
func (i *batch) Reset()                {}
func (i *batch) Close() error          { return nil }

type writer struct{}

func (w *writer) NewBatch() store.KVBatch {
	return &batch{}
}

func (w *writer) NewBatchEx(options store.KVBatchOptions) ([]byte, store.KVBatch, error) {
	return make([]byte, options.TotalBytes), w.NewBatch(), nil
}

func (w *writer) ExecuteBatch(store.KVBatch) error {
	return nil
}

func (w *writer) Close() error {
	return nil
}

func init() {
	registry.RegisterKVStore(Name, New)
}
