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

package fa

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestPersianNormalizeFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// FarsiYeh
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("های"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("هاي"),
				},
			},
		},
		// YehBarree
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("هاے"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("هاي"),
				},
			},
		},
		// Keheh
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("کشاندن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("كشاندن"),
				},
			},
		},
		// HehYeh
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("كتابۀ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("كتابه"),
				},
			},
		},
		// HehHamzaAbove
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("كتابهٔ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("كتابه"),
				},
			},
		},
		// HehGoal
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("زادہ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("زاده"),
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

	persianNormalizeFilter := NewPersianNormalizeFilter()
	for _, test := range tests {
		actual := persianNormalizeFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x", test.output[0].Term, actual[0].Term)
		}
	}
}
