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

package query

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestTokenStreamToPhrase(t *testing.T) {

	tests := []struct {
		tokens analysis.TokenStream
		result [][]string
	}{
		// empty token stream returns nil
		{
			tokens: analysis.TokenStream{},
			result: nil,
		},
		// typical token
		{
			tokens: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("one"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("two"),
					Position: 2,
				},
			},
			result: [][]string{[]string{"one"}, []string{"two"}},
		},
		// token stream containing a gap (usually from stop words)
		{
			tokens: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("wag"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("dog"),
					Position: 3,
				},
			},
			result: [][]string{[]string{"wag"}, nil, []string{"dog"}},
		},
		// token stream containing multiple tokens at the same position
		{
			tokens: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("nia"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("onia"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("donia"),
					Position: 1,
				},
				&analysis.Token{
					Term:     []byte("imo"),
					Position: 2,
				},
				&analysis.Token{
					Term:     []byte("nimo"),
					Position: 2,
				},
				&analysis.Token{
					Term:     []byte("ónimo"),
					Position: 2,
				},
			},
			result: [][]string{[]string{"nia", "onia", "donia"}, []string{"imo", "nimo", "ónimo"}},
		},
	}

	for i, test := range tests {
		actual := tokenStreamToPhrase(test.tokens)
		if !reflect.DeepEqual(actual, test.result) {
			t.Fatalf("expected %#v got %#v for test %d", test.result, actual, i)
		}
	}
}
