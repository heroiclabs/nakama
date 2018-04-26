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

package metrics

import (
	"encoding/json"

	"github.com/blevesearch/bleve/index/store"
)

type stats struct {
	s *Store
}

func (s *stats) statsMap() map[string]interface{} {
	ms := map[string]interface{}{}

	ms["metrics"] = map[string]interface{}{
		"reader_get":             TimerMap(s.s.timerReaderGet),
		"reader_multi_get":       TimerMap(s.s.timerReaderMultiGet),
		"reader_prefix_iterator": TimerMap(s.s.timerReaderPrefixIterator),
		"reader_range_iterator":  TimerMap(s.s.timerReaderRangeIterator),
		"writer_execute_batch":   TimerMap(s.s.timerWriterExecuteBatch),
		"iterator_seek":          TimerMap(s.s.timerIteratorSeek),
		"iterator_next":          TimerMap(s.s.timerIteratorNext),
		"batch_merge":            TimerMap(s.s.timerBatchMerge),
	}

	if o, ok := s.s.o.(store.KVStoreStats); ok {
		ms["kv"] = o.StatsMap()
	}

	return ms
}

func (s *stats) MarshalJSON() ([]byte, error) {
	m := s.statsMap()
	return json.Marshal(m)
}
