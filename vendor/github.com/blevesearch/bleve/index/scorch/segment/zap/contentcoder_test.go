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

func TestChunkContentCoder(t *testing.T) {

	tests := []struct {
		maxDocNum uint64
		chunkSize uint64
		docNums   []uint64
		vals      [][]byte
		expected  string
	}{
		{
			maxDocNum: 0,
			chunkSize: 1,
			docNums:   []uint64{0},
			vals:      [][]byte{[]byte("bleve")},
			// 1 chunk, chunk-0 length 11(b), value
			expected: string([]byte{0x1, 0xb, 0x1, 0x0, 0x0, 0x05, 0x05, 0x10, 0x62, 0x6c, 0x65, 0x76, 0x65}),
		},
		{
			maxDocNum: 1,
			chunkSize: 1,
			docNums:   []uint64{0, 1},
			vals: [][]byte{
				[]byte("upside"),
				[]byte("scorch"),
			},

			expected: string([]byte{0x02, 0x0c, 0x0c, 0x01, 0x00, 0x00, 0x06, 0x06, 0x14,
				0x75, 0x70, 0x73, 0x69, 0x64, 0x65, 0x01, 0x01, 0x00, 0x06, 0x06,
				0x14, 0x73, 0x63, 0x6f, 0x72, 0x63, 0x68}),
		},
	}

	for _, test := range tests {

		cic := newChunkedContentCoder(test.chunkSize, test.maxDocNum)
		for i, docNum := range test.docNums {
			err := cic.Add(docNum, test.vals[i])
			if err != nil {
				t.Fatalf("error adding to intcoder: %v", err)
			}
		}
		_ = cic.Close()
		var actual bytes.Buffer
		_, err := cic.Write(&actual)
		if err != nil {
			t.Fatalf("error writing: %v", err)
		}

		if !reflect.DeepEqual(test.expected, string(actual.Bytes())) {
			t.Errorf("got % s, expected % s", string(actual.Bytes()), test.expected)
		}
	}
}
