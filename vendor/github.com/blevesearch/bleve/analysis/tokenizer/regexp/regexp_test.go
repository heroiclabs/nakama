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

package regexp

import (
	"reflect"
	"regexp"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestBoundary(t *testing.T) {

	wordRegex := regexp.MustCompile(`\p{Han}|\p{Hangul}|\p{Hiragana}|\p{Katakana}|\w+`)

	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		{
			[]byte("Hello World."),
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
					End:      11,
					Term:     []byte("World"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
		{
			[]byte("こんにちは世界"),
			analysis.TokenStream{
				{
					Start:    0,
					End:      3,
					Term:     []byte("こ"),
					Position: 1,
					Type:     analysis.Ideographic,
				},
				{
					Start:    3,
					End:      6,
					Term:     []byte("ん"),
					Position: 2,
					Type:     analysis.Ideographic,
				},
				{
					Start:    6,
					End:      9,
					Term:     []byte("に"),
					Position: 3,
					Type:     analysis.Ideographic,
				},
				{
					Start:    9,
					End:      12,
					Term:     []byte("ち"),
					Position: 4,
					Type:     analysis.Ideographic,
				},
				{
					Start:    12,
					End:      15,
					Term:     []byte("は"),
					Position: 5,
					Type:     analysis.Ideographic,
				},
				{
					Start:    15,
					End:      18,
					Term:     []byte("世"),
					Position: 6,
					Type:     analysis.Ideographic,
				},
				{
					Start:    18,
					End:      21,
					Term:     []byte("界"),
					Position: 7,
					Type:     analysis.Ideographic,
				},
			},
		},
		{
			[]byte(""),
			analysis.TokenStream{},
		},
	}

	for _, test := range tests {
		tokenizer := NewRegexpTokenizer(wordRegex)
		actual := tokenizer.Tokenize(test.input)

		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("Expected %v, got %v for %s", test.output, actual, string(test.input))
		}
	}
}

func TestBugProducingEmptyTokens(t *testing.T) {

	wordRegex := regexp.MustCompile(`[0-9a-zA-Z_]*`)

	tests := []struct {
		input  []byte
		output analysis.TokenStream
	}{
		{
			[]byte("Chatha Edwards Sr."),
			analysis.TokenStream{
				{
					Start:    0,
					End:      6,
					Term:     []byte("Chatha"),
					Position: 1,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    7,
					End:      14,
					Term:     []byte("Edwards"),
					Position: 2,
					Type:     analysis.AlphaNumeric,
				},
				{
					Start:    15,
					End:      17,
					Term:     []byte("Sr"),
					Position: 3,
					Type:     analysis.AlphaNumeric,
				},
			},
		},
	}

	for _, test := range tests {
		tokenizer := NewRegexpTokenizer(wordRegex)
		actual := tokenizer.Tokenize(test.input)

		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("Expected %v, got %v for %s", test.output, actual, string(test.input))
		}
	}
}
