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

func TestHindiNormalizeFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		// basics
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अँगरेज़ी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अँगरेजी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अँग्रेज़ी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अँग्रेजी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेज़ी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंग्रेज़ी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंग्रेजी"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अंगरेजि"),
				},
			},
		},
		// test decompositions
		// removing nukta dot
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("क़िताब"),
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
					Term: []byte("फ़र्ज़"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("फरज"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("क़र्ज़"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("करज"),
				},
			},
		},
		// some other composed nukta forms
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ऱऴख़ग़ड़ढ़य़"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("रळखगडढय"),
				},
			},
		},
		// removal of format (ZWJ/ZWNJ)
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("शार्‍मा"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("शारमा"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("शार्‌मा"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("शारमा"),
				},
			},
		},
		// removal of chandra
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ॅॆॉॊऍऎऑऒ\u0972"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ेेोोएएओओअ"),
				},
			},
		},
		// vowel shortening
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("आईऊॠॡऐऔीूॄॣैौ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("अइउऋऌएओिुृॢेो"),
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

	hindiNormalizeFilter := NewHindiNormalizeFilter()
	for _, test := range tests {
		actual := hindiNormalizeFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %#v, got %#v", test.output, actual)
			t.Errorf("expected % x, got % x", test.output[0].Term, actual[0].Term)
		}
	}
}
