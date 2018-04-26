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

package in

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestIndicNormalizeFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// basics
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अाॅअाॅ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ऑऑ"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अाॆअाॆ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ऒऒ"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अाेअाे"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ओओ"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अाैअाै"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("औऔ"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अाअा"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आआ"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अाैर"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("और"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ত্‍"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ৎ"),
				},
			},
		},
		// empty term
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

	indicNormalizeFilter := NewIndicNormalizeFilter()
	for _, test := range tests {
		actual := indicNormalizeFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x for % x", test.output[0].Term, actual[0].Term, test.input[0].Term)
			t.Errorf("expected %s, got %s for %s", test.output[0].Term, actual[0].Term, test.input[0].Term)
		}
	}
}
