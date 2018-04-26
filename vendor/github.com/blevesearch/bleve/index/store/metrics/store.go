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

// Package metrics provides a bleve.store.KVStore implementation that
// wraps another, real KVStore implementation, and uses go-metrics to
// track runtime performance metrics.
package metrics

import (
	"container/list"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/bleve/registry"
	"github.com/rcrowley/go-metrics"
)

const Name = "metrics"

type Store struct {
	o store.KVStore

	timerReaderGet            metrics.Timer
	timerReaderMultiGet       metrics.Timer
	timerReaderPrefixIterator metrics.Timer
	timerReaderRangeIterator  metrics.Timer
	timerWriterExecuteBatch   metrics.Timer
	timerIteratorSeek         metrics.Timer
	timerIteratorNext         metrics.Timer
	timerBatchMerge           metrics.Timer

	m      sync.Mutex // Protects the fields that follow.
	errors *list.List // Capped list of StoreError's.

	s *stats
}

func New(mo store.MergeOperator, config map[string]interface{}) (store.KVStore, error) {

	name, ok := config["kvStoreName_actual"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("metrics: missing kvStoreName_actual,"+
			" config: %#v", config)
	}

	if name == Name {
		return nil, fmt.Errorf("metrics: circular kvStoreName_actual")
	}

	ctr := registry.KVStoreConstructorByName(name)
	if ctr == nil {
		return nil, fmt.Errorf("metrics: no kv store constructor,"+
			" kvStoreName_actual: %s", name)
	}

	kvs, err := ctr(mo, config)
	if err != nil {
		return nil, err
	}

	rv := &Store{
		o: kvs,

		timerReaderGet:            metrics.NewTimer(),
		timerReaderMultiGet:       metrics.NewTimer(),
		timerReaderPrefixIterator: metrics.NewTimer(),
		timerReaderRangeIterator:  metrics.NewTimer(),
		timerWriterExecuteBatch:   metrics.NewTimer(),
		timerIteratorSeek:         metrics.NewTimer(),
		timerIteratorNext:         metrics.NewTimer(),
		timerBatchMerge:           metrics.NewTimer(),

		errors: list.New(),
	}

	rv.s = &stats{s: rv}

	return rv, nil
}

func init() {
	registry.RegisterKVStore(Name, New)
}

func (s *Store) Close() error {
	return s.o.Close()
}

func (s *Store) Reader() (store.KVReader, error) {
	o, err := s.o.Reader()
	if err != nil {
		s.AddError("Reader", err, nil)
		return nil, err
	}
	return &Reader{s: s, o: o}, nil
}

func (s *Store) Writer() (store.KVWriter, error) {
	o, err := s.o.Writer()
	if err != nil {
		s.AddError("Writer", err, nil)
		return nil, err
	}
	return &Writer{s: s, o: o}, nil
}

// Metric specific code below:

const MaxErrors = 100

type StoreError struct {
	Time string
	Op   string
	Err  string
	Key  string
}

func (s *Store) AddError(op string, err error, key []byte) {
	e := &StoreError{
		Time: time.Now().Format(time.RFC3339Nano),
		Op:   op,
		Err:  fmt.Sprintf("%v", err),
		Key:  string(key),
	}

	s.m.Lock()
	for s.errors.Len() >= MaxErrors {
		s.errors.Remove(s.errors.Front())
	}
	s.errors.PushBack(e)
	s.m.Unlock()
}

func (s *Store) WriteJSON(w io.Writer) (err error) {
	_, err = w.Write([]byte(`{"TimerReaderGet":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerReaderGet)
	_, err = w.Write([]byte(`,"TimerReaderMultiGet":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerReaderMultiGet)
	_, err = w.Write([]byte(`,"TimerReaderPrefixIterator":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerReaderPrefixIterator)
	_, err = w.Write([]byte(`,"TimerReaderRangeIterator":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerReaderRangeIterator)
	_, err = w.Write([]byte(`,"TimerWriterExecuteBatch":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerWriterExecuteBatch)
	_, err = w.Write([]byte(`,"TimerIteratorSeek":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerIteratorSeek)
	_, err = w.Write([]byte(`,"TimerIteratorNext":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerIteratorNext)
	_, err = w.Write([]byte(`,"TimerBatchMerge":`))
	if err != nil {
		return
	}
	WriteTimerJSON(w, s.timerBatchMerge)

	_, err = w.Write([]byte(`,"Errors":[`))
	if err != nil {
		return
	}
	s.m.Lock()
	defer s.m.Unlock()
	e := s.errors.Front()
	i := 0
	for e != nil {
		se, ok := e.Value.(*StoreError)
		if ok && se != nil {
			if i > 0 {
				_, err = w.Write([]byte(","))
				if err != nil {
					return
				}
			}
			var buf []byte
			buf, err = json.Marshal(se)
			if err == nil {
				_, err = w.Write(buf)
				if err != nil {
					return
				}
			}
		}
		e = e.Next()
		i = i + 1
	}
	_, err = w.Write([]byte(`]`))
	if err != nil {
		return
	}

	// see if the underlying implementation has its own stats
	if o, ok := s.o.(store.KVStoreStats); ok {
		storeStats := o.Stats()
		var storeBytes []byte
		storeBytes, err = json.Marshal(storeStats)
		if err != nil {
			return
		}
		_, err = fmt.Fprintf(w, `, "store": %s`, string(storeBytes))
		if err != nil {
			return
		}
	}

	_, err = w.Write([]byte(`}`))
	if err != nil {
		return
	}

	return
}

func (s *Store) WriteCSVHeader(w io.Writer) {
	WriteTimerCSVHeader(w, "TimerReaderGet")
	WriteTimerCSVHeader(w, "TimerReaderPrefixIterator")
	WriteTimerCSVHeader(w, "TimerReaderRangeIterator")
	WriteTimerCSVHeader(w, "TimerWtierExecuteBatch")
	WriteTimerCSVHeader(w, "TimerIteratorSeek")
	WriteTimerCSVHeader(w, "TimerIteratorNext")
	WriteTimerCSVHeader(w, "TimerBatchMerge")
}

func (s *Store) WriteCSV(w io.Writer) {
	WriteTimerCSV(w, s.timerReaderGet)
	WriteTimerCSV(w, s.timerReaderPrefixIterator)
	WriteTimerCSV(w, s.timerReaderRangeIterator)
	WriteTimerCSV(w, s.timerWriterExecuteBatch)
	WriteTimerCSV(w, s.timerIteratorSeek)
	WriteTimerCSV(w, s.timerIteratorNext)
	WriteTimerCSV(w, s.timerBatchMerge)
}

func (s *Store) Stats() json.Marshaler {
	return s.s
}

func (s *Store) StatsMap() map[string]interface{} {
	return s.s.statsMap()
}
