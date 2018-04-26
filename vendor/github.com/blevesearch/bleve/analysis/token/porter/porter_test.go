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

package porter

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestPorterStemmer(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("walking"),
		},
		&analysis.Token{
			Term: []byte("talked"),
		},
		&analysis.Token{
			Term: []byte("business"),
		},
		&analysis.Token{
			Term:    []byte("protected"),
			KeyWord: true,
		},
		&analysis.Token{
			Term: []byte("cat"),
		},
		&analysis.Token{
			Term: []byte("done"),
		},
		// a term which does stem, but does not change length
		&analysis.Token{
			Term: []byte("marty"),
		},
	}

	expectedTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("walk"),
		},
		&analysis.Token{
			Term: []byte("talk"),
		},
		&analysis.Token{
			Term: []byte("busi"),
		},
		&analysis.Token{
			Term:    []byte("protected"),
			KeyWord: true,
		},
		&analysis.Token{
			Term: []byte("cat"),
		},
		&analysis.Token{
			Term: []byte("done"),
		},
		&analysis.Token{
			Term: []byte("marti"),
		},
	}

	filter := NewPorterStemmer()
	ouputTokenStream := filter.Filter(inputTokenStream)
	if !reflect.DeepEqual(ouputTokenStream, expectedTokenStream) {
		t.Errorf("expected %#v got %#v", expectedTokenStream[3], ouputTokenStream[3])
	}
}

func BenchmarkPorterStemmer(b *testing.B) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("walking"),
		},
		&analysis.Token{
			Term: []byte("talked"),
		},
		&analysis.Token{
			Term: []byte("business"),
		},
		&analysis.Token{
			Term:    []byte("protected"),
			KeyWord: true,
		},
		&analysis.Token{
			Term: []byte("cat"),
		},
		&analysis.Token{
			Term: []byte("done"),
		},
	}

	filter := NewPorterStemmer()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		filter.Filter(inputTokenStream)
	}

}
