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

package stop

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
			Term: []byte("a"),
		},
		&analysis.Token{
			Term: []byte("walk"),
		},
		&analysis.Token{
			Term: []byte("in"),
		},
		&analysis.Token{
			Term: []byte("the"),
		},
		&analysis.Token{
			Term: []byte("park"),
		},
	}

	expectedTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("walk"),
		},
		&analysis.Token{
			Term: []byte("park"),
		},
	}

	cache := registry.NewCache()
	stopListConfig := map[string]interface{}{
		"type":   tokenmap.Name,
		"tokens": []interface{}{"a", "in", "the"},
	}
	_, err := cache.DefineTokenMap("stop_test", stopListConfig)
	if err != nil {
		t.Fatal(err)
	}

	stopConfig := map[string]interface{}{
		"type":           "stop_tokens",
		"stop_token_map": "stop_test",
	}
	stopFilter, err := cache.DefineTokenFilter("stop_test", stopConfig)
	if err != nil {
		t.Fatal(err)
	}

	ouputTokenStream := stopFilter.Filter(inputTokenStream)
	if !reflect.DeepEqual(ouputTokenStream, expectedTokenStream) {
		t.Errorf("expected %#v got %#v", expectedTokenStream, ouputTokenStream)
	}
}

func BenchmarkStopWordsFilter(b *testing.B) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("a"),
		},
		&analysis.Token{
			Term: []byte("walk"),
		},
		&analysis.Token{
			Term: []byte("in"),
		},
		&analysis.Token{
			Term: []byte("the"),
		},
		&analysis.Token{
			Term: []byte("park"),
		},
	}

	cache := registry.NewCache()
	stopListConfig := map[string]interface{}{
		"type":   tokenmap.Name,
		"tokens": []interface{}{"a", "in", "the"},
	}
	_, err := cache.DefineTokenMap("stop_test", stopListConfig)
	if err != nil {
		b.Fatal(err)
	}

	stopConfig := map[string]interface{}{
		"type":           "stop_tokens",
		"stop_token_map": "stop_test",
	}
	stopFilter, err := cache.DefineTokenFilter("stop_test", stopConfig)
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		stopFilter.Filter(inputTokenStream)
	}

}
