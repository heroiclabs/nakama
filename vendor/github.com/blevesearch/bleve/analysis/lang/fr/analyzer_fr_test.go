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

package fr

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestFrenchAnalyzer(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		{
			input:  []byte(""),
			output: analysis.TokenStream{},
		},
		{
			input: []byte("chien chat cheval"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chien"),
				},
				&analysis.Token{
					Term: []byte("chat"),
				},
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		{
			input: []byte("chien CHAT CHEVAL"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chien"),
				},
				&analysis.Token{
					Term: []byte("chat"),
				},
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		{
			input: []byte("  chien  ,? + = -  CHAT /: > CHEVAL"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chien"),
				},
				&analysis.Token{
					Term: []byte("chat"),
				},
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		{
			input: []byte("chien++"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chien"),
				},
			},
		},
		{
			input: []byte("mot \"entreguillemet\""),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("mot"),
				},
				&analysis.Token{
					Term: []byte("entreguilemet"),
				},
			},
		},
		{
			input: []byte("Jean-François"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("jean"),
				},
				&analysis.Token{
					Term: []byte("francoi"),
				},
			},
		},
		// stop words
		{
			input: []byte("le la chien les aux chat du des à cheval"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chien"),
				},
				&analysis.Token{
					Term: []byte("chat"),
				},
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		// nouns and adjectives
		{
			input: []byte("lances chismes habitable chiste éléments captifs"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("lanc"),
				},
				&analysis.Token{
					Term: []byte("chism"),
				},
				&analysis.Token{
					Term: []byte("habitabl"),
				},
				&analysis.Token{
					Term: []byte("chist"),
				},
				&analysis.Token{
					Term: []byte("element"),
				},
				&analysis.Token{
					Term: []byte("captif"),
				},
			},
		},
		// verbs
		{
			input: []byte("finissions souffrirent rugissante"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("finision"),
				},
				&analysis.Token{
					Term: []byte("soufrirent"),
				},
				&analysis.Token{
					Term: []byte("rugisant"),
				},
			},
		},
		{
			input: []byte("C3PO aujourd'hui oeuf ïâöûàä anticonstitutionnellement Java++ "),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("c3po"),
				},
				&analysis.Token{
					Term: []byte("aujourd'hui"),
				},
				&analysis.Token{
					Term: []byte("oeuf"),
				},
				&analysis.Token{
					Term: []byte("ïaöuaä"),
				},
				&analysis.Token{
					Term: []byte("anticonstitutionel"),
				},
				&analysis.Token{
					Term: []byte("java"),
				},
			},
		},
		{
			input: []byte("propriétaire"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("proprietair"),
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
