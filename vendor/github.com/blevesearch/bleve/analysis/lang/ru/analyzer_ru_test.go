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

package ru

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestRussianAnalyzer(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// stemming
		{
			input: []byte("километрах"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("километр"),
				},
			},
		},
		{
			input: []byte("актеров"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("актер"),
				},
			},
		},
		// stop word
		{
			input:  []byte("как"),
			output: analysis.TokenStream{},
		},
		// digits safe
		{
			input: []byte("text 1000"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("text"),
				},
				&analysis.Token{
					Term: []byte("1000"),
				},
			},
		},
		{
			input: []byte("Вместе с тем о силе электромагнитной энергии имели представление еще"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("вмест"),
				},
				&analysis.Token{
					Term: []byte("сил"),
				},
				&analysis.Token{
					Term: []byte("электромагнитн"),
				},
				&analysis.Token{
					Term: []byte("энерг"),
				},
				&analysis.Token{
					Term: []byte("имел"),
				},
				&analysis.Token{
					Term: []byte("представлен"),
				},
			},
		},
		{
			input: []byte("Но знание это хранилось в тайне"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("знан"),
				},
				&analysis.Token{
					Term: []byte("эт"),
				},
				&analysis.Token{
					Term: []byte("хран"),
				},
				&analysis.Token{
					Term: []byte("тайн"),
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
