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

type Iterator struct {
	s *Store
	o store.KVIterator
}

func (i *Iterator) Seek(x []byte) {
	i.s.timerIteratorSeek.Time(func() {
		i.o.Seek(x)
	})
}

func (i *Iterator) Next() {
	i.s.timerIteratorNext.Time(func() {
		i.o.Next()
	})
}

func (i *Iterator) Current() ([]byte, []byte, bool) {
	return i.o.Current()
}

func (i *Iterator) Key() []byte {
	return i.o.Key()
}

func (i *Iterator) Value() []byte {
	return i.o.Value()
}

func (i *Iterator) Valid() bool {
	return i.o.Valid()
}

func (i *Iterator) Close() error {
	err := i.o.Close()
	if err != nil {
		i.s.AddError("Iterator.Close", err, nil)
	}
	return err
}
