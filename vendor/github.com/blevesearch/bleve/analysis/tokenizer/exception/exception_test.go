//  Copyright (c) 2015 Couchbase, Inc.
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

package exception

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	_ "github.com/blevesearch/bleve/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/registry"
)

func TestExceptionsTokenizer(t *testing.T) {
	tests := []struct {
		config   map[string]interface{}
		input    []byte
		patterns []string
		result   analysis.TokenStream
	}{
		{
			input: []byte("test http://blevesearch.com/ words"),
			config: map[string]interface{}{
				"type":      "exception",
				"tokenizer": "unicode",
				"exceptions": []interface{}{
					`[hH][tT][tT][pP][sS]?://(\S)*`,
					`[fF][iI][lL][eE]://(\S)*`,
					`[fF][tT][pP]://(\S)*`,
				},
			},
			result: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("test"),
					Position: 1,
					Start:    0,
					End:      4,
				},
				&analysis.Token{
					Term:     []byte("http://blevesearch.com/"),
					Position: 2,
					Start:    5,
					End:      28,
				},
				&analysis.Token{
					Term:     []byte("words"),
					Position: 3,
					Start:    29,
					End:      34,
				},
			},
		},
		{
			input: []byte("what ftp://blevesearch.com/ songs"),
			config: map[string]interface{}{
				"type":      "exception",
				"tokenizer": "unicode",
				"exceptions": []interface{}{
					`[hH][tT][tT][pP][sS]?://(\S)*`,
					`[fF][iI][lL][eE]://(\S)*`,
					`[fF][tT][pP]://(\S)*`,
				},
			},
			result: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("what"),
					Position: 1,
					Start:    0,
					End:      4,
				},
				&analysis.Token{
					Term:     []byte("ftp://blevesearch.com/"),
					Position: 2,
					Start:    5,
					End:      27,
				},
				&analysis.Token{
					Term:     []byte("songs"),
					Position: 3,
					Start:    28,
					End:      33,
				},
			},
		},
		{
			input: []byte("please email marty@couchbase.com the URL https://blevesearch.com/"),
			config: map[string]interface{}{
				"type":      "exception",
				"tokenizer": "unicode",
				"exceptions": []interface{}{
					`[hH][tT][tT][pP][sS]?://(\S)*`,
					`[fF][iI][lL][eE]://(\S)*`,
					`[fF][tT][pP]://(\S)*`,
					`\S+@\S+`,
				},
			},
			result: analysis.TokenStream{
				&analysis.Token{
					Term:     []byte("please"),
					Position: 1,
					Start:    0,
					End:      6,
				},
				&analysis.Token{
					Term:     []byte("email"),
					Position: 2,
					Start:    7,
					End:      12,
				},
				&analysis.Token{
					Term:     []byte("marty@couchbase.com"),
					Position: 3,
					Start:    13,
					End:      32,
				},
				&analysis.Token{
					Term:     []byte("the"),
					Position: 4,
					Start:    33,
					End:      36,
				},
				&analysis.Token{
					Term:     []byte("URL"),
					Position: 5,
					Start:    37,
					End:      40,
				},
				&analysis.Token{
					Term:     []byte("https://blevesearch.com/"),
					Position: 6,
					Start:    41,
					End:      65,
				},
			},
		},
	}

	// remaining := unicode.NewUnicodeTokenizer()
	for _, test := range tests {

		// build the requested exception tokenizer
		cache := registry.NewCache()
		tokenizer, err := cache.DefineTokenizer("custom", test.config)
		if err != nil {
			t.Fatal(err)
		}

		// pattern := strings.Join(test.patterns, "|")
		// r, err := regexp.Compile(pattern)
		// if err != nil {
		// 	t.Fatal(err)
		// }
		// tokenizer := NewExceptionsTokenizer(r, remaining)
		actual := tokenizer.Tokenize(test.input)
		if !reflect.DeepEqual(actual, test.result) {
			t.Errorf("expected %v, got %v", test.result, actual)
		}
	}
}
