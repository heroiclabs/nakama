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

package levenshtein2

import (
	"testing"
)

func TestLevenshtein(t *testing.T) {

	hash := make(map[uint8]LevenshteinAutomatonBuilder, 4)
	for i := 0; i < 3; i++ {
		lb, err := NewLevenshteinAutomatonBuilder(uint8(i), false)
		if err != nil {
			t.Errorf("NewLevenshteinAutomatonBuilder(%d, false) failed, err: %v", i, err)
		}
		hash[uint8(i)] = *lb
	}

	tests := []struct {
		desc     string
		query    string
		distance uint8
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
		{
			desc:     "cate/1 - cate",
			query:    "cate",
			distance: 1,
			seq:      []byte{'c', 'a', 't', 'e'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cater/1 - cate",
			query:    "cater",
			distance: 1,
			seq:      []byte{'c', 'a', 't', 'e'},
			isMatch:  true,
			canMatch: true,
		},
		{
			desc:     "cater/1 - ctr",
			query:    "cater",
			distance: 1,
			seq:      []byte{'c', 't', 'r'},
			isMatch:  false,
			canMatch: false,
		},
		{
			desc:     "catered/2 - cater",
			query:    "catered",
			distance: 2,
			seq:      []byte{'c', 'a', 't', 'e', 'r'},
			isMatch:  true,
			canMatch: true,
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
			l, err := hash[uint8(test.distance)].pDfa.buildDfa(test.query, test.distance, false)
			if err != nil {
				t.Errorf("buildDfa(%s, %d, false) failed, err: %v", test.query,
					test.distance, err)
			}

			s := l.Start()
			for _, b := range test.seq {
				s = l.Accept(s, b)
				if uint32(s) == SinkState {
					break
				}
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

func makeDistance(d uint8, md uint8) Distance {
	if d > md {
		return Atleast{d: md + 1}
	}
	return Exact{d: d}
}

func testLevenshteinNfaUtil(left, right string, ed uint8, t *testing.T) {
	for _, d := range []uint8{0, 1, 2, 3} {
		expectedDistance := makeDistance(ed, uint8(d))
		lev := newLevenshtein(d, false)
		testSymmetric(lev, left, right, expectedDistance, t)
	}
}

func testSymmetric(lev *LevenshteinNFA, left, right string, expected Distance, t *testing.T) {
	levd := lev.computeDistance([]rune(left), []rune(right))
	if levd.distance() != expected.distance() {
		t.Errorf("expected distance: %d, actual: %d", expected.distance(), levd.distance())
	}

	levd = lev.computeDistance([]rune(right), []rune(left))
	if levd.distance() != expected.distance() {
		t.Errorf("expected distance: %d, actual: %d", expected.distance(), levd.distance())
	}
}
func TestLevenshteinNfa(t *testing.T) {
	testLevenshteinNfaUtil("abc", "abc", 0, t)
	testLevenshteinNfaUtil("abc", "abcd", 1, t)
	testLevenshteinNfaUtil("aab", "ab", 1, t)
}

/*func TestDeadState(t *testing.T) {
	nfa := newLevenshtein(2, false)
	pdfa := fromNfa(nfa)
	dfa := pdfa.buildDfa("abcdefghijklmnop", 0, false)
	state := dfa.initialState()
	r := []rune("X")
	state = dfa.transition(state, uint8(r[0]))
	if state != 0 {
		t.Errorf("expected state: 0, actual: %d", state)
	}
	state = dfa.transition(state, uint8(r[0]))
	if state != 0 {
		t.Errorf("expected state: 0, actual: %d", state)
	}
	state = dfa.transition(state, uint8(r[0]))
	if state != 0 {
		t.Errorf("expected state: 0, actual: %d", state)
	}
}*/

func TestLevenshteinParametricDfa(t *testing.T) {
	lev := newLevenshtein(1, true)
	pDfa, err := fromNfa(lev)
	if err != nil {
		t.Errorf("fromNfa err: %v", err)
	}

	testStr := "abc"
	dfa, err := pDfa.buildDfa(testStr, 1, false)
	if err != nil {
		t.Errorf("buildDfa(%s, 1, false) failed, err: %v", testStr, err)
	}

	rd := dfa.eval([]byte("abc"))
	if rd.distance() != 0 {
		t.Errorf("expected distance 0, actual: %d", rd.distance())
	}

	rd = dfa.eval([]byte("ab"))
	if rd.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", rd.distance())
	}

	rd = dfa.eval([]byte("ac"))
	if rd.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", rd.distance())
	}

	rd = dfa.eval([]byte("a"))
	if rd.distance() != 2 {
		t.Errorf("expected distance 2, actual: %d", rd.distance())
	}

	rd = dfa.eval([]byte("abcd"))
	if rd.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", rd.distance())
	}

	rd = dfa.eval([]byte("abdd"))
	if rd.distance() != 2 {
		t.Errorf("expected distance 2, actual: %d", rd.distance())
	}

	testStr = "abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlmnopqrstuvwxyz"

	dfa, err = pDfa.buildDfa(testStr, 1, false)
	if err != nil {
		t.Errorf("buildDfa(%s, 1, false) failed, err: %v", testStr, err)
	}

	sample1 := "abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlnopqrstuvwxyz" +
		"abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlmnopqrstuvwxyz"
	rd = dfa.eval([]byte(sample1))
	if rd.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", rd.distance())
	}

	sample2 := "abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlnopqrstuvwxyz" +
		"abcdefghijlmnopqrstuvwxyz" +
		"abcdefghijlmnoprqstuvwxyz"
	rd = dfa.eval([]byte(sample2))
	if rd.distance() != 2 {
		t.Errorf("expected distance 2, actual: %d", rd.distance())
	}
}

func TestDamerau(t *testing.T) {
	nfa := newLevenshtein(2, true)
	testSymmetric(nfa, "abc", "abc", Exact{d: 0}, t)
	testSymmetric(nfa, "abc", "abcd", Exact{d: 1}, t)
	testSymmetric(nfa, "abcdef", "abddef", Exact{d: 1}, t)
	testSymmetric(nfa, "abcdef", "abdcef", Exact{d: 1}, t)
}

func TestLevenshteinDfa(t *testing.T) {
	nfa := newLevenshtein(2, false)
	pDfa, err := fromNfa(nfa)
	if err != nil {
		t.Errorf("fromNfa failed, err: %v", err)
	}

	dfa, err := pDfa.buildDfa("abcabcaaabc", 2, false)
	if err != nil {
		t.Errorf("buildDfa(abcabcaaabc, 1, false) failed, err: %v", err)
	}

	if dfa.numStates() != 273 {
		t.Errorf("expected number of states: 273, actual: %d", dfa.numStates())
	}
}

func TestUtf8Simple(t *testing.T) {
	nfa := newLevenshtein(1, false)
	pDfa, err := fromNfa(nfa)
	if err != nil {
		t.Errorf("fromNfa failed, err: %v", err)
	}

	dfa, err := pDfa.buildDfa("あ", 1, false)
	if err != nil {
		t.Errorf("buildDfa(あ, 1, false) failed, err: %v", err)
	}

	ed := dfa.eval([]byte("あ"))
	if ed.distance() != 0 {
		t.Errorf("expected distance 0, actual: %d", ed.distance())
	}
}

func TestSimple(t *testing.T) {
	query := "abcdef"
	nfa := newLevenshtein(2, false)
	pDfa, err := fromNfa(nfa)
	if err != nil {
		t.Errorf("fromNfa failed, err: %v", err)
	}

	dfa, err := pDfa.buildDfa(query, 1, false)
	if err != nil {
		t.Errorf("buildDfa(%s, 1, false) failed, err: %v", query, err)
	}

	ed := dfa.eval([]byte(query))
	if ed.distance() != 0 {
		t.Errorf("expected distance 0, actual: %d", ed.distance())
	}

	ed = dfa.eval([]byte("abcdf"))
	if ed.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", ed.distance())
	}
	ed = dfa.eval([]byte("abcdgf"))
	if ed.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", ed.distance())
	}
	ed = dfa.eval([]byte("abccdef"))
	if ed.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", ed.distance())
	}
}

func TestJapanese(t *testing.T) {
	query := "寿司は焦げられない"
	nfa := newLevenshtein(2, false)
	pDfa, err := fromNfa(nfa)
	if err != nil {
		t.Errorf("fromNfa failed, err: %v", err)
	}

	dfa, err := pDfa.buildDfa(query, 2, false)
	if err != nil {
		t.Errorf("buildDfa(%s, 2, false) failed, err: %v", query, err)
	}

	ed := dfa.eval([]byte(query))
	if ed.distance() != 0 {
		t.Errorf("expected distance 0, actual: %d", ed.distance())
	}

	ed = dfa.eval([]byte("寿司は焦げられな"))
	if ed.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", ed.distance())
	}

	ed = dfa.eval([]byte("寿司は焦げられなI"))
	if ed.distance() != 1 {
		t.Errorf("expected distance 1, actual: %d", ed.distance())
	}

	ed = dfa.eval([]byte("寿司は焦られなI"))
	if ed.distance() != 2 {
		t.Errorf("expected distance 2, actual: %d", ed.distance())
	}
}

func TestJapaneseEnglish(t *testing.T) {
	query := "寿a"
	nfa := newLevenshtein(1, false)
	pDfa, err := fromNfa(nfa)
	if err != nil {
		t.Errorf("fromNfa failed, err: %v", err)
	}

	dfa, err := pDfa.buildDfa(query, 1, false)
	if err != nil {
		t.Errorf("buildDfa(%s, 1, false) failed, err: %v", query, err)
	}

	ed := dfa.eval([]byte(query))
	if ed.distance() != 0 {
		t.Errorf("expected distance 0, actual: %d", ed.distance())
	}

	ed = dfa.eval([]byte("a"))
	if ed.distance() != 1 {
		t.Errorf("expected distance 0, actual: %d", ed.distance())
	}
}

func TestTooManyStatesError(t *testing.T) {
	nfa := newLevenshtein(3, true)
	pDfa, err := fromNfa(nfa)
	if err != nil {
		t.Errorf("fromNfa failed, err: %v", err)
	}

	// query of length 139 characters won't generate 10K states as against
	// the current levenshtein limit of query length 50.
	lengthQuery := "1234567890123456789012345678901234567890123456789" + // 50 chars
		"1234567890123456789012345678901234567890123456789" + // 50 chars
		"1234567890123456789012345678901234567890" // 40 chars (total 140)

	_, err = pDfa.buildDfa(lengthQuery, 1, false)
	if err != ErrTooManyStates {
		t.Errorf("buildDfa(%s, 1, false) expected to fail with err: %v",
			lengthQuery, ErrTooManyStates)
	}
}
