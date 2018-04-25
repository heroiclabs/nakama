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
	"reflect"
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/index/scorch/segment/mem"
)

func buildMemSegmentForDict() *mem.Segment {
	doc := &document.Document{
		ID: "a",
		Fields: []document.Field{
			document.NewTextFieldCustom("_id", nil, []byte("a"), document.IndexField|document.StoreField, nil),
			document.NewTextFieldCustom("desc", nil, []byte("apple ball cat dog egg fish bat"), document.IndexField|document.StoreField|document.IncludeTermVectors, nil),
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
						End:      5,
						Position: 1,
						Term:     []byte("apple"),
					},
					&analysis.Token{
						Start:    6,
						End:      10,
						Position: 2,
						Term:     []byte("ball"),
					},
					&analysis.Token{
						Start:    11,
						End:      14,
						Position: 3,
						Term:     []byte("cat"),
					},
					&analysis.Token{
						Start:    15,
						End:      18,
						Position: 4,
						Term:     []byte("dog"),
					},
					&analysis.Token{
						Start:    19,
						End:      22,
						Position: 5,
						Term:     []byte("egg"),
					},
					&analysis.Token{
						Start:    20,
						End:      24,
						Position: 6,
						Term:     []byte("fish"),
					},
					&analysis.Token{
						Start:    25,
						End:      28,
						Position: 7,
						Term:     []byte("bat"),
					},
				}, nil, true),
			},
			Length: []int{
				1,
				7,
			},
		},
	}

	segment := mem.NewFromAnalyzedDocs(results)

	return segment
}

func TestDictionary(t *testing.T) {

	_ = os.RemoveAll("/tmp/scorch.zap")

	memSegment := buildMemSegmentForDict()
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
			t.Fatalf("error closing segment: %v", err)
		}
	}()

	dict, err := segment.Dictionary("desc")
	if err != nil {
		t.Fatal(err)
	}

	// test basic full iterator
	expected := []string{"apple", "ball", "bat", "cat", "dog", "egg", "fish"}
	var got []string
	itr := dict.Iterator()
	next, err := itr.Next()
	for next != nil && err == nil {
		got = append(got, next.Term)
		next, err = itr.Next()
	}
	if err != nil {
		t.Fatalf("dict itr error: %v", err)
	}

	if !reflect.DeepEqual(expected, got) {
		t.Errorf("expected: %v, got: %v", expected, got)
	}

	// test prefix iterator
	expected = []string{"ball", "bat"}
	got = got[:0]
	itr = dict.PrefixIterator("b")
	next, err = itr.Next()
	for next != nil && err == nil {
		got = append(got, next.Term)
		next, err = itr.Next()
	}
	if err != nil {
		t.Fatalf("dict itr error: %v", err)
	}

	if !reflect.DeepEqual(expected, got) {
		t.Errorf("expected: %v, got: %v", expected, got)
	}

	// test range iterator
	expected = []string{"cat", "dog", "egg"}
	got = got[:0]
	itr = dict.RangeIterator("cat", "egg")
	next, err = itr.Next()
	for next != nil && err == nil {
		got = append(got, next.Term)
		next, err = itr.Next()
	}
	if err != nil {
		t.Fatalf("dict itr error: %v", err)
	}

	if !reflect.DeepEqual(expected, got) {
		t.Errorf("expected: %v, got: %v", expected, got)
	}
}
