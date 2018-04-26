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

package analysis

import (
	"reflect"
	"testing"
)

func TestDeleteRune(t *testing.T) {
	tests := []struct {
		in     []rune
		delPos int
		out    []rune
	}{
		{
			in:     []rune{'a', 'b', 'c'},
			delPos: 1,
			out:    []rune{'a', 'c'},
		},
	}

	for _, test := range tests {
		actual := DeleteRune(test.in, test.delPos)
		if !reflect.DeepEqual(actual, test.out) {
			t.Errorf("expected %#v, got %#v", test.out, actual)
		}
	}
}

func TestInsertRune(t *testing.T) {
	tests := []struct {
		in      []rune
		insPos  int
		insRune rune
		out     []rune
	}{
		{
			in:      []rune{'a', 'b', 'c'},
			insPos:  1,
			insRune: 'x',
			out:     []rune{'a', 'x', 'b', 'c'},
		},
		{
			in:      []rune{'a', 'b', 'c'},
			insPos:  0,
			insRune: 'x',
			out:     []rune{'x', 'a', 'b', 'c'},
		},
		{
			in:      []rune{'a', 'b', 'c'},
			insPos:  3,
			insRune: 'x',
			out:     []rune{'a', 'b', 'c', 'x'},
		},
	}

	for _, test := range tests {
		actual := InsertRune(test.in, test.insPos, test.insRune)
		if !reflect.DeepEqual(actual, test.out) {
			t.Errorf("expected %#v, got %#v", test.out, actual)
		}
	}
}

func TestBuildTermFromRunes(t *testing.T) {
	tests := []struct {
		in []rune
	}{
		{
			in: []rune{'a', 'b', 'c'},
		},
		{
			in: []rune{'こ', 'ん', 'に', 'ち', 'は', '世', '界'},
		},
	}
	for _, test := range tests {
		out := BuildTermFromRunes(test.in)
		back := []rune(string(out))
		if !reflect.DeepEqual(back, test.in) {
			t.Errorf("expected %v to convert back to %v", out, test.in)
		}
	}
}

func TestBuildTermFromRunesOptimistic(t *testing.T) {
	tests := []struct {
		buf []byte
		in  []rune
	}{
		{
			buf: []byte("abc"),
			in:  []rune{'a', 'b', 'c'},
		},
		{
			buf: []byte("こんにちは世界"),
			in:  []rune{'こ', 'ん', 'に', 'ち', 'は', '世', '界'},
		},
		// same, but don't give enough buffer
		{
			buf: []byte("ab"),
			in:  []rune{'a', 'b', 'c'},
		},
		{
			buf: []byte("こ"),
			in:  []rune{'こ', 'ん', 'に', 'ち', 'は', '世', '界'},
		},
	}
	for _, test := range tests {
		out := BuildTermFromRunesOptimistic(test.buf, test.in)
		back := []rune(string(out))
		if !reflect.DeepEqual(back, test.in) {
			t.Errorf("expected %v to convert back to %v", out, test.in)
		}
	}
}

func BenchmarkBuildTermFromRunes(b *testing.B) {
	input := [][]rune{
		{'a', 'b', 'c'},
		{'こ', 'ん', 'に', 'ち', 'は', '世', '界'},
	}
	for i := 0; i < b.N; i++ {
		for _, i := range input {
			BuildTermFromRunes(i)
		}
	}
}
