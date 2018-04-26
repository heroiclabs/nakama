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

package web

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/registry"
)

func TestWeb(t *testing.T) {

	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		{
			[]byte("Hello info@blevesearch.com"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      5,
					Term:     []byte("Hello"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    6,
					End:      26,
					Term:     []byte("info@blevesearch.com"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("That http://blevesearch.com"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      4,
					Term:     []byte("That"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    5,
					End:      27,
					Term:     []byte("http://blevesearch.com"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("Hey @blevesearch"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      3,
					Term:     []byte("Hey"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    4,
					End:      16,
					Term:     []byte("@blevesearch"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("This #bleve"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      4,
					Term:     []byte("This"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    5,
					End:      11,
					Term:     []byte("#bleve"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("What about @blevesearch?"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      4,
					Term:     []byte("What"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    5,
					End:      10,
					Term:     []byte("about"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    11,
					End:      23,
					Term:     []byte("@blevesearch"),
					Position: 3,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
	}

	cache := registry.NewCache()
	tokenizer, err := cache.TokenizerNamed(Name)
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range tests {

		actual := tokenizer.Tokenize(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("Expected %v, got %v for %s", test.output, actual, string(test.input))
		}
	}
}
