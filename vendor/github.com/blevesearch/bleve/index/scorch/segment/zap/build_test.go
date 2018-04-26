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
	"github.com/blevesearch/bleve/index/scorch/segment/mem"
)

func TestBuild(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment := buildMemSegment()
	err := PersistSegment(memSegment, "/tmp/scorch.zap", 1024)
	if err != nil {
		t.Fatal(err)
	}
}

func buildMemSegment() *mem.Segment {
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

	return mem.NewFromAnalyzedDocs(results)
}

func buildMemSegmentMulti() *mem.Segment {

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

	segment := mem.NewFromAnalyzedDocs(results)

	return segment
}

func buildMemSegmentWithDefaultFieldMapping() (*mem.Segment, []string) {

	doc := &document.Document{
		ID: "a",
		Fields: []document.Field{
			document.NewTextField("_id", nil, []byte("a")),
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

	return mem.NewFromAnalyzedDocs(results), fields
}
