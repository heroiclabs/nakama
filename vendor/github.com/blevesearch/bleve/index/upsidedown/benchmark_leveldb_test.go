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

// +build leveldb

package upsidedown

import (
	"testing"

	"github.com/blevesearch/blevex/leveldb"
)

var leveldbTestOptions = map[string]interface{}{
	"path":              "test",
	"create_if_missing": true,
}

func BenchmarkLevelDBIndexing1Workers(b *testing.B) {
	CommonBenchmarkIndex(b, leveldb.Name, leveldbTestOptions, DestroyTest, 1)
}

func BenchmarkLevelDBIndexing2Workers(b *testing.B) {
	CommonBenchmarkIndex(b, leveldb.Name, leveldbTestOptions, DestroyTest, 2)
}

func BenchmarkLevelDBIndexing4Workers(b *testing.B) {
	CommonBenchmarkIndex(b, leveldb.Name, leveldbTestOptions, DestroyTest, 4)
}

// batches

func BenchmarkLevelDBIndexing1Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 1, 10)
}

func BenchmarkLevelDBIndexing2Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 2, 10)
}

func BenchmarkLevelDBIndexing4Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 4, 10)
}

func BenchmarkLevelDBIndexing1Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 1, 100)
}

func BenchmarkLevelDBIndexing2Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 2, 100)
}

func BenchmarkLevelDBIndexing4Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 4, 100)
}

func BenchmarkLevelDBIndexing1Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 1, 1000)
}

func BenchmarkLevelDBIndexing2Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 2, 1000)
}

func BenchmarkLevelDBIndexing4Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, leveldb.Name, leveldbTestOptions, DestroyTest, 4, 1000)
}
