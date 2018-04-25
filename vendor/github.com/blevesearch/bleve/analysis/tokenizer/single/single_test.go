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

package single

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestSingleTokenTokenizer(t *testing.T) {

	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		{
			[]byte("Hello World"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      11,
					Term:     []byte("Hello World"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("こんにちは世界"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      21,
					Term:     []byte("こんにちは世界"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("แยกคำภาษาไทยก็ทำได้นะจ้ะ"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      72,
					Term:     []byte("แยกคำภาษาไทยก็ทำได้นะจ้ะ"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
	}

	for _, test := range tests {
		tokenizer := NewSingleTokenTokenizer()
		actual := tokenizer.Tokenize(test.input)

		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("Expected %v, got %v for %s", test.output, actual, string(test.input))
		}
	}
}
