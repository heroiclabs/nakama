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

// +build rocksdb

package upsidedown

import (
	"testing"

	"github.com/blevesearch/blevex/rocksdb"
)

var rocksdbTestOptions = map[string]interface{}{
	"path":              "test",
	"create_if_missing": true,
}

func BenchmarkRocksDBIndexing1Workers(b *testing.B) {
	CommonBenchmarkIndex(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 1)
}

func BenchmarkRocksDBIndexing2Workers(b *testing.B) {
	CommonBenchmarkIndex(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 2)
}

func BenchmarkRocksDBIndexing4Workers(b *testing.B) {
	CommonBenchmarkIndex(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 4)
}

// batches

func BenchmarkRocksDBIndexing1Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 1, 10)
}

func BenchmarkRocksDBIndexing2Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 2, 10)
}

func BenchmarkRocksDBIndexing4Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 4, 10)
}

func BenchmarkRocksDBIndexing1Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 1, 100)
}

func BenchmarkRocksDBIndexing2Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 2, 100)
}

func BenchmarkRocksDBIndexing4Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 4, 100)
}

func BenchmarkRocksDBIndexing1Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 1, 1000)
}

func BenchmarkRocksDBIndexing2Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 2, 1000)
}

func BenchmarkRocksDBIndexing4Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, rocksdb.Name, rocksdbTestOptions, DestroyTest, 4, 1000)
}
