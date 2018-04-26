//  Copyright (c) 2016 Couchbase, Inc.
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

package camelcase

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestCamelCaseFilter(t *testing.T) {

	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input:  tokenStream(""),
			output: tokenStream(""),
		},
		{
			input:  tokenStream("a"),
			output: tokenStream("a"),
		},

		{
			input:  tokenStream("...aMACMac123macILoveGolang"),
			output: tokenStream("...", "a", "MAC", "Mac", "123", "mac", "I", "Love", "Golang"),
		},
		{
			input:  tokenStream("Lang"),
			output: tokenStream("Lang"),
		},
		{
			input:  tokenStream("GLang"),
			output: tokenStream("G", "Lang"),
		},
		{
			input:  tokenStream("GOLang"),
			output: tokenStream("GO", "Lang"),
		},
		{
			input:  tokenStream("GOOLang"),
			output: tokenStream("GOO", "Lang"),
		},
		{
			input:  tokenStream("1234"),
			output: tokenStream("1234"),
		},
		{
			input:  tokenStream("starbucks"),
			output: tokenStream("starbucks"),
		},
		{
			input:  tokenStream("Starbucks TVSamsungIsGREAT000"),
			output: tokenStream("Starbucks", " ", "TV", "Samsung", "Is", "GREAT", "000"),
		},
	}

	for _, test := range tests {
		ccFilter := NewCamelCaseFilter()
		actual := ccFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s \n\n got %s", test.output, actual)
		}
	}
}

func tokenStream(termStrs ...string) analysis.TokenStream {
	tokenStream := make([]*analysis.Token, len(termStrs))
	index := 0
	for i, termStr := range termStrs {
		tokenStream[i] = &analysis.Token{
			Term:     []byte(termStr),
			Position: i + 1,
			Start:    index,
			End:      index + len(termStr),
		}
		index += len(termStr)
	}
	return analysis.TokenStream(tokenStream)
}
