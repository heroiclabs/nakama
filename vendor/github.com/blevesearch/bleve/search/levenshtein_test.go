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

package search

import (
	"testing"
)

func TestLevenshteinDistance(t *testing.T) {

	tests := []struct {
		a    string
		b    string
		dist int
	}{
		{
			"water",
			"atec",
			2,
		},
		{
			"water",
			"aphex",
			4,
		},
	}

	for _, test := range tests {
		actual := LevenshteinDistance(test.a, test.b)
		if actual != test.dist {
			t.Errorf("expected %d, got %d for %s and %s", test.dist, actual, test.a, test.b)
		}
	}
}

func TestLevenshteinDistanceMax(t *testing.T) {

	tests := []struct {
		a        string
		b        string
		max      int
		dist     int
		exceeded bool
	}{
		{
			a:        "water",
			b:        "atec",
			max:      1,
			dist:     1,
			exceeded: true,
		},
		{
			a:        "water",
			b:        "christmas",
			max:      3,
			dist:     3,
			exceeded: true,
		},
		{
			a:        "water",
			b:        "water",
			max:      1,
			dist:     0,
			exceeded: false,
		},
	}

	for _, test := range tests {
		actual, exceeded := LevenshteinDistanceMax(test.a, test.b, test.max)
		if actual != test.dist || exceeded != test.exceeded {
			t.Errorf("expected %d %t, got %d %t for %s and %s", test.dist, test.exceeded, actual, exceeded, test.a, test.b)
		}
	}
}

// 5 terms that are less than 2
// 5 terms that are more than 2
var benchmarkTerms = []string{
	"watex",
	"aters",
	"wayer",
	"wbter",
	"yater",
	"christmas",
	"waterwaterwater",
	"watcatdogfish",
	"q",
	"couchbase",
}

func BenchmarkLevenshteinDistance(b *testing.B) {
	a := "water"
	for i := 0; i < b.N; i++ {
		for _, t := range benchmarkTerms {
			LevenshteinDistance(a, t)
		}
	}
}

func BenchmarkLevenshteinDistanceMax(b *testing.B) {
	a := "water"
	for i := 0; i < b.N; i++ {
		for _, t := range benchmarkTerms {
			LevenshteinDistanceMax(a, t, 2)
		}
	}
}
