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

	"github.com/couchbase/vellum/levenshtein"
)

func BenchmarkNewEvalEditDistance1(b *testing.B) {
	lb, _ := NewLevenshteinAutomatonBuilder(1, true)

	query := "coucibase"
	for i := 0; i < b.N; i++ {
		dfa, _ := lb.BuildDfa("couchbase", 1)
		ed := dfa.eval([]byte(query))
		if ed.distance() != 1 {
			b.Errorf("expected distance 1, actual: %d", ed.distance())
		}

	}
}

func BenchmarkNewEvalEditDistance2(b *testing.B) {
	lb, _ := NewLevenshteinAutomatonBuilder(2, false)

	query := "couchbasefts"
	for i := 0; i < b.N; i++ {
		dfa, _ := lb.BuildDfa("couchbases", 2)
		ed := dfa.eval([]byte(query))
		if ed.distance() != 2 {
			b.Errorf("expected distance 2, actual: %d", ed.distance())
		}
	}
}

func BenchmarkNewEditDistance1(b *testing.B) {
	lb, _ := NewLevenshteinAutomatonBuilder(1, true)

	query := "coucibase"
	for i := 0; i < b.N; i++ {
		dfa, _ := lb.BuildDfa("couchbase", 1)

		state := dfa.initialState()
		for _, b := range []byte(query) {
			state = dfa.transition(state, b)
		}

		if !dfa.IsMatch(state) {
			b.Errorf("expected isMatch %t, got %t", true, !dfa.IsMatch(state))
		}

	}
}

func BenchmarkNewEditDistance2(b *testing.B) {
	lb, _ := NewLevenshteinAutomatonBuilder(2, false)

	query := "couchbasefts"
	for i := 0; i < b.N; i++ {
		dfa, _ := lb.BuildDfa("couchbases", 2)

		state := dfa.initialState()
		for _, b := range []byte(query) {
			state = dfa.transition(state, b)
		}

		if !dfa.IsMatch(state) {
			b.Errorf("expected isMatch %t, got %t", true, !dfa.IsMatch(state))
		}
	}
}

func BenchmarkOlderEditDistance1(b *testing.B) {
	query := "coucibase"
	for i := 0; i < b.N; i++ {
		l, _ := levenshtein.New("couchbase", 1)

		s := l.Start()
		for _, b := range []byte(query) {
			s = l.Accept(s, b)
		}

		if !l.IsMatch(s) {
			b.Errorf("expected isMatch %t, got %t", true, l.IsMatch(s))
		}
	}
}

func BenchmarkOlderEditDistance2(b *testing.B) {
	query := "couchbasefts"
	for i := 0; i < b.N; i++ {
		l, _ := levenshtein.New("couchbases", 2)

		s := l.Start()
		for _, b := range []byte(query) {
			s = l.Accept(s, b)
		}

		if !l.IsMatch(s) {
			b.Errorf("expected isMatch %t, got %t", true, l.IsMatch(s))
		}
	}
}
