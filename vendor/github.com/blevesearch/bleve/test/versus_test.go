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

package test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"text/template"

	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/index/scorch"
	"github.com/blevesearch/bleve/index/store/boltdb"
	"github.com/blevesearch/bleve/index/upsidedown"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/bleve/search"
)

// Tests scorch indexer versus upsidedown/bolt indexer against various
// templated queries.  Example usage from the bleve top-level directory...
//
//     go test -v -run TestScorchVersusUpsideDownBolt ./test
//     VERBOSE=1 FOCUS=Trista go test -v -run TestScorchVersusUpsideDownBolt ./test
//

func init() {
	// override for tests
	scorch.DefaultPersisterNapTimeMSec = 1
}

func TestScorchVersusUpsideDownBoltAll(t *testing.T) {
	(&VersusTest{
		t:                    t,
		NumDocs:              1000,
		MaxWordsPerDoc:       20,
		NumWords:             10,
		BatchSize:            10,
		NumAttemptsPerSearch: 100,
	}).run(scorch.Name, boltdb.Name, upsidedown.Name, boltdb.Name, nil, nil)
}

func TestScorchVersusUpsideDownBoltSmallMNSAM(t *testing.T) {
	(&VersusTest{
		t:                    t,
		Focus:                "must-not-same-as-must",
		NumDocs:              5,
		MaxWordsPerDoc:       2,
		NumWords:             1,
		BatchSize:            1,
		NumAttemptsPerSearch: 1,
	}).run(scorch.Name, boltdb.Name, upsidedown.Name, boltdb.Name, nil, nil)
}

func TestScorchVersusUpsideDownBoltSmallCMP11(t *testing.T) {
	(&VersusTest{
		t:                    t,
		Focus:                "conjuncts-match-phrase-1-1",
		NumDocs:              30,
		MaxWordsPerDoc:       8,
		NumWords:             2,
		BatchSize:            1,
		NumAttemptsPerSearch: 1,
	}).run(scorch.Name, boltdb.Name, upsidedown.Name, boltdb.Name, nil, nil)
}

// -------------------------------------------------------

// Templates used to compare search results in the "versus" tests.
var testVersusSearchTemplates = []string{
	`{
      "about": "expected to return zero hits",
      "query": {
       "query": "title:notARealTitle"
      }
     }`,
	`{
      "about": "try straight word()'s",
      "query": {
       "query": "body:{{word}}"
      }
     }`,
	`{
      "about": "conjuncts on same term",
      "query": {
        "conjuncts": [
          { "field": "body", "term": "{{word}}", "boost": 1.0 },
          { "field": "body", "term": "{{word}}", "boost": 1.0 }
        ]
      }
     }`,
	`{
      "about": "disjuncts on same term",
      "query": {
        "disjuncts": [
          { "field": "body", "term": "{{word}}", "boost": 1.0 },
          { "field": "body", "term": "{{word}}", "boost": 1.0 }
        ]
      }
     }`,
	`{
      "about": "never-matching-title-conjuncts",
      "query": {
        "conjuncts": [
          {"field": "body", "match": "{{word}}"},
          {"field": "body", "match": "{{word}}"},
          {"field": "title", "match": "notAnActualTitle"}
        ]
      }
     }`,
	`{
      "about": "never-matching-title-disjuncts",
      "query": {
        "disjuncts": [
          {"field": "body", "match": "{{word}}"},
          {"field": "body", "match": "{{word}}"},
          {"field": "title", "match": "notAnActualTitle"}
        ]
      }
     }`,
	`{
      "about": "must-not-never-matches",
      "query": {
        "must_not": {"disjuncts": [
          {"field": "title", "match": "notAnActualTitle"}
        ]},
        "should": {"disjuncts": [
          {"field": "body", "match": "{{word}}"}
        ]}
      }
     }`,
	`{
      "about": "must-not-only",
      "query": {
        "must_not": {"disjuncts": [
          {"field": "body", "term": "{{word}}"}
        ]}
      }
     }`,
	`{
      "about": "must-not-same-as-must -- see: MB-27291",
      "query": {
        "must_not": {"disjuncts": [
          {"field": "body", "match": "{{word}}"}
        ]},
        "must": {"conjuncts": [
          {"field": "body", "match": "{{word}}"}
        ]}
      }
     }`,
	`{
      "about": "must-not-same-as-should",
      "query": {
        "must_not": {"disjuncts": [
          {"field": "body", "match": "{{word}}"}
        ]},
        "should": {"disjuncts": [
          {"field": "body", "match": "{{word}}"}
        ]}
      }
     }`,
	`{
      "about": "inspired by testrunner RQG issue -- see: MB-27291",
      "query": {
        "must_not": {"disjuncts": [
          {"field": "title", "match": "Trista Allen"},
          {"field": "body", "match": "{{word}}"}
        ]},
        "should": {"disjuncts": [
          {"field": "title", "match": "Kallie Safiya Amara"},
          {"field": "body", "match": "{{word}}"}
        ]}
      }
     }`,
	`{
      "about": "conjuncts-match-phrase-1-1 inspired by testrunner RQG issue -- see: MB-27291",
      "query": {
        "conjuncts": [
          {"field": "body", "match": "{{bodyWord 0}}"},
          {"field": "body", "match_phrase": "{{bodyWord 1}} {{bodyWord 1}}"}
        ]
      }
     }`,
	`{
      "about": "conjuncts-match-phrase-1-2 inspired by testrunner RQG issue -- see: MB-27291 -- FAILS!!",
      "query": {
        "conjuncts": [
          {"field": "body", "match": "{{bodyWord 0}}"},
          {"field": "body", "match_phrase": "{{bodyWord 1}} {{bodyWord 2}}"}
        ]
      }
     }`,
}

// -------------------------------------------------------

type VersusTest struct {
	t *testing.T

	// Use environment variable VERBOSE=<integer> that's > 0 for more
	// verbose output.
	Verbose int

	// Allow user to focus on particular search templates, where
	// where the search template must contain the Focus string.
	Focus string

	NumDocs              int // Number of docs to insert.
	MaxWordsPerDoc       int // Max number words in each doc's Body field.
	NumWords             int // Total number of words in the dictionary.
	BatchSize            int // Batch size when inserting docs.
	NumAttemptsPerSearch int // For each search template, number of searches to try.

	// The Bodies is an array with length NumDocs, where each entry
	// is the words in a doc's Body field.
	Bodies [][]string

	CurAttempt  int
	TotAttempts int
}

// -------------------------------------------------------

func testVersusSearches(vt *VersusTest, searchTemplates []string, idxA, idxB bleve.Index) {
	t := vt.t

	funcMap := template.FuncMap{
		// Returns a word.  The word may or may not be in any
		// document's body.
		"word": func() string {
			return vt.genWord(vt.CurAttempt % vt.NumWords)
		},
		// Picks a document and returns the i'th word in that
		// document's body.  You can use this in searches to
		// definitely find at least one document.
		"bodyWord": func(i int) string {
			body := vt.Bodies[vt.CurAttempt%len(vt.Bodies)]
			if len(body) == 0 {
				return ""
			}
			return body[i%len(body)]
		},
	}

	// Optionally allow call to focus on a particular search templates,
	// where the search template must contain the vt.Focus string.
	if vt.Focus == "" {
		vt.Focus = os.Getenv("FOCUS")
	}

	for i, searchTemplate := range searchTemplates {
		if vt.Focus != "" && !strings.Contains(searchTemplate, vt.Focus) {
			continue
		}

		tmpl, err := template.New("search").Funcs(funcMap).Parse(searchTemplate)
		if err != nil {
			t.Fatalf("could not parse search template: %s, err: %v", searchTemplate, err)
		}

		for j := 0; j < vt.NumAttemptsPerSearch; j++ {
			vt.CurAttempt = j

			var buf bytes.Buffer
			err = tmpl.Execute(&buf, vt)
			if err != nil {
				t.Fatalf("could not execute search template: %s, err: %v", searchTemplate, err)
			}

			bufBytes := buf.Bytes()

			if vt.Verbose > 0 {
				fmt.Printf("  %s\n", bufBytes)
			}

			var search bleve.SearchRequest
			err = json.Unmarshal(bufBytes, &search)
			if err != nil {
				t.Fatalf("could not unmarshal search: %s, err: %v", bufBytes, err)
			}

			search.Size = vt.NumDocs * 10 // Crank up limit to get all results.

			searchA := search
			searchB := search

			resA, errA := idxA.Search(&searchA)
			resB, errB := idxB.Search(&searchB)
			if errA != errB {
				t.Errorf("search: (%d) %s,\n err mismatch, errA: %v, errB: %v",
					i, bufBytes, errA, errB)
			}

			// Scores might have float64 vs float32 wobbles, so truncate precision.
			resA.MaxScore = math.Trunc(resA.MaxScore*1000.0) / 1000.0
			resB.MaxScore = math.Trunc(resB.MaxScore*1000.0) / 1000.0

			// Timings may be different between A & B, so force equality.
			resA.Took = resB.Took

			// Hits might have different ordering since some indexers
			// (like upsidedown) have a natural secondary sort on id
			// while others (like scorch) don't.  So, we compare by
			// putting the hits from A & B into maps.
			hitsA := hitsById(resA)
			hitsB := hitsById(resB)
			for id, hitA := range hitsA {
				hitB := hitsB[id]
				if len(hitA.FieldTermLocations) == 0 {
					hitA.FieldTermLocations = nil
				}
				if len(hitB.FieldTermLocations) == 0 {
					hitB.FieldTermLocations = nil
				}
				if !reflect.DeepEqual(hitA, hitB) {
					t.Errorf("\n  driving from hitsA\n    hitA: %#v,\n    hitB: %#v", hitA, hitB)
					idx, _ := strconv.Atoi(id)
					t.Errorf("\n    doc: %d, body: %s", idx, strings.Join(vt.Bodies[idx], " "))
				}
			}
			for id, hitB := range hitsB {
				hitA := hitsA[id]
				if len(hitA.FieldTermLocations) == 0 {
					hitA.FieldTermLocations = nil
				}
				if len(hitB.FieldTermLocations) == 0 {
					hitB.FieldTermLocations = nil
				}
				if !reflect.DeepEqual(hitA, hitB) {
					t.Errorf("\n  driving from hitsB\n    hitA: %#v,\n    hitB: %#v", hitA, hitB)
					idx, _ := strconv.Atoi(id)
					t.Errorf("\n    doc: %d, body: %s", idx, strings.Join(vt.Bodies[idx], " "))
				}
			}
			if !reflect.DeepEqual(hitsA, hitsB) {
				t.Errorf("=========\nsearch: (%d) %s,\n res hits mismatch,\n len(hitsA): %d,\n len(hitsB): %d",
					i, bufBytes, len(hitsA), len(hitsB))
				t.Errorf("\n  hitsA: %#v,\n  hitsB: %#v",
					hitsA, hitsB)
			}

			resA.Hits = nil
			resB.Hits = nil

			if !reflect.DeepEqual(resA, resB) {
				resAj, _ := json.Marshal(resA)
				resBj, _ := json.Marshal(resB)
				t.Errorf("search: (%d) %s,\n  res mismatch,\n  resA: %s,\n  resB: %s",
					i, bufBytes, resAj, resBj)
			}

			if vt.Verbose > 0 {
				fmt.Printf("  Total: (%t) %d\n", resA.Total == resB.Total, resA.Total)
			}

			vt.TotAttempts++
		}
	}
}

// Organizes the hits into a map keyed by id.
func hitsById(res *bleve.SearchResult) map[string]*search.DocumentMatch {
	rv := make(map[string]*search.DocumentMatch, len(res.Hits))

	for _, hit := range res.Hits {
		// Clear out or truncate precision of hit fields that might be
		// different across different indexer implementations.
		hit.Index = ""
		hit.Score = math.Trunc(hit.Score*1000.0) / 1000.0
		hit.IndexInternalID = nil
		hit.HitNumber = 0

		rv[hit.ID] = hit
	}

	return rv
}

// -------------------------------------------------------

func (vt *VersusTest) run(indexTypeA, kvStoreA, indexTypeB, kvStoreB string,
	cb func(versusTest *VersusTest, searchTemplates []string, idxA, idxB bleve.Index),
	searchTemplates []string) {
	if cb == nil {
		cb = testVersusSearches
	}

	if searchTemplates == nil {
		searchTemplates = testVersusSearchTemplates
	}

	if vt.Verbose <= 0 {
		vt.Verbose, _ = strconv.Atoi(os.Getenv("VERBOSE"))
	}

	dirA := "/tmp/bleve-versus-test-a"
	dirB := "/tmp/bleve-versus-test-b"

	defer func() {
		_ = os.RemoveAll(dirA)
		_ = os.RemoveAll(dirB)
	}()

	_ = os.RemoveAll(dirA)
	_ = os.RemoveAll(dirB)

	imA := vt.makeIndexMapping()
	imB := vt.makeIndexMapping()

	kvConfigA := map[string]interface{}{}
	kvConfigB := map[string]interface{}{}

	idxA, err := bleve.NewUsing(dirA, imA, indexTypeA, kvStoreA, kvConfigA)
	if err != nil || idxA == nil {
		vt.t.Fatalf("new using err: %v", err)
	}
	defer func() { _ = idxA.Close() }()

	idxB, err := bleve.NewUsing(dirB, imB, indexTypeB, kvStoreB, kvConfigB)
	if err != nil || idxB == nil {
		vt.t.Fatalf("new using err: %v", err)
	}
	defer func() { _ = idxB.Close() }()

	rand.Seed(0)

	if vt.Bodies == nil {
		vt.Bodies = vt.genBodies()
	}

	vt.insertBodies(idxA)
	vt.insertBodies(idxB)

	cb(vt, searchTemplates, idxA, idxB)
}

// -------------------------------------------------------

func (vt *VersusTest) makeIndexMapping() mapping.IndexMapping {
	standardFM := bleve.NewTextFieldMapping()
	standardFM.Store = false
	standardFM.IncludeInAll = false
	standardFM.IncludeTermVectors = true
	standardFM.Analyzer = "standard"

	dm := bleve.NewDocumentMapping()
	dm.AddFieldMappingsAt("title", standardFM)
	dm.AddFieldMappingsAt("body", standardFM)

	im := bleve.NewIndexMapping()
	im.DefaultMapping = dm
	im.DefaultAnalyzer = "standard"

	return im
}

func (vt *VersusTest) insertBodies(idx bleve.Index) {
	batch := idx.NewBatch()
	for i, bodyWords := range vt.Bodies {
		title := fmt.Sprintf("%d", i)
		body := strings.Join(bodyWords, " ")
		err := batch.Index(title, map[string]interface{}{"title": title, "body": body})
		if err != nil {
			vt.t.Fatalf("batch.Index err: %v", err)
		}
		if i%vt.BatchSize == 0 {
			err = idx.Batch(batch)
			if err != nil {
				vt.t.Fatalf("batch err: %v", err)
			}
			batch.Reset()
		}
	}
	err := idx.Batch(batch)
	if err != nil {
		vt.t.Fatalf("last batch err: %v", err)
	}
}

func (vt *VersusTest) genBodies() (rv [][]string) {
	for i := 0; i < vt.NumDocs; i++ {
		rv = append(rv, vt.genBody())
	}
	return rv
}

func (vt *VersusTest) genBody() (rv []string) {
	m := rand.Intn(vt.MaxWordsPerDoc)
	for j := 0; j < m; j++ {
		rv = append(rv, vt.genWord(rand.Intn(vt.NumWords)))
	}
	return rv
}

func (vt *VersusTest) genWord(i int) string {
	return fmt.Sprintf("%x", i)
}
