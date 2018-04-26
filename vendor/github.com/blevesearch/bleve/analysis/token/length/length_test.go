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

package length

import (
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestLengthFilter(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("1"),
		},
		&analysis.Token{
			Term: []byte("two"),
		},
		&analysis.Token{
			Term: []byte("three"),
		},
	}

	lengthFilter := NewLengthFilter(3, 4)
	ouputTokenStream := lengthFilter.Filter(inputTokenStream)
	if len(ouputTokenStream) != 1 {
		t.Fatalf("expected 1 output token")
	}
	if string(ouputTokenStream[0].Term) != "two" {
		t.Errorf("expected term `two`, got `%s`", ouputTokenStream[0].Term)
	}
}

func TestLengthFilterNoMax(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("1"),
		},
		&analysis.Token{
			Term: []byte("two"),
		},
		&analysis.Token{
			Term: []byte("three"),
		},
	}

	lengthFilter := NewLengthFilter(3, -1)
	ouputTokenStream := lengthFilter.Filter(inputTokenStream)
	if len(ouputTokenStream) != 2 {
		t.Fatalf("expected 2 output token")
	}
	if string(ouputTokenStream[0].Term) != "two" {
		t.Errorf("expected term `two`, got `%s`", ouputTokenStream[0].Term)
	}
	if string(ouputTokenStream[1].Term) != "three" {
		t.Errorf("expected term `three`, got `%s`", ouputTokenStream[0].Term)
	}
}

func TestLengthFilterNoMin(t *testing.T) {

	inputTokenStream := analysis.TokenStream{
		&analysis.Token{
			Term: []byte("1"),
		},
		&analysis.Token{
			Term: []byte("two"),
		},
		&analysis.Token{
			Term: []byte("three"),
		},
	}

	lengthFilter := NewLengthFilter(-1, 4)
	ouputTokenStream := lengthFilter.Filter(inputTokenStream)
	if len(ouputTokenStream) != 2 {
		t.Fatalf("expected 2 output token")
	}
	if string(ouputTokenStream[0].Term) != "1" {
		t.Errorf("expected term `1`, got `%s`", ouputTokenStream[0].Term)
	}
	if string(ouputTokenStream[1].Term) != "two" {
		t.Errorf("expected term `two`, got `%s`", ouputTokenStream[0].Term)
	}
}
