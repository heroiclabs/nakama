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

package highlight

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/search"
)

func TestTermLocationOverlaps(t *testing.T) {

	tests := []struct {
		left     *TermLocation
		right    *TermLocation
		expected bool
	}{
		{
			left: &TermLocation{
				Start: 0,
				End:   5,
			},
			right: &TermLocation{
				Start: 3,
				End:   7,
			},
			expected: true,
		},
		{
			left: &TermLocation{
				Start: 0,
				End:   5,
			},
			right: &TermLocation{
				Start: 5,
				End:   7,
			},
			expected: false,
		},
		{
			left: &TermLocation{
				Start: 0,
				End:   5,
			},
			right: &TermLocation{
				Start: 7,
				End:   11,
			},
			expected: false,
		},
		// with array positions
		{
			left: &TermLocation{
				ArrayPositions: search.ArrayPositions{0},
				Start:          0,
				End:            5,
			},
			right: &TermLocation{
				ArrayPositions: search.ArrayPositions{1},
				Start:          7,
				End:            11,
			},
			expected: false,
		},
		{
			left: &TermLocation{
				ArrayPositions: search.ArrayPositions{0},
				Start:          0,
				End:            5,
			},
			right: &TermLocation{
				ArrayPositions: search.ArrayPositions{1},
				Start:          3,
				End:            11,
			},
			expected: false,
		},
		{
			left: &TermLocation{
				ArrayPositions: search.ArrayPositions{0},
				Start:          0,
				End:            5,
			},
			right: &TermLocation{
				ArrayPositions: search.ArrayPositions{0},
				Start:          3,
				End:            11,
			},
			expected: true,
		},
		{
			left: &TermLocation{
				ArrayPositions: search.ArrayPositions{0},
				Start:          0,
				End:            5,
			},
			right: &TermLocation{
				ArrayPositions: search.ArrayPositions{0},
				Start:          7,
				End:            11,
			},
			expected: false,
		},
	}

	for _, test := range tests {
		actual := test.left.Overlaps(test.right)
		if actual != test.expected {
			t.Errorf("expected %t got %t for %#v", test.expected, actual, test)
		}
	}
}

func TestTermLocationsMergeOverlapping(t *testing.T) {

	tests := []struct {
		input  TermLocations
		output TermLocations
	}{
		{
			input:  TermLocations{},
			output: TermLocations{},
		},
		{
			input: TermLocations{
				&TermLocation{
					Start: 0,
					End:   5,
				},
				&TermLocation{
					Start: 7,
					End:   11,
				},
			},
			output: TermLocations{
				&TermLocation{
					Start: 0,
					End:   5,
				},
				&TermLocation{
					Start: 7,
					End:   11,
				},
			},
		},
		{
			input: TermLocations{
				&TermLocation{
					Start: 0,
					End:   5,
				},
				&TermLocation{
					Start: 4,
					End:   11,
				},
			},
			output: TermLocations{
				&TermLocation{
					Start: 0,
					End:   11,
				},
				nil,
			},
		},
		{
			input: TermLocations{
				&TermLocation{
					Start: 0,
					End:   5,
				},
				&TermLocation{
					Start: 4,
					End:   11,
				},
				&TermLocation{
					Start: 9,
					End:   13,
				},
			},
			output: TermLocations{
				&TermLocation{
					Start: 0,
					End:   13,
				},
				nil,
				nil,
			},
		},
		{
			input: TermLocations{
				&TermLocation{
					Start: 0,
					End:   5,
				},
				&TermLocation{
					Start: 4,
					End:   11,
				},
				&TermLocation{
					Start: 9,
					End:   13,
				},
				&TermLocation{
					Start: 15,
					End:   21,
				},
			},
			output: TermLocations{
				&TermLocation{
					Start: 0,
					End:   13,
				},
				nil,
				nil,
				&TermLocation{
					Start: 15,
					End:   21,
				},
			},
		},
		// with array positions
		{
			input: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{1},
					Start:          7,
					End:            11,
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{1},
					Start:          7,
					End:            11,
				},
			},
		},
		{
			input: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          7,
					End:            11,
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          7,
					End:            11,
				},
			},
		},
		{
			input: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          3,
					End:            11,
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            11,
				},
				nil,
			},
		},
		{
			input: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{1},
					Start:          3,
					End:            11,
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Start:          0,
					End:            5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{1},
					Start:          3,
					End:            11,
				},
			},
		},
	}

	for _, test := range tests {
		test.input.MergeOverlapping()
		if !reflect.DeepEqual(test.input, test.output) {
			t.Errorf("expected: %#v got %#v", test.output, test.input)
		}
	}
}

func TestTermLocationsOrder(t *testing.T) {

	tests := []struct {
		input  search.TermLocationMap
		output TermLocations
	}{
		{
			input:  search.TermLocationMap{},
			output: TermLocations{},
		},
		{
			input: search.TermLocationMap{
				"term": []*search.Location{
					{
						Start: 0,
					},
					{
						Start: 5,
					},
				},
			},
			output: TermLocations{
				&TermLocation{
					Term:  "term",
					Start: 0,
				},
				&TermLocation{
					Term:  "term",
					Start: 5,
				},
			},
		},
		{
			input: search.TermLocationMap{
				"term": []*search.Location{
					{
						Start: 5,
					},
					{
						Start: 0,
					},
				},
			},
			output: TermLocations{
				&TermLocation{
					Term:  "term",
					Start: 0,
				},
				&TermLocation{
					Term:  "term",
					Start: 5,
				},
			},
		},
		// with array positions
		{
			input: search.TermLocationMap{
				"term": []*search.Location{
					{
						ArrayPositions: search.ArrayPositions{0},
						Start:          0,
					},
					{
						ArrayPositions: search.ArrayPositions{0},
						Start:          5,
					},
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Term:           "term",
					Start:          0,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Term:           "term",
					Start:          5,
				},
			},
		},
		{
			input: search.TermLocationMap{
				"term": []*search.Location{
					{
						ArrayPositions: search.ArrayPositions{0},
						Start:          5,
					},
					{
						ArrayPositions: search.ArrayPositions{0},
						Start:          0,
					},
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Term:           "term",
					Start:          0,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Term:           "term",
					Start:          5,
				},
			},
		},
		{
			input: search.TermLocationMap{
				"term": []*search.Location{
					{
						ArrayPositions: search.ArrayPositions{0},
						Start:          5,
					},
					{
						ArrayPositions: search.ArrayPositions{1},
						Start:          0,
					},
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Term:           "term",
					Start:          5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{1},
					Term:           "term",
					Start:          0,
				},
			},
		},
		{
			input: search.TermLocationMap{
				"term": []*search.Location{
					{
						ArrayPositions: search.ArrayPositions{0},
						Start:          5,
					},
					{
						ArrayPositions: search.ArrayPositions{0, 1},
						Start:          0,
					},
				},
			},
			output: TermLocations{
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0},
					Term:           "term",
					Start:          5,
				},
				&TermLocation{
					ArrayPositions: search.ArrayPositions{0, 1},
					Term:           "term",
					Start:          0,
				},
			},
		},
	}

	for _, test := range tests {
		actual := OrderTermLocations(test.input)
		if !reflect.DeepEqual(actual, test.output) {
			t.Errorf("expected: %#v got %#v", test.output, actual)
		}
	}
}
