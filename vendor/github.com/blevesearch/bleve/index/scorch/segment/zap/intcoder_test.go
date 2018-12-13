//  Copyright (c) 2017 Couchbase, Inc.
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

package zap

import (
	"bytes"
	"reflect"
	"testing"
)

func TestChunkIntCoder(t *testing.T) {
	tests := []struct {
		maxDocNum uint64
		chunkSize uint64
		docNums   []uint64
		vals      [][]uint64
		expected  []byte
	}{
		{
			maxDocNum: 0,
			chunkSize: 1,
			docNums:   []uint64{0},
			vals: [][]uint64{
				[]uint64{3},
			},
			// 1 chunk, chunk-0 length 1, value 3
			expected: []byte{0x1, 0x1, 0x3},
		},
		{
			maxDocNum: 1,
			chunkSize: 1,
			docNums:   []uint64{0, 1},
			vals: [][]uint64{
				[]uint64{3},
				[]uint64{7},
			},
			// 2 chunks, chunk-0 offset 1, chunk-1 offset 2, value 3, value 7
			expected: []byte{0x2, 0x1, 0x2, 0x3, 0x7},
		},
	}

	for _, test := range tests {

		cic := newChunkedIntCoder(test.chunkSize, test.maxDocNum)
		for i, docNum := range test.docNums {
			err := cic.Add(docNum, test.vals[i]...)
			if err != nil {
				t.Fatalf("error adding to intcoder: %v", err)
			}
		}
		cic.Close()
		var actual bytes.Buffer
		_, err := cic.Write(&actual)
		if err != nil {
			t.Fatalf("error writing: %v", err)
		}
		if !reflect.DeepEqual(test.expected, actual.Bytes()) {
			t.Errorf("got % x, expected % x", actual.Bytes(), test.expected)
		}
	}
}

func TestChunkLengthToOffsets(t *testing.T) {

	tests := []struct {
		lengths         []uint64
		expectedOffsets []uint64
	}{
		{
			lengths:         []uint64{5, 5, 5, 5, 5},
			expectedOffsets: []uint64{5, 10, 15, 20, 25},
		},
		{
			lengths:         []uint64{0, 5, 0, 5, 0},
			expectedOffsets: []uint64{0, 5, 5, 10, 10},
		},
		{
			lengths:         []uint64{0, 0, 0, 0, 5},
			expectedOffsets: []uint64{0, 0, 0, 0, 5},
		},
		{
			lengths:         []uint64{5, 0, 0, 0, 0},
			expectedOffsets: []uint64{5, 5, 5, 5, 5},
		},
		{
			lengths:         []uint64{0, 5, 0, 0, 0},
			expectedOffsets: []uint64{0, 5, 5, 5, 5},
		},
		{
			lengths:         []uint64{0, 0, 0, 5, 0},
			expectedOffsets: []uint64{0, 0, 0, 5, 5},
		},
		{
			lengths:         []uint64{0, 0, 0, 5, 5},
			expectedOffsets: []uint64{0, 0, 0, 5, 10},
		},
		{
			lengths:         []uint64{5, 5, 5, 0, 0},
			expectedOffsets: []uint64{5, 10, 15, 15, 15},
		},
		{
			lengths:         []uint64{5},
			expectedOffsets: []uint64{5},
		},
		{
			lengths:         []uint64{5, 5},
			expectedOffsets: []uint64{5, 10},
		},
	}

	for i, test := range tests {
		modifyLengthsToEndOffsets(test.lengths)
		if !reflect.DeepEqual(test.expectedOffsets, test.lengths) {
			t.Errorf("Test: %d failed, got %+v, expected %+v", i, test.lengths, test.expectedOffsets)
		}
	}
}

func TestChunkReadBoundaryFromOffsets(t *testing.T) {

	tests := []struct {
		chunkNumber   int
		offsets       []uint64
		expectedStart uint64
		expectedEnd   uint64
	}{
		{
			offsets:       []uint64{5, 10, 15, 20, 25},
			chunkNumber:   4,
			expectedStart: 20,
			expectedEnd:   25,
		},
		{
			offsets:       []uint64{5, 10, 15, 20, 25},
			chunkNumber:   0,
			expectedStart: 0,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{5, 10, 15, 20, 25},
			chunkNumber:   2,
			expectedStart: 10,
			expectedEnd:   15,
		},
		{
			offsets:       []uint64{0, 5, 5, 10, 10},
			chunkNumber:   4,
			expectedStart: 10,
			expectedEnd:   10,
		},
		{
			offsets:       []uint64{0, 5, 5, 10, 10},
			chunkNumber:   1,
			expectedStart: 0,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{5, 5, 5, 5, 5},
			chunkNumber:   0,
			expectedStart: 0,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{5, 5, 5, 5, 5},
			chunkNumber:   4,
			expectedStart: 5,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{5, 5, 5, 5, 5},
			chunkNumber:   1,
			expectedStart: 5,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{0, 5, 5, 5, 5},
			chunkNumber:   1,
			expectedStart: 0,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{0, 5, 5, 5, 5},
			chunkNumber:   0,
			expectedStart: 0,
			expectedEnd:   0,
		},
		{
			offsets:       []uint64{0, 0, 0, 5, 5},
			chunkNumber:   2,
			expectedStart: 0,
			expectedEnd:   0,
		},
		{
			offsets:       []uint64{0, 0, 0, 5, 5},
			chunkNumber:   1,
			expectedStart: 0,
			expectedEnd:   0,
		},
		{
			offsets:       []uint64{0, 0, 0, 0, 5},
			chunkNumber:   4,
			expectedStart: 0,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{0, 0, 0, 0, 5},
			chunkNumber:   2,
			expectedStart: 0,
			expectedEnd:   0,
		},
		{
			offsets:       []uint64{5, 10, 15, 15, 15},
			chunkNumber:   0,
			expectedStart: 0,
			expectedEnd:   5,
		},
		{
			offsets:       []uint64{5, 10, 15, 15, 15},
			chunkNumber:   1,
			expectedStart: 5,
			expectedEnd:   10,
		},
		{
			offsets:       []uint64{5, 10, 15, 15, 15},
			chunkNumber:   2,
			expectedStart: 10,
			expectedEnd:   15,
		},
		{
			offsets:       []uint64{5, 10, 15, 15, 15},
			chunkNumber:   3,
			expectedStart: 15,
			expectedEnd:   15,
		},
		{
			offsets:       []uint64{5, 10, 15, 15, 15},
			chunkNumber:   4,
			expectedStart: 15,
			expectedEnd:   15,
		},
		{
			offsets:       []uint64{5},
			chunkNumber:   0,
			expectedStart: 0,
			expectedEnd:   5,
		},
	}

	for i, test := range tests {
		s, e := readChunkBoundary(test.chunkNumber, test.offsets)
		if test.expectedStart != s || test.expectedEnd != e {
			t.Errorf("Test: %d failed for chunkNumber: %d got start: %d end: %d,"+
				" expected start: %d end: %d", i, test.chunkNumber, s, e,
				test.expectedStart, test.expectedEnd)
		}
	}
}
