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

package html

import (
	"testing"

	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/highlight"
)

func TestHTMLFragmentFormatter1(t *testing.T) {
	tests := []struct {
		fragment *highlight.Fragment
		tlm      search.TermLocationMap
		output   string
	}{
		{
			fragment: &highlight.Fragment{
				Orig:  []byte("the quick brown fox"),
				Start: 0,
				End:   19,
			},
			tlm: search.TermLocationMap{
				"quick": []*search.Location{
					{
						Pos:   2,
						Start: 4,
						End:   9,
					},
				},
			},
			output: "the <b>quick</b> brown fox",
		},
	}

	emHTMLFormatter := NewFragmentFormatter("<b>", "</b>")
	for _, test := range tests {
		otl := highlight.OrderTermLocations(test.tlm)
		result := emHTMLFormatter.Format(test.fragment, otl)
		if result != test.output {
			t.Errorf("expected `%s`, got `%s`", test.output, result)
		}
	}
}

func TestHTMLFragmentFormatter2(t *testing.T) {
	tests := []struct {
		fragment *highlight.Fragment
		tlm      search.TermLocationMap
		output   string
	}{
		{
			fragment: &highlight.Fragment{
				Orig:  []byte("the quick brown fox"),
				Start: 0,
				End:   19,
			},
			tlm: search.TermLocationMap{
				"quick": []*search.Location{
					{
						Pos:   2,
						Start: 4,
						End:   9,
					},
				},
			},
			output: "the <em>quick</em> brown fox",
		},
	}

	emHTMLFormatter := NewFragmentFormatter("<em>", "</em>")
	for _, test := range tests {
		otl := highlight.OrderTermLocations(test.tlm)
		result := emHTMLFormatter.Format(test.fragment, otl)
		if result != test.output {
			t.Errorf("expected `%s`, got `%s`", test.output, result)
		}
	}
}
