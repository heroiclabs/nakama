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
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied.  See the License for the specific language governing
// permissions and limitations under the License.

package zap

import (
	"fmt"
	"testing"

	"github.com/couchbase/vellum"
)

type enumTestEntry struct {
	key string
	val uint64
}

type enumTestWant struct {
	key string
	idx int
	val uint64
}

func TestEnumerator(t *testing.T) {
	tests := []struct {
		desc string
		in   [][]enumTestEntry
		want []enumTestWant
	}{
		{
			desc: "two non-empty enumerators with no duplicate keys",
			in: [][]enumTestEntry{
				[]enumTestEntry{
					{"a", 1},
					{"c", 3},
					{"e", 5},
				},
				[]enumTestEntry{
					{"b", 2},
					{"d", 4},
					{"f", 6},
				},
			},
			want: []enumTestWant{
				{"a", 0, 1},
				{"b", 1, 2},
				{"c", 0, 3},
				{"d", 1, 4},
				{"e", 0, 5},
				{"f", 1, 6},
			},
		},
		{
			desc: "two non-empty enumerators with duplicate keys",
			in: [][]enumTestEntry{
				[]enumTestEntry{
					{"a", 1},
					{"c", 3},
					{"e", 5},
				},
				[]enumTestEntry{
					{"a", 2},
					{"c", 4},
					{"e", 6},
				},
			},
			want: []enumTestWant{
				{"a", 0, 1},
				{"a", 1, 2},
				{"c", 0, 3},
				{"c", 1, 4},
				{"e", 0, 5},
				{"e", 1, 6},
			},
		},
		{
			desc: "first iterator is empty",
			in: [][]enumTestEntry{
				[]enumTestEntry{},
				[]enumTestEntry{
					{"a", 2},
					{"c", 4},
					{"e", 6},
				},
			},
			want: []enumTestWant{
				{"a", 1, 2},
				{"c", 1, 4},
				{"e", 1, 6},
			},
		},
		{
			desc: "last iterator is empty",
			in: [][]enumTestEntry{
				[]enumTestEntry{
					{"a", 1},
					{"c", 3},
					{"e", 5},
				},
				[]enumTestEntry{},
			},
			want: []enumTestWant{
				{"a", 0, 1},
				{"c", 0, 3},
				{"e", 0, 5},
			},
		},
		{
			desc: "two different length enumerators with duplicate keys",
			in: [][]enumTestEntry{
				[]enumTestEntry{
					{"a", 1},
					{"c", 3},
					{"e", 5},
				},
				[]enumTestEntry{
					{"a", 2},
					{"b", 4},
					{"d", 1000},
					{"e", 6},
				},
			},
			want: []enumTestWant{
				{"a", 0, 1},
				{"a", 1, 2},
				{"b", 1, 4},
				{"c", 0, 3},
				{"d", 1, 1000},
				{"e", 0, 5},
				{"e", 1, 6},
			},
		},
	}

	for _, test := range tests {
		var itrs []vellum.Iterator
		for _, entries := range test.in {
			itrs = append(itrs, &testIterator{entries: entries})
		}

		enumerator, err := newEnumerator(itrs)
		if err != nil {
			t.Fatalf("%s - expected no err on newNumerator, got: %v", test.desc, err)
		}

		wanti := 0
		for wanti < len(test.want) {
			if err != nil {
				t.Fatalf("%s - wanted no err, got: %v", test.desc, err)
			}

			currK, currIdx, currV := enumerator.Current()

			want := test.want[wanti]
			if want.key != string(currK) {
				t.Fatalf("%s - wrong key, wanted: %#v, got: %q, %d, %d", test.desc,
					want, currK, currIdx, currV)
			}
			if want.idx != currIdx {
				t.Fatalf("%s - wrong idx, wanted: %#v, got: %q, %d, %d", test.desc,
					want, currK, currIdx, currV)
			}
			if want.val != currV {
				t.Fatalf("%s - wrong val, wanted: %#v, got: %q, %d, %d", test.desc,
					want, currK, currIdx, currV)
			}

			wanti += 1

			err = enumerator.Next()
		}

		if err != vellum.ErrIteratorDone {
			t.Fatalf("%s - expected ErrIteratorDone, got: %v", test.desc, err)
		}

		err = enumerator.Close()
		if err != nil {
			t.Fatalf("%s - expected nil err on close, got: %v", test.desc, err)
		}

		for _, itr := range itrs {
			if itr.(*testIterator).curr != 654321 {
				t.Fatalf("%s - expected child iter to be closed", test.desc)
			}
		}
	}
}

type testIterator struct {
	entries []enumTestEntry
	curr    int
}

func (m *testIterator) Current() ([]byte, uint64) {
	if m.curr >= len(m.entries) {
		return nil, 0
	}
	return []byte(m.entries[m.curr].key), m.entries[m.curr].val
}

func (m *testIterator) Next() error {
	m.curr++
	if m.curr >= len(m.entries) {
		return vellum.ErrIteratorDone
	}
	return nil
}

func (m *testIterator) Seek(key []byte) error {
	return fmt.Errorf("not implemented for enumerator unit tests")
}

func (m *testIterator) Reset(f *vellum.FST,
	startKeyInclusive, endKeyExclusive []byte, aut vellum.Automaton) error {
	return fmt.Errorf("not implemented for enumerator unit tests")
}

func (m *testIterator) Close() error {
	m.curr = 654321
	return nil
}
