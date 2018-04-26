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

package hi

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestHindiStemmerFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// masc noun inflections
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडका"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडके"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडकों"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("गुरु"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("गुर"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("गुरुओं"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("गुर"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("दोस्त"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("दोस्त"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("दोस्तों"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("दोस्त"),
				},
			},
		},
		// feminine noun inflections
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडकी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडकियों"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("लडक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("किताब"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("किताब"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("किताबें"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("किताब"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("किताबों"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("किताब"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आध्यापीका"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आध्यापीक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आध्यापीकाएं"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आध्यापीक"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आध्यापीकाओं"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आध्यापीक"),
				},
			},
		},
		// some verb forms
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खाना"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खा"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खाता"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खा"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खाती"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खा"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खा"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("खा"),
				},
			},
		},
		// exceptions
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("कठिनाइयां"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("कठिन"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("कठिन"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("कठिन"),
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

	hindiStemmerFilter := NewHindiStemmerFilter()
	for _, test := range tests {
		actual := hindiStemmerFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x", test.output[0].Term, actual[0].Term)
		}
	}
}
