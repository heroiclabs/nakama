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
	"reflect"
	"sort"
	"testing"
)

func TestMergeIterator(t *testing.T) {

	tests := []struct {
		desc  string
		in    []map[string]uint64
		merge MergeFunc
		want  map[string]uint64
	}{
		{
			desc: "two non-empty iterators with no duplicate keys",
			in: []map[string]uint64{
				map[string]uint64{
					"a": 1,
					"c": 3,
					"e": 5,
				},
				map[string]uint64{
					"b": 2,
					"d": 4,
					"f": 6,
				},
			},
			merge: func(mvs []uint64) uint64 {
				return mvs[0]
			},
			want: map[string]uint64{
				"a": 1,
				"c": 3,
				"e": 5,
				"b": 2,
				"d": 4,
				"f": 6,
			},
		},
		{
			desc: "two non-empty iterators with duplicate keys summed",
			in: []map[string]uint64{
				map[string]uint64{
					"a": 1,
					"c": 3,
					"e": 5,
				},
				map[string]uint64{
					"a": 2,
					"c": 4,
					"e": 6,
				},
			},
			merge: func(mvs []uint64) uint64 {
				var rv uint64
				for _, mv := range mvs {
					rv += mv
				}
				return rv
			},
			want: map[string]uint64{
				"a": 3,
				"c": 7,
				"e": 11,
			},
		},

		{
			desc: "non-working example",
			in: []map[string]uint64{
				map[string]uint64{
					"mon":   2,
					"tues":  3,
					"thurs": 5,
					"tye":   99,
				},
				map[string]uint64{
					"bold": 25,
					"last": 1,
					"next": 500,
					"tank": 0,
				},
			},
			merge: func(mvs []uint64) uint64 {
				return mvs[0]
			},
			want: map[string]uint64{
				"mon":   2,
				"tues":  3,
				"thurs": 5,
				"tye":   99,
				"bold":  25,
				"last":  1,
				"next":  500,
				"tank":  0,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			var itrs []Iterator
			for i := range test.in {
				itr, err := newTestIterator(test.in[i])
				if err != nil && err != ErrIteratorDone {
					t.Fatalf("error creating iterator: %v", err)
				}
				if err == nil {
					itrs = append(itrs, itr)
				}
			}
			mi, err := NewMergeIterator(itrs, test.merge)
			if err != nil && err != ErrIteratorDone {
				t.Fatalf("error creating iterator: %v", err)
			}
			got := make(map[string]uint64)
			for err == nil {
				currk, currv := mi.Current()
				err = mi.Next()
				got[string(currk)] = currv
			}
			if err != nil && err != ErrIteratorDone {
				t.Fatalf("error iterating: %v", err)
			}

			if !reflect.DeepEqual(got, test.want) {
				t.Errorf("expected %v, got %v", test.want, got)
			}
		})
	}
}

type testIterator struct {
	vals map[int]uint64
	keys []string
	curr int
}

func newTestIterator(in map[string]uint64) (*testIterator, error) {
	rv := &testIterator{
		vals: make(map[int]uint64, len(in)),
	}
	for k := range in {
		rv.keys = append(rv.keys, k)
	}
	sort.Strings(rv.keys)
	for i, k := range rv.keys {
		rv.vals[i] = in[k]
	}
	return rv, nil
}

func (m *testIterator) Current() ([]byte, uint64) {
	if m.curr >= len(m.keys) {
		return nil, 0
	}
	return []byte(m.keys[m.curr]), m.vals[m.curr]
}

func (m *testIterator) Next() error {
	m.curr++
	if m.curr >= len(m.keys) {
		return ErrIteratorDone
	}
	return nil
}

func (m *testIterator) Seek(key []byte) error {
	m.curr = sort.SearchStrings(m.keys, string(key))
	if m.curr >= len(m.keys) {
		return ErrIteratorDone
	}
	return nil
}

func (m *testIterator) Reset(f *FST, startKeyInclusive, endKeyExclusive []byte, aut Automaton) error {
	return nil
}

func (m *testIterator) Close() error {
	return nil
}

func TestMergeFunc(t *testing.T) {
	tests := []struct {
		desc  string
		in    []uint64
		merge MergeFunc
		want  uint64
	}{
		{
			desc:  "min",
			in:    []uint64{5, 99, 1},
			merge: MergeMin,
			want:  1,
		},
		{
			desc:  "max",
			in:    []uint64{5, 99, 1},
			merge: MergeMax,
			want:  99,
		},
		{
			desc:  "sum",
			in:    []uint64{5, 99, 1},
			merge: MergeSum,
			want:  105,
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			got := test.merge(test.in)
			if test.want != got {
				t.Errorf("expected %d, got %d", test.want, got)
			}
		})
	}
}

func TestEmptyMergeIterator(t *testing.T) {
	mi, err := NewMergeIterator([]Iterator{}, MergeMin)
	if err != ErrIteratorDone {
		t.Fatalf("expected iterator done, got %v", err)
	}

	// should get valid merge iterator anyway
	if mi == nil {
		t.Fatalf("expected non-nil merge iterator")
	}

	// current returns nil, 0 per interface spec
	ck, cv := mi.Current()
	if ck != nil {
		t.Errorf("expected current to return nil key, got %v", ck)
	}
	if cv != 0 {
		t.Errorf("expected current to return 0 val, got %d", cv)
	}

	// calling Next/Seek continues to return ErrIteratorDone
	err = mi.Next()
	if err != ErrIteratorDone {
		t.Errorf("expected iterator done, got %v", err)
	}
	err = mi.Seek([]byte("anywhere"))
	if err != ErrIteratorDone {
		t.Errorf("expected iterator done, got %v", err)
	}

	err = mi.Close()
	if err != nil {
		t.Errorf("error closing %v", err)
	}

}
