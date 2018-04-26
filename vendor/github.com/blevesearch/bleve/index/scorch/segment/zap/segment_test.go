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
	"math"
	"os"
	"reflect"
	"sort"
	"testing"

	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/index/scorch/segment"
)

func TestOpen(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment := buildMemSegment()
	err := PersistSegment(memSegment, "/tmp/scorch.zap", 1024)
	if err != nil {
		t.Fatalf("error persisting segment: %v", err)
	}

	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", cerr)
		}
	}()

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

	docCount := segment.Count()
	if docCount != 1 {
		t.Errorf("expected count 1, got %d", docCount)
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
		expectedNorm := float32(1.0 / math.Sqrt(float64(5)))
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

func TestOpenMulti(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment := buildMemSegmentMulti()
	err := PersistSegment(memSegment, "/tmp/scorch.zap", 1024)
	if err != nil {
		t.Fatalf("error persisting segment: %v", err)
	}

	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", cerr)
		}
	}()

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

func TestOpenMultiWithTwoChunks(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment := buildMemSegmentMulti()
	err := PersistSegment(memSegment, "/tmp/scorch.zap", 1)
	if err != nil {
		t.Fatalf("error persisting segment: %v", err)
	}

	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", cerr)
		}
	}()

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

func TestSegmentVisitableDocValueFieldsList(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment := buildMemSegmentMulti()
	err := PersistSegment(memSegment, "/tmp/scorch.zap", 1)
	if err != nil {
		t.Fatalf("error persisting segment: %v", err)
	}

	seg, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}

	if zaps, ok := seg.(segment.DocumentFieldTermVisitable); ok {
		fields, err := zaps.VisitableDocValueFields()
		if err != nil {
			t.Fatalf("segment VisitableDocValueFields err: %v", err)
		}
		// no persisted doc value fields
		if len(fields) != 0 {
			t.Errorf("expected no persisted fields for doc values, got: %#v", fields)
		}
	}

	err = seg.Close()
	if err != nil {
		t.Fatalf("error closing segment: %v", err)
	}
	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment, expectedFields := buildMemSegmentWithDefaultFieldMapping()
	err = PersistSegment(memSegment, "/tmp/scorch.zap", 1)
	if err != nil {
		t.Fatalf("error persisting segment: %v", err)
	}

	seg, err = Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}

	defer func() {
		cerr := seg.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", cerr)
		}
	}()

	if zaps, ok := seg.(segment.DocumentFieldTermVisitable); ok {
		fields, err := zaps.VisitableDocValueFields()
		if err != nil {
			t.Fatalf("segment VisitableDocValueFields err: %v", err)
		}

		sort.Strings(expectedFields[1:]) // keep _id as first field
		if !reflect.DeepEqual(fields, expectedFields) {
			t.Errorf("expected field terms: %#v, got: %#v", expectedFields, fields)
		}

		fieldTerms := make(index.FieldTerms)
		err = zaps.VisitDocumentFieldTerms(0, fields, func(field string, term []byte) {
			fieldTerms[field] = append(fieldTerms[field], string(term))
		})
		if err != nil {
			t.Error(err)
		}

		expectedFieldTerms := index.FieldTerms{
			"name": []string{"wow"},
			"desc": []string{"some", "thing"},
			"tag":  []string{"cold"},
			"_id":  []string{"a"},
		}
		if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
			t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
		}

	}
}
