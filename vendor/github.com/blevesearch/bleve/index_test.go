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

package bleve

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/blevesearch/bleve/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/index/store/null"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"

	"github.com/blevesearch/bleve/index/scorch"
	"github.com/blevesearch/bleve/index/upsidedown"
)

func TestCrud(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	doca := map[string]interface{}{
		"name": "marty",
		"desc": "gophercon india",
	}
	err = index.Index("a", doca)
	if err != nil {
		t.Error(err)
	}

	docy := map[string]interface{}{
		"name": "jasper",
		"desc": "clojure",
	}
	err = index.Index("y", docy)
	if err != nil {
		t.Error(err)
	}

	err = index.Delete("y")
	if err != nil {
		t.Error(err)
	}

	docx := map[string]interface{}{
		"name": "rose",
		"desc": "googler",
	}
	err = index.Index("x", docx)
	if err != nil {
		t.Error(err)
	}

	err = index.SetInternal([]byte("status"), []byte("pending"))
	if err != nil {
		t.Error(err)
	}

	docb := map[string]interface{}{
		"name": "steve",
		"desc": "cbft master",
	}
	batch := index.NewBatch()
	err = batch.Index("b", docb)
	if err != nil {
		t.Error(err)
	}
	batch.Delete("x")
	batch.SetInternal([]byte("batchi"), []byte("batchv"))
	batch.DeleteInternal([]byte("status"))
	err = index.Batch(batch)
	if err != nil {
		t.Error(err)
	}
	val, err := index.GetInternal([]byte("batchi"))
	if err != nil {
		t.Error(err)
	}
	if string(val) != "batchv" {
		t.Errorf("expected 'batchv', got '%s'", val)
	}
	val, err = index.GetInternal([]byte("status"))
	if err != nil {
		t.Error(err)
	}
	if val != nil {
		t.Errorf("expected nil, got '%s'", val)
	}

	err = index.SetInternal([]byte("seqno"), []byte("7"))
	if err != nil {
		t.Error(err)
	}
	err = index.SetInternal([]byte("status"), []byte("ready"))
	if err != nil {
		t.Error(err)
	}
	err = index.DeleteInternal([]byte("status"))
	if err != nil {
		t.Error(err)
	}
	val, err = index.GetInternal([]byte("status"))
	if err != nil {
		t.Error(err)
	}
	if val != nil {
		t.Errorf("expected nil, got '%s'", val)
	}

	val, err = index.GetInternal([]byte("seqno"))
	if err != nil {
		t.Error(err)
	}
	if string(val) != "7" {
		t.Errorf("expected '7', got '%s'", val)
	}

	// close the index, open it again, and try some more things
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}

	index, err = Open("testidx")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	count, err := index.DocCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("expected doc count 2, got %d", count)
	}

	doc, err := index.Document("a")
	if err != nil {
		t.Fatal(err)
	}
	if doc == nil {
		t.Errorf("expected doc not nil, got nil")
	}
	foundNameField := false
	for _, field := range doc.Fields {
		if field.Name() == "name" && string(field.Value()) == "marty" {
			foundNameField = true
		}
	}
	if !foundNameField {
		t.Errorf("expected to find field named 'name' with value 'marty'")
	}

	fields, err := index.Fields()
	if err != nil {
		t.Fatal(err)
	}
	expectedFields := map[string]bool{
		"_all": false,
		"name": false,
		"desc": false,
	}
	if len(fields) < len(expectedFields) {
		t.Fatalf("expected %d fields got %d", len(expectedFields), len(fields))
	}
	for _, f := range fields {
		expectedFields[f] = true
	}
	for ef, efp := range expectedFields {
		if !efp {
			t.Errorf("field %s is missing", ef)
		}
	}
}

func TestIndexCreateNewOverExisting(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
	index, err = New("testidx", NewIndexMapping())
	if err != ErrorIndexPathExists {
		t.Fatalf("expected error index path exists, got %v", err)
	}
}

func TestIndexOpenNonExisting(t *testing.T) {
	_, err := Open("doesnotexist")
	if err != ErrorIndexPathDoesNotExist {
		t.Fatalf("expected error index path does not exist, got %v", err)
	}
}

func TestIndexOpenMetaMissingOrCorrupt(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}

	// now intentionally change the storage type
	err = ioutil.WriteFile("testidx/index_meta.json", []byte(`{"storage":"mystery"}`), 0666)
	if err != nil {
		t.Fatal(err)
	}

	index, err = Open("testidx")
	if err != ErrorUnknownStorageType {
		t.Fatalf("expected error unknown storage type, got %v", err)
	}

	// now intentionally corrupt the metadata
	err = ioutil.WriteFile("testidx/index_meta.json", []byte("corrupted"), 0666)
	if err != nil {
		t.Fatal(err)
	}

	index, err = Open("testidx")
	if err != ErrorIndexMetaCorrupt {
		t.Fatalf("expected error index metadata corrupted, got %v", err)
	}

	// now intentionally remove the metadata
	err = os.Remove("testidx/index_meta.json")
	if err != nil {
		t.Fatal(err)
	}

	index, err = Open("testidx")
	if err != ErrorIndexMetaMissing {
		t.Fatalf("expected error index metadata missing, got %v", err)
	}
}

func TestInMemIndex(t *testing.T) {

	index, err := NewMemOnly(NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestClosedIndex(t *testing.T) {
	index, err := NewMemOnly(NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}

	err = index.Index("test", "test")
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}

	err = index.Delete("test")
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}

	b := index.NewBatch()
	err = index.Batch(b)
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}

	_, err = index.Document("test")
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}

	_, err = index.DocCount()
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}

	_, err = index.Search(NewSearchRequest(NewTermQuery("test")))
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}

	_, err = index.Fields()
	if err != ErrorIndexClosed {
		t.Errorf("expected error index closed, got %v", err)
	}
}

type slowQuery struct {
	actual query.Query
	delay  time.Duration
}

func (s *slowQuery) Searcher(i index.IndexReader, m mapping.IndexMapping, options search.SearcherOptions) (search.Searcher, error) {
	time.Sleep(s.delay)
	return s.actual.Searcher(i, m, options)
}

func TestSlowSearch(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	defer func() {
		// reset logger back to normal
		SetLog(log.New(ioutil.Discard, "bleve", log.LstdFlags))
	}()
	// set custom logger
	var sdw sawDataWriter
	SetLog(log.New(&sdw, "bleve", log.LstdFlags))

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	Config.SlowSearchLogThreshold = 1 * time.Minute

	query := NewTermQuery("water")
	req := NewSearchRequest(query)
	_, err = index.Search(req)
	if err != nil {
		t.Fatal(err)
	}

	if sdw.sawData {
		t.Errorf("expected to not see slow query logged, but did")
	}

	sq := &slowQuery{
		actual: query,
		delay:  50 * time.Millisecond, // on Windows timer resolution is 15ms
	}
	req.Query = sq
	Config.SlowSearchLogThreshold = 1 * time.Microsecond
	_, err = index.Search(req)
	if err != nil {
		t.Fatal(err)
	}

	if !sdw.sawData {
		t.Errorf("expected to see slow query logged, but didn't")
	}
}

type sawDataWriter struct {
	sawData bool
}

func (s *sawDataWriter) Write(p []byte) (n int, err error) {
	s.sawData = true
	return len(p), nil
}

func TestStoredFieldPreserved(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doca := map[string]interface{}{
		"name": "Marty",
		"desc": "GopherCON India",
		"bool": true,
		"num":  float64(1),
	}
	err = index.Index("a", doca)
	if err != nil {
		t.Error(err)
	}

	q := NewTermQuery("marty")
	req := NewSearchRequest(q)
	req.Fields = []string{"name", "desc", "bool", "num"}
	res, err := index.Search(req)
	if err != nil {
		t.Error(err)
	}

	if len(res.Hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(res.Hits))
	}
	if res.Hits[0].Fields["name"] != "Marty" {
		t.Errorf("expected 'Marty' got '%s'", res.Hits[0].Fields["name"])
	}
	if res.Hits[0].Fields["desc"] != "GopherCON India" {
		t.Errorf("expected 'GopherCON India' got '%s'", res.Hits[0].Fields["desc"])
	}
	if res.Hits[0].Fields["num"] != float64(1) {
		t.Errorf("expected '1' got '%v'", res.Hits[0].Fields["num"])
	}
	if res.Hits[0].Fields["bool"] != true {
		t.Errorf("expected 'true' got '%v'", res.Hits[0].Fields["bool"])
	}
}

func TestDict(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	doca := map[string]interface{}{
		"name": "marty",
		"desc": "gophercon india",
	}
	err = index.Index("a", doca)
	if err != nil {
		t.Error(err)
	}

	docy := map[string]interface{}{
		"name": "jasper",
		"desc": "clojure",
	}
	err = index.Index("y", docy)
	if err != nil {
		t.Error(err)
	}

	docx := map[string]interface{}{
		"name": "rose",
		"desc": "googler",
	}
	err = index.Index("x", docx)
	if err != nil {
		t.Error(err)
	}

	dict, err := index.FieldDict("name")
	if err != nil {
		t.Error(err)
	}

	terms := []string{}
	de, err := dict.Next()
	for err == nil && de != nil {
		terms = append(terms, string(de.Term))
		de, err = dict.Next()
	}

	expectedTerms := []string{"jasper", "marty", "rose"}
	if !reflect.DeepEqual(terms, expectedTerms) {
		t.Errorf("expected %v, got %v", expectedTerms, terms)
	}

	err = dict.Close()
	if err != nil {
		t.Fatal(err)
	}

	// test start and end range
	dict, err = index.FieldDictRange("name", []byte("marty"), []byte("rose"))
	if err != nil {
		t.Error(err)
	}

	terms = []string{}
	de, err = dict.Next()
	for err == nil && de != nil {
		terms = append(terms, string(de.Term))
		de, err = dict.Next()
	}

	expectedTerms = []string{"marty", "rose"}
	if !reflect.DeepEqual(terms, expectedTerms) {
		t.Errorf("expected %v, got %v", expectedTerms, terms)
	}

	err = dict.Close()
	if err != nil {
		t.Fatal(err)
	}

	docz := map[string]interface{}{
		"name": "prefix",
		"desc": "bob cat cats catting dog doggy zoo",
	}
	err = index.Index("z", docz)
	if err != nil {
		t.Error(err)
	}

	dict, err = index.FieldDictPrefix("desc", []byte("cat"))
	if err != nil {
		t.Error(err)
	}

	terms = []string{}
	de, err = dict.Next()
	for err == nil && de != nil {
		terms = append(terms, string(de.Term))
		de, err = dict.Next()
	}

	expectedTerms = []string{"cat", "cats", "catting"}
	if !reflect.DeepEqual(terms, expectedTerms) {
		t.Errorf("expected %v, got %v", expectedTerms, terms)
	}

	stats := index.Stats()
	if stats == nil {
		t.Errorf("expected IndexStat, got nil")
	}

	err = dict.Close()
	if err != nil {
		t.Fatal(err)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestBatchString(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	batch := index.NewBatch()
	err = batch.Index("a", []byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	batch.Delete("b")
	batch.SetInternal([]byte("c"), []byte{})
	batch.DeleteInternal([]byte("d"))

	batchStr := batch.String()
	if !strings.HasPrefix(batchStr, "Batch (2 ops, 2 internal ops)") {
		t.Errorf("expected to start with Batch (2 ops, 2 internal ops), did not")
	}
	if !strings.Contains(batchStr, "INDEX - 'a'") {
		t.Errorf("expected to contain INDEX - 'a', did not")
	}
	if !strings.Contains(batchStr, "DELETE - 'b'") {
		t.Errorf("expected to contain DELETE - 'b', did not")
	}
	if !strings.Contains(batchStr, "SET INTERNAL - 'c'") {
		t.Errorf("expected to contain SET INTERNAL - 'c', did not")
	}
	if !strings.Contains(batchStr, "DELETE INTERNAL - 'd'") {
		t.Errorf("expected to contain DELETE INTERNAL - 'd', did not")
	}

}

func TestIndexMetadataRaceBug198(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	wg := sync.WaitGroup{}
	wg.Add(1)
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-done:
				wg.Done()
				return
			default:
				_, err2 := index.DocCount()
				if err2 != nil {
					t.Fatal(err2)
				}
			}
		}
	}()

	for i := 0; i < 100; i++ {
		batch := index.NewBatch()
		err = batch.Index("a", []byte("{}"))
		if err != nil {
			t.Fatal(err)
		}
		err = index.Batch(batch)
		if err != nil {
			t.Fatal(err)
		}
	}
	close(done)
	wg.Wait()
}

func TestSortMatchSearch(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	names := []string{"Noam", "Uri", "David", "Yosef", "Eitan", "Itay", "Ariel", "Daniel", "Omer", "Yogev", "Yehonatan", "Moshe", "Mohammed", "Yusuf", "Omar"}
	days := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
	numbers := []string{"One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"}
	for i := 0; i < 200; i++ {
		doc := make(map[string]interface{})
		doc["Name"] = names[i%len(names)]
		doc["Day"] = days[i%len(days)]
		doc["Number"] = numbers[i%len(numbers)]
		err = index.Index(fmt.Sprintf("%d", i), doc)
		if err != nil {
			t.Fatal(err)
		}
	}

	req := NewSearchRequest(NewMatchQuery("One"))
	req.SortBy([]string{"Day", "Name"})
	req.Fields = []string{"*"}
	sr, err := index.Search(req)
	if err != nil {
		t.Fatal(err)
	}
	prev := ""
	for _, hit := range sr.Hits {
		val := hit.Fields["Day"].(string)
		if prev > val {
			t.Errorf("Hits must be sorted by 'Day'. Found '%s' before '%s'", prev, val)
		}
		prev = val
	}
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexCountMatchSearch(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			b := index.NewBatch()
			for j := 0; j < 200; j++ {
				id := fmt.Sprintf("%d", (i*200)+j)
				doc := struct {
					Body string
				}{
					Body: "match",
				}
				err := b.Index(id, doc)
				if err != nil {
					t.Fatal(err)
				}
			}
			err := index.Batch(b)
			if err != nil {
				t.Fatal(err)
			}
			wg.Done()
		}(i)
	}
	wg.Wait()

	// search for something that should match all documents
	sr, err := index.Search(NewSearchRequest(NewMatchQuery("match")))
	if err != nil {
		t.Fatal(err)
	}

	// get the index document count
	dc, err := index.DocCount()
	if err != nil {
		t.Fatal(err)
	}

	// make sure test is working correctly, doc count should 2000
	if dc != 2000 {
		t.Errorf("expected doc count 2000, got %d", dc)
	}

	// make sure our search found all the documents
	if dc != sr.Total {
		t.Errorf("expected search result total %d to match doc count %d", sr.Total, dc)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestBatchReset(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	batch := index.NewBatch()
	err = batch.Index("k1", struct {
		Body string
	}{
		Body: "v1",
	})
	if err != nil {
		t.Error(err)
	}
	batch.Delete("k2")
	batch.SetInternal([]byte("k3"), []byte("v3"))
	batch.DeleteInternal([]byte("k4"))

	if batch.Size() != 4 {
		t.Logf("%v", batch)
		t.Errorf("expected batch size 4, got %d", batch.Size())
	}

	batch.Reset()

	if batch.Size() != 0 {
		t.Errorf("expected batch size 0 after reset, got %d", batch.Size())
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestDocumentFieldArrayPositions(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	// index a document with an array of strings
	err = index.Index("k", struct {
		Messages []string
	}{
		Messages: []string{
			"first",
			"second",
			"third",
			"last",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// load the document
	doc, err := index.Document("k")
	if err != nil {
		t.Fatal(err)
	}

	for _, f := range doc.Fields {
		if reflect.DeepEqual(f.Value(), []byte("first")) {
			ap := f.ArrayPositions()
			if len(ap) < 1 {
				t.Errorf("expected an array position, got none")
				continue
			}
			if ap[0] != 0 {
				t.Errorf("expected 'first' in array position 0, got %d", ap[0])
			}
		}
		if reflect.DeepEqual(f.Value(), []byte("second")) {
			ap := f.ArrayPositions()
			if len(ap) < 1 {
				t.Errorf("expected an array position, got none")
				continue
			}
			if ap[0] != 1 {
				t.Errorf("expected 'second' in array position 1, got %d", ap[0])
			}
		}
		if reflect.DeepEqual(f.Value(), []byte("third")) {
			ap := f.ArrayPositions()
			if len(ap) < 1 {
				t.Errorf("expected an array position, got none")
				continue
			}
			if ap[0] != 2 {
				t.Errorf("expected 'third' in array position 2, got %d", ap[0])
			}
		}
		if reflect.DeepEqual(f.Value(), []byte("last")) {
			ap := f.ArrayPositions()
			if len(ap) < 1 {
				t.Errorf("expected an array position, got none")
				continue
			}
			if ap[0] != 3 {
				t.Errorf("expected 'last' in array position 3, got %d", ap[0])
			}
		}
	}

	// now index a document in the same field with a single string
	err = index.Index("k2", struct {
		Messages string
	}{
		Messages: "only",
	})
	if err != nil {
		t.Fatal(err)
	}

	// load the document
	doc, err = index.Document("k2")
	if err != nil {
		t.Fatal(err)
	}

	for _, f := range doc.Fields {
		if reflect.DeepEqual(f.Value(), []byte("only")) {
			ap := f.ArrayPositions()
			if len(ap) != 0 {
				t.Errorf("expected no array positions, got %d", len(ap))
				continue
			}
		}
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestKeywordSearchBug207(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	f := NewTextFieldMapping()
	f.Analyzer = keyword.Name

	m := NewIndexMapping()
	m.DefaultMapping = NewDocumentMapping()
	m.DefaultMapping.AddFieldMappingsAt("Body", f)

	index, err := New("testidx", m)
	if err != nil {
		t.Fatal(err)
	}

	doc1 := struct {
		Body string
	}{
		Body: "a555c3bb06f7a127cda000005",
	}

	err = index.Index("a", doc1)
	if err != nil {
		t.Fatal(err)
	}

	doc2 := struct {
		Body string
	}{
		Body: "555c3bb06f7a127cda000005",
	}

	err = index.Index("b", doc2)
	if err != nil {
		t.Fatal(err)
	}

	// now search for these terms
	sreq := NewSearchRequest(NewTermQuery("a555c3bb06f7a127cda000005"))
	sres, err := index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 result, got %d", sres.Total)
	}
	if sres.Hits[0].ID != "a" {
		t.Errorf("expecated id 'a', got '%s'", sres.Hits[0].ID)
	}

	sreq = NewSearchRequest(NewTermQuery("555c3bb06f7a127cda000005"))
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 result, got %d", sres.Total)
	}
	if sres.Hits[0].ID != "b" {
		t.Errorf("expecated id 'b', got '%s'", sres.Hits[0].ID)
	}

	// now do the same searches using query strings
	sreq = NewSearchRequest(NewQueryStringQuery("Body:a555c3bb06f7a127cda000005"))
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 result, got %d", sres.Total)
	}
	if sres.Hits[0].ID != "a" {
		t.Errorf("expecated id 'a', got '%s'", sres.Hits[0].ID)
	}

	sreq = NewSearchRequest(NewQueryStringQuery(`Body:555c3bb06f7a127cda000005`))
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 result, got %d", sres.Total)
	}
	if sres.Hits[0].ID != "b" {
		t.Errorf("expecated id 'b', got '%s'", sres.Hits[0].ID)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestTermVectorArrayPositions(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	// index a document with an array of strings
	err = index.Index("k", struct {
		Messages []string
	}{
		Messages: []string{
			"first",
			"second",
			"third",
			"last",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// search for this document in all field
	tq := NewTermQuery("second")
	tsr := NewSearchRequest(tq)
	tsr.IncludeLocations = true
	results, err := index.Search(tsr)
	if err != nil {
		t.Fatal(err)
	}
	if results.Total != 1 {
		t.Fatalf("expected 1 result, got %d", results.Total)
	}
	if len(results.Hits[0].Locations["Messages"]["second"]) < 1 {
		t.Fatalf("expected at least one location")
	}
	if len(results.Hits[0].Locations["Messages"]["second"][0].ArrayPositions) < 1 {
		t.Fatalf("expected at least one location array position")
	}
	if results.Hits[0].Locations["Messages"]["second"][0].ArrayPositions[0] != 1 {
		t.Fatalf("expected array position 1, got %d", results.Hits[0].Locations["Messages"]["second"][0].ArrayPositions[0])
	}

	// repeat search for this document in Messages field
	tq2 := NewTermQuery("third")
	tq2.SetField("Messages")
	tsr = NewSearchRequest(tq2)
	tsr.IncludeLocations = true
	results, err = index.Search(tsr)
	if err != nil {
		t.Fatal(err)
	}
	if results.Total != 1 {
		t.Fatalf("expected 1 result, got %d", results.Total)
	}
	if len(results.Hits[0].Locations["Messages"]["third"]) < 1 {
		t.Fatalf("expected at least one location")
	}
	if len(results.Hits[0].Locations["Messages"]["third"][0].ArrayPositions) < 1 {
		t.Fatalf("expected at least one location array position")
	}
	if results.Hits[0].Locations["Messages"]["third"][0].ArrayPositions[0] != 2 {
		t.Fatalf("expected array position 2, got %d", results.Hits[0].Locations["Messages"]["third"][0].ArrayPositions[0])
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestDocumentStaticMapping(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	m := NewIndexMapping()
	m.DefaultMapping = NewDocumentStaticMapping()
	m.DefaultMapping.AddFieldMappingsAt("Text", NewTextFieldMapping())
	m.DefaultMapping.AddFieldMappingsAt("Date", NewDateTimeFieldMapping())
	m.DefaultMapping.AddFieldMappingsAt("Numeric", NewNumericFieldMapping())

	index, err := New("testidx", m)
	if err != nil {
		t.Fatal(err)
	}

	doc1 := struct {
		Text           string
		IgnoredText    string
		Numeric        float64
		IgnoredNumeric float64
		Date           time.Time
		IgnoredDate    time.Time
	}{
		Text:           "valid text",
		IgnoredText:    "ignored text",
		Numeric:        10,
		IgnoredNumeric: 20,
		Date:           time.Unix(1, 0),
		IgnoredDate:    time.Unix(2, 0),
	}

	err = index.Index("a", doc1)
	if err != nil {
		t.Fatal(err)
	}

	fields, err := index.Fields()
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(fields)
	expectedFields := []string{"Date", "Numeric", "Text", "_all"}
	if len(fields) < len(expectedFields) {
		t.Fatalf("invalid field count: %d", len(fields))
	}
	for i, expected := range expectedFields {
		if expected != fields[i] {
			t.Fatalf("unexpected field[%d]: %s", i, fields[i])
		}
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestIndexEmptyDocId(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	doc := map[string]interface{}{
		"body": "nodocid",
	}

	err = index.Index("", doc)
	if err != ErrorEmptyID {
		t.Errorf("expect index empty doc id to fail")
	}

	err = index.Delete("")
	if err != ErrorEmptyID {
		t.Errorf("expect delete empty doc id to fail")
	}

	batch := index.NewBatch()
	err = batch.Index("", doc)
	if err != ErrorEmptyID {
		t.Errorf("expect index empty doc id in batch to fail")
	}

	batch.Delete("")
	if batch.Size() > 0 {
		t.Errorf("expect delete empty doc id in batch to be ignored")
	}
}

func TestDateTimeFieldMappingIssue287(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	f := NewDateTimeFieldMapping()

	m := NewIndexMapping()
	m.DefaultMapping = NewDocumentMapping()
	m.DefaultMapping.AddFieldMappingsAt("Date", f)

	index, err := New("testidx", m)
	if err != nil {
		t.Fatal(err)
	}

	type doc struct {
		Date time.Time
	}

	now := time.Now()

	// 3hr ago to 1hr ago
	for i := 0; i < 3; i++ {
		d := doc{now.Add(time.Duration((i - 3)) * time.Hour)}

		err = index.Index(strconv.FormatInt(int64(i), 10), d)
		if err != nil {
			t.Fatal(err)
		}
	}

	// search range across all docs
	start := now.Add(-4 * time.Hour)
	end := now
	sreq := NewSearchRequest(NewDateRangeQuery(start, end))
	sres, err := index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 3 {
		t.Errorf("expected 3 results, got %d", sres.Total)
	}

	// search range includes only oldest
	start = now.Add(-4 * time.Hour)
	end = now.Add(-121 * time.Minute)
	sreq = NewSearchRequest(NewDateRangeQuery(start, end))
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 results, got %d", sres.Total)
	}
	if sres.Total > 0 && sres.Hits[0].ID != "0" {
		t.Errorf("expecated id '0', got '%s'", sres.Hits[0].ID)
	}

	// search range includes only newest
	start = now.Add(-61 * time.Minute)
	end = now
	sreq = NewSearchRequest(NewDateRangeQuery(start, end))
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 results, got %d", sres.Total)
	}
	if sres.Total > 0 && sres.Hits[0].ID != "2" {
		t.Errorf("expecated id '2', got '%s'", sres.Hits[0].ID)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestDocumentFieldArrayPositionsBug295(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	// index a document with an array of strings
	err = index.Index("k", struct {
		Messages []string
		Another  string
		MoreData []string
	}{
		Messages: []string{
			"bleve",
			"bleve",
		},
		Another: "text",
		MoreData: []string{
			"a",
			"b",
			"c",
			"bleve",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// search for it in the messages field
	tq := NewTermQuery("bleve")
	tq.SetField("Messages")
	tsr := NewSearchRequest(tq)
	tsr.IncludeLocations = true
	results, err := index.Search(tsr)
	if err != nil {
		t.Fatal(err)
	}
	if results.Total != 1 {
		t.Fatalf("expected 1 result, got %d", results.Total)
	}
	if len(results.Hits[0].Locations["Messages"]["bleve"]) != 2 {
		t.Fatalf("expected 2 locations of 'bleve', got %d", len(results.Hits[0].Locations["Messages"]["bleve"]))
	}
	if results.Hits[0].Locations["Messages"]["bleve"][0].ArrayPositions[0] != 0 {
		t.Errorf("expected array position to be 0")
	}
	if results.Hits[0].Locations["Messages"]["bleve"][1].ArrayPositions[0] != 1 {
		t.Errorf("expected array position to be 1")
	}

	// search for it in all
	tq = NewTermQuery("bleve")
	tsr = NewSearchRequest(tq)
	tsr.IncludeLocations = true
	results, err = index.Search(tsr)
	if err != nil {
		t.Fatal(err)
	}
	if results.Total != 1 {
		t.Fatalf("expected 1 result, got %d", results.Total)
	}
	if len(results.Hits[0].Locations["Messages"]["bleve"]) != 2 {
		t.Fatalf("expected 2 locations of 'bleve', got %d", len(results.Hits[0].Locations["Messages"]["bleve"]))
	}
	if results.Hits[0].Locations["Messages"]["bleve"][0].ArrayPositions[0] != 0 {
		t.Errorf("expected array position to be 0")
	}
	if results.Hits[0].Locations["Messages"]["bleve"][1].ArrayPositions[0] != 1 {
		t.Errorf("expected array position to be 1")
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestBooleanFieldMappingIssue109(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	m := NewIndexMapping()
	m.DefaultMapping = NewDocumentMapping()
	m.DefaultMapping.AddFieldMappingsAt("Bool", NewBooleanFieldMapping())

	index, err := New("testidx", m)
	if err != nil {
		t.Fatal(err)
	}

	type doc struct {
		Bool bool
	}
	err = index.Index("true", &doc{Bool: true})
	if err != nil {
		t.Fatal(err)
	}
	err = index.Index("false", &doc{Bool: false})
	if err != nil {
		t.Fatal(err)
	}

	q := NewBoolFieldQuery(true)
	q.SetField("Bool")
	sreq := NewSearchRequest(q)
	sres, err := index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 results, got %d", sres.Total)
	}

	q = NewBoolFieldQuery(false)
	q.SetField("Bool")
	sreq = NewSearchRequest(q)
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 results, got %d", sres.Total)
	}

	sreq = NewSearchRequest(NewBoolFieldQuery(true))
	sres, err = index.Search(sreq)
	if err != nil {
		t.Fatal(err)
	}
	if sres.Total != 1 {
		t.Errorf("expected 1 results, got %d", sres.Total)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func TestSearchTimeout(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// first run a search with an absurdly long timeout (should succeed)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	query := NewTermQuery("water")
	req := NewSearchRequest(query)
	_, err = index.SearchInContext(ctx, req)
	if err != nil {
		t.Fatal(err)
	}

	// now run a search again with an absurdly low timeout (should timeout)
	ctx, cancel = context.WithTimeout(context.Background(), 1*time.Microsecond)
	defer cancel()
	sq := &slowQuery{
		actual: query,
		delay:  50 * time.Millisecond, // on Windows timer resolution is 15ms
	}
	req.Query = sq
	_, err = index.SearchInContext(ctx, req)
	if err != context.DeadlineExceeded {
		t.Fatalf("exected %v, got: %v", context.DeadlineExceeded, err)
	}

	// now run a search with a long timeout, but with a long query, and cancel it
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	sq = &slowQuery{
		actual: query,
		delay:  100 * time.Millisecond, // on Windows timer resolution is 15ms
	}
	req = NewSearchRequest(sq)
	cancel()
	_, err = index.SearchInContext(ctx, req)
	if err != context.Canceled {
		t.Fatalf("exected %v, got: %v", context.Canceled, err)
	}
}

// TestConfigCache exposes a concurrent map write with go 1.6
func TestConfigCache(t *testing.T) {
	for i := 0; i < 100; i++ {
		go func() {
			_, err := Config.Cache.HighlighterNamed(Config.DefaultHighlighter)
			if err != nil {
				t.Error(err)
			}
		}()
	}
}

func TestBatchRaceBug260(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()
	i, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := i.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()
	b := i.NewBatch()
	err = b.Index("1", 1)
	if err != nil {
		t.Fatal(err)
	}
	err = i.Batch(b)
	if err != nil {
		t.Fatal(err)
	}
	b.Reset()
	err = b.Index("2", 2)
	if err != nil {
		t.Fatal(err)
	}
	err = i.Batch(b)
	if err != nil {
		t.Fatal(err)
	}
	b.Reset()
}

func BenchmarkBatchOverhead(b *testing.B) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			b.Fatal(err)
		}
	}()
	m := NewIndexMapping()
	i, err := NewUsing("testidx", m, Config.DefaultIndexType, null.Name, nil)
	if err != nil {
		b.Fatal(err)
	}
	for n := 0; n < b.N; n++ {
		// put 1000 items in a batch
		batch := i.NewBatch()
		for i := 0; i < 1000; i++ {
			err = batch.Index(fmt.Sprintf("%d", i), map[string]interface{}{"name": "bleve"})
			if err != nil {
				b.Fatal(err)
			}
		}
		err = i.Batch(batch)
		if err != nil {
			b.Fatal(err)
		}
		batch.Reset()
	}
}

func TestOpenReadonlyMultiple(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	// build an index and close it
	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	doca := map[string]interface{}{
		"name": "marty",
		"desc": "gophercon india",
	}
	err = index.Index("a", doca)
	if err != nil {
		t.Fatal(err)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}

	// now open it read-only
	index, err = OpenUsing("testidx", map[string]interface{}{
		"read_only": true,
	})

	if err != nil {
		t.Fatal(err)
	}

	// now open it again
	index2, err := OpenUsing("testidx", map[string]interface{}{
		"read_only": true,
	})

	if err != nil {
		t.Fatal(err)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
	err = index2.Close()
	if err != nil {
		t.Fatal(err)
	}
}

// TestBug408 tests for VERY large values of size, even though actual result
// set may be reasonable size
func TestBug408(t *testing.T) {
	type TestStruct struct {
		ID     string  `json:"id"`
		UserID *string `json:"user_id"`
	}

	docMapping := NewDocumentMapping()
	docMapping.AddFieldMappingsAt("id", NewTextFieldMapping())
	docMapping.AddFieldMappingsAt("user_id", NewTextFieldMapping())

	indexMapping := NewIndexMapping()
	indexMapping.DefaultMapping = docMapping

	index, err := NewMemOnly(indexMapping)
	if err != nil {
		t.Fatal(err)
	}

	numToTest := 10
	matchUserID := "match"
	noMatchUserID := "no_match"
	matchingDocIds := make(map[string]struct{})

	for i := 0; i < numToTest; i++ {
		ds := &TestStruct{"id_" + strconv.Itoa(i), nil}
		if i%2 == 0 {
			ds.UserID = &noMatchUserID
		} else {
			ds.UserID = &matchUserID
			matchingDocIds[ds.ID] = struct{}{}
		}
		err = index.Index(ds.ID, ds)
		if err != nil {
			t.Fatal(err)
		}
	}

	cnt, err := index.DocCount()
	if err != nil {
		t.Fatal(err)
	}
	if int(cnt) != numToTest {
		t.Fatalf("expected %d documents in index, got %d", numToTest, cnt)
	}

	q := NewTermQuery(matchUserID)
	q.SetField("user_id")
	searchReq := NewSearchRequestOptions(q, math.MaxInt32, 0, false)
	results, err := index.Search(searchReq)
	if err != nil {
		t.Fatal(err)
	}
	if int(results.Total) != numToTest/2 {
		t.Fatalf("expected %d search hits, got %d", numToTest/2, results.Total)
	}

	for _, result := range results.Hits {
		if _, found := matchingDocIds[result.ID]; !found {
			t.Fatalf("document with ID %s not in results as expected", result.ID)
		}
	}
}

func TestIndexAdvancedCountMatchSearch(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			b := index.NewBatch()
			for j := 0; j < 200; j++ {
				id := fmt.Sprintf("%d", (i*200)+j)

				doc := &document.Document{
					ID: id,
					Fields: []document.Field{
						document.NewTextField("body", []uint64{}, []byte("match")),
					},
					CompositeFields: []*document.CompositeField{
						document.NewCompositeField("_all", true, []string{}, []string{}),
					},
				}

				err := b.IndexAdvanced(doc)
				if err != nil {
					t.Fatal(err)
				}
			}
			err := index.Batch(b)
			if err != nil {
				t.Fatal(err)
			}
			wg.Done()
		}(i)
	}
	wg.Wait()

	// search for something that should match all documents
	sr, err := index.Search(NewSearchRequest(NewMatchQuery("match")))
	if err != nil {
		t.Fatal(err)
	}

	// get the index document count
	dc, err := index.DocCount()
	if err != nil {
		t.Fatal(err)
	}

	// make sure test is working correctly, doc count should 2000
	if dc != 2000 {
		t.Errorf("expected doc count 2000, got %d", dc)
	}

	// make sure our search found all the documents
	if dc != sr.Total {
		t.Errorf("expected search result total %d to match doc count %d", sr.Total, dc)
	}

	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}
}

func benchmarkSearchOverhead(indexType string, b *testing.B) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			b.Fatal(err)
		}
	}()

	index, err := NewUsing("testidx", NewIndexMapping(),
		indexType, Config.DefaultKVStore, nil)
	if err != nil {
		b.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			b.Fatal(err)
		}
	}()

	elements := []string{"air", "water", "fire", "earth"}
	for j := 0; j < 10000; j++ {
		err = index.Index(fmt.Sprintf("%d", j),
			map[string]interface{}{"name": elements[j%len(elements)]})
		if err != nil {
			b.Fatal(err)
		}
	}

	query1 := NewTermQuery("water")
	query2 := NewTermQuery("fire")
	query := NewDisjunctionQuery(query1, query2)
	req := NewSearchRequest(query)

	b.ResetTimer()

	for n := 0; n < b.N; n++ {
		_, err = index.Search(req)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkUpsidedownSearchOverhead(b *testing.B) {
	benchmarkSearchOverhead(upsidedown.Name, b)
}

func BenchmarkScorchSearchOverhead(b *testing.B) {
	benchmarkSearchOverhead(scorch.Name, b)
}

func TestSearchQueryCallback(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	elements := []string{"air", "water", "fire", "earth"}
	for j := 0; j < 10000; j++ {
		err = index.Index(fmt.Sprintf("%d", j),
			map[string]interface{}{"name": elements[j%len(elements)]})
		if err != nil {
			t.Fatal(err)
		}
	}

	query := NewTermQuery("water")
	req := NewSearchRequest(query)

	expErr := fmt.Errorf("MEM_LIMIT_EXCEEDED")
	f := func(size uint64) error {
		if size > 1000 {
			return expErr
		}
		return nil
	}

	ctx := context.WithValue(context.Background(), SearchQueryStartCallbackKey,
		SearchQueryStartCallbackFn(f))
	_, err = index.SearchInContext(ctx, req)
	if err != expErr {
		t.Fatalf("Expected: %v, Got: %v", expErr, err)
	}
}

func TestBatchMerge(t *testing.T) {
	defer func() {
		err := os.RemoveAll("testidx")
		if err != nil {
			t.Fatal(err)
		}
	}()

	index, err := New("testidx", NewIndexMapping())
	if err != nil {
		t.Fatal(err)
	}
	doca := map[string]interface{}{
		"name":   "scorch",
		"desc":   "gophercon india",
		"nation": "india",
	}

	batchA := index.NewBatch()
	err = batchA.Index("a", doca)
	if err != nil {
		t.Error(err)
	}
	batchA.SetInternal([]byte("batchkA"), []byte("batchvA"))

	docb := map[string]interface{}{
		"name": "moss",
		"desc": "gophercon MV",
	}

	batchB := index.NewBatch()
	err = batchB.Index("b", docb)
	if err != nil {
		t.Error(err)
	}
	batchB.SetInternal([]byte("batchkB"), []byte("batchvB"))

	docC := map[string]interface{}{
		"name":    "blahblah",
		"desc":    "inProgress",
		"country": "usa",
	}

	batchC := index.NewBatch()
	err = batchC.Index("c", docC)
	if err != nil {
		t.Error(err)
	}
	batchC.SetInternal([]byte("batchkC"), []byte("batchvC"))
	batchC.SetInternal([]byte("batchkB"), []byte("batchvBNew"))
	batchC.Delete("a")
	batchC.DeleteInternal([]byte("batchkA"))

	batchA.Merge(batchB)

	if batchA.Size() != 4 {
		t.Errorf("expected batch size 4, got %d", batchA.Size())
	}

	batchA.Merge(batchC)

	if batchA.Size() != 6 {
		t.Errorf("expected batch size 6, got %d", batchA.Size())
	}

	err = index.Batch(batchA)
	if err != nil {
		t.Fatal(err)
	}

	// close the index, open it again, and try some more things
	err = index.Close()
	if err != nil {
		t.Fatal(err)
	}

	index, err = Open("testidx")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	count, err := index.DocCount()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("expected doc count 2, got %d", count)
	}

	doc, err := index.Document("c")
	if err != nil {
		t.Fatal(err)
	}
	if doc == nil {
		t.Errorf("expected doc not nil, got nil")
	}

	val, err := index.GetInternal([]byte("batchkB"))
	if err != nil {
		t.Fatal(err)
	}
	if val == nil || string(val) != "batchvBNew" {
		t.Errorf("expected val: batchvBNew , got %s", val)
	}

	val, err = index.GetInternal([]byte("batchkA"))
	if err != nil {
		t.Fatal(err)
	}
	if val != nil {
		t.Errorf("expected nil, got %s", val)
	}

	foundNameField := false
	for _, field := range doc.Fields {
		if field.Name() == "name" && string(field.Value()) == "blahblah" {
			foundNameField = true
		}
	}
	if !foundNameField {
		t.Errorf("expected to find field named 'name' with value 'blahblah'")
	}

	fields, err := index.Fields()
	if err != nil {
		t.Fatal(err)
	}

	expectedFields := map[string]bool{
		"_all":    false,
		"name":    false,
		"desc":    false,
		"country": false,
	}
	if len(fields) < len(expectedFields) {
		t.Fatalf("expected %d fields got %d", len(expectedFields), len(fields))
	}

	for _, f := range fields {
		expectedFields[f] = true
	}

	for ef, efp := range expectedFields {
		if !efp {
			t.Errorf("field %s is missing", ef)
		}
	}

}
