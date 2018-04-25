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

package keyword

import (
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
)

func TestKeyWordMarkerFilter(t *testing.T) {

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
			Term: []byte("a"),
		},
		&analysis.Token{
			Term:    []byte("walk"),
			KeyWord: true,
		},
		&analysis.Token{
			Term: []byte("in"),
		},
		&analysis.Token{
			Term: []byte("the"),
		},
		&analysis.Token{
			Term:    []byte("park"),
			KeyWord: true,
		},
	}

	keyWordsMap := analysis.NewTokenMap()
	keyWordsMap.AddToken("walk")
	keyWordsMap.AddToken("park")

	filter := NewKeyWordMarkerFilter(keyWordsMap)
	ouputTokenStream := filter.Filter(inputTokenStream)
	if !reflect.DeepEqual(ouputTokenStream, expectedTokenStream) {
		t.Errorf("expected %#v got %#v", expectedTokenStream[0].KeyWord, ouputTokenStream[0].KeyWord)
	}
}
