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

package elision

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/analysis/tokenmap"
	"github.com/blevesearch/bleve/registry"
)

func TestElisionFilter(t *testing.T) {

	tests := []struct {
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ar" + string(Apostrophe) + "word"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("word"),
				},
			},
		},
		{
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ar" + string(RightSingleQuotationMark) + "word"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("word"),
				},
			},
		},
	}

	cache := registry.NewCache()

	articleListConfig := map[string]interface{}{
		"type":   tokenmap.Name,
		"tokens": []interface{}{"ar"},
	}
	_, err := cache.DefineTokenMap("articles_test", articleListConfig)
	if err != nil {
		t.Fatal(err)
	}

	elisionConfig := map[string]interface{}{
		"type":               "elision",
		"articles_token_map": "articles_test",
	}
	elisionFilter, err := cache.DefineTokenFilter("elision_test", elisionConfig)
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range tests {

		actual := elisionFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output[0].Term, actual[0].Term)
		}
	}
}
