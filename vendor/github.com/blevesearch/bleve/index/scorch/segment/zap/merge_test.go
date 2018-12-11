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
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/RoaringBitmap/roaring"
	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
)

func TestMerge(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")
	_ = os.RemoveAll("/tmp/scorch2.zap")
	_ = os.RemoveAll("/tmp/scorch3.zap")

	testSeg, _, _ := buildTestSegmentMulti()
	err := PersistSegmentBase(testSeg, "/tmp/scorch.zap")
	if err != nil {
		t.Fatal(err)
	}

	testSeg2, _, _ := buildTestSegmentMulti2()
	err = PersistSegmentBase(testSeg2, "/tmp/scorch2.zap")
	if err != nil {
		t.Fatal(err)
	}

	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	segment2, err := Open("/tmp/scorch2.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment2.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	segsToMerge := make([]*Segment, 2)
	segsToMerge[0] = segment.(*Segment)
	segsToMerge[1] = segment2.(*Segment)

	_, _, err = Merge(segsToMerge, []*roaring.Bitmap{nil, nil}, "/tmp/scorch3.zap", 1024, nil)
	if err != nil {
		t.Fatal(err)
	}

	segm, err := Open("/tmp/scorch3.zap")
	if err != nil {
		t.Fatalf("error opening merged segment: %v", err)
	}
	seg3 := segm.(*Segment)
	defer func() {
		cerr := seg3.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	if seg3.Path() != "/tmp/scorch3.zap" {
		t.Fatalf("wrong path")
	}
	if seg3.Count() != 4 {
		t.Fatalf("wrong count")
	}
	if len(seg3.Fields()) != 5 {
		t.Fatalf("wrong # fields: %#v\n", seg3.Fields())
	}

	testMergeWithSelf(t, seg3, 4)
}

func TestMergeWithEmptySegment(t *testing.T) {
	testMergeWithEmptySegments(t, true, 1)
}

func TestMergeWithEmptySegments(t *testing.T) {
	testMergeWithEmptySegments(t, true, 5)
}

func TestMergeWithEmptySegmentFirst(t *testing.T) {
	testMergeWithEmptySegments(t, false, 1)
}

func TestMergeWithEmptySegmentsFirst(t *testing.T) {
	testMergeWithEmptySegments(t, false, 5)
}

func testMergeWithEmptySegments(t *testing.T, before bool, numEmptySegments int) {
	_ = os.RemoveAll("/tmp/scorch.zap")

	testSeg, _, _ := buildTestSegmentMulti()
	err := PersistSegmentBase(testSeg, "/tmp/scorch.zap")
	if err != nil {
		t.Fatal(err)
	}
	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	var segsToMerge []*Segment

	if before {
		segsToMerge = append(segsToMerge, segment.(*Segment))
	}

	for i := 0; i < numEmptySegments; i++ {
		fname := fmt.Sprintf("scorch-empty-%d.zap", i)

		_ = os.RemoveAll("/tmp/" + fname)

		emptySegment, _, _ := AnalysisResultsToSegmentBase([]*index.AnalysisResult{}, 1024)
		err = PersistSegmentBase(emptySegment, "/tmp/"+fname)
		if err != nil {
			t.Fatal(err)
		}

		emptyFileSegment, err := Open("/tmp/" + fname)
		if err != nil {
			t.Fatalf("error opening segment: %v", err)
		}
		defer func(emptyFileSegment *Segment) {
			cerr := emptyFileSegment.Close()
			if cerr != nil {
				t.Fatalf("error closing segment: %v", err)
			}
		}(emptyFileSegment.(*Segment))

		segsToMerge = append(segsToMerge, emptyFileSegment.(*Segment))
	}

	if !before {
		segsToMerge = append(segsToMerge, segment.(*Segment))
	}

	_ = os.RemoveAll("/tmp/scorch3.zap")

	drops := make([]*roaring.Bitmap, len(segsToMerge))

	_, _, err = Merge(segsToMerge, drops, "/tmp/scorch3.zap", 1024, nil)
	if err != nil {
		t.Fatal(err)
	}

	segm, err := Open("/tmp/scorch3.zap")
	if err != nil {
		t.Fatalf("error opening merged segment: %v", err)
	}
	segCur := segm.(*Segment)
	defer func() {
		cerr := segCur.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	if segCur.Path() != "/tmp/scorch3.zap" {
		t.Fatalf("wrong path")
	}
	if segCur.Count() != 2 {
		t.Fatalf("wrong count, numEmptySegments: %d, got count: %d", numEmptySegments, segCur.Count())
	}
	if len(segCur.Fields()) != 5 {
		t.Fatalf("wrong # fields: %#v\n", segCur.Fields())
	}

	testMergeWithSelf(t, segCur, 2)
}

func testMergeWithSelf(t *testing.T, segCur *Segment, expectedCount uint64) {
	// trying merging the segment with itself for a few rounds
	var diffs []string

	for i := 0; i < 10; i++ {
		fname := fmt.Sprintf("scorch-self-%d.zap", i)

		_ = os.RemoveAll("/tmp/" + fname)

		segsToMerge := make([]*Segment, 1)
		segsToMerge[0] = segCur

		_, _, err := Merge(segsToMerge, []*roaring.Bitmap{nil, nil}, "/tmp/"+fname, 1024, nil)
		if err != nil {
			t.Fatal(err)
		}

		segm, err := Open("/tmp/" + fname)
		if err != nil {
			t.Fatalf("error opening merged segment: %v", err)
		}
		segNew := segm.(*Segment)
		defer func(s *Segment) {
			cerr := s.Close()
			if cerr != nil {
				t.Fatalf("error closing segment: %v", err)
			}
		}(segNew)

		if segNew.Count() != expectedCount {
			t.Fatalf("wrong count")
		}
		if len(segNew.Fields()) != 5 {
			t.Fatalf("wrong # fields: %#v\n", segNew.Fields())
		}

		diff := compareSegments(segCur, segNew)
		if diff != "" {
			diffs = append(diffs, fname+" is different than previous:\n"+diff)
		}

		segCur = segNew
	}

	if len(diffs) > 0 {
		t.Errorf("mismatches after repeated self-merging: %v", strings.Join(diffs, "\n"))
	}
}

func compareSegments(a, b *Segment) string {
	var rv []string

	if a.Count() != b.Count() {
		return "counts"
	}

	afields := append([]string(nil), a.Fields()...)
	bfields := append([]string(nil), b.Fields()...)
	sort.Strings(afields)
	sort.Strings(bfields)
	if !reflect.DeepEqual(afields, bfields) {
		return "fields"
	}

	for _, fieldName := range afields {
		adict, err := a.Dictionary(fieldName)
		if err != nil {
			return fmt.Sprintf("adict err: %v", err)
		}
		bdict, err := b.Dictionary(fieldName)
		if err != nil {
			return fmt.Sprintf("bdict err: %v", err)
		}

		if adict.(*Dictionary).fst.Len() != bdict.(*Dictionary).fst.Len() {
			rv = append(rv, fmt.Sprintf("field %s, dict fst Len()'s  different: %v %v",
				fieldName, adict.(*Dictionary).fst.Len(), bdict.(*Dictionary).fst.Len()))
		}

		aitr := adict.Iterator()
		bitr := bdict.Iterator()
		for {
			anext, aerr := aitr.Next()
			bnext, berr := bitr.Next()
			if aerr != berr {
				rv = append(rv, fmt.Sprintf("field %s, dict iterator Next() errors different: %v %v",
					fieldName, aerr, berr))
				break
			}
			if !reflect.DeepEqual(anext, bnext) {
				rv = append(rv, fmt.Sprintf("field %s, dict iterator Next() results different: %#v %#v",
					fieldName, anext, bnext))
				// keep going to try to see more diff details at the postingsList level
			}
			if aerr != nil || anext == nil ||
				berr != nil || bnext == nil {
				break
			}

			for _, next := range []*index.DictEntry{anext, bnext} {
				if next == nil {
					continue
				}

				aplist, aerr := adict.(*Dictionary).postingsList([]byte(next.Term), nil, nil)
				bplist, berr := bdict.(*Dictionary).postingsList([]byte(next.Term), nil, nil)
				if aerr != berr {
					rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsList() errors different: %v %v",
						fieldName, next.Term, aerr, berr))
				}

				if (aplist != nil) != (bplist != nil) {
					rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsList() results different: %v %v",
						fieldName, next.Term, aplist, bplist))
					break
				}

				if aerr != nil || aplist == nil ||
					berr != nil || bplist == nil {
					break
				}

				if aplist.Count() != bplist.Count() {
					rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsList().Count()'s different: %v %v",
						fieldName, next.Term, aplist.Count(), bplist.Count()))
				}

				apitr := aplist.Iterator(true, true, true, nil)
				bpitr := bplist.Iterator(true, true, true, nil)
				if (apitr != nil) != (bpitr != nil) {
					rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsList.Iterator() results different: %v %v",
						fieldName, next.Term, apitr, bpitr))
					break
				}

				for {
					apitrn, aerr := apitr.Next()
					bpitrn, berr := bpitr.Next()
					if aerr != berr {
						rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() errors different: %v %v",
							fieldName, next.Term, aerr, berr))
					}

					if (apitrn != nil) != (bpitrn != nil) {
						rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() results different: %v %v",
							fieldName, next.Term, apitrn, bpitrn))
						break
					}

					if aerr != nil || apitrn == nil ||
						berr != nil || bpitrn == nil {
						break
					}

					if apitrn.Number() != bpitrn.Number() {
						rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() Number()'s different: %v %v",
							fieldName, next.Term, apitrn.Number(), bpitrn.Number()))
					}

					if apitrn.Frequency() != bpitrn.Frequency() {
						rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() Frequency()'s different: %v %v",
							fieldName, next.Term, apitrn.Frequency(), bpitrn.Frequency()))
					}

					if apitrn.Norm() != bpitrn.Norm() {
						rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() Norm()'s different: %v %v",
							fieldName, next.Term, apitrn.Norm(), bpitrn.Norm()))
					}

					if len(apitrn.Locations()) != len(bpitrn.Locations()) {
						rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() Locations() len's different: %v %v",
							fieldName, next.Term, len(apitrn.Locations()), len(bpitrn.Locations())))
					}

					for loci, aloc := range apitrn.Locations() {
						bloc := bpitrn.Locations()[loci]

						if (aloc != nil) != (bloc != nil) {
							rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() loc different: %v %v",
								fieldName, next.Term, aloc, bloc))
							break
						}

						if aloc.Field() != bloc.Field() ||
							aloc.Start() != bloc.Start() ||
							aloc.End() != bloc.End() ||
							aloc.Pos() != bloc.Pos() ||
							!reflect.DeepEqual(aloc.ArrayPositions(), bloc.ArrayPositions()) {
							rv = append(rv, fmt.Sprintf("field %s, term: %s, postingsListIterator Next() loc details different: %v %v",
								fieldName, next.Term, aloc, bloc))
						}
					}

					if fieldName == "_id" {
						docId := next.Term
						docNumA := apitrn.Number()
						docNumB := bpitrn.Number()
						afields := map[string]interface{}{}
						err = a.VisitDocument(apitrn.Number(),
							func(field string, typ byte, value []byte, pos []uint64) bool {
								afields[field+"-typ"] = typ
								afields[field+"-value"] = append([]byte(nil), value...)
								afields[field+"-pos"] = append([]uint64(nil), pos...)
								return true
							})
						if err != nil {
							rv = append(rv, fmt.Sprintf("a.VisitDocument err: %v", err))
						}
						bfields := map[string]interface{}{}
						err = b.VisitDocument(bpitrn.Number(),
							func(field string, typ byte, value []byte, pos []uint64) bool {
								bfields[field+"-typ"] = typ
								bfields[field+"-value"] = append([]byte(nil), value...)
								bfields[field+"-pos"] = append([]uint64(nil), pos...)
								return true
							})
						if err != nil {
							rv = append(rv, fmt.Sprintf("b.VisitDocument err: %v", err))
						}
						if !reflect.DeepEqual(afields, bfields) {
							rv = append(rv, fmt.Sprintf("afields != bfields,"+
								" id: %s, docNumA: %d, docNumB: %d,"+
								" afields: %#v, bfields: %#v",
								docId, docNumA, docNumB, afields, bfields))
						}
					}
				}
			}
		}
	}

	return strings.Join(rv, "\n")
}

func TestMergeAndDrop(t *testing.T) {
	docsToDrop := make([]*roaring.Bitmap, 2)
	docsToDrop[0] = roaring.NewBitmap()
	docsToDrop[0].AddInt(1)
	docsToDrop[1] = roaring.NewBitmap()
	docsToDrop[1].AddInt(1)
	testMergeAndDrop(t, docsToDrop)
}

func TestMergeAndDropAllFromOneSegment(t *testing.T) {
	docsToDrop := make([]*roaring.Bitmap, 2)
	docsToDrop[0] = roaring.NewBitmap()
	docsToDrop[0].AddInt(0)
	docsToDrop[0].AddInt(1)
	docsToDrop[1] = roaring.NewBitmap()
	testMergeAndDrop(t, docsToDrop)
}

func testMergeAndDrop(t *testing.T, docsToDrop []*roaring.Bitmap) {
	_ = os.RemoveAll("/tmp/scorch.zap")
	_ = os.RemoveAll("/tmp/scorch2.zap")

	testSeg, _, _ := buildTestSegmentMulti()
	err := PersistSegmentBase(testSeg, "/tmp/scorch.zap")
	if err != nil {
		t.Fatal(err)
	}
	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	testSeg2, _, _ := buildTestSegmentMulti2()
	err = PersistSegmentBase(testSeg2, "/tmp/scorch2.zap")
	if err != nil {
		t.Fatal(err)
	}

	segment2, err := Open("/tmp/scorch2.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment2.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	segsToMerge := make([]*Segment, 2)
	segsToMerge[0] = segment.(*Segment)
	segsToMerge[1] = segment2.(*Segment)

	testMergeAndDropSegments(t, segsToMerge, docsToDrop, 2)
}

func TestMergeWithUpdates(t *testing.T) {
	segmentDocIds := [][]string{
		[]string{"a", "b"},
		[]string{"b", "c"}, // doc "b" updated
	}

	docsToDrop := make([]*roaring.Bitmap, 2)
	docsToDrop[0] = roaring.NewBitmap()
	docsToDrop[0].AddInt(1) // doc "b" updated
	docsToDrop[1] = roaring.NewBitmap()

	testMergeWithUpdates(t, segmentDocIds, docsToDrop, 3)
}

func TestMergeWithUpdatesOnManySegments(t *testing.T) {
	segmentDocIds := [][]string{
		[]string{"a", "b"},
		[]string{"b", "c"}, // doc "b" updated
		[]string{"c", "d"}, // doc "c" updated
		[]string{"d", "e"}, // doc "d" updated
	}

	docsToDrop := make([]*roaring.Bitmap, 4)
	docsToDrop[0] = roaring.NewBitmap()
	docsToDrop[0].AddInt(1) // doc "b" updated
	docsToDrop[1] = roaring.NewBitmap()
	docsToDrop[1].AddInt(1) // doc "c" updated
	docsToDrop[2] = roaring.NewBitmap()
	docsToDrop[2].AddInt(1) // doc "d" updated
	docsToDrop[3] = roaring.NewBitmap()

	testMergeWithUpdates(t, segmentDocIds, docsToDrop, 5)
}

func TestMergeWithUpdatesOnOneDoc(t *testing.T) {
	segmentDocIds := [][]string{
		[]string{"a", "b"},
		[]string{"a", "c"}, // doc "a" updated
		[]string{"a", "d"}, // doc "a" updated
		[]string{"a", "e"}, // doc "a" updated
	}

	docsToDrop := make([]*roaring.Bitmap, 4)
	docsToDrop[0] = roaring.NewBitmap()
	docsToDrop[0].AddInt(0) // doc "a" updated
	docsToDrop[1] = roaring.NewBitmap()
	docsToDrop[1].AddInt(0) // doc "a" updated
	docsToDrop[2] = roaring.NewBitmap()
	docsToDrop[2].AddInt(0) // doc "a" updated
	docsToDrop[3] = roaring.NewBitmap()

	testMergeWithUpdates(t, segmentDocIds, docsToDrop, 5)
}

func testMergeWithUpdates(t *testing.T, segmentDocIds [][]string, docsToDrop []*roaring.Bitmap, expectedNumDocs uint64) {
	var segsToMerge []*Segment

	// convert segmentDocIds to segsToMerge
	for i, docIds := range segmentDocIds {
		fname := fmt.Sprintf("scorch%d.zap", i)

		_ = os.RemoveAll("/tmp/" + fname)

		testSeg, _, _ := buildTestSegmentMultiHelper(docIds)
		err := PersistSegmentBase(testSeg, "/tmp/"+fname)
		if err != nil {
			t.Fatal(err)
		}
		segment, err := Open("/tmp/" + fname)
		if err != nil {
			t.Fatalf("error opening segment: %v", err)
		}
		defer func(segment *Segment) {
			cerr := segment.Close()
			if cerr != nil {
				t.Fatalf("error closing segment: %v", err)
			}
		}(segment.(*Segment))

		segsToMerge = append(segsToMerge, segment.(*Segment))
	}

	testMergeAndDropSegments(t, segsToMerge, docsToDrop, expectedNumDocs)
}

func testMergeAndDropSegments(t *testing.T, segsToMerge []*Segment, docsToDrop []*roaring.Bitmap, expectedNumDocs uint64) {
	_ = os.RemoveAll("/tmp/scorch-merged.zap")

	_, _, err := Merge(segsToMerge, docsToDrop, "/tmp/scorch-merged.zap", 1024, nil)
	if err != nil {
		t.Fatal(err)
	}

	segm, err := Open("/tmp/scorch-merged.zap")
	if err != nil {
		t.Fatalf("error opening merged segment: %v", err)
	}
	defer func() {
		cerr := segm.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	if segm.Count() != expectedNumDocs {
		t.Fatalf("wrong count, got: %d, wanted: %d", segm.Count(), expectedNumDocs)
	}
	if len(segm.Fields()) != 5 {
		t.Fatalf("wrong # fields: %#v\n", segm.Fields())
	}

	testMergeWithSelf(t, segm.(*Segment), expectedNumDocs)
}

func buildTestSegmentMulti2() (*SegmentBase, uint64, error) {
	return buildTestSegmentMultiHelper([]string{"c", "d"})
}

func buildTestSegmentMultiHelper(docIds []string) (*SegmentBase, uint64, error) {
	doc := &document.Document{
		ID: "c",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte(docIds[0]), document.IndexField|document.StoreField, nil),
			document.NewTextFieldCustom("name", nil, []byte("mat"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("desc", nil, []byte("some thing"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{0}, []byte("cold"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
			document.NewTextFieldCustom("tag", []uint64{1}, []byte("dark"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
		},
		CompositeFields: []*document.CompositeField{
			document.NewCompositeField("_all", true, nil, []string{"_id"}),
		},
	}

	doc2 := &document.Document{
		ID: "d",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte(docIds[1]), document.IndexField|document.StoreField, nil),
			document.NewTextFieldCustom("name", nil, []byte("joa"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
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
						Term:     []byte(docIds[0]),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("mat"),
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
						Term:     []byte(docIds[1]),
					},
				}, nil, false),
				analysis.TokenFrequency(analysis.TokenStream{
					&analysis.Token{
						Start:    0,
						End:      3,
						Position: 1,
						Term:     []byte("joa"),
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

func TestMergeBytesWritten(t *testing.T) {
	_ = os.RemoveAll("/tmp/scorch.zap")
	_ = os.RemoveAll("/tmp/scorch2.zap")
	_ = os.RemoveAll("/tmp/scorch3.zap")

	testSeg, _, _ := buildTestSegmentMulti()
	err := PersistSegmentBase(testSeg, "/tmp/scorch.zap")
	if err != nil {
		t.Fatal(err)
	}

	testSeg2, _, _ := buildTestSegmentMulti2()
	err = PersistSegmentBase(testSeg2, "/tmp/scorch2.zap")
	if err != nil {
		t.Fatal(err)
	}

	segment, err := Open("/tmp/scorch.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	segment2, err := Open("/tmp/scorch2.zap")
	if err != nil {
		t.Fatalf("error opening segment: %v", err)
	}
	defer func() {
		cerr := segment2.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	segsToMerge := make([]*Segment, 2)
	segsToMerge[0] = segment.(*Segment)
	segsToMerge[1] = segment2.(*Segment)

	_, nBytes, err := Merge(segsToMerge, []*roaring.Bitmap{nil, nil}, "/tmp/scorch3.zap", 1024, nil)
	if err != nil {
		t.Fatal(err)
	}

	if nBytes == 0 {
		t.Fatalf("expected a non zero total_compaction_written_bytes")
	}

	segm, err := Open("/tmp/scorch3.zap")
	if err != nil {
		t.Fatalf("error opening merged segment: %v", err)
	}
	seg3 := segm.(*Segment)
	defer func() {
		cerr := seg3.Close()
		if cerr != nil {
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	if seg3.Path() != "/tmp/scorch3.zap" {
		t.Fatalf("wrong path")
	}
	if seg3.Count() != 4 {
		t.Fatalf("wrong count")
	}
	if len(seg3.Fields()) != 5 {
		t.Fatalf("wrong # fields: %#v\n", seg3.Fields())
	}

	testMergeWithSelf(t, seg3, 4)
}

func TestUnder32Bits(t *testing.T) {
	if !under32Bits(0) || !under32Bits(uint64(0x7fffffff)) {
		t.Errorf("under32Bits bad")
	}
	if under32Bits(uint64(0x80000000)) || under32Bits(uint64(0x80000001)) {
		t.Errorf("under32Bits wrong")
	}
}
