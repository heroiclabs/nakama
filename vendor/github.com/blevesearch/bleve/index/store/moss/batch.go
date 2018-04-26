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

type Batch struct {
	store   *Store
	merge   *store.EmulatedMerge
	batch   moss.Batch
	buf     []byte // Non-nil when using pre-alloc'ed / NewBatchEx().
	bufUsed int
}

func (b *Batch) Set(key, val []byte) {
	var err error
	if b.buf != nil {
		b.bufUsed += len(key) + len(val)
		err = b.batch.AllocSet(key, val)
	} else {
		err = b.batch.Set(key, val)
	}

	if err != nil {
		b.store.Logf("bleve moss batch.Set err: %v", err)
	}
}

func (b *Batch) Delete(key []byte) {
	var err error
	if b.buf != nil {
		b.bufUsed += len(key)
		err = b.batch.AllocDel(key)
	} else {
		err = b.batch.Del(key)
	}

	if err != nil {
		b.store.Logf("bleve moss batch.Delete err: %v", err)
	}
}

func (b *Batch) Merge(key, val []byte) {
	if b.buf != nil {
		b.bufUsed += len(key) + len(val)
	}
	b.merge.Merge(key, val)
}

func (b *Batch) Reset() {
	err := b.Close()
	if err != nil {
		b.store.Logf("bleve moss batch.Close err: %v", err)
		return
	}

	batch, err := b.store.ms.NewBatch(0, 0)
	if err == nil {
		b.batch = batch
		b.merge = store.NewEmulatedMerge(b.store.mo)
		b.buf = nil
		b.bufUsed = 0
	}
}

func (b *Batch) Close() error {
	b.merge = nil
	err := b.batch.Close()
	b.batch = nil
	return err
}
