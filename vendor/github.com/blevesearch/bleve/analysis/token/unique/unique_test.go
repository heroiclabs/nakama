//  Copyright (c) 2018 Couchbase, Inc.
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

package unique

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestUniqueTermFilter(t *testing.T) {
	var tests = []struct {
		input analysis.TokenStream
		// expected indices of input which should be included in the output. We
		// use indices instead of another TokenStream, since position/start/end
		// should be preserved.
		expectedIndices []int
	}{
		{
			input:           tokenStream(),
			expectedIndices: []int{},
		},
		{
			input:           tokenStream("a"),
			expectedIndices: []int{0},
		},
		{
			input:           tokenStream("each", "term", "in", "this", "sentence", "is", "unique"),
			expectedIndices: []int{0, 1, 2, 3, 4, 5, 6},
		},
		{
			input:           tokenStream("Lui", "è", "alto", "e", "lei", "è", "bassa"),
			expectedIndices: []int{0, 1, 2, 3, 4, 6},
		},
		{
			input:           tokenStream("a", "a", "A", "a", "a", "A"),
			expectedIndices: []int{0, 2},
		},
	}
	uniqueTermFilter := NewUniqueTermFilter()
	for _, test := range tests {
		expected := subStream(test.input, test.expectedIndices)
		actual := uniqueTermFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, expected) {
			t.Errorf("expected %s \n\n got %s", expected, actual)
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

func subStream(stream analysis.TokenStream, indices []int) analysis.TokenStream {
	result := make(analysis.TokenStream, len(indices))
	for i, index := range indices {
		result[i] = stream[index]
	}
	return result
}
