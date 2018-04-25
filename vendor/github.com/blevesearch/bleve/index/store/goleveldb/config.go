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

package goleveldb

import (
	"github.com/syndtr/goleveldb/leveldb/filter"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

func applyConfig(o *opt.Options, config map[string]interface{}) (*opt.Options, error) {

	ro, ok := config["read_only"].(bool)
	if ok {
		o.ReadOnly = ro
	}

	cim, ok := config["create_if_missing"].(bool)
	if ok {
		o.ErrorIfMissing = !cim
	}

	eie, ok := config["error_if_exists"].(bool)
	if ok {
		o.ErrorIfExist = eie
	}

	wbs, ok := config["write_buffer_size"].(float64)
	if ok {
		o.WriteBuffer = int(wbs)
	}

	bs, ok := config["block_size"].(float64)
	if ok {
		o.BlockSize = int(bs)
	}

	bri, ok := config["block_restart_interval"].(float64)
	if ok {
		o.BlockRestartInterval = int(bri)
	}

	lcc, ok := config["lru_cache_capacity"].(float64)
	if ok {
		o.BlockCacheCapacity = int(lcc)
	}

	bfbpk, ok := config["bloom_filter_bits_per_key"].(float64)
	if ok {
		bf := filter.NewBloomFilter(int(bfbpk))
		o.Filter = bf
	}

	return o, nil
}
