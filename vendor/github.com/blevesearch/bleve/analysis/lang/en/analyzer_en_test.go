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

package en

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestEnglishAnalyzer(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// stemming
		{
			input: []byte("books"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("book"),
					Position: 1,
					Start:    0,
					End:      5,
				},
			},
		},
		{
			input: []byte("book"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("book"),
					Position: 1,
					Start:    0,
					End:      4,
				},
			},
		},
		// stop word removal
		{
			input:  []byte("the"),
			output: analysis.TokenStream{},
		},
		// possessive removal
		{
			input: []byte("steven's"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("steven"),
					Position: 1,
					Start:    0,
					End:      8,
				},
			},
		},
		{
			input: []byte("steven\u2019s"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("steven"),
					Position: 1,
					Start:    0,
					End:      10,
				},
			},
		},
		{
			input: []byte("steven\uFF07s"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("steven"),
					Position: 1,
					Start:    0,
					End:      10,
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
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %v, got %v", test.output, actual)
		}
	}
}
