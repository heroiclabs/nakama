//  Copyright (c) 2015 Couchbase, Inc.
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

package metrics

import "github.com/blevesearch/bleve/index/store"

type Reader struct {
	s *Store
	o store.KVReader
}

func (r *Reader) Get(key []byte) (v []byte, err error) {
	r.s.timerReaderGet.Time(func() {
		v, err = r.o.Get(key)
		if err != nil {
			r.s.AddError("Reader.Get", err, key)
		}
	})
	return
}

func (r *Reader) MultiGet(keys [][]byte) (vals [][]byte, err error) {
	r.s.timerReaderMultiGet.Time(func() {
		vals, err = r.o.MultiGet(keys)
		if err != nil {
			r.s.AddError("Reader.MultiGet", err, nil)
		}
	})
	return
}

func (r *Reader) PrefixIterator(prefix []byte) (i store.KVIterator) {
	r.s.timerReaderPrefixIterator.Time(func() {
		i = &Iterator{s: r.s, o: r.o.PrefixIterator(prefix)}
	})
	return
}

func (r *Reader) RangeIterator(start, end []byte) (i store.KVIterator) {
	r.s.timerReaderRangeIterator.Time(func() {
		i = &Iterator{s: r.s, o: r.o.RangeIterator(start, end)}
	})
	return
}

func (r *Reader) Close() error {
	err := r.o.Close()
	if err != nil {
		r.s.AddError("Reader.Close", err, nil)
	}
	return err
}
