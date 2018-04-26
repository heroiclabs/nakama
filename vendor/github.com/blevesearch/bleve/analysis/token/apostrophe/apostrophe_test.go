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

package apostrophe

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestApostropheFilter(t *testing.T) {

	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Türkiye'de"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Türkiye"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("2003'te"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("2003"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Van"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Van"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Gölü'nü"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("Gölü"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("gördüm"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("gördüm"),
				},
			},
		},
	}

	for _, test := range tests {
		apostropheFilter := NewApostropheFilter()
		actual := apostropheFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output[0].Term, actual[0].Term)
		}
	}
}
