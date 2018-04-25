//  Copyright (c) 2015 Couchbase, Inc.
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

func TestFrenchMinimalStemmer(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chevaux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("cheval"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("hiboux"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("hibou"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chantés"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chanter"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chante"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("chant"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baronnes"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("barons"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("baron"),
				},
			},
		},
	}

	cache := registry.NewCache()
	filter, err := cache.TokenFilterNamed(MinimalStemmerName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := filter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output[0].Term, actual[0].Term)
		}
	}
}
