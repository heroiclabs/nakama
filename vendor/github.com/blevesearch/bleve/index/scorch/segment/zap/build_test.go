//  Copyright (c) 2017 Couchbase, Inc.
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

package zap

import (
	"os"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
)

func TestBuild(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	sb, _, err := buildTestSegment()
	if err != nil {
		t.Fatal(err)
	}
	err = PersistSegmentBase(sb, "/tmp/scorch.zap")
	if err != nil {
		t.Fatal(err)
	}
}

func buildTestSegment() (*SegmentBase, uint64, error) {
	doc := &document.Document{
		ID: "a",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte("a"), document.IndexField|document.StoreField, nil),
			document.NewTextFieldCustom("name", nil, []byte("wow"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("desc", nil, []byte("some thing"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{0}, []byte("cold"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{1}, []byte("dark"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
		},
		CompositeFields: []*document.CompositeField{
			document.NewCompositeField("_all", true, nil, []string{"_id"}),
		},
	}

	// forge analyzed docs
	results := []*index.AnalysisResult{
		&index.AnalysisResult{
			Document: doc,
			Analyzed: []analysis.TokenFrequencies{
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("a"),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("wow"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("some"),
					},
					&analysis.Token{
						Start:    5,
						End:      10,
						Position: 2,
						Term:     []byte("thing"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("cold"),
					},
				}, []uint64{0}, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("dark"),
					},
				}, []uint64{1}, true),
			},
			Length: []int{
				1,
				1,
				2,
				1,
				1,
			},
		},
	}

	// fix up composite fields
	for _, ar := range results {
		for i, f := range ar.Document.Fields {
			for _, cf := range ar.Document.CompositeFields {
				cf.Compose(f.Name(), ar.Length[i], ar.Analyzed[i])
			}
		}
	}

	return AnalysisResultsToSegmentBase(results, 1024)
}

func buildTestSegmentMulti() (*SegmentBase, uint64, error) {
	results := buildTestAnalysisResultsMulti()

	return AnalysisResultsToSegmentBase(results, 1024)
}

func buildTestSegmentMultiWithChunkFactor(chunkFactor uint32) (*SegmentBase, uint64, error) {
	results := buildTestAnalysisResultsMulti()

	return AnalysisResultsToSegmentBase(results, chunkFactor)
}

func buildTestSegmentMultiWithDifferentFields(includeDocA, includeDocB bool) (*SegmentBase, uint64, error) {
	results := buildTestAnalysisResultsMultiWithDifferentFields(includeDocA, includeDocB)

	return AnalysisResultsToSegmentBase(results, 1024)
}

func buildTestAnalysisResultsMulti() []*index.AnalysisResult {
	doc := &document.Document{
		ID: "a",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte("a"), document.IndexField|document.StoreField, nil),
			document.NewTextFieldCustom("name", nil, []byte("wow"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("desc", nil, []byte("some thing"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{0}, []byte("cold"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{1}, []byte("dark"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
		},
		CompositeFields: []*document.CompositeField{
			document.NewCompositeField("_all", true, nil, []string{"_id"}),
		},
	}

	doc2 := &document.Document{
		ID: "b",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte("b"), document.IndexField|document.StoreField, nil),
			document.NewTextFieldCustom("name", nil, []byte("who"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("desc", nil, []byte("some thing"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{0}, []byte("cold"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{1}, []byte("dark"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
		},
		CompositeFields: []*document.CompositeField{
			document.NewCompositeField("_all", true, nil, []string{"_id"}),
		},
	}

	// forge analyzed docs
	results := []*index.AnalysisResult{
		&index.AnalysisResult{
			Document: doc,
			Analyzed: []analysis.TokenFrequencies{
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("a"),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("wow"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("some"),
					},
					&analysis.Token{
						Start:    5,
						End:      10,
						Position: 2,
						Term:     []byte("thing"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("cold"),
					},
				}, []uint64{0}, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("dark"),
					},
				}, []uint64{1}, true),
			},
			Length: []int{
				1,
				1,
				2,
				1,
				1,
			},
		},
		&index.AnalysisResult{
			Document: doc2,
			Analyzed: []analysis.TokenFrequencies{
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("b"),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("who"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("some"),
					},
					&analysis.Token{
						Start:    5,
						End:      10,
						Position: 2,
						Term:     []byte("thing"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("cold"),
					},
				}, []uint64{0}, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("dark"),
					},
				}, []uint64{1}, true),
			},
			Length: []int{
				1,
				1,
				2,
				1,
				1,
			},
		},
	}

	// fix up composite fields
	for _, ar := range results {
		for i, f := range ar.Document.Fields {
			for _, cf := range ar.Document.CompositeFields {
				cf.Compose(f.Name(), ar.Length[i], ar.Analyzed[i])
			}
		}
	}

	return results
}

func buildTestAnalysisResultsMultiWithDifferentFields(includeDocA, includeDocB bool) []*index.AnalysisResult {
	results := []*index.AnalysisResult{}

	if includeDocA {
		doc := &document.Document{
			ID: "a",
			Fields: []document.Field{
				document.NewTextFieldCustom("_id", nil, []byte("a"),
					document.IndexField|document.StoreField, nil),
				document.NewTextField("name", []uint64{}, []byte("ABC")),
				document.NewTextField("dept", []uint64{}, []byte("ABC dept")),
				document.NewTextField("manages.id", []uint64{}, []byte("XYZ")),
				document.NewTextField("manages.count", []uint64{}, []byte("1")),
			},
			CompositeFields: []*document.CompositeField{
				document.NewCompositeField("_all", true, nil, []string{"_id"}),
			},
		}

		result := &index.AnalysisResult{
			Document: doc,
			Analyzed: []analysis.TokenFrequencies{
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("a"),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("ABC"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("ABC"),
					},
					&analysis.Token{
						Start:    4,
						End:      8,
						Position: 2,
						Term:     []byte("dept"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("XYZ"),
					},
				}, []uint64{0}, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("1"),
					},
				}, []uint64{1}, true),
			},
			Length: []int{
				1,
				1,
				2,
				1,
				1,
			},
		}

		results = append(results, result)
	}

	if includeDocB {
		doc := &document.Document{
			ID: "b",
			Fields: []document.Field{
				document.NewTextFieldCustom("_id", nil, []byte("b"),
					document.IndexField|document.StoreField, nil),
				document.NewTextField("name", []uint64{}, []byte("XYZ")),
				document.NewTextField("dept", []uint64{}, []byte("ABC dept")),
				document.NewTextField("reportsTo.id", []uint64{}, []byte("ABC")),
			},
			CompositeFields: []*document.CompositeField{
				document.NewCompositeField("_all", true, nil, []string{"_id"}),
			},
		}

		result := &index.AnalysisResult{
			Document: doc,
			Analyzed: []analysis.TokenFrequencies{
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("b"),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("XYZ"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("ABC"),
					},
					&analysis.Token{
						Start:    4,
						End:      8,
						Position: 2,
						Term:     []byte("dept"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("ABC"),
					},
				}, []uint64{0}, true),
			},
			Length: []int{
				1,
				1,
				2,
				1,
			},
		}

		results = append(results, result)
	}

	// fix up composite fields
	for _, ar := range results {
		for i, f := range ar.Document.Fields {
			for _, cf := range ar.Document.CompositeFields {
				cf.Compose(f.Name(), ar.Length[i], ar.Analyzed[i])
			}
		}
	}

	return results
}

func buildTestSegmentWithDefaultFieldMapping(chunkFactor uint32) (
	*SegmentBase, []string, error) {
	doc := &document.Document{
		ID: "a",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte("a"),
				document.IndexField|document.StoreField, nil),
			document.NewTextField("name", nil, []byte("wow")),
			document.NewTextField("desc", nil, []byte("some thing")),
			document.NewTextField("tag", []uint64{0}, []byte("cold")),
		},
		CompositeFields: []*document.CompositeField{
			document.NewCompositeField("_all", true, nil, []string{"_id"}),
		},
	}

	var fields []string
	fields = append(fields, "_id")
	fields = append(fields, "name")
	fields = append(fields, "desc")
	fields = append(fields, "tag")

	// forge analyzed docs
	results := []*index.AnalysisResult{
		&index.AnalysisResult{
			Document: doc,
			Analyzed: []analysis.TokenFrequencies{
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      1,
						Position: 1,
						Term:     []byte("a"),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("wow"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("some"),
					},
					&analysis.Token{
						Start:    5,
						End:      10,
						Position: 2,
						Term:     []byte("thing"),
					},
				}, nil, true),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      4,
						Position: 1,
						Term:     []byte("cold"),
					},
				}, []uint64{0}, true),
			},
			Length: []int{
				1,
				1,
				2,
				1,
				1,
			},
		},
	}

	// fix up composite fields
	for _, ar := range results {
		for i, f := range ar.Document.Fields {
			for _, cf := range ar.Document.CompositeFields {
				cf.Compose(f.Name(), ar.Length[i], ar.Analyzed[i])
			}
		}
	}

	sb, _, err := AnalysisResultsToSegmentBase(results, chunkFactor)

	return sb, fields, err
}
