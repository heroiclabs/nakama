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

package it

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestItalianAnalyzer(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// stemming
		{
			input: []byte("abbandonata"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abbandonat"),
				},
			},
		},
		{
			input: []byte("abbandonati"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abbandonat"),
				},
			},
		},
		// stop word
		{
			input:  []byte("dallo"),
			output: analysis.TokenStream{},
		},
		// contractions
		{
			input: []byte("dell'Italia"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ital"),
				},
			},
		},
		{
			input: []byte("l'Italiano"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("italian"),
				},
			},
		},
		// test for bug #218
		{
			input: []byte("Nell'anfora"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("anfor"),
				},
			},
		},
	}

	cache := registry.NewCache()
	analyzer, err := cache.AnalyzerNamed(AnalyzerName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := analyzer.Analyze(test.input)
		if len(actual) != len(test.output) {
			t.Fatalf("expected length: %d, got %d", len(test.output), len(actual))
		}
		for i, tok := range actual {
			if !reflect.DeepEqual(tok.Term, test.output[i].Term) {
				t.Errorf("expected term %s (% x) got %s (% x)", test.output[i].Term, test.output[i].Term, tok.Term, tok.Term)
			}
		}
	}
}
