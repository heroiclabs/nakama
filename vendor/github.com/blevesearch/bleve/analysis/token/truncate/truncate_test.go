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

package truncate

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestTruncateTokenFilter(t *testing.T) {

	tests := []struct {
		length int
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			length: 5,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcdefgh"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
		},
		{
			length: 3,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("こんにちは世界"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("こんに"),
				},
			},
		},
		{
			length: 10,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("แยกคำภาษาไทยก็ทำได้นะจ้ะ"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("แยกคำภาษาไ"),
				},
			},
		},
	}

	for _, test := range tests {
		truncateTokenFilter := NewTruncateTokenFilter(test.length)
		actual := truncateTokenFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output[0].Term, actual[0].Term)
		}
	}
}
