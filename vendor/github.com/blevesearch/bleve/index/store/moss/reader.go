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

package moss

import (
	"github.com/couchbase/moss"

	"github.com/blevesearch/bleve/index/store"
)

type Reader struct {
	store *Store
	ss    moss.Snapshot
}

func (r *Reader) Get(k []byte) (v []byte, err error) {
	v, err = r.ss.Get(k, moss.ReadOptions{})
	if err != nil {
		return nil, err
	}
	if v != nil {
		return append(make([]byte, 0, len(v)), v...), nil
	}
	return nil, nil
}

func (r *Reader) MultiGet(keys [][]byte) ([][]byte, error) {
	return store.MultiGet(r, keys)
}

func (r *Reader) PrefixIterator(k []byte) store.KVIterator {
	kEnd := incrementBytes(k)

	iter, err := r.ss.StartIterator(k, kEnd, moss.IteratorOptions{})
	if err != nil {
		return nil
	}

	rv := &Iterator{
		store: r.store,
		ss:    r.ss,
		iter:  iter,
		start: k,
		end:   kEnd,
	}

	rv.current()

	return rv
}

func (r *Reader) RangeIterator(start, end []byte) store.KVIterator {
	iter, err := r.ss.StartIterator(start, end, moss.IteratorOptions{})
	if err != nil {
		return nil
	}

	rv := &Iterator{
		store: r.store,
		ss:    r.ss,
		iter:  iter,
		start: start,
		end:   end,
	}

	rv.current()

	return rv
}

func (r *Reader) Close() error {
	return r.ss.Close()
}

func incrementBytes(in []byte) []byte {
	rv := make([]byte, len(in))
	copy(rv, in)
	for i := len(rv) - 1; i >= 0; i-- {
		rv[i] = rv[i] + 1
		if rv[i] != 0 {
			return rv // didn't overflow, so stop
		}
	}
	return nil // overflowed
}
