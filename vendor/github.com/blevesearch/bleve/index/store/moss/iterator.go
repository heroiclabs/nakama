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
)

type Iterator struct {
	store *Store
	ss    moss.Snapshot
	iter  moss.Iterator
	start []byte
	end   []byte
	k     []byte
	v     []byte
	err   error
}

func (x *Iterator) Seek(seekToKey []byte) {
	_ = x.iter.SeekTo(seekToKey)

	x.k, x.v, x.err = x.iter.Current()
}

func (x *Iterator) Next() {
	_ = x.iter.Next()

	x.k, x.v, x.err = x.iter.Current()
}

func (x *Iterator) Current() ([]byte, []byte, bool) {
	return x.k, x.v, x.err == nil
}

func (x *Iterator) Key() []byte {
	if x.err != nil {
		return nil
	}

	return x.k
}

func (x *Iterator) Value() []byte {
	if x.err != nil {
		return nil
	}

	return x.v
}

func (x *Iterator) Valid() bool {
	return x.err == nil
}

func (x *Iterator) Close() error {
	var err error

	x.ss = nil

	if x.iter != nil {
		err = x.iter.Close()
		x.iter = nil
	}

	x.k = nil
	x.v = nil
	x.err = moss.ErrIteratorDone

	return err
}

func (x *Iterator) current() {
	x.k, x.v, x.err = x.iter.Current()
}
