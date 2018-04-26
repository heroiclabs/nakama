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

import "testing"

func TestCommonInputs(t *testing.T) {

	// first ensure items that can be encoded round trip properly
	for i := 0; i < 256; i++ {
		roundTrip(t, byte(i))
	}

	// G maps to 62, +1 is 63, which is highest 6-bit value we can encode
	enc := encodeCommon('G')
	if enc != 63 {
		t.Errorf("expected G to encode to 63, got %d", enc)
	}

	// W encodes to 63, +1 is 64, which is too big to fit
	enc = encodeCommon('W')
	if enc != 0 {
		t.Errorf("expected W to encode to 0, got %d", enc)
	}
}

func roundTrip(t *testing.T, b byte) {
	enc := encodeCommon(b)
	if enc > 0 {
		dec := decodeCommon(enc)
		if dec != b {
			t.Errorf("error round trip common input: %d", b)
		}
	}
}
