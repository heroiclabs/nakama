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

package mem

import (
	"math"
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
)

func TestEmpty(t *testing.T) {

	emptySegment := New()

	if emptySegment.Count() != 0 {
		t.Errorf("expected count 0, got %d", emptySegment.Count())
	}

	dict, err := emptySegment.Dictionary("name")
	if err != nil {
		t.Fatal(err)
	}
	if dict == nil {
		t.Fatal("got nil dict, expected non-nil")
	}

	postingsList, err := dict.PostingsList("marty", nil)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsItr := postingsList.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	count := 0
	nextPosting, err := postingsItr.Next()
	for nextPosting != nil && err == nil {
		count++
		nextPosting, err = postingsItr.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	if count != 0 {
		t.Errorf("expected count to be 0, got %d", count)
	}

	// now try and visit a document
	err = emptySegment.VisitDocument(0, func(field string, typ byte, value []byte, pos []uint64) bool {
		t.Errorf("document visitor called, not expected")
		return true
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestSingle(t *testing.T) {

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
			document.NewCompositeField("_all", true, nil, nil),
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

	segment := NewFromAnalyzedDocs(results)
	if segment == nil {
		t.Fatalf("segment nil, not expected")
	}

	if segment.SizeInBytes() <= 0 {
		t.Fatalf("segment size not updated")
	}

	expectFields := map[string]struct{}{
		"_id":  struct{}{},
		"_all": struct{}{},
		"name": struct{}{},
		"desc": struct{}{},
		"tag":  struct{}{},
	}
	fields := segment.Fields()
	if len(fields) != len(expectFields) {
		t.Errorf("expected %d fields, only got %d", len(expectFields), len(fields))
	}
	for _, field := range fields {
		if _, ok := expectFields[field]; !ok {
			t.Errorf("got unexpected field: %s", field)
		}
	}

	if segment.Count() != 1 {
		t.Errorf("expected count 1, got %d", segment.Count())
	}

	// check the _id field
	dict, err := segment.Dictionary("_id")
	if err != nil {
		t.Fatal(err)
	}
	if dict == nil {
		t.Fatal("got nil dict, expected non-nil")
	}

	postingsList, err := dict.PostingsList("a", nil)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsItr := postingsList.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	count := 0
	nextPosting, err := postingsItr.Next()
	for nextPosting != nil && err == nil {
		count++
		if nextPosting.Frequency() != 1 {
			t.Errorf("expected frequency 1, got %d", nextPosting.Frequency())
		}
		if nextPosting.Number() != 0 {
			t.Errorf("expected doc number 0, got %d", nextPosting.Number())
		}
		if nextPosting.Norm() != 1.0 {
			t.Errorf("expected norm 1.0, got %f", nextPosting.Norm())
		}

		nextPosting, err = postingsItr.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Errorf("expected count to be 1, got %d", count)
	}

	// check the name field
	dict, err = segment.Dictionary("name")
	if err != nil {
		t.Fatal(err)
	}
	if dict == nil {
		t.Fatal("got nil dict, expected non-nil")
	}

	postingsList, err = dict.PostingsList("wow", nil)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsItr = postingsList.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	count = 0
	nextPosting, err = postingsItr.Next()
	for nextPosting != nil && err == nil {
		count++
		if nextPosting.Frequency() != 1 {
			t.Errorf("expected frequency 1, got %d", nextPosting.Frequency())
		}
		if nextPosting.Number() != 0 {
			t.Errorf("expected doc number 0, got %d", nextPosting.Number())
		}
		if nextPosting.Norm() != 1.0 {
			t.Errorf("expected norm 1.0, got %f", nextPosting.Norm())
		}
		var numLocs uint64
		for _, loc := range nextPosting.Locations() {
			numLocs++
			if loc.Field() != "name" {
				t.Errorf("expected loc field to be 'name', got '%s'", loc.Field())
			}
			if loc.Start() != 0 {
				t.Errorf("expected loc start to be 0, got %d", loc.Start())
			}
			if loc.End() != 3 {
				t.Errorf("expected loc end to be 3, got %d", loc.End())
			}
			if loc.Pos() != 1 {
				t.Errorf("expected loc pos to be 1, got %d", loc.Pos())
			}
			if loc.ArrayPositions() != nil {
				t.Errorf("expect loc array pos to be nil, got %v", loc.ArrayPositions())
			}
		}
		if numLocs != nextPosting.Frequency() {
			t.Errorf("expected %d locations, got %d", nextPosting.Frequency(), numLocs)
		}

		nextPosting, err = postingsItr.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Errorf("expected count to be 1, got %d", count)
	}

	// check the _all field (composite)
	dict, err = segment.Dictionary("_all")
	if err != nil {
		t.Fatal(err)
	}
	if dict == nil {
		t.Fatal("got nil dict, expected non-nil")
	}

	postingsList, err = dict.PostingsList("wow", nil)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsItr = postingsList.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	count = 0
	nextPosting, err = postingsItr.Next()
	for nextPosting != nil && err == nil {
		count++
		if nextPosting.Frequency() != 1 {
			t.Errorf("expected frequency 1, got %d", nextPosting.Frequency())
		}
		if nextPosting.Number() != 0 {
			t.Errorf("expected doc number 0, got %d", nextPosting.Number())
		}
		expectedNorm := float32(1.0 / math.Sqrt(float64(6)))
		if nextPosting.Norm() != float64(expectedNorm) {
			t.Errorf("expected norm %f, got %f", expectedNorm, nextPosting.Norm())
		}
		var numLocs uint64
		for _, loc := range nextPosting.Locations() {
			numLocs++
			if loc.Field() != "name" {
				t.Errorf("expected loc field to be 'name', got '%s'", loc.Field())
			}
			if loc.Start() != 0 {
				t.Errorf("expected loc start to be 0, got %d", loc.Start())
			}
			if loc.End() != 3 {
				t.Errorf("expected loc end to be 3, got %d", loc.End())
			}
			if loc.Pos() != 1 {
				t.Errorf("expected loc pos to be 1, got %d", loc.Pos())
			}
			if loc.ArrayPositions() != nil {
				t.Errorf("expect loc array pos to be nil, got %v", loc.ArrayPositions())
			}
		}
		if numLocs != nextPosting.Frequency() {
			t.Errorf("expected %d locations, got %d", nextPosting.Frequency(), numLocs)
		}

		nextPosting, err = postingsItr.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Errorf("expected count to be 1, got %d", count)
	}

	// now try a field with array positions
	dict, err = segment.Dictionary("tag")
	if err != nil {
		t.Fatal(err)
	}
	if dict == nil {
		t.Fatal("got nil dict, expected non-nil")
	}

	postingsList, err = dict.PostingsList("dark", nil)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsItr = postingsList.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	nextPosting, err = postingsItr.Next()
	for nextPosting != nil && err == nil {

		if nextPosting.Frequency() != 1 {
			t.Errorf("expected frequency 1, got %d", nextPosting.Frequency())
		}
		if nextPosting.Number() != 0 {
			t.Errorf("expected doc number 0, got %d", nextPosting.Number())
		}
		var numLocs uint64
		for _, loc := range nextPosting.Locations() {
			numLocs++
			if loc.Field() != "tag" {
				t.Errorf("expected loc field to be 'name', got '%s'", loc.Field())
			}
			if loc.Start() != 0 {
				t.Errorf("expected loc start to be 0, got %d", loc.Start())
			}
			if loc.End() != 4 {
				t.Errorf("expected loc end to be 3, got %d", loc.End())
			}
			if loc.Pos() != 1 {
				t.Errorf("expected loc pos to be 1, got %d", loc.Pos())
			}
			expectArrayPos := []uint64{1}
			if !reflect.DeepEqual(loc.ArrayPositions(), expectArrayPos) {
				t.Errorf("expect loc array pos to be %v, got %v", expectArrayPos, loc.ArrayPositions())
			}
		}
		if numLocs != nextPosting.Frequency() {
			t.Errorf("expected %d locations, got %d", nextPosting.Frequency(), numLocs)
		}

		nextPosting, err = postingsItr.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	// now try and visit a document
	var fieldValuesSeen int
	err = segment.VisitDocument(0, func(field string, typ byte, value []byte, pos []uint64) bool {
		fieldValuesSeen++
		return true
	})
	if err != nil {
		t.Fatal(err)
	}
	if fieldValuesSeen != 5 {
		t.Errorf("expected 5 field values, got %d", fieldValuesSeen)
	}

}

func TestMultiple(t *testing.T) {

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
			document.NewCompositeField("_all", true, nil, nil),
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
			document.NewCompositeField("_all", true, nil, nil),
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

	segment := NewFromAnalyzedDocs(results)
	if segment == nil {
		t.Fatalf("segment nil, not expected")
	}

	if segment.Count() != 2 {
		t.Errorf("expected count 2, got %d", segment.Count())
	}

	// check the desc field
	dict, err := segment.Dictionary("desc")
	if err != nil {
		t.Fatal(err)
	}
	if dict == nil {
		t.Fatal("got nil dict, expected non-nil")
	}

	postingsList, err := dict.PostingsList("thing", nil)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsItr := postingsList.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	count := 0
	nextPosting, err := postingsItr.Next()
	for nextPosting != nil && err == nil {
		count++
		nextPosting, err = postingsItr.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	if count != 2 {
		t.Errorf("expected count to be 2, got %d", count)
	}

	// get docnum of a
	exclude, err := segment.DocNumbers([]string{"a"})
	if err != nil {
		t.Fatal(err)
	}

	// look for term 'thing' excluding doc 'a'
	postingsListExcluding, err := dict.PostingsList("thing", exclude)
	if err != nil {
		t.Fatal(err)
	}
	if postingsList == nil {
		t.Fatal("got nil postings list, expected non-nil")
	}

	postingsListExcludingCount := postingsListExcluding.Count()
	if postingsListExcludingCount != 1 {
		t.Errorf("expected count from postings list to be 1, got %d", postingsListExcludingCount)
	}

	postingsItrExcluding := postingsListExcluding.Iterator()
	if postingsItr == nil {
		t.Fatal("got nil iterator, expected non-nil")
	}

	count = 0
	nextPosting, err = postingsItrExcluding.Next()
	for nextPosting != nil && err == nil {
		count++
		nextPosting, err = postingsItrExcluding.Next()
	}
	if err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Errorf("expected count to be 1, got %d", count)
	}

}
