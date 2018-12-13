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
	"testing"
)

func TestChunkedContentCoder(t *testing.T) {

	tests := []struct {
		maxDocNum uint64
		chunkSize uint64
		docNums   []uint64
		vals      [][]byte
		expected  []byte
	}{
		{
			maxDocNum: 0,
			chunkSize: 1,
			docNums:   []uint64{0},
			vals:      [][]byte{[]byte("bleve")},
			// 1 chunk, chunk-0 length 11(b), value
			expected: []byte{0x1, 0x0, 0x5, 0x5, 0x10, 0x62, 0x6c, 0x65, 0x76, 0x65,
				0xa,
				0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1,
				0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1},
		},
		{
			maxDocNum: 1,
			chunkSize: 1,
			docNums:   []uint64{0, 1},
			vals: [][]byte{
				[]byte("upside"),
				[]byte("scorch"),
			},

			expected: []byte{0x1, 0x0, 0x6, 0x6, 0x14, 0x75, 0x70, 0x73, 0x69, 0x64,
				0x65, 0x1, 0x1, 0x6, 0x6, 0x14, 0x73, 0x63, 0x6f, 0x72, 0x63, 0x68,
				0xb, 0x16,
				0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x2,
				0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x2},
		},
	}

	for _, test := range tests {

		var actual bytes.Buffer
		cic := newChunkedContentCoder(test.chunkSize, test.maxDocNum, &actual, false)
		for i, docNum := range test.docNums {
			err := cic.Add(docNum, test.vals[i])
			if err != nil {
				t.Fatalf("error adding to intcoder: %v", err)
			}
		}
		_ = cic.Close()
		_, err := cic.Write()
		if err != nil {
			t.Fatalf("error writing: %v", err)
		}

		if !bytes.Equal(test.expected, actual.Bytes()) {
			t.Errorf("got:%s, expected:%s", string(actual.Bytes()), string(test.expected))
		}
	}
}

func TestChunkedContentCoders(t *testing.T) {
	maxDocNum := uint64(5)
	chunkSize := uint64(1)
	docNums := []uint64{0, 1, 2, 3, 4, 5}
	vals := [][]byte{
		[]byte("scorch"),
		[]byte("does"),
		[]byte("better"),
		[]byte("than"),
		[]byte("upside"),
		[]byte("down"),
	}

	var actual1, actual2 bytes.Buffer
	// chunkedContentCoder that writes out at the end
	cic1 := newChunkedContentCoder(chunkSize, maxDocNum, &actual1, false)
	// chunkedContentCoder that writes out in chunks
	cic2 := newChunkedContentCoder(chunkSize, maxDocNum, &actual2, true)

	for i, docNum := range docNums {
		err := cic1.Add(docNum, vals[i])
		if err != nil {
			t.Fatalf("error adding to intcoder: %v", err)
		}
		err = cic2.Add(docNum, vals[i])
		if err != nil {
			t.Fatalf("error adding to intcoder: %v", err)
		}
	}
	_ = cic1.Close()
	_ = cic2.Close()

	_, err := cic1.Write()
	if err != nil {
		t.Fatalf("error writing: %v", err)
	}
	_, err = cic2.Write()
	if err != nil {
		t.Fatalf("error writing: %v", err)
	}

	if !bytes.Equal(actual1.Bytes(), actual2.Bytes()) {
		t.Errorf("%s != %s", string(actual1.Bytes()), string(actual2.Bytes()))
	}
}
