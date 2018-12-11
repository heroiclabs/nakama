//  Copyright (c) 2018 Couchbase, Inc.
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
	"math"
	"testing"

	"github.com/RoaringBitmap/roaring"
)

func TestRoaringSizes(t *testing.T) {
	tests := []struct {
		vals          []uint32
		expectedSize  int // expected serialized # bytes
		optimizedSize int // after calling roaring's RunOptimize() API
	}{
		{[]uint32{}, 8, 8}, // empty roaring is 8 bytes

		{[]uint32{0}, 18, 18}, // single entry roaring is 18 bytes
		{[]uint32{1}, 18, 18},
		{[]uint32{4}, 18, 18},
		{[]uint32{4000}, 18, 18},
		{[]uint32{40000000}, 18, 18},
		{[]uint32{math.MaxUint32}, 18, 18},
		{[]uint32{math.MaxUint32 - 1}, 18, 18},

		{[]uint32{0, 1}, 20, 20},
		{[]uint32{0, 10000000}, 28, 28},

		{[]uint32{0, 1, 2}, 22, 15},
		{[]uint32{0, 1, 20000000}, 30, 30},

		{[]uint32{0, 1, 2, 3}, 24, 15},
		{[]uint32{0, 1, 2, 30000000}, 32, 21},
	}

	for _, test := range tests {
		bm := roaring.New()
		for _, val := range test.vals {
			bm.Add(val)
		}

		b, err := bm.ToBytes()
		if err != nil {
			t.Errorf("expected no ToBytes() err, got: %v", err)
		}
		if len(b) != test.expectedSize {
			t.Errorf("size did not match,"+
				" got: %d, test: %#v", len(b), test)
		}
		if int(bm.GetSerializedSizeInBytes()) != test.expectedSize {
			t.Errorf("GetSerializedSizeInBytes did not match,"+
				" got: %d, test: %#v",
				bm.GetSerializedSizeInBytes(), test)
		}

		bm.RunOptimize()

		b, err = bm.ToBytes()
		if err != nil {
			t.Errorf("expected no ToBytes() err, got: %v", err)
		}
		if len(b) != test.optimizedSize {
			t.Errorf("optimized size did not match,"+
				" got: %d, test: %#v", len(b), test)
		}
		if int(bm.GetSerializedSizeInBytes()) != test.optimizedSize {
			t.Errorf("optimized GetSerializedSizeInBytes did not match,"+
				" got: %d, test: %#v",
				bm.GetSerializedSizeInBytes(), test)
		}
	}
}
