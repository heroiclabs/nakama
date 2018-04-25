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

func TestArabicStemmerFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// AlPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("الحسن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("حسن"),
				},
			},
		},
		// WalPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("والحسن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("حسن"),
				},
			},
		},
		// BalPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("بالحسن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("حسن"),
				},
			},
		},
		// KalPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("كالحسن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("حسن"),
				},
			},
		},
		// FalPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("فالحسن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("حسن"),
				},
			},
		},
		// LlPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("للاخر"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("اخر"),
				},
			},
		},
		// WaPrefix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("وحسن"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("حسن"),
				},
			},
		},
		// AhSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("زوجها"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("زوج"),
				},
			},
		},
		// AnSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدان"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// AtSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدات"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// WnSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدون"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// YnSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدين"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// YhSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهديه"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// YpSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدية"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// HSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهده"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// PSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدة"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// YSuffix
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدي"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// ComboPrefSuf
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("وساهدون"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// ComboSuf
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهدهات"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ساهد"),
				},
			},
		},
		// Shouldn't Stem
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("الو"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("الو"),
				},
			},
		},
		// NonArabic
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("English"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("English"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("سلام"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("سلام"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("السلام"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("سلام"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("سلامة"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("سلام"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("السلامة"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("سلام"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("الوصل"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("وصل"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("والصل"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("صل"),
				},
			},
		},
		// Empty
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

	arabicStemmerFilter := NewArabicStemmerFilter()
	for _, test := range tests {
		actual := arabicStemmerFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x", test.output[0].Term, actual[0].Term)
		}
	}
}
