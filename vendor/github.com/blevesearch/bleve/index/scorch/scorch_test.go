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

package scorch

import (
	"log"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/analysis/analyzer/standard"
	regexpTokenizer "github.com/blevesearch/bleve/analysis/tokenizer/regexp"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/mapping"
)

func init() {
	// override for tests
	DefaultPersisterNapTimeMSec = 1
}

func InitTest(cfg map[string]interface{}) error {
	return os.RemoveAll(cfg["path"].(string))
}

func DestroyTest(cfg map[string]interface{}) error {
	return os.RemoveAll(cfg["path"].(string))
}

func CreateConfig(name string) map[string]interface{} {
	// TODO: Use t.Name() when Go 1.7 support terminates.
	rv := make(map[string]interface{})
	rv["path"] = os.TempDir() + "/bleve-scorch-test-" + name
	return rv
}

var testAnalyzer = &analysis.Analyzer{
	Tokenizer: regexpTokenizer.NewRegexpTokenizer(regexp.MustCompile(`\w+`)),
}

func TestIndexOpenReopen(t *testing.T) {
	cfg := CreateConfig("TestIndexOpenReopen")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Errorf("error opening index: %v", err)
	}

	var expectedCount uint64
	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// insert a doc
	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// now close it
	err = idx.Close()
	if err != nil {
		t.Fatal(err)
	}

	idx, err = NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Errorf("error opening index: %v", err)
	}

	// check the doc count again after reopening it
	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// now close it
	err = idx.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexInsert(t *testing.T) {
	cfg := CreateConfig("TestIndexInsert")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var expectedCount uint64
	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexInsertThenDelete(t *testing.T) {
	cfg := CreateConfig("TestIndexInsertThenDelete")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var expectedCount uint64
	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	doc2 := document.NewDocument("2")
	doc2.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc2)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	iid, err := reader.InternalID("1")
	if err != nil || iid == nil {
		t.Errorf("unexpected on doc id 1")
	}
	iid, err = reader.InternalID("2")
	if err != nil || iid == nil {
		t.Errorf("unexpected on doc id 2")
	}
	iid, err = reader.InternalID("3")
	if err != nil || iid != nil {
		t.Errorf("unexpected on doc id 3")
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	err = idx.Delete("1")
	if err != nil {
		t.Errorf("Error deleting entry from index: %v", err)
	}
	expectedCount--

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	storedDoc, err := reader.Document("1")
	if err != nil {
		t.Error(err)
	}
	if storedDoc != nil {
		t.Errorf("expected nil for deleted stored doc #1, got %v", storedDoc)
	}
	storedDoc, err = reader.Document("2")
	if err != nil {
		t.Error(err)
	}
	if storedDoc == nil {
		t.Errorf("expected stored doc for #2, got nil")
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// now close it
	err = idx.Close()
	if err != nil {
		t.Fatal(err)
	}

	idx, err = NewScorch(Name, cfg, analysisQueue) // reopen
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Errorf("error reopening index: %v", err)
	}

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	storedDoc, err = reader.Document("1")
	if err != nil {
		t.Error(err)
	}
	if storedDoc != nil {
		t.Errorf("expected nil for deleted stored doc #1, got %v", storedDoc)
	}
	storedDoc, err = reader.Document("2")
	if err != nil {
		t.Error(err)
	}
	if storedDoc == nil {
		t.Errorf("expected stored doc for #2, got nil")
	}
	iid, err = reader.InternalID("1")
	if err != nil || iid != nil {
		t.Errorf("unexpected on doc id 1")
	}
	iid, err = reader.InternalID("2")
	if err != nil || iid == nil {
		t.Errorf("unexpected on doc id 2, should exist")
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	err = idx.Delete("2")
	if err != nil {
		t.Errorf("Error deleting entry from index: %v", err)
	}
	expectedCount--

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	storedDoc, err = reader.Document("1")
	if err != nil {
		t.Error(err)
	}
	if storedDoc != nil {
		t.Errorf("expected nil for deleted stored doc #1, got %v", storedDoc)
	}
	storedDoc, err = reader.Document("2")
	if err != nil {
		t.Error(err)
	}
	if storedDoc != nil {
		t.Errorf("expected nil for deleted stored doc #2, got nil")
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexInsertThenUpdate(t *testing.T) {
	cfg := CreateConfig("TestIndexInsertThenUpdate")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}

	var expectedCount uint64
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	// this update should overwrite one term, and introduce one new one
	doc = document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithAnalyzer("name", []uint64{}, []byte("test fail"), testAnalyzer))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error deleting entry from index: %v", err)
	}

	// now do another update that should remove one of the terms
	doc = document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("fail")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error deleting entry from index: %v", err)
	}

	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexInsertMultiple(t *testing.T) {
	cfg := CreateConfig("TestIndexInsertMultiple")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var expectedCount uint64

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	doc = document.NewDocument("2")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	doc = document.NewDocument("3")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexInsertWithStore(t *testing.T) {
	cfg := CreateConfig("TestIndexInsertWithStore")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var expectedCount uint64
	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err := indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	storedDoc, err := indexReader.Document("1")
	if err != nil {
		t.Error(err)
	}

	if len(storedDoc.Fields) != 1 {
		t.Errorf("expected 1 stored field, got %d", len(storedDoc.Fields))
	}
	for _, field := range storedDoc.Fields {
		if field.Name() == "name" {
			textField, ok := field.(*document.TextField)
			if !ok {
				t.Errorf("expected text field")
			}
			if string(textField.Value()) != "test" {
				t.Errorf("expected field content 'test', got '%s'", string(textField.Value()))
			}
		} else if field.Name() == "_id" {
			t.Errorf("not expecting _id field")
		}
	}
}

func TestIndexInternalCRUD(t *testing.T) {
	cfg := CreateConfig("TestIndexInternalCRUD")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	if len(indexReader.(*IndexSnapshot).segment) != 0 {
		t.Errorf("expected 0 segments")
	}

	// get something that doesn't exist yet
	val, err := indexReader.GetInternal([]byte("key"))
	if err != nil {
		t.Error(err)
	}
	if val != nil {
		t.Errorf("expected nil, got %s", val)
	}

	err = indexReader.Close()
	if err != nil {
		t.Fatal(err)
	}

	// set
	err = idx.SetInternal([]byte("key"), []byte("abc"))
	if err != nil {
		t.Error(err)
	}

	indexReader2, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	if len(indexReader2.(*IndexSnapshot).segment) != 0 {
		t.Errorf("expected 0 segments")
	}

	// get
	val, err = indexReader2.GetInternal([]byte("key"))
	if err != nil {
		t.Error(err)
	}
	if string(val) != "abc" {
		t.Errorf("expected %s, got '%s'", "abc", val)
	}

	err = indexReader2.Close()
	if err != nil {
		t.Fatal(err)
	}

	// delete
	err = idx.DeleteInternal([]byte("key"))
	if err != nil {
		t.Error(err)
	}

	indexReader3, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	if len(indexReader3.(*IndexSnapshot).segment) != 0 {
		t.Errorf("expected 0 segments")
	}

	// get again
	val, err = indexReader3.GetInternal([]byte("key"))
	if err != nil {
		t.Error(err)
	}
	if val != nil {
		t.Errorf("expected nil, got %s", val)
	}

	err = indexReader3.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexBatch(t *testing.T) {
	cfg := CreateConfig("TestIndexBatch")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var expectedCount uint64

	// first create 2 docs the old fashioned way
	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	doc = document.NewDocument("2")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test2")))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	// now create a batch which does 3 things
	// insert new doc
	// update existing doc
	// delete existing doc
	// net document count change 0

	batch := index.NewBatch()
	doc = document.NewDocument("3")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test3")))
	batch.Update(doc)
	doc = document.NewDocument("2")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test2updated")))
	batch.Update(doc)
	batch.Delete("1")

	err = idx.Batch(batch)
	if err != nil {
		t.Error(err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err := indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	numSegments := len(indexReader.(*IndexSnapshot).segment)
	if numSegments <= 0 {
		t.Errorf("expected some segments, got: %d", numSegments)
	}

	docCount, err := indexReader.DocCount()
	if err != nil {
		t.Fatal(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}

	docIDReader, err := indexReader.DocIDReaderAll()
	if err != nil {
		t.Error(err)
	}
	var docIds []index.IndexInternalID
	docID, err := docIDReader.Next()
	for docID != nil && err == nil {
		docIds = append(docIds, docID)
		docID, err = docIDReader.Next()
	}
	if err != nil {
		t.Error(err)
	}
	externalDocIds := map[string]struct{}{}
	// convert back to external doc ids
	for _, id := range docIds {
		externalID, err := indexReader.ExternalID(id)
		if err != nil {
			t.Fatal(err)
		}
		externalDocIds[externalID] = struct{}{}
	}
	expectedDocIds := map[string]struct{}{
		"2": struct{}{},
		"3": struct{}{},
	}
	if !reflect.DeepEqual(externalDocIds, expectedDocIds) {
		t.Errorf("expected ids: %v, got ids: %v", expectedDocIds, externalDocIds)
	}
}

func TestIndexInsertUpdateDeleteWithMultipleTypesStored(t *testing.T) {
	cfg := CreateConfig("TestIndexInsertUpdateDeleteWithMultipleTypesStored")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var expectedCount uint64
	reader, err := idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err := reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField))
	doc.AddField(document.NewNumericFieldWithIndexingOptions("age", []uint64{}, 35.99, document.IndexField|document.StoreField))
	df, err := document.NewDateTimeFieldWithIndexingOptions("unixEpoch", []uint64{}, time.Unix(0, 0), document.IndexField|document.StoreField)
	if err != nil {
		t.Error(err)
	}
	doc.AddField(df)
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	expectedCount++

	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	storedDoc, err := indexReader.Document("1")
	if err != nil {
		t.Error(err)
	}

	err = indexReader.Close()
	if err != nil {
		t.Error(err)
	}

	if len(storedDoc.Fields) != 3 {
		t.Errorf("expected 3 stored field, got %d", len(storedDoc.Fields))
	}
	for _, field := range storedDoc.Fields {

		if field.Name() == "name" {
			textField, ok := field.(*document.TextField)
			if !ok {
				t.Errorf("expected text field")
			}
			if string(textField.Value()) != "test" {
				t.Errorf("expected field content 'test', got '%s'", string(textField.Value()))
			}
		} else if field.Name() == "age" {
			numField, ok := field.(*document.NumericField)
			if !ok {
				t.Errorf("expected numeric field")
			}
			numFieldNumer, err := numField.Number()
			if err != nil {
				t.Error(err)
			} else {
				if numFieldNumer != 35.99 {
					t.Errorf("expeted numeric value 35.99, got %f", numFieldNumer)
				}
			}
		} else if field.Name() == "unixEpoch" {
			dateField, ok := field.(*document.DateTimeField)
			if !ok {
				t.Errorf("expected date field")
			}
			dateFieldDate, err := dateField.DateTime()
			if err != nil {
				t.Error(err)
			} else {
				if dateFieldDate != time.Unix(0, 0).UTC() {
					t.Errorf("expected date value unix epoch, got %v", dateFieldDate)
				}
			}
		} else if field.Name() == "_id" {
			t.Errorf("not expecting _id field")
		}
	}

	// now update the document, but omit one of the fields
	doc = document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("testup"), document.IndexField|document.StoreField))
	doc.AddField(document.NewNumericFieldWithIndexingOptions("age", []uint64{}, 36.99, document.IndexField|document.StoreField))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader2, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	// expected doc count shouldn't have changed
	docCount, err = indexReader2.DocCount()
	if err != nil {
		t.Fatal(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}

	// should only get 2 fields back now though
	storedDoc, err = indexReader2.Document("1")
	if err != nil {
		t.Error(err)
	}

	err = indexReader2.Close()
	if err != nil {
		t.Error(err)
	}

	if len(storedDoc.Fields) != 2 {
		t.Errorf("expected 2 stored field, got %d", len(storedDoc.Fields))
	}

	for _, field := range storedDoc.Fields {

		if field.Name() == "name" {
			textField, ok := field.(*document.TextField)
			if !ok {
				t.Errorf("expected text field")
			}
			if string(textField.Value()) != "testup" {
				t.Errorf("expected field content 'testup', got '%s'", string(textField.Value()))
			}
		} else if field.Name() == "age" {
			numField, ok := field.(*document.NumericField)
			if !ok {
				t.Errorf("expected numeric field")
			}
			numFieldNumer, err := numField.Number()
			if err != nil {
				t.Error(err)
			} else {
				if numFieldNumer != 36.99 {
					t.Errorf("expeted numeric value 36.99, got %f", numFieldNumer)
				}
			}
		} else if field.Name() == "_id" {
			t.Errorf("not expecting _id field")
		}
	}

	// now delete the document
	err = idx.Delete("1")
	expectedCount--

	// expected doc count shouldn't have changed
	reader, err = idx.Reader()
	if err != nil {
		t.Fatal(err)
	}
	docCount, err = reader.DocCount()
	if err != nil {
		t.Error(err)
	}
	if docCount != expectedCount {
		t.Errorf("Expected document count to be %d got %d", expectedCount, docCount)
	}
	err = reader.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexInsertFields(t *testing.T) {
	cfg := CreateConfig("TestIndexInsertFields")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField))
	doc.AddField(document.NewNumericFieldWithIndexingOptions("age", []uint64{}, 35.99, document.IndexField|document.StoreField))
	dateField, err := document.NewDateTimeFieldWithIndexingOptions("unixEpoch", []uint64{}, time.Unix(0, 0), document.IndexField|document.StoreField)
	if err != nil {
		t.Error(err)
	}
	doc.AddField(dateField)
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err := indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	fields, err := indexReader.Fields()
	if err != nil {
		t.Error(err)
	} else {
		fieldsMap := map[string]struct{}{}
		for _, field := range fields {
			fieldsMap[field] = struct{}{}
		}
		expectedFieldsMap := map[string]struct{}{
			"_id":       struct{}{},
			"name":      struct{}{},
			"age":       struct{}{},
			"unixEpoch": struct{}{},
		}
		if !reflect.DeepEqual(fieldsMap, expectedFieldsMap) {
			t.Errorf("expected fields: %v, got %v", expectedFieldsMap, fieldsMap)
		}
	}

}

func TestIndexUpdateComposites(t *testing.T) {
	cfg := CreateConfig("TestIndexUpdateComposites")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField))
	doc.AddField(document.NewTextFieldWithIndexingOptions("title", []uint64{}, []byte("mister"), document.IndexField|document.StoreField))
	doc.AddField(document.NewCompositeFieldWithIndexingOptions("_all", true, nil, nil, document.IndexField))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	// now lets update it
	doc = document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("testupdated"), document.IndexField|document.StoreField))
	doc.AddField(document.NewTextFieldWithIndexingOptions("title", []uint64{}, []byte("misterupdated"), document.IndexField|document.StoreField))
	doc.AddField(document.NewCompositeFieldWithIndexingOptions("_all", true, nil, nil, document.IndexField))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err := indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// make sure new values are in index
	storedDoc, err := indexReader.Document("1")
	if err != nil {
		t.Error(err)
	}
	if len(storedDoc.Fields) != 2 {
		t.Errorf("expected 2 stored field, got %d", len(storedDoc.Fields))
	}
	for _, field := range storedDoc.Fields {
		if field.Name() == "name" {
			textField, ok := field.(*document.TextField)
			if !ok {
				t.Errorf("expected text field")
			}
			if string(textField.Value()) != "testupdated" {
				t.Errorf("expected field content 'test', got '%s'", string(textField.Value()))
			}
		} else if field.Name() == "_id" {
			t.Errorf("not expecting _id field")
		}
	}
}

func TestIndexTermReaderCompositeFields(t *testing.T) {
	cfg := CreateConfig("TestIndexTermReaderCompositeFields")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	doc.AddField(document.NewTextFieldWithIndexingOptions("title", []uint64{}, []byte("mister"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	doc.AddField(document.NewCompositeFieldWithIndexingOptions("_all", true, nil, nil, document.IndexField|document.IncludeTermVectors))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err := indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	termFieldReader, err := indexReader.TermFieldReader([]byte("mister"), "_all", true, true, true)
	if err != nil {
		t.Error(err)
	}

	tfd, err := termFieldReader.Next(nil)
	for tfd != nil && err == nil {
		externalID, err := indexReader.ExternalID(tfd.ID)
		if err != nil {
			t.Fatal(err)
		}
		if externalID != "1" {
			t.Errorf("expected to find document id 1")
		}
		tfd, err = termFieldReader.Next(nil)
	}
	if err != nil {
		t.Error(err)
	}
}

func TestIndexDocumentVisitFieldTerms(t *testing.T) {
	cfg := CreateConfig("TestIndexDocumentVisitFieldTerms")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Errorf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	doc.AddField(document.NewTextFieldWithIndexingOptions("title", []uint64{}, []byte("mister"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}
	defer func() {
		err := indexReader.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	fieldTerms := make(index.FieldTerms)

	internalID, err := indexReader.InternalID("1")
	if err != nil {
		t.Fatal(err)
	}

	err = indexReader.DocumentVisitFieldTerms(internalID, []string{"name", "title"}, func(field string, term []byte) {
		fieldTerms[field] = append(fieldTerms[field], string(term))
	})
	if err != nil {
		t.Error(err)
	}
	expectedFieldTerms := index.FieldTerms{
		"name":  []string{"test"},
		"title": []string{"mister"},
	}
	if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
		t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
	}
}

func TestConcurrentUpdate(t *testing.T) {
	cfg := CreateConfig("TestConcurrentUpdate")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// do some concurrent updates
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			doc := document.NewDocument("1")
			doc.AddField(document.NewTextFieldWithIndexingOptions(strconv.Itoa(i), []uint64{}, []byte(strconv.Itoa(i)), document.StoreField))
			err := idx.Update(doc)
			if err != nil {
				t.Errorf("Error updating index: %v", err)
			}
			wg.Done()
		}(i)
	}
	wg.Wait()

	// now load the name field and see what we get
	r, err := idx.Reader()
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		err := r.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc, err := r.Document("1")
	if err != nil {
		log.Fatal(err)
	}

	if len(doc.Fields) > 2 {
		t.Errorf("expected no more than 2 fields, found %d", len(doc.Fields))
	}
}

func TestLargeField(t *testing.T) {
	cfg := CreateConfig("TestLargeField")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	var largeFieldValue []byte
	for len(largeFieldValue) < 4096 {
		largeFieldValue = append(largeFieldValue, bleveWikiArticle1K...)
	}

	d := document.NewDocument("large")
	f := document.NewTextFieldWithIndexingOptions("desc", nil, largeFieldValue, document.IndexField|document.StoreField)
	d.AddField(f)

	err = idx.Update(d)
	if err != nil {
		t.Fatal(err)
	}
}

var bleveWikiArticle1K = []byte(`Boiling liquid expanding vapor explosion
From Wikipedia, the free encyclopedia
See also: Boiler explosion and Steam explosion

Flames subsequent to a flammable liquid BLEVE from a tanker. BLEVEs do not necessarily involve fire.

This article's tone or style may not reflect the encyclopedic tone used on Wikipedia. See Wikipedia's guide to writing better articles for suggestions. (July 2013)
A boiling liquid expanding vapor explosion (BLEVE, /ˈblɛviː/ blev-ee) is an explosion caused by the rupture of a vessel containing a pressurized liquid above its boiling point.[1]
Contents  [hide]
1 Mechanism
1.1 Water example
1.2 BLEVEs without chemical reactions
2 Fires
3 Incidents
4 Safety measures
5 See also
6 References
7 External links
Mechanism[edit]

This section needs additional citations for verification. Please help improve this article by adding citations to reliable sources. Unsourced material may be challenged and removed. (July 2013)
There are three characteristics of liquids which are relevant to the discussion of a BLEVE:`)

func TestIndexDocumentVisitFieldTermsWithMultipleDocs(t *testing.T) {
	cfg := CreateConfig("TestIndexDocumentVisitFieldTermsWithMultipleDocs")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := document.NewDocument("1")
	doc.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	doc.AddField(document.NewTextFieldWithIndexingOptions("title", []uint64{}, []byte("mister"), document.IndexField|document.StoreField|document.IncludeTermVectors))

	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	fieldTerms := make(index.FieldTerms)
	docNumber, err := indexReader.InternalID("1")
	if err != nil {
		t.Fatal(err)
	}
	err = indexReader.DocumentVisitFieldTerms(docNumber, []string{"name", "title"}, func(field string, term []byte) {
		fieldTerms[field] = append(fieldTerms[field], string(term))
	})
	if err != nil {
		t.Error(err)
	}
	expectedFieldTerms := index.FieldTerms{
		"name":  []string{"test"},
		"title": []string{"mister"},
	}
	if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
		t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
	}
	err = indexReader.Close()
	if err != nil {
		t.Fatal(err)
	}

	doc2 := document.NewDocument("2")
	doc2.AddField(document.NewTextFieldWithIndexingOptions("name", []uint64{}, []byte("test2"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	doc2.AddField(document.NewTextFieldWithIndexingOptions("title", []uint64{}, []byte("mister2"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	err = idx.Update(doc2)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	indexReader, err = idx.Reader()
	if err != nil {
		t.Error(err)
	}

	fieldTerms = make(index.FieldTerms)
	docNumber, err = indexReader.InternalID("2")
	if err != nil {
		t.Fatal(err)
	}
	err = indexReader.DocumentVisitFieldTerms(docNumber, []string{"name", "title"}, func(field string, term []byte) {
		fieldTerms[field] = append(fieldTerms[field], string(term))
	})
	if err != nil {
		t.Error(err)
	}
	expectedFieldTerms = index.FieldTerms{
		"name":  []string{"test2"},
		"title": []string{"mister2"},
	}
	if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
		t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
	}
	err = indexReader.Close()
	if err != nil {
		t.Fatal(err)
	}

	doc3 := document.NewDocument("3")
	doc3.AddField(document.NewTextFieldWithIndexingOptions("name3", []uint64{}, []byte("test3"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	doc3.AddField(document.NewTextFieldWithIndexingOptions("title3", []uint64{}, []byte("mister3"), document.IndexField|document.StoreField|document.IncludeTermVectors))
	err = idx.Update(doc3)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
	indexReader, err = idx.Reader()
	if err != nil {
		t.Error(err)
	}

	fieldTerms = make(index.FieldTerms)
	docNumber, err = indexReader.InternalID("3")
	if err != nil {
		t.Fatal(err)
	}
	err = indexReader.DocumentVisitFieldTerms(docNumber, []string{"name3", "title3"}, func(field string, term []byte) {
		fieldTerms[field] = append(fieldTerms[field], string(term))
	})
	if err != nil {
		t.Error(err)
	}
	expectedFieldTerms = index.FieldTerms{
		"name3":  []string{"test3"},
		"title3": []string{"mister3"},
	}
	if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
		t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
	}

	fieldTerms = make(index.FieldTerms)
	docNumber, err = indexReader.InternalID("1")
	if err != nil {
		t.Fatal(err)
	}
	err = indexReader.DocumentVisitFieldTerms(docNumber, []string{"name", "title"}, func(field string, term []byte) {
		fieldTerms[field] = append(fieldTerms[field], string(term))
	})
	if err != nil {
		t.Error(err)
	}
	expectedFieldTerms = index.FieldTerms{
		"name":  []string{"test"},
		"title": []string{"mister"},
	}
	if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
		t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
	}
	err = indexReader.Close()
	if err != nil {
		t.Fatal(err)
	}

}

func TestIndexDocumentVisitFieldTermsWithMultipleFieldOptions(t *testing.T) {
	cfg := CreateConfig("TestIndexDocumentVisitFieldTermsWithMultipleFieldOptions")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch(Name, cfg, analysisQueue)
	if err != nil {
		t.Fatal(err)
	}
	err = idx.Open()
	if err != nil {
		t.Fatalf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// mix of field options, this exercises the run time/ on the fly un inverting of
	// doc values for custom options enabled field like designation, dept.
	options := document.IndexField | document.StoreField | document.IncludeTermVectors
	doc := document.NewDocument("1")
	doc.AddField(document.NewTextField("name", []uint64{}, []byte("test")))    // default doc value persisted
	doc.AddField(document.NewTextField("title", []uint64{}, []byte("mister"))) // default doc value persisted
	doc.AddField(document.NewTextFieldWithIndexingOptions("designation", []uint64{}, []byte("engineer"), options))
	doc.AddField(document.NewTextFieldWithIndexingOptions("dept", []uint64{}, []byte("bleve"), options))

	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}

	indexReader, err := idx.Reader()
	if err != nil {
		t.Error(err)
	}

	fieldTerms := make(index.FieldTerms)
	docNumber, err := indexReader.InternalID("1")
	if err != nil {
		t.Fatal(err)
	}
	err = indexReader.DocumentVisitFieldTerms(docNumber, []string{"name", "designation", "dept"}, func(field string, term []byte) {
		fieldTerms[field] = append(fieldTerms[field], string(term))
	})
	if err != nil {
		t.Error(err)
	}
	expectedFieldTerms := index.FieldTerms{
		"name":        []string{"test"},
		"designation": []string{"engineer"},
		"dept":        []string{"bleve"},
	}
	if !reflect.DeepEqual(fieldTerms, expectedFieldTerms) {
		t.Errorf("expected field terms: %#v, got: %#v", expectedFieldTerms, fieldTerms)
	}
	err = indexReader.Close()
	if err != nil {
		t.Fatal(err)
	}

}

func TestAllFieldWithDifferentTermVectorsEnabled(t *testing.T) {
	// Based on https://github.com/blevesearch/bleve/issues/895 from xeizmendi
	cfg := CreateConfig("TestAllFieldWithDifferentTermVectorsEnabled")
	err := InitTest(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := DestroyTest(cfg)
		if err != nil {
			t.Log(err)
		}
	}()

	testConfig := cfg
	mp := mapping.NewIndexMapping()

	keywordMapping := mapping.NewTextFieldMapping()
	keywordMapping.Analyzer = keyword.Name
	keywordMapping.IncludeTermVectors = false
	keywordMapping.IncludeInAll = true

	textMapping := mapping.NewTextFieldMapping()
	textMapping.Analyzer = standard.Name
	textMapping.IncludeTermVectors = true
	textMapping.IncludeInAll = true

	docMapping := mapping.NewDocumentStaticMapping()
	docMapping.AddFieldMappingsAt("keyword", keywordMapping)
	docMapping.AddFieldMappingsAt("text", textMapping)

	mp.DefaultMapping = docMapping

	analysisQueue := index.NewAnalysisQueue(1)
	idx, err := NewScorch("storeName", testConfig, analysisQueue)
	if err != nil {
		log.Fatalln(err)
	}
	err = idx.Open()
	if err != nil {
		t.Errorf("error opening index: %v", err)
	}
	defer func() {
		err := idx.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	data := map[string]string{
		"keyword": "something",
		"text":    "A sentence that includes something within.",
	}

	doc := document.NewDocument("1")
	err = mp.MapDocument(doc, data)
	if err != nil {
		t.Errorf("error mapping doc: %v", err)
	}

	err = idx.Update(doc)
	if err != nil {
		t.Errorf("Error updating index: %v", err)
	}
}
