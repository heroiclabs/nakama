//  Copyright (c) 2013 Couchbase, Inc.
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
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

func TestPhraseSearch(t *testing.T) {

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

	soptions := search.SearcherOptions{Explain: true, IncludeTermVectors: true}
	phraseSearcher, err := NewPhraseSearcher(twoDocIndexReader, []string{"angst", "beer"}, "desc", soptions)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		searcher   search.Searcher
		results    []*search.DocumentMatch
		locations  map[string]map[string][]search.Location
		fieldterms [][2]string
	}{
		{
			searcher: phraseSearcher,
			results: []*search.DocumentMatch{
				{
					IndexInternalID: index.IndexInternalID("2"),
					Score:           1.0807601687084403,
				},
			},
			locations:  map[string]map[string][]search.Location{"desc": map[string][]search.Location{"beer": []search.Location{search.Location{Pos: 2, Start: 6, End: 10}}, "angst": []search.Location{search.Location{Pos: 1, Start: 0, End: 5}}}},
			fieldterms: [][2]string{[2]string{"desc", "beer"}, [2]string{"desc", "angst"}},
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
					t.Errorf("expected result %d to have id %s got %s for test %d\n", i, test.results[i].IndexInternalID, next.IndexInternalID, testIndex)
				}
				if next.Score != test.results[i].Score {
					t.Errorf("expected result %d to have score %v got %v for test %d\n", i, test.results[i].Score, next.Score, testIndex)
					t.Logf("scoring explanation: %s\n", next.Expl)
				}
				for _, ft := range test.fieldterms {
					locs := next.Locations[ft[0]][ft[1]]
					explocs := test.locations[ft[0]][ft[1]]
					if len(explocs) != len(locs) {
						t.Fatalf("expected result %d to have %d Locations (%#v) but got %d (%#v) for test %d with field %q and term %q\n", i, len(explocs), explocs, len(locs), locs, testIndex, ft[0], ft[1])
					}
					for ind, exploc := range explocs {
						if !reflect.DeepEqual(*locs[ind], exploc) {
							t.Errorf("expected result %d to have Location %v got %v for test %d\n", i, exploc, locs[ind], testIndex)
						}
					}
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

func TestMultiPhraseSearch(t *testing.T) {

	soptions := search.SearcherOptions{Explain: true, IncludeTermVectors: true}

	tests := []struct {
		phrase [][]string
		docids [][]byte
	}{
		{
			phrase: [][]string{[]string{"angst", "what"}, []string{"beer"}},
			docids: [][]byte{[]byte("2")},
		},
	}

	for i, test := range tests {

		reader, err := twoDocIndex.Reader()
		if err != nil {
			t.Error(err)
		}
		searcher, err := NewMultiPhraseSearcher(reader, test.phrase, "desc", soptions)
		if err != nil {
			t.Error(err)
		}
		ctx := &search.SearchContext{
			DocumentMatchPool: search.NewDocumentMatchPool(searcher.DocumentMatchPoolSize(), 0),
		}
		next, err := searcher.Next(ctx)
		var actualIds [][]byte
		for err == nil && next != nil {
			actualIds = append(actualIds, next.IndexInternalID)
			ctx.DocumentMatchPool.Put(next)
			next, err = searcher.Next(ctx)
		}
		if err != nil {
			t.Fatalf("error iterating searcher: %v for test %d", err, i)
		}
		if !reflect.DeepEqual(test.docids, actualIds) {
			t.Fatalf("expected ids: %v, got %v", test.docids, actualIds)
		}

		err = searcher.Close()
		if err != nil {
			t.Error(err)
		}

		err = reader.Close()
		if err != nil {
			t.Error(err)
		}
	}
}

func TestFindPhrasePaths(t *testing.T) {
	tests := []struct {
		phrase [][]string
		tlm    search.TermLocationMap
		paths  []phrasePath
	}{
		// simplest matching case
		{
			phrase: [][]string{[]string{"cat"}, []string{"dog"}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 1,
					},
				},
				"dog": search.Locations{
					&search.Location{
						Pos: 2,
					},
				},
			},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"dog", &search.Location{Pos: 2}},
				},
			},
		},
		// second term missing, no match
		{
			phrase: [][]string{[]string{"cat"}, []string{"dog"}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 1,
					},
				},
			},
			paths: nil,
		},
		// second term exists but in wrong position
		{
			phrase: [][]string{[]string{"cat"}, []string{"dog"}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 1,
					},
				},
				"dog": search.Locations{
					&search.Location{
						Pos: 3,
					},
				},
			},
			paths: nil,
		},
		// matches multiple times
		{
			phrase: [][]string{[]string{"cat"}, []string{"dog"}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 1,
					},
					&search.Location{
						Pos: 8,
					},
				},
				"dog": search.Locations{
					&search.Location{
						Pos: 2,
					},
					&search.Location{
						Pos: 9,
					},
				},
			},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"dog", &search.Location{Pos: 2}},
				},
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 8}},
					&phrasePart{"dog", &search.Location{Pos: 9}},
				},
			},
		},
		// match over gaps
		{
			phrase: [][]string{[]string{"cat"}, []string{""}, []string{"dog"}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 1,
					},
				},
				"dog": search.Locations{
					&search.Location{
						Pos: 3,
					},
				},
			},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"dog", &search.Location{Pos: 3}},
				},
			},
		},
		// match with leading ""
		{
			phrase: [][]string{[]string{""}, []string{"cat"}, []string{"dog"}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 2,
					},
				},
				"dog": search.Locations{
					&search.Location{
						Pos: 3,
					},
				},
			},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 2}},
					&phrasePart{"dog", &search.Location{Pos: 3}},
				},
			},
		},
		// match with trailing ""
		{
			phrase: [][]string{[]string{"cat"}, []string{"dog"}, []string{""}},
			tlm: search.TermLocationMap{
				"cat": search.Locations{
					&search.Location{
						Pos: 2,
					},
				},
				"dog": search.Locations{
					&search.Location{
						Pos: 3,
					},
				},
			},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 2}},
					&phrasePart{"dog", &search.Location{Pos: 3}},
				},
			},
		},
	}

	for i, test := range tests {
		actualPaths := findPhrasePaths(0, nil, test.phrase, test.tlm, nil, 0)
		if !reflect.DeepEqual(actualPaths, test.paths) {
			t.Fatalf("expected: %v got %v for test %d", test.paths, actualPaths, i)
		}
	}
}

func TestFindPhrasePathsSloppy(t *testing.T) {
	tlm := search.TermLocationMap{
		"one": search.Locations{
			&search.Location{
				Pos: 1,
			},
		},
		"two": search.Locations{
			&search.Location{
				Pos: 2,
			},
		},
		"three": search.Locations{
			&search.Location{
				Pos: 3,
			},
		},
		"four": search.Locations{
			&search.Location{
				Pos: 4,
			},
		},
		"five": search.Locations{
			&search.Location{
				Pos: 5,
			},
		},
	}

	tests := []struct {
		phrase [][]string
		paths  []phrasePath
		slop   int
	}{
		// no match
		{
			phrase: [][]string{[]string{"one"}, []string{"five"}},
			slop:   2,
		},
		// should match
		{
			phrase: [][]string{[]string{"one"}, []string{"five"}},
			slop:   3,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"one", &search.Location{Pos: 1}},
					&phrasePart{"five", &search.Location{Pos: 5}},
				},
			},
		},
		// slop 0 finds exact match
		{
			phrase: [][]string{[]string{"four"}, []string{"five"}},
			slop:   0,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"four", &search.Location{Pos: 4}},
					&phrasePart{"five", &search.Location{Pos: 5}},
				},
			},
		},
		// slop 0 does not find exact match (reversed)
		{
			phrase: [][]string{[]string{"two"}, []string{"one"}},
			slop:   0,
		},
		// slop 1 finds exact match
		{
			phrase: [][]string{[]string{"one"}, []string{"two"}},
			slop:   1,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"one", &search.Location{Pos: 1}},
					&phrasePart{"two", &search.Location{Pos: 2}},
				},
			},
		},
		// slop 1 *still* does not find exact match (reversed) requires at least 2
		{
			phrase: [][]string{[]string{"two"}, []string{"one"}},
			slop:   1,
		},
		// slop 2 does finds exact match reversed
		{
			phrase: [][]string{[]string{"two"}, []string{"one"}},
			slop:   2,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"two", &search.Location{Pos: 2}},
					&phrasePart{"one", &search.Location{Pos: 1}},
				},
			},
		},
		// slop 2 not enough for this
		{
			phrase: [][]string{[]string{"three"}, []string{"one"}},
			slop:   2,
		},
		// slop should be cumulative
		{
			phrase: [][]string{[]string{"one"}, []string{"three"}, []string{"five"}},
			slop:   2,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"one", &search.Location{Pos: 1}},
					&phrasePart{"three", &search.Location{Pos: 3}},
					&phrasePart{"five", &search.Location{Pos: 5}},
				},
			},
		},
		// should require 6
		{
			phrase: [][]string{[]string{"five"}, []string{"three"}, []string{"one"}},
			slop:   5,
		},
		// so lets try 6
		{
			phrase: [][]string{[]string{"five"}, []string{"three"}, []string{"one"}},
			slop:   6,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"five", &search.Location{Pos: 5}},
					&phrasePart{"three", &search.Location{Pos: 3}},
					&phrasePart{"one", &search.Location{Pos: 1}},
				},
			},
		},
	}

	for i, test := range tests {
		actualPaths := findPhrasePaths(0, nil, test.phrase, tlm, nil, test.slop)
		if !reflect.DeepEqual(actualPaths, test.paths) {
			t.Fatalf("expected: %v got %v for test %d", test.paths, actualPaths, i)
		}
	}
}

func TestFindPhrasePathsSloppyPalyndrome(t *testing.T) {
	tlm := search.TermLocationMap{
		"one": search.Locations{
			&search.Location{
				Pos: 1,
			},
			&search.Location{
				Pos: 5,
			},
		},
		"two": search.Locations{
			&search.Location{
				Pos: 2,
			},
			&search.Location{
				Pos: 4,
			},
		},
		"three": search.Locations{
			&search.Location{
				Pos: 3,
			},
		},
	}

	tests := []struct {
		phrase [][]string
		paths  []phrasePath
		slop   int
	}{
		// search non palyndrone, exact match
		{
			phrase: [][]string{[]string{"two"}, []string{"three"}},
			slop:   0,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"two", &search.Location{Pos: 2}},
					&phrasePart{"three", &search.Location{Pos: 3}},
				},
			},
		},
		// same with slop 2 (not required) (find it twice)
		{
			phrase: [][]string{[]string{"two"}, []string{"three"}},
			slop:   2,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"two", &search.Location{Pos: 2}},
					&phrasePart{"three", &search.Location{Pos: 3}},
				},
				phrasePath{
					&phrasePart{"two", &search.Location{Pos: 4}},
					&phrasePart{"three", &search.Location{Pos: 3}},
				},
			},
		},
		// palyndrone reversed
		{
			phrase: [][]string{[]string{"three"}, []string{"two"}},
			slop:   2,
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"three", &search.Location{Pos: 3}},
					&phrasePart{"two", &search.Location{Pos: 2}},
				},
				phrasePath{
					&phrasePart{"three", &search.Location{Pos: 3}},
					&phrasePart{"two", &search.Location{Pos: 4}},
				},
			},
		},
	}

	for i, test := range tests {
		actualPaths := findPhrasePaths(0, nil, test.phrase, tlm, nil, test.slop)
		if !reflect.DeepEqual(actualPaths, test.paths) {
			t.Fatalf("expected: %v got %v for test %d", test.paths, actualPaths, i)
		}
	}
}

func TestFindMultiPhrasePaths(t *testing.T) {

	tlm := search.TermLocationMap{
		"cat": search.Locations{
			&search.Location{
				Pos: 1,
			},
		},
		"dog": search.Locations{
			&search.Location{
				Pos: 2,
			},
		},
		"frog": search.Locations{
			&search.Location{
				Pos: 3,
			},
		},
	}

	tests := []struct {
		phrase [][]string
		paths  []phrasePath
	}{
		// simplest, one of two possible terms matches
		{
			phrase: [][]string{[]string{"cat", "rat"}, []string{"dog"}},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"dog", &search.Location{Pos: 2}},
				},
			},
		},
		// two possible terms, neither work
		{
			phrase: [][]string{[]string{"cat", "rat"}, []string{"chicken"}},
		},
		// two possible terms, one works, but out of position with next
		{
			phrase: [][]string{[]string{"cat", "rat"}, []string{"frog"}},
		},
		// matches multiple times, with different pairing
		{
			phrase: [][]string{[]string{"cat", "dog"}, []string{"dog", "frog"}},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"dog", &search.Location{Pos: 2}},
				},
				phrasePath{
					&phrasePart{"dog", &search.Location{Pos: 2}},
					&phrasePart{"frog", &search.Location{Pos: 3}},
				},
			},
		},
		// multi-match over a gap
		{
			phrase: [][]string{[]string{"cat", "rat"}, []string{""}, []string{"frog"}},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"frog", &search.Location{Pos: 3}},
				},
			},
		},
		// multi-match over a gap (same as before, but with empty term list)
		{
			phrase: [][]string{[]string{"cat", "rat"}, []string{}, []string{"frog"}},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"frog", &search.Location{Pos: 3}},
				},
			},
		},
		// multi-match over a gap (same once again, but nil term list)
		{
			phrase: [][]string{[]string{"cat", "rat"}, nil, []string{"frog"}},
			paths: []phrasePath{
				phrasePath{
					&phrasePart{"cat", &search.Location{Pos: 1}},
					&phrasePart{"frog", &search.Location{Pos: 3}},
				},
			},
		},
	}

	for i, test := range tests {
		actualPaths := findPhrasePaths(0, nil, test.phrase, tlm, nil, 0)
		if !reflect.DeepEqual(actualPaths, test.paths) {
			t.Fatalf("expected: %v got %v for test %d", test.paths, actualPaths, i)
		}
	}
}
