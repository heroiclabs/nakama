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

package levenshtein

import (
	"testing"
)

func TestLevenshtein(t *testing.T) {

	tests := []struct {
		desc     string
		query    string
		distance int
		seq      []byte
		isMatch  bool
		canMatch bool
	}{
		{
			desc:     "cat/0 - c a t",
			query:    "cat",
			distance: 0,
			seq:      []byte{'c', 'a', 't'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/1 - c a",
			query:    "cat",
			distance: 1,
			seq:      []byte{'c', 'a'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/1 - c a t s",
			query:    "cat",
			distance: 1,
			seq:      []byte{'c', 'a', 't', 's'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/0 - c a",
			query:    "cat",
			distance: 0,
			seq:      []byte{'c', 'a'},
			isMatch:  false,
			canMatch: true,
		},
		{
			desc:     "cat/0 - c a t s",
			query:    "cat",
			distance: 0,
			seq:      []byte{'c', 'a', 't', 's'},
			isMatch:  false,
			canMatch: false,
		},
		// this section contains cases where the sequence
		// of bytes encountered contains utf-8 encoded
		// multi-byte characters, which should count as 1
		// for the purposes of the levenshtein edit distance
		{
			desc:     "cat/0 - c 0xc3 0xa1 t (cát)",
			query:    "cat",
			distance: 0,
			seq:      []byte{'c', 0xc3, 0xa1, 't'},
			isMatch:  false,
			canMatch: false,
		},
		{
			desc:     "cat/1 - c 0xc3 0xa1 t (cát)",
			query:    "cat",
			distance: 1,
			seq:      []byte{'c', 0xc3, 0xa1, 't'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/1 - c 0xc3 0xa1 t (cáts)",
			query:    "cat",
			distance: 1,
			seq:      []byte{'c', 0xc3, 0xa1, 't', 's'},
			isMatch:  false,
			canMatch: false,
		},
		{
			desc:     "cat/1 - 0xc3 0xa1 (á)",
			query:    "cat",
			distance: 1,
			seq:      []byte{0xc3, 0xa1},
			isMatch:  false,
			canMatch: true,
		},
		{
			desc:     "cat/1 - c 0xc3 0xa1 t (ácat)",
			query:    "cat",
			distance: 1,
			seq:      []byte{0xc3, 0xa1, 'c', 'a', 't'},
			isMatch:  true,
			canMatch: true,
		},
		// this section has utf-8 encoded multi-byte characters
		// in the query, which should still just count as 1
		// for the purposes of the levenshtein edit distance
		{
			desc:     "cát/0 - c a t (cat)",
			query:    "cát",
			distance: 0,
			seq:      []byte{'c', 'a', 't'},
			isMatch:  false,
			canMatch: false,
		},
		{
			desc:     "cát/1 - c 0xc3 0xa1 (cá)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'c', 0xc3, 0xa1},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cát/1 - c 0xc3 0xa1 s (cás)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'c', 0xc3, 0xa1, 's'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cát/1 - c 0xc3 0xa1 t a (cáta)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'c', 0xc3, 0xa1, 't', 'a'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cát/1 - d 0xc3 0xa1 (dát)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'d', 0xc3, 0xa1, 't'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cát/1 - c a t (cat)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'c', 'a', 't'},
			isMatch:  true,
			canMatch: true,
		},

		{
			desc:     "cát/1 - c a t (cats)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'c', 'a', 't', 's'},
			isMatch:  false,
			canMatch: false,
		},
		{
			desc:     "cát/1 - 0xc3, 0xa (á)",
			query:    "cát",
			distance: 1,
			seq:      []byte{0xc3, 0xa1},
			isMatch:  false,
			canMatch: true,
		},
		{
			desc:     "cát/1 - a c 0xc3 0xa1 t (acát)",
			query:    "cát",
			distance: 1,
			seq:      []byte{'a', 'c', 0xc3, 0xa1, 't'},
			isMatch:  true,
			canMatch: true,
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			l, err := New(test.query, test.distance)
			if err != nil {
				t.Fatal(err)
			}

			s := l.Start()
			for _, b := range test.seq {
				s = l.Accept(s, b)
			}

			isMatch := l.IsMatch(s)
			if isMatch != test.isMatch {
				t.Errorf("expected isMatch %t, got %t", test.isMatch, isMatch)
			}

			canMatch := l.CanMatch(s)
			if canMatch != test.canMatch {
				t.Errorf("expectec canMatch %t, got %t", test.canMatch, canMatch)
			}
		})
	}
}

func BenchmarkNewMarty1(b *testing.B) {
	for i := 0; i < b.N; i++ {
		New("marty", 1)
	}
}

func BenchmarkNewMarty2(b *testing.B) {
	for i := 0; i < b.N; i++ {
		New("marty", 2)
	}
}
