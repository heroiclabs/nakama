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

package compound

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/analysis/tokenmap"
	"github.com/blevesearch/bleve/registry"
)

func TestStopWordsFilter(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term:     []byte("i"),
			Start:    0,
			End:      1,
			Position: 1,
		},
		&analysis.Token{
			Term:     []byte("like"),
			Start:    2,
			End:      6,
			Position: 2,
		},
		&analysis.Token{
			Term:     []byte("to"),
			Start:    7,
			End:      9,
			Position: 3,
		},
		&analysis.Token{
			Term:     []byte("play"),
			Start:    10,
			End:      14,
			Position: 4,
		},
		&analysis.Token{
			Term:     []byte("softball"),
			Start:    15,
			End:      23,
			Position: 5,
		},
	}

	expectedTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term:     []byte("i"),
			Start:    0,
			End:      1,
			Position: 1,
		},
		&analysis.Token{
			Term:     []byte("like"),
			Start:    2,
			End:      6,
			Position: 2,
		},
		&analysis.Token{
			Term:     []byte("to"),
			Start:    7,
			End:      9,
			Position: 3,
		},
		&analysis.Token{
			Term:     []byte("play"),
			Start:    10,
			End:      14,
			Position: 4,
		},
		&analysis.Token{
			Term:     []byte("softball"),
			Start:    15,
			End:      23,
			Position: 5,
		},
		&analysis.Token{
			Term:     []byte("soft"),
			Start:    15,
			End:      19,
			Position: 5,
		},
		&analysis.Token{
			Term:     []byte("ball"),
			Start:    19,
			End:      23,
			Position: 5,
		},
	}

	cache := registry.NewCache()
	dictListConfig := map[string]interface{}{
		"type":   tokenmap.Name,
		"tokens": []interface{}{"factor", "soft", "ball", "team"},
	}
	_, err := cache.DefineTokenMap("dict_test", dictListConfig)
	if err != nil {
		t.Fatal(err)
	}

	dictConfig := map[string]interface{}{
		"type":           "dict_compound",
		"dict_token_map": "dict_test",
	}
	dictFilter, err := cache.DefineTokenFilter("dict_test", dictConfig)
	if err != nil {
		t.Fatal(err)
	}

	ouputTokenStream := dictFilter.Filter(inputTokenStream)
	if !reflect.DeepEqual(ouputTokenStream, expectedTokenStream) {
		t.Errorf("expected %#v got %#v", expectedTokenStream, ouputTokenStream)
	}
}

func TestStopWordsFilterLongestMatch(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term:     []byte("softestball"),
			Start:    0,
			End:      11,
			Position: 1,
		},
	}

	expectedTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term:     []byte("softestball"),
			Start:    0,
			End:      11,
			Position: 1,
		},
		&analysis.Token{
			Term:     []byte("softest"),
			Start:    0,
			End:      7,
			Position: 1,
		},
		&analysis.Token{
			Term:     []byte("ball"),
			Start:    7,
			End:      11,
			Position: 1,
		},
	}

	cache := registry.NewCache()
	dictListConfig := map[string]interface{}{
		"type":   tokenmap.Name,
		"tokens": []interface{}{"soft", "softest", "ball"},
	}
	_, err := cache.DefineTokenMap("dict_test", dictListConfig)
	if err != nil {
		t.Fatal(err)
	}

	dictConfig := map[string]interface{}{
		"type":               "dict_compound",
		"dict_token_map":     "dict_test",
		"only_longest_match": true,
	}
	dictFilter, err := cache.DefineTokenFilter("dict_test", dictConfig)
	if err != nil {
		t.Fatal(err)
	}

	ouputTokenStream := dictFilter.Filter(inputTokenStream)
	if !reflect.DeepEqual(ouputTokenStream, expectedTokenStream) {
		t.Errorf("expected %#v got %#v", expectedTokenStream, ouputTokenStream)
	}
}
