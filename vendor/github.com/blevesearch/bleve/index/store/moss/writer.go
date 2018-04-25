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
	"fmt"

	"github.com/blevesearch/bleve/index/store"

	"github.com/couchbase/moss"
)

type Writer struct {
	s *Store
}

func (w *Writer) NewBatch() store.KVBatch {
	b, err := w.s.ms.NewBatch(0, 0)
	if err != nil {
		return nil
	}

	return &Batch{
		store: w.s,
		merge: store.NewEmulatedMerge(w.s.mo),
		batch: b,
	}
}

func (w *Writer) NewBatchEx(options store.KVBatchOptions) (
	[]byte, store.KVBatch, error) {
	numOps := options.NumSets + options.NumDeletes + options.NumMerges

	b, err := w.s.ms.NewBatch(numOps, options.TotalBytes)
	if err != nil {
		return nil, nil, err
	}

	buf, err := b.Alloc(options.TotalBytes)
	if err != nil {
		return nil, nil, err
	}

	return buf, &Batch{
		store:   w.s,
		merge:   store.NewEmulatedMerge(w.s.mo),
		batch:   b,
		buf:     buf,
		bufUsed: 0,
	}, nil
}

func (w *Writer) ExecuteBatch(b store.KVBatch) (err error) {
	batch, ok := b.(*Batch)
	if !ok {
		return fmt.Errorf("wrong type of batch")
	}

	for kStr, mergeOps := range batch.merge.Merges {
		for _, v := range mergeOps {
			if batch.buf != nil {
				kLen := len(kStr)
				vLen := len(v)
				kBuf := batch.buf[batch.bufUsed : batch.bufUsed+kLen]
				vBuf := batch.buf[batch.bufUsed+kLen : batch.bufUsed+kLen+vLen]
				copy(kBuf, kStr)
				copy(vBuf, v)
				batch.bufUsed += kLen + vLen
				err = batch.batch.AllocMerge(kBuf, vBuf)
			} else {
				err = batch.batch.Merge([]byte(kStr), v)
			}
			if err != nil {
				return err
			}
		}
	}

	return w.s.ms.ExecuteBatch(batch.batch, moss.WriteOptions{})
}

func (w *Writer) Close() error {
	w.s = nil
	return nil
}
