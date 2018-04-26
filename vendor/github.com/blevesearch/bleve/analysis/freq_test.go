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

package analysis

import (
	"reflect"
	"testing"
)

func TestTokenFrequency(t *testing.T) {
	tokens := TokenStream{
		&Token{
			Term:     []byte("water"),
			Position: 1,
			Start:    0,
			End:      5,
		},
		&Token{
			Term:     []byte("water"),
			Position: 2,
			Start:    6,
			End:      11,
		},
	}
	expectedResult := TokenFrequencies{
		"water": &TokenFreq{
			Term: []byte("water"),
			Locations: []*TokenLocation{
				{
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Position: 2,
					Start:    6,
					End:      11,
				},
			},
			frequency: 2,
		},
	}
	result := TokenFrequency(tokens, nil, true)
	if !reflect.DeepEqual(result, expectedResult) {
		t.Errorf("expected %#v, got %#v", expectedResult, result)
	}
}

func TestTokenFrequenciesMergeAll(t *testing.T) {
	tf1 := TokenFrequencies{
		"water": &TokenFreq{
			Term: []byte("water"),
			Locations: []*TokenLocation{
				{
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Position: 2,
					Start:    6,
					End:      11,
				},
			},
		},
	}
	tf2 := TokenFrequencies{
		"water": &TokenFreq{
			Term: []byte("water"),
			Locations: []*TokenLocation{
				{
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Position: 2,
					Start:    6,
					End:      11,
				},
			},
		},
	}
	expectedResult := TokenFrequencies{
		"water": &TokenFreq{
			Term: []byte("water"),
			Locations: []*TokenLocation{
				{
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Position: 2,
					Start:    6,
					End:      11,
				},
				{
					Field:    "tf2",
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Field:    "tf2",
					Position: 2,
					Start:    6,
					End:      11,
				},
			},
		},
	}
	tf1.MergeAll("tf2", tf2)
	if !reflect.DeepEqual(tf1, expectedResult) {
		t.Errorf("expected %#v, got %#v", expectedResult, tf1)
	}
}

func TestTokenFrequenciesMergeAllLeftEmpty(t *testing.T) {
	tf1 := TokenFrequencies{}
	tf2 := TokenFrequencies{
		"water": &TokenFreq{
			Term: []byte("water"),
			Locations: []*TokenLocation{
				{
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Position: 2,
					Start:    6,
					End:      11,
				},
			},
		},
	}
	expectedResult := TokenFrequencies{
		"water": &TokenFreq{
			Term: []byte("water"),
			Locations: []*TokenLocation{
				{
					Field:    "tf2",
					Position: 1,
					Start:    0,
					End:      5,
				},
				{
					Field:    "tf2",
					Position: 2,
					Start:    6,
					End:      11,
				},
			},
		},
	}
	tf1.MergeAll("tf2", tf2)
	if !reflect.DeepEqual(tf1, expectedResult) {
		t.Errorf("expected %#v, got %#v", expectedResult, tf1)
	}
}
