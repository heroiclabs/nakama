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

package ar

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestArabicNormalizeFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// AlifMadda
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("آجن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("اجن"),
				},
			},
		},
		// AlifHamzaAbove
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("أحمد"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("احمد"),
				},
			},
		},
		// AlifHamzaBelow
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("إعاذ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("اعاذ"),
				},
			},
		},
		// AlifMaksura
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بنى"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بني"),
				},
			},
		},
		// TehMarbuta
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("فاطمة"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("فاطمه"),
				},
			},
		},
		// Tatweel
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("روبرـــــت"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("روبرت"),
				},
			},
		},
		// Fatha
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("مَبنا"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("مبنا"),
				},
			},
		},
		// Kasra
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("علِي"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("علي"),
				},
			},
		},
		// Damma
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بُوات"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بوات"),
				},
			},
		},
		// Fathatan
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ولداً"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ولدا"),
				},
			},
		},
		// Kasratan
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ولدٍ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ولد"),
				},
			},
		},
		// Dammatan
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ولدٌ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ولد"),
				},
			},
		},
		// Sukun
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("نلْسون"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("نلسون"),
				},
			},
		},
		// Shaddah
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("هتميّ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("هتمي"),
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

	arabicNormalizeFilter := NewArabicNormalizeFilter()
	for _, test := range tests {
		actual := arabicNormalizeFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x", test.output[0].Term, actual[0].Term)
		}
	}
}
