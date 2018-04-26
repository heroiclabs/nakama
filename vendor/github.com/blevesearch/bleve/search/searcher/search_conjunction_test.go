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

package searcher

import (
	"testing"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

func TestConjunctionSearch(t *testing.T) {

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

	// test 0
	beerTermSearcher, err := NewTermSearcher(twoDocIndexReader, "beer", "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	martyTermSearcher, err := NewTermSearcher(twoDocIndexReader, "marty", "name", 5.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	beerAndMartySearcher, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{beerTermSearcher, martyTermSearcher}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	// test 1
	angstTermSearcher, err := NewTermSearcher(twoDocIndexReader, "angst", "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	beerTermSearcher2, err := NewTermSearcher(twoDocIndexReader, "beer", "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	angstAndBeerSearcher, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{angstTermSearcher, beerTermSearcher2}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	// test 2
	beerTermSearcher3, err := NewTermSearcher(twoDocIndexReader, "beer", "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	jackTermSearcher, err := NewTermSearcher(twoDocIndexReader, "jack", "name", 5.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	beerAndJackSearcher, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{beerTermSearcher3, jackTermSearcher}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	// test 3
	beerTermSearcher4, err := NewTermSearcher(twoDocIndexReader, "beer", "desc", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	misterTermSearcher, err := NewTermSearcher(twoDocIndexReader, "mister", "title", 5.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	beerAndMisterSearcher, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{beerTermSearcher4, misterTermSearcher}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	// test 4
	couchbaseTermSearcher, err := NewTermSearcher(twoDocIndexReader, "couchbase", "street", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	misterTermSearcher2, err := NewTermSearcher(twoDocIndexReader, "mister", "title", 5.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	couchbaseAndMisterSearcher, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{couchbaseTermSearcher, misterTermSearcher2}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	// test 5
	beerTermSearcher5, err := NewTermSearcher(twoDocIndexReader, "beer", "desc", 5.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	couchbaseTermSearcher2, err := NewTermSearcher(twoDocIndexReader, "couchbase", "street", 1.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	misterTermSearcher3, err := NewTermSearcher(twoDocIndexReader, "mister", "title", 5.0, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	couchbaseAndMisterSearcher2, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{couchbaseTermSearcher2, misterTermSearcher3}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}
	beerAndCouchbaseAndMisterSearcher, err := NewConjunctionSearcher(twoDocIndexReader, []search.Searcher{beerTermSearcher5, couchbaseAndMisterSearcher2}, explainTrue)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		searcher search.Searcher
		results  []*search.DocumentMatch
	}{
		{
			searcher: beerAndMartySearcher,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("1"),
					Score:           2.0097428702814377,
				},
			},
		},
		{
			searcher: angstAndBeerSearcher,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("2"),
					Score:           1.0807601687084403,
				},
			},
		},
		{
			searcher: beerAndJackSearcher,
			results:  []*search.DocumentMatch{},
		},
		{
			searcher: beerAndMisterSearcher,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("2"),
					Score:           1.2877980334016337,
				},
				{
					IndexInternalID: index.IndexInternalID("3"),
					Score:           1.2877980334016337,
				},
			},
		},
		{
			searcher: couchbaseAndMisterSearcher,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("2"),
					Score:           1.4436599157093672,
				},
			},
		},
		{
			searcher: beerAndCouchbaseAndMisterSearcher,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("2"),
					Score:           1.441614953806971,
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
			DocumentMatchPool: search.NewDocumentMatchPool(10, 0),
		}
		next, err := test.searcher.Next(ctx)
		i := 0
		for err == nil && next != nil {
			if i < len(test.results) {
				if !next.IndexInternalID.Equals(test.results[i].IndexInternalID) {
					t.Errorf("expected result %d to have id %s got %s for test %d", i, test.results[i].IndexInternalID, next.IndexInternalID, testIndex)
				}
				if !scoresCloseEnough(next.Score, test.results[i].Score) {
					t.Errorf("expected result %d to have score %v got  %v for test %d", i, test.results[i].Score, next.Score, testIndex)
					t.Logf("scoring explanation: %s", next.Expl)
				}
			}
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
