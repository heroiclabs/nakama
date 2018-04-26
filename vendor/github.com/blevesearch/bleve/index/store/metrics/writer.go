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

import (
	"fmt"

	"github.com/blevesearch/bleve/index/store"
)

type Writer struct {
	s *Store
	o store.KVWriter
}

func (w *Writer) Close() error {
	err := w.o.Close()
	if err != nil {
		w.s.AddError("Writer.Close", err, nil)
	}
	return err
}

func (w *Writer) NewBatch() store.KVBatch {
	return &Batch{s: w.s, o: w.o.NewBatch()}
}

func (w *Writer) NewBatchEx(options store.KVBatchOptions) ([]byte, store.KVBatch, error) {
	buf, b, err := w.o.NewBatchEx(options)
	if err != nil {
		return nil, nil, err
	}
	return buf, &Batch{s: w.s, o: b}, nil
}

func (w *Writer) ExecuteBatch(b store.KVBatch) (err error) {
	batch, ok := b.(*Batch)
	if !ok {
		return fmt.Errorf("wrong type of batch")
	}
	w.s.timerWriterExecuteBatch.Time(func() {
		err = w.o.ExecuteBatch(batch.o)
		if err != nil {
			w.s.AddError("Writer.ExecuteBatch", err, nil)
		}
	})
	return
}
