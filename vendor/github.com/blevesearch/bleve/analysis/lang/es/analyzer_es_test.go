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

package es

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestSpanishAnalyzer(t *testing.T) {
	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		// stemming
		{
			input: []byte("chicana"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("chican"),
					Position: 1,
					Start:    0,
					End:      7,
				},
			},
		},
		{
			input: []byte("chicano"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("chican"),
					Position: 1,
					Start:    0,
					End:      7,
				},
			},
		},
		// added by marty for better coverage
		{
			input: []byte("yeses"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("yes"),
					Position: 1,
					Start:    0,
					End:      5,
				},
			},
		},
		{
			input: []byte("jaeces"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("jaez"),
					Position: 1,
					Start:    0,
					End:      6,
				},
			},
		},
		{
			input: []byte("arcos"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("arc"),
					Position: 1,
					Start:    0,
					End:      5,
				},
			},
		},
		{
			input: []byte("caos"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("caos"),
					Position: 1,
					Start:    0,
					End:      4,
				},
			},
		},
		{
			input: []byte("parecer"),
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("parecer"),
					Position: 1,
					Start:    0,
					End:      7,
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
