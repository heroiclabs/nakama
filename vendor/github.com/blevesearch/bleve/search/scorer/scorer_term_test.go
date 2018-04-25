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

package scorer

import (
	"math"
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/search"
)

func TestTermScorer(t *testing.T) {

	var docTotal uint64 = 100
	var docTerm uint64 = 9
	var queryTerm = []byte("beer")
	var queryField = "desc"
	var queryBoost = 1.0
	scorer := NewTermQueryScorer(queryTerm, queryField, queryBoost, docTotal, docTerm, search.SearcherOptions{Explain: true})
	idf := 1.0 + math.Log(float64(docTotal)/float64(docTerm+1.0))

	tests := []struct {
		termMatch *index.TermFieldDoc
		result    *search.DocumentMatch
	}{
		// test some simple math
		{
			termMatch: &index.TermFieldDoc{
				ID:   index.IndexInternalID("one"),
				Freq: 1,
				Norm: 1.0,
				Vectors: []*index.TermFieldVector{
					{
						Field: "desc",
						Pos:   1,
						Start: 0,
						End:   4,
					},
				},
			},
			result: &search.DocumentMatch{
				IndexInternalID: index.IndexInternalID("one"),
				Score:           math.Sqrt(1.0) * idf,
				Sort:            []string{},
				Expl: &search.Explanation{
					Value:   math.Sqrt(1.0) * idf,
					Message: "fieldWeight(desc:beer in one), product of:",
					Children: []*search.Explanation{
						{
							Value:   1,
							Message: "tf(termFreq(desc:beer)=1",
						},
						{
							Value:   1,
							Message: "fieldNorm(field=desc, doc=one)",
						},
						{
							Value:   idf,
							Message: "idf(docFreq=9, maxDocs=100)",
						},
					},
				},
				Locations: search.FieldTermLocationMap{
					"desc": search.TermLocationMap{
						"beer": []*search.Location{
							{
								Pos:   1,
								Start: 0,
								End:   4,
							},
						},
					},
				},
			},
		},
		// test the same thing again (score should be cached this time)
		{
			termMatch: &index.TermFieldDoc{
				ID:   index.IndexInternalID("one"),
				Freq: 1,
				Norm: 1.0,
			},
			result: &search.DocumentMatch{
				IndexInternalID: index.IndexInternalID("one"),
				Score:           math.Sqrt(1.0) * idf,
				Sort:            []string{},
				Expl: &search.Explanation{
					Value:   math.Sqrt(1.0) * idf,
					Message: "fieldWeight(desc:beer in one), product of:",
					Children: []*search.Explanation{
						{
							Value:   1,
							Message: "tf(termFreq(desc:beer)=1",
						},
						{
							Value:   1,
							Message: "fieldNorm(field=desc, doc=one)",
						},
						{
							Value:   idf,
							Message: "idf(docFreq=9, maxDocs=100)",
						},
					},
				},
			},
		},
		// test a case where the sqrt isn't precalculated
		{
			termMatch: &index.TermFieldDoc{
				ID:   index.IndexInternalID("one"),
				Freq: 65,
				Norm: 1.0,
			},
			result: &search.DocumentMatch{
				IndexInternalID: index.IndexInternalID("one"),
				Score:           math.Sqrt(65) * idf,
				Sort:            []string{},
				Expl: &search.Explanation{
					Value:   math.Sqrt(65) * idf,
					Message: "fieldWeight(desc:beer in one), product of:",
					Children: []*search.Explanation{
						{
							Value:   math.Sqrt(65),
							Message: "tf(termFreq(desc:beer)=65",
						},
						{
							Value:   1,
							Message: "fieldNorm(field=desc, doc=one)",
						},
						{
							Value:   idf,
							Message: "idf(docFreq=9, maxDocs=100)",
						},
					},
				},
			},
		},
	}

	for _, test := range tests {
		ctx := &search.SearchContext{
			DocumentMatchPool: search.NewDocumentMatchPool(1, 0),
		}
		actual := scorer.Score(ctx, test.termMatch)

		if !reflect.DeepEqual(actual, test.result) {
			t.Errorf("expected %#v got %#v for %#v", test.result, actual, test.termMatch)
		}
	}

}

func TestTermScorerWithQueryNorm(t *testing.T) {

	var docTotal uint64 = 100
	var docTerm uint64 = 9
	var queryTerm = []byte("beer")
	var queryField = "desc"
	var queryBoost = 3.0
	scorer := NewTermQueryScorer(queryTerm, queryField, queryBoost, docTotal, docTerm, search.SearcherOptions{Explain: true})
	idf := 1.0 + math.Log(float64(docTotal)/float64(docTerm+1.0))

	scorer.SetQueryNorm(2.0)

	expectedQueryWeight := 3 * idf * 3 * idf
	actualQueryWeight := scorer.Weight()
	if expectedQueryWeight != actualQueryWeight {
		t.Errorf("expected query weight %f, got %f", expectedQueryWeight, actualQueryWeight)
	}

	tests := []struct {
		termMatch *index.TermFieldDoc
		result    *search.DocumentMatch
	}{
		{
			termMatch: &index.TermFieldDoc{
				ID:   index.IndexInternalID("one"),
				Freq: 1,
				Norm: 1.0,
			},
			result: &search.DocumentMatch{
				IndexInternalID: index.IndexInternalID("one"),
				Score:           math.Sqrt(1.0) * idf * 3.0 * idf * 2.0,
				Sort:            []string{},
				Expl: &search.Explanation{
					Value:   math.Sqrt(1.0) * idf * 3.0 * idf * 2.0,
					Message: "weight(desc:beer^3.000000 in one), product of:",
					Children: []*search.Explanation{
						{
							Value:   2.0 * idf * 3.0,
							Message: "queryWeight(desc:beer^3.000000), product of:",
							Children: []*search.Explanation{
								{
									Value:   3,
									Message: "boost",
								},
								{
									Value:   idf,
									Message: "idf(docFreq=9, maxDocs=100)",
								},
								{
									Value:   2,
									Message: "queryNorm",
								},
							},
						},
						{
							Value:   math.Sqrt(1.0) * idf,
							Message: "fieldWeight(desc:beer in one), product of:",
							Children: []*search.Explanation{
								{
									Value:   1,
									Message: "tf(termFreq(desc:beer)=1",
								},
								{
									Value:   1,
									Message: "fieldNorm(field=desc, doc=one)",
								},
								{
									Value:   idf,
									Message: "idf(docFreq=9, maxDocs=100)",
								},
							},
						},
					},
				},
			},
		},
	}

	for _, test := range tests {
		ctx := &search.SearchContext{
			DocumentMatchPool: search.NewDocumentMatchPool(1, 0),
		}
		actual := scorer.Score(ctx, test.termMatch)

		if !reflect.DeepEqual(actual, test.result) {
			t.Errorf("expected %#v got %#v for %#v", test.result, actual, test.termMatch)
		}
	}

}
