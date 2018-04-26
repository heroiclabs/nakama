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
	"bytes"
	"encoding/binary"
	"testing"
)

func TestPartialMerge(t *testing.T) {

	tests := []struct {
		in  [][]byte
		out uint64
	}{
		{
			in:  [][]byte{dictionaryTermIncr, dictionaryTermIncr, dictionaryTermIncr, dictionaryTermIncr, dictionaryTermIncr},
			out: 5,
		},
	}

	mo := &upsideDownMerge{}
	for _, test := range tests {
		curr := test.in[0]
		for _, next := range test.in[1:] {
			var ok bool
			curr, ok = mo.PartialMerge([]byte("key"), curr, next)
			if !ok {
				t.Errorf("expected partial merge ok")
			}
		}
		actual := decodeCount(curr)
		if actual != test.out {
			t.Errorf("expected %d, got %d", test.out, actual)
		}
	}

}

func decodeCount(in []byte) uint64 {
	buf := bytes.NewBuffer(in)
	count, _ := binary.ReadUvarint(buf)
	return count
}
