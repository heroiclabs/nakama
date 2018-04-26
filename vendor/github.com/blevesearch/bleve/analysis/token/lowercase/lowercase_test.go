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

package lowercase

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestLowerCaseFilter(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("ONE"),
		},
		&analysis.Token{
			Term: []byte("two"),
		},
		&analysis.Token{
			Term: []byte("ThReE"),
		},
		&analysis.Token{
			Term: []byte("steven's"),
		},
		// these characters are chosen in particular
		// because the utf-8 encoding of the lower-case
		// version has a different length
		// Rune İ(304) width 2 - Lower i(105) width 1
		// Rune Ⱥ(570) width 2 - Lower ⱥ(11365) width 3
		// Rune Ⱦ(574) width 2 - Lower ⱦ(11366) width 3
		&analysis.Token{
			Term: []byte("İȺȾCAT"),
		},
		&analysis.Token{
			Term: []byte("ȺȾCAT"),
		},
		&analysis.Token{
			Term: []byte("ὈΔΥΣΣ"),
		},
	}

	expectedTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("one"),
		},
		&analysis.Token{
			Term: []byte("two"),
		},
		&analysis.Token{
			Term: []byte("three"),
		},
		&analysis.Token{
			Term: []byte("steven's"),
		},
		&analysis.Token{
			Term: []byte("iⱥⱦcat"),
		},
		&analysis.Token{
			Term: []byte("ⱥⱦcat"),
		},
		&analysis.Token{
			Term: []byte("ὀδυσς"),
		},
	}

	filter := NewLowerCaseFilter()
	ouputTokenStream := filter.Filter(inputTokenStream)
	if !reflect.DeepEqual(ouputTokenStream, expectedTokenStream) {
		t.Errorf("expected %#v got %#v", expectedTokenStream, ouputTokenStream)
		t.Errorf("expected %s got %s", expectedTokenStream[0].Term, ouputTokenStream[0].Term)
	}
}

func BenchmarkLowerCaseFilter(b *testing.B) {
	input := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("A"),
		},
		&analysis.Token{
			Term: []byte("boiling"),
		},
		&analysis.Token{
			Term: []byte("liquid"),
		},
		&analysis.Token{
			Term: []byte("expanding"),
		},
		&analysis.Token{
			Term: []byte("vapor"),
		},
		&analysis.Token{
			Term: []byte("explosion"),
		},
		&analysis.Token{
			Term: []byte("caused"),
		},
		&analysis.Token{
			Term: []byte("by"),
		},
		&analysis.Token{
			Term: []byte("the"),
		},
		&analysis.Token{
			Term: []byte("rupture"),
		},
		&analysis.Token{
			Term: []byte("of"),
		},
		&analysis.Token{
			Term: []byte("a"),
		},
		&analysis.Token{
			Term: []byte("vessel"),
		},
		&analysis.Token{
			Term: []byte("containing"),
		},
		&analysis.Token{
			Term: []byte("a"),
		},
		&analysis.Token{
			Term: []byte("pressurized"),
		},
		&analysis.Token{
			Term: []byte("liquid"),
		},
		&analysis.Token{
			Term: []byte("above"),
		},
		&analysis.Token{
			Term: []byte("its"),
		},
		&analysis.Token{
			Term: []byte("boiling"),
		},
		&analysis.Token{
			Term: []byte("point"),
		},
		&analysis.Token{
			Term: []byte("İȺȾCAT"),
		},
		&analysis.Token{
			Term: []byte("ȺȾCAT"),
		},
	}
	filter := NewLowerCaseFilter()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		filter.Filter(input)
	}
}
