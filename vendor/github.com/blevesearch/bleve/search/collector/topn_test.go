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

package collector

import (
	"testing"

	"golang.org/x/net/context"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

func TestTop10Scores(t *testing.T) {

	// a stub search with more than 10 matches
	// the top-10 scores are > 10
	// everything else is less than 10
	searcher := &stubSearcher{
		matches: []*search.DocumentMatch{
			{
				IndexInternalID: index.IndexInternalID("a"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("b"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("c"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("d"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("e"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("f"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("g"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("h"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("i"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("j"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("k"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("l"),
				Score:           99,
			},
			{
				IndexInternalID: index.IndexInternalID("m"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("n"),
				Score:           11,
			},
		},
	}

	collector := NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	err := collector.Collect(context.Background(), searcher, &stubReader{})
	if err != nil {
		t.Fatal(err)
	}

	maxScore := collector.MaxScore()
	if maxScore != 99.0 {
		t.Errorf("expected max score 99.0, got %f", maxScore)
	}

	total := collector.Total()
	if total != 14 {
		t.Errorf("expected 14 total results, got %d", total)
	}

	results := collector.Results()

	if len(results) != 10 {
		t.Logf("results: %v", results)
		t.Fatalf("expected 10 results, got %d", len(results))
	}

	if results[0].ID != "l" {
		t.Errorf("expected first result to have ID 'l', got %s", results[0].ID)
	}

	if results[0].Score != 99.0 {
		t.Errorf("expected highest score to be 99.0, got %f", results[0].Score)
	}

	minScore := 1000.0
	for _, result := range results {
		if result.Score < minScore {
			minScore = result.Score
		}
	}

	if minScore < 10 {
		t.Errorf("expected minimum score to be higher than 10, got %f", minScore)
	}
}

func TestTop10ScoresSkip10(t *testing.T) {

	// a stub search with more than 10 matches
	// the top-10 scores are > 10
	// everything else is less than 10
	searcher := &stubSearcher{
		matches: []*search.DocumentMatch{
			{
				IndexInternalID: index.IndexInternalID("a"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("b"),
				Score:           9.5,
			},
			{
				IndexInternalID: index.IndexInternalID("c"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("d"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("e"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("f"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("g"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("h"),
				Score:           9,
			},
			{
				IndexInternalID: index.IndexInternalID("i"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("j"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("k"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("l"),
				Score:           99,
			},
			{
				IndexInternalID: index.IndexInternalID("m"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("n"),
				Score:           11,
			},
		},
	}

	collector := NewTopNCollector(10, 10, search.SortOrder{&search.SortScore{Desc: true}})
	err := collector.Collect(context.Background(), searcher, &stubReader{})
	if err != nil {
		t.Fatal(err)
	}

	maxScore := collector.MaxScore()
	if maxScore != 99.0 {
		t.Errorf("expected max score 99.0, got %f", maxScore)
	}

	total := collector.Total()
	if total != 14 {
		t.Errorf("expected 14 total results, got %d", total)
	}

	results := collector.Results()

	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}

	if results[0].ID != "b" {
		t.Errorf("expected first result to have ID 'b', got %s", results[0].ID)
	}

	if results[0].Score != 9.5 {
		t.Errorf("expected highest score to be 9.5, got %f", results[0].Score)
	}
}

func TestTop10ScoresSkip10Only9Hits(t *testing.T) {

	// a stub search with only 10 matches
	searcher := &stubSearcher{
		matches: []*search.DocumentMatch{
			{
				IndexInternalID: index.IndexInternalID("a"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("c"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("e"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("g"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("i"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("j"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("k"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("m"),
				Score:           11,
			},
			{
				IndexInternalID: index.IndexInternalID("n"),
				Score:           11,
			},
		},
	}

	collector := NewTopNCollector(10, 10, search.SortOrder{&search.SortScore{Desc: true}})
	err := collector.Collect(context.Background(), searcher, &stubReader{})
	if err != nil {
		t.Fatal(err)
	}

	total := collector.Total()
	if total != 9 {
		t.Errorf("expected 9 total results, got %d", total)
	}

	results := collector.Results()

	if len(results) != 0 {
		t.Fatalf("expected 0 results, got %d", len(results))
	}
}

func TestPaginationSameScores(t *testing.T) {

	// a stub search with more than 10 matches
	// all documents have the same score
	searcher := &stubSearcher{
		matches: []*search.DocumentMatch{
			{
				IndexInternalID: index.IndexInternalID("a"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("b"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("c"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("d"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("e"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("f"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("g"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("h"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("i"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("j"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("k"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("l"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("m"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("n"),
				Score:           5,
			},
		},
	}

	// first get first 5 hits
	collector := NewTopNCollector(5, 0, search.SortOrder{&search.SortScore{Desc: true}})
	err := collector.Collect(context.Background(), searcher, &stubReader{})
	if err != nil {
		t.Fatal(err)
	}

	total := collector.Total()
	if total != 14 {
		t.Errorf("expected 14 total results, got %d", total)
	}

	results := collector.Results()

	if len(results) != 5 {
		t.Fatalf("expected 5 results, got %d", len(results))
	}

	firstResults := make(map[string]struct{})
	for _, hit := range results {
		firstResults[hit.ID] = struct{}{}
	}

	// a stub search with more than 10 matches
	// all documents have the same score
	searcher = &stubSearcher{
		matches: []*search.DocumentMatch{
			{
				IndexInternalID: index.IndexInternalID("a"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("b"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("c"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("d"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("e"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("f"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("g"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("h"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("i"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("j"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("k"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("l"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("m"),
				Score:           5,
			},
			{
				IndexInternalID: index.IndexInternalID("n"),
				Score:           5,
			},
		},
	}

	// now get next 5 hits
	collector = NewTopNCollector(5, 5, search.SortOrder{&search.SortScore{Desc: true}})
	err = collector.Collect(context.Background(), searcher, &stubReader{})
	if err != nil {
		t.Fatal(err)
	}

	total = collector.Total()
	if total != 14 {
		t.Errorf("expected 14 total results, got %d", total)
	}

	results = collector.Results()

	if len(results) != 5 {
		t.Fatalf("expected 5 results, got %d", len(results))
	}

	// make sure that none of these hits repeat ones we saw in the top 5
	for _, hit := range results {
		if _, ok := firstResults[hit.ID]; ok {
			t.Errorf("doc ID %s is in top 5 and next 5 result sets", hit.ID)
		}
	}
}

func BenchmarkTop10of0Scores(b *testing.B) {
	benchHelper(0, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10of3Scores(b *testing.B) {
	benchHelper(3, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10of10Scores(b *testing.B) {
	benchHelper(10, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10of25Scores(b *testing.B) {
	benchHelper(25, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10of50Scores(b *testing.B) {
	benchHelper(50, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10of10000Scores(b *testing.B) {
	benchHelper(10000, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of0Scores(b *testing.B) {
	benchHelper(0, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of3Scores(b *testing.B) {
	benchHelper(3, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of10Scores(b *testing.B) {
	benchHelper(10, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of25Scores(b *testing.B) {
	benchHelper(25, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of50Scores(b *testing.B) {
	benchHelper(50, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of10000Scores(b *testing.B) {
	benchHelper(10000, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop1000of10000Scores(b *testing.B) {
	benchHelper(10000, func() search.Collector {
		return NewTopNCollector(1000, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10000of100000Scores(b *testing.B) {
	benchHelper(100000, func() search.Collector {
		return NewTopNCollector(10000, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10of100000Scores(b *testing.B) {
	benchHelper(100000, func() search.Collector {
		return NewTopNCollector(10, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop100of100000Scores(b *testing.B) {
	benchHelper(100000, func() search.Collector {
		return NewTopNCollector(100, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop1000of100000Scores(b *testing.B) {
	benchHelper(100000, func() search.Collector {
		return NewTopNCollector(1000, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}

func BenchmarkTop10000of1000000Scores(b *testing.B) {
	benchHelper(1000000, func() search.Collector {
		return NewTopNCollector(10000, 0, search.SortOrder{&search.SortScore{Desc: true}})
	}, b)
}
