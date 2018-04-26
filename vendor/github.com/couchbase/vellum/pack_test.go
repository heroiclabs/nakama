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

package vellum

import (
	"fmt"
	"testing"
)

func TestEncodeDecodePackSize(t *testing.T) {

	for i := 0; i <= 8; i++ {
		for j := 0; j <= 8; j++ {
			got := encodePackSize(i, j)
			goti, gotj := decodePackSize(got)
			if goti != i || gotj != j {
				t.Errorf("failed to round trip %d,%d packed as %b to %d,%d", i, j, got, goti, gotj)
			}
		}
	}
}

func TestEncodeNumTrans(t *testing.T) {
	tests := []struct {
		input int
		want  byte
	}{
		{0, 0},
		{5, 5},
		{1<<6 - 1, 1<<6 - 1},
		{1 << 6, 0},
	}

	for _, test := range tests {
		t.Run(fmt.Sprintf("input %d", test.input), func(t *testing.T) {
			got := encodeNumTrans(test.input)
			if got != test.want {
				t.Errorf("wanted: %d, got: %d", test.want, got)
			}
		})
	}
}
