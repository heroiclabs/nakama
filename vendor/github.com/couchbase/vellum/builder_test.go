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
	"bufio"
	"io/ioutil"
	"math/rand"
	"os"
	"sort"
	"testing"
)

func init() {
	thousandTestWords, _ = loadWords("data/words-1000.txt")
}

// this simple test case only has a shared final state
// it also tests out of order insert
func TestBuilderSimple(t *testing.T) {
	b, err := New(ioutil.Discard, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	// add our first string
	err = b.Insert([]byte("jul"), 0)
	if err != nil {
		t.Errorf("got error inserting string: %v", err)
	}
	// expect len to be 1
	if b.len != 1 {
		t.Errorf("expected node count to be 1, got %v", b.len)
	}

	// try to add a value out of order (not allowed)
	err = b.Insert([]byte("abc"), 0)
	if err == nil {
		t.Errorf("expected err, got nil")
	}

	// add a second string
	err = b.Insert([]byte("mar"), 0)
	if err != nil {
		t.Errorf("got error inserting string: %v", err)
	}
	// expect len to grow by 1
	if b.len != 2 {
		t.Errorf("expected node count to be 2, got %v", b.len)
	}

	// now close the builder
	err = b.Close()
	if err != nil {
		t.Errorf("got error closing set builder: %v", err)
	}
}

func TestBuilderSharedPrefix(t *testing.T) {
	b, err := New(ioutil.Discard, nil)
	if err != nil {
		t.Fatalf("error creating builder: %v", err)
	}

	// add our first string
	err = b.Insert([]byte("car"), 0)
	if err != nil {
		t.Errorf("got error inserting string: %v", err)
	}
	// expect len to be 1
	if b.len != 1 {
		t.Errorf("expected node count to be 1, got %v", b.len)
	}

	// add a second string
	err = b.Insert([]byte("cat"), 0)
	if err != nil {
		t.Errorf("got error inserting string: %v", err)
	}
	// expect len to be 2
	if b.len != 2 {
		t.Errorf("expected node count to be 2, got %v", b.len)
	}

	// now close the builder
	err = b.Close()
	if err != nil {
		t.Errorf("got error closing set builder: %v", err)
	}
}

func randomValues(list []string) []uint64 {
	rv := make([]uint64, len(list))
	for i := range list {
		rv[i] = uint64(rand.Uint64())
	}
	return rv
}

func insertStrings(b *Builder, list []string, vals []uint64) error {
	for i, item := range list {
		err := b.Insert([]byte(item), vals[i])
		if err != nil {
			return err
		}
	}
	return nil
}

var smallSample = map[string]uint64{
	"mon":   2,
	"tues":  3,
	"thurs": 5,
	"tye":   99,
}

func insertStringMap(b *Builder, m map[string]uint64) error {
	// make list of keys
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// sort it
	sort.Strings(keys)
	// insert in sorted order
	for _, k := range keys {
		err := b.Insert([]byte(k), m[k])
		if err != nil {
			return err
		}
	}
	return nil
}

func TestBuilderNodeEquiv(t *testing.T) {
	tests := []struct {
		desc string
		a    *builderNode
		b    *builderNode
		want bool
	}{
		{
			"both states final",
			&builderNode{
				final: true,
			},
			&builderNode{
				final: true,
			},
			true,
		},
		{
			"both states final, different final val",
			&builderNode{
				final:       true,
				finalOutput: 7,
			},
			&builderNode{
				final:       true,
				finalOutput: 9,
			},
			false,
		},
		{
			"both states final, same transitions, but different trans val",
			&builderNode{
				final: true,
				trans: []transition{
					{in: 'a', out: 7},
				},
			},
			&builderNode{
				final: true,
				trans: []transition{
					{in: 'a', out: 9},
				},
			},
			false,
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			got := test.a.equiv(test.b)
			if got != test.want {
				t.Errorf("wanted: %t, got: %t", test.want, got)
			}
		})
	}
}

func loadWords(path string) ([]string, error) {
	var rv []string

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		word := append([]byte(nil), scanner.Bytes()...)
		rv = append(rv, string(word))
		if err != nil {
			return nil, err
		}
	}

	if err = scanner.Err(); err != nil {
		return nil, err
	}

	err = file.Close()
	if err != nil {
		return nil, err
	}

	return rv, nil
}

var thousandTestWords []string

func BenchmarkBuilder(b *testing.B) {
	dataset := thousandTestWords
	randomThousandVals := randomValues(dataset)

	b.ResetTimer()

	for i := 0; i < b.N; i++ {

		builder, err := New(ioutil.Discard, nil)
		if err != nil {
			b.Fatalf("error creating builder: %v", err)
		}
		err = insertStrings(builder, dataset, randomThousandVals)
		if err != nil {
			b.Fatalf("error inserting thousand words: %v", err)
		}
		err = builder.Close()
		if err != nil {
			b.Fatalf("error closing builder: %v", err)
		}
	}
}
