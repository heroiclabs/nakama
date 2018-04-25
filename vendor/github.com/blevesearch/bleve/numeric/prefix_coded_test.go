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

package numeric

import (
	"reflect"
	"testing"
)

var tests = []struct {
	input  int64
	shift  uint
	output PrefixCoded
}{
	{
		input:  1,
		shift:  0,
		output: PrefixCoded{0x20, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1},
	},
	{
		input:  -1,
		shift:  0,
		output: PrefixCoded{0x20, 0x0, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f},
	},
	{
		input:  -94582,
		shift:  0,
		output: PrefixCoded{0x20, 0x0, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7a, 0x1d, 0xa},
	},
	{
		input:  314729851,
		shift:  0,
		output: PrefixCoded{0x20, 0x1, 0x0, 0x0, 0x0, 0x0, 0x1, 0x16, 0x9, 0x4a, 0x7b},
	},
	{
		input:  314729851,
		shift:  4,
		output: PrefixCoded{0x24, 0x8, 0x0, 0x0, 0x0, 0x0, 0x9, 0x30, 0x4c, 0x57},
	},
	{
		input:  314729851,
		shift:  8,
		output: PrefixCoded{0x28, 0x40, 0x0, 0x0, 0x0, 0x0, 0x4b, 0x4, 0x65},
	},
	{
		input:  314729851,
		shift:  16,
		output: PrefixCoded{0x30, 0x20, 0x0, 0x0, 0x0, 0x0, 0x25, 0x42},
	},
	{
		input:  314729851,
		shift:  32,
		output: PrefixCoded{0x40, 0x8, 0x0, 0x0, 0x0, 0x0},
	},
	{
		input:  1234729851,
		shift:  32,
		output: PrefixCoded{0x40, 0x8, 0x0, 0x0, 0x0, 0x0},
	},
}

// these array encoding values have been verified manually
// against the lucene implementation
func TestPrefixCoded(t *testing.T) {

	for _, test := range tests {
		actual, err := NewPrefixCodedInt64(test.input, test.shift)
		if err != nil {
			t.Error(err)
		}
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
		}
		checkedShift, err := actual.Shift()
		if err != nil {
			t.Error(err)
		}
		if checkedShift != test.shift {
			t.Errorf("expected %d, got %d", test.shift, checkedShift)
		}
		// if the shift was 0, make sure we can go back to the original
		if test.shift == 0 {
			backToLong, err := actual.Int64()
			if err != nil {
				t.Error(err)
			}
			if backToLong != test.input {
				t.Errorf("expected %v, got %v", test.input, backToLong)
			}
		}
	}
}

func TestPrefixCodedValid(t *testing.T) {
	// all of the shared tests should be valid
	for _, test := range tests {
		valid, _ := ValidPrefixCodedTerm(string(test.output))
		if !valid {
			t.Errorf("expected %s to be valid prefix coded, is not", string(test.output))
		}
	}

	invalidTests := []struct {
		data PrefixCoded
	}{
		// first byte invalid skip (too low)
		{
			data: PrefixCoded{0x19, 'c', 'a', 't'},
		},
		// first byte invalid skip (too high)
		{
			data: PrefixCoded{0x20 + 64, 'c'},
		},
		// length of trailing bytes wrong (too long)
		{
			data: PrefixCoded{0x20, 0x1, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1},
		},
		// length of trailing bytes wrong (too short)
		{
			data: PrefixCoded{0x20 + 63},
		},
	}

	// all of the shared tests should be valid
	for _, test := range invalidTests {
		valid, _ := ValidPrefixCodedTerm(string(test.data))
		if valid {
			t.Errorf("expected %s to be invalid prefix coded, it is", string(test.data))
		}
	}
}

func BenchmarkTestPrefixCoded(b *testing.B) {

	for i := 0; i < b.N; i++ {
		for _, test := range tests {
			actual, err := NewPrefixCodedInt64(test.input, test.shift)
			if err != nil {
				b.Error(err)
			}
			if !reflect.DeepEqual(actual, test.output) {
				b.Errorf("expected %#v, got %#v", test.output, actual)
			}
		}
	}
}
