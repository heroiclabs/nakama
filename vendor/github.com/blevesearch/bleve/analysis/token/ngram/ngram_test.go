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

package ngram

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestNgramFilter(t *testing.T) {

	tests := []struct {
		min    int
		max    int
		input  analysis.TokenStream
		output analysis.TokenStream
	}{
		{
			min: 1,
			max: 1,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("b"),
				},
				&analysis.Token{
					Term: []byte("c"),
				},
				&analysis.Token{
					Term: []byte("d"),
				},
				&analysis.Token{
					Term: []byte("e"),
				},
			},
		},
		{
			min: 2,
			max: 2,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("ab"),
				},
				&analysis.Token{
					Term: []byte("bc"),
				},
				&analysis.Token{
					Term: []byte("cd"),
				},
				&analysis.Token{
					Term: []byte("de"),
				},
			},
		},
		{
			min: 1,
			max: 3,
			input: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("abcde"),
				},
			},
			output: analysis.TokenStream{
				&analysis.Token{
					Term: []byte("a"),
				},
				&analysis.Token{
					Term: []byte("ab"),
				},
				&analysis.Token{
					Term: []byte("abc"),
				},
				&analysis.Token{
					Term: []byte("b"),
				},
				&analysis.Token{
					Term: []byte("bc"),
				},
				&analysis.Token{
					Term: []byte("bcd"),
				},
				&analysis.Token{
					Term: []byte("c"),
				},
				&analysis.Token{
					Term: []byte("cd"),
				},
				&analysis.Token{
					Term: []byte("cde"),
				},
				&analysis.Token{
					Term: []byte("d"),
				},
				&analysis.Token{
					Term: []byte("de"),
				},
				&analysis.Token{
					Term: []byte("e"),
				},
			},
		},
	}

	for _, test := range tests {
		ngramFilter := NewNgramFilter(test.min, test.max)
		actual := ngramFilter.Filter(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected %s, got %s", test.output, actual)
		}
	}
}

func TestConversionInt(t *testing.T) {
	config := map[string]interface{}{
		"type": Name,
		"min":  3,
		"max":  8,
	}

	f, err := NgramFilterConstructor(config, nil)

	if err != nil {
		t.Errorf("Failed to construct the ngram filter: %v", err)
	}

	ngram := f.(*NgramFilter)
	if ngram.minLength != 3 && ngram.maxLength != 8 {
		t.Errorf("Failed to construct the bounds. Got %v and %v.", ngram.minLength, ngram.maxLength)
	}
}

func TestConversionFloat(t *testing.T) {
	config := map[string]interface{}{
		"type": Name,
		"min":  float64(3),
		"max":  float64(8),
	}

	f, err := NgramFilterConstructor(config, nil)

	if err != nil {
		t.Errorf("Failed to construct the ngram filter: %v", err)
	}

	ngram := f.(*NgramFilter)
	if ngram.minLength != 3 && ngram.maxLength != 8 {
		t.Errorf("Failed to construct the bounds. Got %v and %v.", ngram.minLength, ngram.maxLength)
	}
}

func TestBadConversion(t *testing.T) {
	config := map[string]interface{}{
		"type": Name,
		"min":  "3",
	}

	_, err := NgramFilterConstructor(config, nil)

	if err == nil {
		t.Errorf("Expected conversion error.")
	}

	if err.Error() != "failed to convert to int value" {
		t.Errorf("Wrong error recevied. Got %v.", err)
	}
}
