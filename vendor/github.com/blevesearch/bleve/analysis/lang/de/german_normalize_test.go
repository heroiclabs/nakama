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

package de

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestGermanNormalizeFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// Tests that a/o/u + e is equivalent to the umlaut form
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Schaltflächen"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Schaltflachen"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Schaltflaechen"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Schaltflachen"),
				},
			},
		},
		// Tests the specific heuristic that ue is not folded after a vowel or q.
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("dauer"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("dauer"),
				},
			},
		},
		// Tests german specific folding of sharp-s
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("weißbier"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("weissbier"),
				},
			},
		},
		// empty
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
	}

	germanNormalizeFilter := NewGermanNormalizeFilter()
	for _, test := range tests {
		actual := germanNormalizeFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected %s(% x), got %s(% x)", test.output[0].Term, test.output[0].Term, actual[0].Term, actual[0].Term)
		}
	}
}
