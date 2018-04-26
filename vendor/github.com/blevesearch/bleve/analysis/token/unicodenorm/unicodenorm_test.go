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

package unicodenorm

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

// the following tests come from the lucene
// test cases for CJK width filter
// which is our basis for using this
// as a substitute for that
func TestUnicodeNormalization(t *testing.T) {

	tests := []struct {
		formName string
		input    analysis.TokenStream
		output   analysis.TokenStream
	}{
		{
			formName: NFKD,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Ｔｅｓｔ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Test"),
				},
			},
		},
		{
			formName: NFKD,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("１２３４"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("1234"),
				},
			},
		},
		{
			formName: NFKD,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ｶﾀｶﾅ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("カタカナ"),
				},
			},
		},
		{
			formName: NFKC,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ｳﾞｨｯﾂ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ヴィッツ"),
				},
			},
		},
		{
			formName: NFKC,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ﾊﾟﾅｿﾆｯｸ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("パナソニック"),
				},
			},
		},
		{
			formName: NFD,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u212B"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0041\u030A"),
				},
			},
		},
		{
			formName: NFC,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u212B"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u00C5"),
				},
			},
		},
		{
			formName: NFKD,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\uFB01"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0066\u0069"),
				},
			},
		},
		{
			formName: NFKC,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\uFB01"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("\u0066\u0069"),
				},
			},
		},
	}

	for _, test := range tests {
		filter := MustNewUnicodeNormalizeFilter(test.formName)
		actual := filter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output[0].Term, actual[0].Term)
			t.Errorf("expected %#v, got %#v", test.output[0].Term, actual[0].Term)
		}
	}
}
