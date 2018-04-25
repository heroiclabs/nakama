// Copyright 2014 The Cockroach Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied. See the License for the specific language governing
// permissions and limitations under the License.

// This code originated from:
// https://github.com/cockroachdb/cockroach/blob/2dd65dde5d90c157f4b93f92502ca1063b904e1d/pkg/util/encoding/encoding_test.go

// Modified to only test the parts we borrowed

package segment

import (
	"bytes"
	"math"
	"testing"
)

type testCaseUint64 struct {
	value  uint64
	expEnc []byte
}

func TestEncodeDecodeUvarint(t *testing.T) {
	testBasicEncodeDecodeUint64(EncodeUvarintAscending, DecodeUvarintAscending, false, t)
	testCases := []testCaseUint64{
		{0, []byte{0x88}},
		{1, []byte{0x89}},
		{109, []byte{0xf5}},
		{110, []byte{0xf6, 0x6e}},
		{1 << 8, []byte{0xf7, 0x01, 0x00}},
		{math.MaxUint64, []byte{0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}},
	}
	testCustomEncodeUint64(testCases, EncodeUvarintAscending, t)
}

func testBasicEncodeDecodeUint64(
	encFunc func([]byte, uint64) []byte,
	decFunc func([]byte) ([]byte, uint64, error),
	descending bool, t *testing.T,
) {
	testCases := []uint64{
		0, 1,
		1<<8 - 1, 1 << 8,
		1<<16 - 1, 1 << 16,
		1<<24 - 1, 1 << 24,
		1<<32 - 1, 1 << 32,
		1<<40 - 1, 1 << 40,
		1<<48 - 1, 1 << 48,
		1<<56 - 1, 1 << 56,
		math.MaxUint64 - 1, math.MaxUint64,
	}

	var lastEnc []byte
	for i, v := range testCases {
		enc := encFunc(nil, v)
		if i > 0 {
			if (descending && bytes.Compare(enc, lastEnc) >= 0) ||
				(!descending && bytes.Compare(enc, lastEnc) < 0) {
				t.Errorf("ordered constraint violated for %d: [% x] vs. [% x]", v, enc, lastEnc)
			}
		}
		b, decode, err := decFunc(enc)
		if err != nil {
			t.Error(err)
			continue
		}
		if len(b) != 0 {
			t.Errorf("leftover bytes: [% x]", b)
		}
		if decode != v {
			t.Errorf("decode yielded different value than input: %d vs. %d", decode, v)
		}
		lastEnc = enc
	}
}

func testCustomEncodeUint64(
	testCases []testCaseUint64, encFunc func([]byte, uint64) []byte, t *testing.T,
) {
	for _, test := range testCases {
		enc := encFunc(nil, test.value)
		if !bytes.Equal(enc, test.expEnc) {
			t.Errorf("expected [% x]; got [% x] (value: %d)", test.expEnc, enc, test.value)
		}
	}
}
