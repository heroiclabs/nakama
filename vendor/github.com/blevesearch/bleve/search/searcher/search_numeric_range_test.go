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

package searcher

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/numeric"
)

func TestSplitRange(t *testing.T) {
	min := numeric.Float64ToInt64(1.0)
	max := numeric.Float64ToInt64(5.0)
	ranges := splitInt64Range(min, max, 4)
	enumerated := ranges.Enumerate()
	if len(enumerated) != 135 {
		t.Errorf("expected 135 terms, got %d", len(enumerated))
	}

}

func TestIncrementBytes(t *testing.T) {
	tests := []struct {
		in  []byte
		out []byte
	}{
		{
			in:  []byte{0},
			out: []byte{1},
		},
		{
			in:  []byte{0, 0},
			out: []byte{0, 1},
		},
		{
			in:  []byte{0, 255},
			out: []byte{1, 0},
		},
	}

	for _, test := range tests {
		actual := incrementBytes(test.in)
		if !reflect.DeepEqual(actual, test.out) {
			t.Errorf("expected %#v, got %#v", test.out, actual)
		}
	}
}
