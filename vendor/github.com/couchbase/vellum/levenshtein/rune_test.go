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

import "testing"

func TestDynamicLevenshtein(t *testing.T) {

	tests := []struct {
		desc     string
		query    string
		distance uint
		seq      []rune
		isMatch  bool
		canMatch bool
	}{
		{
			desc:     "cat/0 - c a t",
			query:    "cat",
			distance: 0,
			seq:      []rune{'c', 'a', 't'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/1 - c a",
			query:    "cat",
			distance: 1,
			seq:      []rune{'c', 'a'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/1 - c a t s",
			query:    "cat",
			distance: 1,
			seq:      []rune{'c', 'a', 't', 's'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cat/0 - c a",
			query:    "cat",
			distance: 0,
			seq:      []rune{'c', 'a'},
			isMatch:  false,
			canMatch: true,
		},
		{
			desc:     "cat/0 - c a t s",
			query:    "cat",
			distance: 0,
			seq:      []rune{'c', 'a', 't', 's'},
			isMatch:  false,
			canMatch: false,
		},
	}

	for _, test := range tests {
		t.Run(test.desc, func(t *testing.T) {
			dl := &dynamicLevenshtein{
				query:    test.query,
				distance: test.distance,
			}

			s := dl.start()
			for _, c := range test.seq {
				s = dl.accept(s, &c)
			}

			isMatch := dl.isMatch(s)
			if isMatch != test.isMatch {
				t.Errorf("expected isMatch %t, got %t", test.isMatch, isMatch)
			}

			canMatch := dl.canMatch(s)
			if canMatch != test.canMatch {
				t.Errorf("expectec canMatch %t, got %t", test.canMatch, canMatch)
			}
		})
	}
}
