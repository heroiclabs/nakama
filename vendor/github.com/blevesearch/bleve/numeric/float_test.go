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
	"testing"
)

// test that the float/sortable int operations work both ways
// and that the corresponding integers sort the same as
// the original floats would have
func TestSortabledFloat64ToInt64(t *testing.T) {
	tests := []struct {
		input float64
	}{
		{
			input: -4640094584139352638,
		},
		{
			input: -167.42,
		},
		{
			input: -1.11,
		},
		{
			input: 0,
		},
		{
			input: 3.14,
		},
		{
			input: 167.42,
		},
	}

	var lastInt64 *int64
	for _, test := range tests {
		actual := Float64ToInt64(test.input)
		if lastInt64 != nil {
			// check that this float is greater than the last one
			if actual <= *lastInt64 {
				t.Errorf("expected greater than prev, this: %d, last %d", actual, *lastInt64)
			}
		}
		lastInt64 = &actual
		convertedBack := Int64ToFloat64(actual)
		// assert that we got back what we started with
		if convertedBack != test.input {
			t.Errorf("expected %f, got %f", test.input, convertedBack)
		}
	}
}
