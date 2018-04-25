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
	"fmt"

	"github.com/blevesearch/bleve/index/store"
	"github.com/syndtr/goleveldb/leveldb"
)

type Writer struct {
	store *Store
}

func (w *Writer) NewBatch() store.KVBatch {
	rv := Batch{
		store: w.store,
		merge: store.NewEmulatedMerge(w.store.mo),
		batch: new(leveldb.Batch),
	}
	return &rv
}

func (w *Writer) NewBatchEx(options store.KVBatchOptions) ([]byte, store.KVBatch, error) {
	return make([]byte, options.TotalBytes), w.NewBatch(), nil
}

func (w *Writer) ExecuteBatch(b store.KVBatch) error {
	batch, ok := b.(*Batch)
	if !ok {
		return fmt.Errorf("wrong type of batch")
	}

	// first process merges
	for k, mergeOps := range batch.merge.Merges {
		kb := []byte(k)
		existingVal, err := w.store.db.Get(kb, w.store.defaultReadOptions)
		if err != nil && err != leveldb.ErrNotFound {
			return err
		}
		mergedVal, fullMergeOk := w.store.mo.FullMerge(kb, existingVal, mergeOps)
		if !fullMergeOk {
			return fmt.Errorf("merge operator returned failure")
		}
		// add the final merge to this batch
		batch.batch.Put(kb, mergedVal)
	}

	// now execute the batch
	return w.store.db.Write(batch.batch, w.store.defaultWriteOptions)
}

func (w *Writer) Close() error {
	return nil
}
