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

package moss

import (
	"encoding/json"

	"github.com/blevesearch/bleve/index/store"
)

type stats struct {
	s *Store
}

func (s *stats) statsMap() map[string]interface{} {
	ms := map[string]interface{}{}

	var err error
	ms["moss"], err = s.s.ms.Stats()
	if err != nil {
		return ms
	}

	if s.s.llstore != nil {
		if o, ok := s.s.llstore.(store.KVStoreStats); ok {
			ms["kv"] = o.StatsMap()
		}
	}

	_, exists := ms["kv"]
	if !exists && s.s.llstats != nil {
		ms["kv"] = s.s.llstats()
	}

	if msw, ok := s.s.llstore.(*mossStoreWrapper); ok {
		ms["store_histograms"] = msw.Actual().Histograms().String()
	}

	ms["coll_histograms"] = s.s.ms.Histograms().String()

	return ms
}

func (s *stats) MarshalJSON() ([]byte, error) {
	m := s.statsMap()
	return json.Marshal(m)
}
