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

package ckb

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestSoraniNormalizeFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// test Y
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u064A"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06CC"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0649"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06CC"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06CC"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06CC"),
				},
			},
		},
		// test K
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0643"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06A9"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06A9"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06A9"),
				},
			},
		},
		// test H
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0647\u200C"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06D5"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0647\u200C\u06A9"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06D5\u06A9"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06BE"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0647"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0629"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u06D5"),
				},
			},
		},
		// test final H
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0647\u0647\u0647"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0647\u0647\u06D5"),
				},
			},
		},
		// test RR
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0692"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0695"),
				},
			},
		},
		// test initial RR
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0631\u0631\u0631"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0695\u0631\u0631"),
				},
			},
		},
		// test remove
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0640"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u064B"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u064C"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u064D"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u064E"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u064F"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0650"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0651"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0652"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u200C"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte(""),
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

	soraniNormalizeFilter := NewSoraniNormalizeFilter()
	for _, test := range tests {
		actual := soraniNormalizeFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x", test.output[0].Term, actual[0].Term)
		}
	}
}
