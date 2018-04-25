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

import "github.com/syndtr/goleveldb/leveldb/iterator"

type Iterator struct {
	store    *Store
	iterator iterator.Iterator
}

func (ldi *Iterator) Seek(key []byte) {
	ldi.iterator.Seek(key)
}

func (ldi *Iterator) Next() {
	ldi.iterator.Next()
}

func (ldi *Iterator) Current() ([]byte, []byte, bool) {
	if ldi.Valid() {
		return ldi.Key(), ldi.Value(), true
	}
	return nil, nil, false
}

func (ldi *Iterator) Key() []byte {
	return ldi.iterator.Key()
}

func (ldi *Iterator) Value() []byte {
	return ldi.iterator.Value()
}

func (ldi *Iterator) Valid() bool {
	return ldi.iterator.Valid()
}

func (ldi *Iterator) Close() error {
	ldi.iterator.Release()
	return nil
}
