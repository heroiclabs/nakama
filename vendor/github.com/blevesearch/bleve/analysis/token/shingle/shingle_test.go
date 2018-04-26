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

package shingle

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestShingleFilter(t *testing.T) {

	tests := []struct {
		min            int
		max            int
		outputOriginal bool
		separator      string
		filler         string
		input          analysis.TokenStream
		output         analysis.TokenStream
	}{
		{
			min:            2,
			max:            2,
			outputOriginal: false,
			separator:      " ",
			filler:         "_",
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the"),
				},
				&analysis.Token{
					Term: []byte("quick"),
				},
				&analysis.Token{
					Term: []byte("brown"),
				},
				&analysis.Token{
					Term: []byte("fox"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the quick"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("quick brown"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("brown fox"),
					Type: analysis.Shingle,
				},
			},
		},
		{
			min:            3,
			max:            3,
			outputOriginal: false,
			separator:      " ",
			filler:         "_",
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the"),
				},
				&analysis.Token{
					Term: []byte("quick"),
				},
				&analysis.Token{
					Term: []byte("brown"),
				},
				&analysis.Token{
					Term: []byte("fox"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the quick brown"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("quick brown fox"),
					Type: analysis.Shingle,
				},
			},
		},
		{
			min:            2,
			max:            3,
			outputOriginal: false,
			separator:      " ",
			filler:         "_",
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the"),
				},
				&analysis.Token{
					Term: []byte("quick"),
				},
				&analysis.Token{
					Term: []byte("brown"),
				},
				&analysis.Token{
					Term: []byte("fox"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the quick"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("quick brown"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("the quick brown"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("brown fox"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("quick brown fox"),
					Type: analysis.Shingle,
				},
			},
		},
		{
			min:            3,
			max:            3,
			outputOriginal: false,
			separator:      " ",
			filler:         "_",
			input: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("ugly"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("quick"),
					Position: 3,
				},
				&analysis.Token{
					Term:     []byte("brown"),
					Position: 4,
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("ugly _ quick"),
					Type:     analysis.Shingle,
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("_ quick brown"),
					Type:     analysis.Shingle,
					Position: 3,
				},
			},
		},
		{
			min:            1,
			max:            5,
			outputOriginal: false,
			separator:      " ",
			filler:         "_",
			input: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("test"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("text"),
					Position: 2,
				},
				// token 3 removed by stop filter
				&analysis.Token{
					Term:     []byte("see"),
					Position: 4,
				},
				&analysis.Token{
					Term:     []byte("shingles"),
					Position: 5,
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("test"),
					Type:     analysis.Shingle,
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("text"),
					Type:     analysis.Shingle,
					Position: 2,
				},
				&analysis.Token{
					Term:     []byte("test text"),
					Type:     analysis.Shingle,
					Position: 1,
				},
				&analysis.Token{
					Term: []byte("_"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term:     []byte("text _"),
					Type:     analysis.Shingle,
					Position: 2,
				},
				&analysis.Token{
					Term:     []byte("test text _"),
					Type:     analysis.Shingle,
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("see"),
					Type:     analysis.Shingle,
					Position: 4,
				},
				&analysis.Token{
					Term:     []byte("_ see"),
					Type:     analysis.Shingle,
					Position: 4,
				},
				&analysis.Token{
					Term:     []byte("text _ see"),
					Type:     analysis.Shingle,
					Position: 2,
				},
				&analysis.Token{
					Term:     []byte("test text _ see"),
					Type:     analysis.Shingle,
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("shingles"),
					Type:     analysis.Shingle,
					Position: 5,
				},
				&analysis.Token{
					Term:     []byte("see shingles"),
					Type:     analysis.Shingle,
					Position: 4,
				},
				&analysis.Token{
					Term:     []byte("_ see shingles"),
					Type:     analysis.Shingle,
					Position: 4,
				},
				&analysis.Token{
					Term:     []byte("text _ see shingles"),
					Type:     analysis.Shingle,
					Position: 2,
				},
				&analysis.Token{
					Term:     []byte("test text _ see shingles"),
					Type:     analysis.Shingle,
					Position: 1,
				},
			},
		},
		{
			min:            2,
			max:            2,
			outputOriginal: true,
			separator:      " ",
			filler:         "_",
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the"),
				},
				&analysis.Token{
					Term: []byte("quick"),
				},
				&analysis.Token{
					Term: []byte("brown"),
				},
				&analysis.Token{
					Term: []byte("fox"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the"),
				},
				&analysis.Token{
					Term: []byte("quick"),
				},
				&analysis.Token{
					Term: []byte("the quick"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("brown"),
				},
				&analysis.Token{
					Term: []byte("quick brown"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("fox"),
				},
				&analysis.Token{
					Term: []byte("brown fox"),
					Type: analysis.Shingle,
				},
			},
		},
	}

	for _, test := range tests {
		shingleFilter := NewShingleFilter(test.min, test.max, test.outputOriginal, test.separator, test.filler)
		actual := shingleFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output, actual)
		}
	}
}

// TestShingleFilterBug431 tests that the shingle filter is in fact stateless
// by making using the same filter instance twice and ensuring we do not get
// contaminated output
func TestShingleFilterBug431(t *testing.T) {

	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the"),
				},
				&analysis.Token{
					Term: []byte("quick"),
				},
				&analysis.Token{
					Term: []byte("brown"),
				},
				&analysis.Token{
					Term: []byte("fox"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("the quick"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("quick brown"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("brown fox"),
					Type: analysis.Shingle,
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("sad"),
				},
				&analysis.Token{
					Term: []byte("dirty"),
				},
				&analysis.Token{
					Term: []byte("sock"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a sad"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("sad dirty"),
					Type: analysis.Shingle,
				},
				&analysis.Token{
					Term: []byte("dirty sock"),
					Type: analysis.Shingle,
				},
			},
		},
	}

	shingleFilter := NewShingleFilter(2, 2, false, " ", "_")
	for _, test := range tests {
		actual := shingleFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output, actual)
		}
	}

}
