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

package tr

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestTurkishAnalyzer(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// stemming
		{
			input: []byte("ağacı"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ağaç"),
				},
			},
		},
		{
			input: []byte("ağaç"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ağaç"),
				},
			},
		},
		// stop word
		{
			input:  []byte("dolayı"),
			output: analysis.TokenStream{},
		},
		// apostrophes
		{
			input: []byte("Kıbrıs'ta"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("kıbrıs"),
				},
			},
		},
		{
			input: []byte("Van Gölü'ne"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("van"),
				},
				&analysis.Token{
					Term: []byte("göl"),
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
