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

package en

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestEnglishPossessiveFilter(t *testing.T) {
	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("marty's"),
				},
				&analysis.Token{
					Term: []byte("MARTY'S"),
				},
				&analysis.Token{
					Term: []byte("marty’s"),
				},
				&analysis.Token{
					Term: []byte("MARTY’S"),
				},
				&analysis.Token{
					Term: []byte("marty＇s"),
				},
				&analysis.Token{
					Term: []byte("MARTY＇S"),
				},
				&analysis.Token{
					Term: []byte("m"),
				},
				&analysis.Token{
					Term: []byte("s"),
				},
				&analysis.Token{
					Term: []byte("'s"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("marty"),
				},
				&analysis.Token{
					Term: []byte("MARTY"),
				},
				&analysis.Token{
					Term: []byte("marty"),
				},
				&analysis.Token{
					Term: []byte("MARTY"),
				},
				&analysis.Token{
					Term: []byte("marty"),
				},
				&analysis.Token{
					Term: []byte("MARTY"),
				},
				&analysis.Token{
					Term: []byte("m"),
				},
				&analysis.Token{
					Term: []byte("s"),
				},
				&analysis.Token{
					Term: []byte(""),
				},
			},
		},
	}

	cache := registry.NewCache()
	stemmerFilter, err := cache.TokenFilterNamed(PossessiveName)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range tests {
		actual := stemmerFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output, actual)
		}
	}
}

func BenchmarkEnglishPossessiveFilter(b *testing.B) {

	input := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("marty's"),
		},
		&analysis.Token{
			Term: []byte("MARTY'S"),
		},
		&analysis.Token{
			Term: []byte("marty’s"),
		},
		&analysis.Token{
			Term: []byte("MARTY’S"),
		},
		&analysis.Token{
			Term: []byte("marty＇s"),
		},
		&analysis.Token{
			Term: []byte("MARTY＇S"),
		},
		&analysis.Token{
			Term: []byte("m"),
		},
	}

	cache := registry.NewCache()
	stemmerFilter, err := cache.TokenFilterNamed(PossessiveName)
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		stemmerFilter.Filter(input)
	}

}
