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

package upsidedown

import (
	"testing"

	"github.com/blevesearch/bleve/index/store/null"
)

func BenchmarkNullIndexing1Workers(b *testing.B) {
	CommonBenchmarkIndex(b, null.Name, nil, DestroyTest, 1)
}

func BenchmarkNullIndexing2Workers(b *testing.B) {
	CommonBenchmarkIndex(b, null.Name, nil, DestroyTest, 2)
}

func BenchmarkNullIndexing4Workers(b *testing.B) {
	CommonBenchmarkIndex(b, null.Name, nil, DestroyTest, 4)
}

// batches

func BenchmarkNullIndexing1Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 1, 10)
}

func BenchmarkNullIndexing2Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 2, 10)
}

func BenchmarkNullIndexing4Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 4, 10)
}

func BenchmarkNullIndexing1Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 1, 100)
}

func BenchmarkNullIndexing2Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 2, 100)
}

func BenchmarkNullIndexing4Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 4, 100)
}

func BenchmarkNullIndexing1Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 1, 1000)
}

func BenchmarkNullIndexing2Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 2, 1000)
}

func BenchmarkNullIndexing4Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, null.Name, nil, DestroyTest, 4, 1000)
}
