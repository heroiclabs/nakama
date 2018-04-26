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

package edgengram

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestEdgeNgramFilter(t *testing.T) {

	tests := []struct {
		side   Side
		min    int
		max    int
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			side: FRONT,
			min:  1,
			max:  1,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a"),
				},
			},
		},
		{
			side: BACK,
			min:  1,
			max:  1,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("e"),
				},
			},
		},
		{
			side: FRONT,
			min:  1,
			max:  3,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("ab"),
				},
				&analysis.Token{
					Term: []byte("abc"),
				},
			},
		},
		{
			side: BACK,
			min:  1,
			max:  3,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("e"),
				},
				&analysis.Token{
					Term: []byte("de"),
				},
				&analysis.Token{
					Term: []byte("cde"),
				},
			},
		},
		{
			side: FRONT,
			min:  1,
			max:  3,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
				&analysis.Token{
					Term: []byte("vwxyz"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("ab"),
				},
				&analysis.Token{
					Term: []byte("abc"),
				},
				&analysis.Token{
					Term: []byte("v"),
				},
				&analysis.Token{
					Term: []byte("vw"),
				},
				&analysis.Token{
					Term: []byte("vwx"),
				},
			},
		},
		{
			side: BACK,
			min:  3,
			max:  5,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Beryl"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ryl"),
				},
				&analysis.Token{
					Term: []byte("eryl"),
				},
				&analysis.Token{
					Term: []byte("Beryl"),
				},
			},
		},
		{
			side: FRONT,
			min:  3,
			max:  5,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Beryl"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Ber"),
				},
				&analysis.Token{
					Term: []byte("Bery"),
				},
				&analysis.Token{
					Term: []byte("Beryl"),
				},
			},
		},
	}

	for _, test := range tests {
		edgeNgramFilter := NewEdgeNgramFilter(test.side, test.min, test.max)
		actual := edgeNgramFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output, actual)
		}
	}
}
