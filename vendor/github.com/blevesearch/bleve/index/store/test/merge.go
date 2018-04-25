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

package test

import (
	"encoding/binary"
	"testing"

	"github.com/blevesearch/bleve/index/store"
)

// test merge behavior

func encodeUint64(in uint64) []byte {
	rv := make([]byte, 8)
	binary.LittleEndian.PutUint64(rv, in)
	return rv
}

func CommonTestMerge(t *testing.T, s store.KVStore) {

	testKey := []byte("k1")

	data := []struct {
		key []byte
		val []byte
	}{
		{testKey, encodeUint64(1)},
		{testKey, encodeUint64(1)},
	}

	// open a writer
	writer, err := s.Writer()
	if err != nil {
		t.Fatal(err)
	}

	// write the data
	batch := writer.NewBatch()
	for _, row := range data {
		batch.Merge(row.key, row.val)
	}
	err = writer.ExecuteBatch(batch)
	if err != nil {
		t.Fatal(err)
	}

	// close the writer
	err = writer.Close()
	if err != nil {
		t.Fatal(err)
	}

	// open a reader
	reader, err := s.Reader()
	if err != nil {
		t.Fatal(err)
	}

	// read key
	returnedVal, err := reader.Get(testKey)
	if err != nil {
		t.Fatal(err)
	}

	// check the value
	mergedval := binary.LittleEndian.Uint64(returnedVal)
	if mergedval != 2 {
		t.Errorf("expected 2, got %d", mergedval)
	}

	// close the reader
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

}

// a test merge operator which is just an incrementing counter of uint64
type TestMergeCounter struct{}

func (mc *TestMergeCounter) FullMerge(key, existingValue []byte, operands [][]byte) ([]byte, bool) {
	var newval uint64
	if len(existingValue) > 0 {
		newval = binary.LittleEndian.Uint64(existingValue)
	}

	// now process operands
	for _, operand := range operands {
		next := binary.LittleEndian.Uint64(operand)
		newval += next
	}

	rv := make([]byte, 8)
	binary.LittleEndian.PutUint64(rv, newval)
	return rv, true
}

func (mc *TestMergeCounter) PartialMerge(key, leftOperand, rightOperand []byte) ([]byte, bool) {
	left := binary.LittleEndian.Uint64(leftOperand)
	right := binary.LittleEndian.Uint64(rightOperand)
	rv := make([]byte, 8)
	binary.LittleEndian.PutUint64(rv, left+right)
	return rv, true
}

func (mc *TestMergeCounter) Name() string {
	return "test_merge_counter"
}
