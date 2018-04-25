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

// +build cznicb

package upsidedown

import (
	"testing"

	"github.com/blevesearch/bleve/index/store"
	"github.com/blevesearch/blevex/cznicb"
)

func CreateCznicB() (store.KVStore, error) {
	return cznicb.StoreConstructor(nil)
}

func DestroyCznicB() error {
	return nil
}

func BenchmarkCznicBIndexing1Workers(b *testing.B) {
	CommonBenchmarkIndex(b, CreateCznicB, DestroyCznicB, 1)
}

func BenchmarkCznicBIndexing2Workers(b *testing.B) {
	CommonBenchmarkIndex(b, CreateCznicB, DestroyCznicB, 2)
}

func BenchmarkCznicBIndexing4Workers(b *testing.B) {
	CommonBenchmarkIndex(b, CreateCznicB, DestroyCznicB, 4)
}

// batches

func BenchmarkCznicBIndexing1Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 1, 10)
}

func BenchmarkCznicBIndexing2Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 2, 10)
}

func BenchmarkCznicBIndexing4Workers10Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 4, 10)
}

func BenchmarkCznicBIndexing1Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 1, 100)
}

func BenchmarkCznicBIndexing2Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 2, 100)
}

func BenchmarkCznicBIndexing4Workers100Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 4, 100)
}

func BenchmarkCznicBIndexing1Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 1, 1000)
}

func BenchmarkCznicBIndexing2Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 2, 1000)
}

func BenchmarkCznicBIndexing4Workers1000Batch(b *testing.B) {
	CommonBenchmarkIndexBatch(b, CreateCznicB, DestroyCznicB, 4, 1000)
}
