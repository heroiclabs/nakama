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

package searcher

import (
	"testing"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

func TestFuzzySearch(t *testing.T) {
	twoDocIndexReader, err := twoDocIndex.Reader()
	if err != nil {
		t.Error(err)
	}

	defer func() {
		err := twoDocIndexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	explainTrue := search.SearcherOptions{Explain: true}

	fuzzySearcherbeet, err := NewFuzzySearcher(twoDocIndexReader, "beet", 0, 1, "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	fuzzySearcherdouches, err := NewFuzzySearcher(twoDocIndexReader, "douches", 0, 2, "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	fuzzySearcheraplee, err := NewFuzzySearcher(twoDocIndexReader, "aplee", 0, 2, "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	fuzzySearcherprefix, err := NewFuzzySearcher(twoDocIndexReader, "water", 3, 2, "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		searcher search.Searcher
		results  []*search.DocumentMatch
	}{
		{
			searcher: fuzzySearcherbeet,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("1"),
					Score:           1.0,
				},
				{
					IndexInternalID: index.IndexInternalID("2"),
					Score:           0.5,
				},
				{
					IndexInternalID: index.IndexInternalID("3"),
					Score:           0.5,
				},
				{
					IndexInternalID: index.IndexInternalID("4"),
					Score:           0.9999999838027345,
				},
			},
		},
		{
			searcher: fuzzySearcherdouches,
			results:  []*search.DocumentMatch{},
		},
		{
			searcher: fuzzySearcheraplee,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("3"),
					Score:           0.9581453659370776,
				},
			},
		},
		{
			searcher: fuzzySearcherprefix,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("5"),
					Score:           1.916290731874155,
				},
			},
		},
	}

	for testIndex, test := range tests {
		defer func() {
			err := test.searcher.Close()
			if err != nil {
				t.Fatal(err)
			}
		}()

		ctx := &search.SearchContext{
			DocumentMatchPool: search.NewDocumentMatchPool(test.searcher.DocumentMatchPoolSize(), 0),
		}
		next, err := test.searcher.Next(ctx)
		i := 0
		for err == nil && next != nil {
			if i < len(test.results) {
				if !next.IndexInternalID.Equals(test.results[i].IndexInternalID) {
					t.Errorf("expected result %d to have id %s got %s for test %d", i, test.results[i].IndexInternalID, next.IndexInternalID, testIndex)
				}
				if next.Score != test.results[i].Score {
					t.Errorf("expected result %d to have score %v got %v for test %d", i, test.results[i].Score, next.Score, testIndex)
					t.Logf("scoring explanation: %s", next.Expl)
				}
			}
			ctx.DocumentMatchPool.Put(next)
			next, err = test.searcher.Next(ctx)
			i++
		}
		if err != nil {
			t.Fatalf("error iterating searcher: %v for test %d", err, testIndex)
		}
		if len(test.results) != i {
			t.Errorf("expected %d results got %d for test %d", len(test.results), i, testIndex)
		}
	}
}

func TestFuzzySearchLimitErrors(t *testing.T) {
	explainTrue := search.SearcherOptions{Explain: true}
	_, err := NewFuzzySearcher(nil, "water", 3, 3, "desc", 1.0, explainTrue)
	if err == nil {
		t.Fatal("`fuzziness exceeds max (2)` error expected")
	}

	_, err = NewFuzzySearcher(nil, "water", 3, -1, "desc", 1.0, explainTrue)
	if err == nil {
		t.Fatal("`invalid fuzziness, negative` error expected")
	}
}
