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
	"encoding/json"
	"flag"
	"io/ioutil"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"testing"

	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/mapping"

	// allow choosing alternate kvstores
	_ "github.com/blevesearch/bleve/config"
)

var dataset = flag.String("dataset", "", "only test datasets matching this regex")
var onlynum = flag.Int("testnum", -1, "only run the test with this number")
var keepIndex = flag.Bool("keepIndex", false, "keep the index after testing")

var indexType = flag.String("indexType", bleve.Config.DefaultIndexType, "index type to build")
var kvType = flag.String("kvType", bleve.Config.DefaultKVStore, "kv store type to build")

func TestIntegration(t *testing.T) {

	flag.Parse()

	bleve.Config.DefaultIndexType = *indexType
	bleve.Config.DefaultKVStore = *kvType
	t.Logf("using index type %s and kv type %s", *indexType, *kvType)

	var err error
	var datasetRegexp *regexp.Regexp
	if *dataset != "" {
		datasetRegexp, err = regexp.Compile(*dataset)
		if err != nil {
			t.Fatal(err)
		}
	}

	fis, err := ioutil.ReadDir("tests")
	if err != nil {
		t.Fatal(err)
	}
	for _, fi := range fis {
		if datasetRegexp != nil {
			if !datasetRegexp.MatchString(fi.Name()) {
				continue
			}
		}
		if fi.IsDir() {
			t.Logf("Running test: %s", fi.Name())
			runTestDir(t, "tests"+string(filepath.Separator)+fi.Name(), fi.Name())
		}
	}
}

func runTestDir(t *testing.T, dir, datasetName string) {
	// read the mapping
	mappingBytes, err := ioutil.ReadFile(dir + string(filepath.Separator) + "mapping.json")
	if err != nil {
		t.Errorf("error reading mapping: %v", err)
		return
	}
	var mapping mapping.IndexMappingImpl
	err = json.Unmarshal(mappingBytes, &mapping)
	if err != nil {
		t.Errorf("error unmarshalling mapping: %v", err)
		return
	}

	// open new index
	if !*keepIndex {
		defer func() {
			err := os.RemoveAll("test.bleve")
			if err != nil {
				t.Fatal(err)
			}
		}()
	}
	index, err := bleve.New("test.bleve", &mapping)
	if err != nil {
		t.Errorf("error creating new index: %v", err)
		return
	}
	// set a custom index name
	index.SetName(datasetName)
	defer func() {
		err := index.Close()
		if err != nil {
			t.Fatal(err)
		}
	}()

	// index data
	fis, err := ioutil.ReadDir(dir + string(filepath.Separator) + "data")
	if err != nil {
		t.Errorf("error reading data dir: %v", err)
		return
	}
	for _, fi := range fis {
		fileBytes, err := ioutil.ReadFile(dir + string(filepath.Separator) + "data" + string(filepath.Separator) + fi.Name())
		if err != nil {
			t.Errorf("error reading data file: %v", err)
			return
		}
		var fileDoc interface{}
		err = json.Unmarshal(fileBytes, &fileDoc)
		if err != nil {
			t.Errorf("error parsing data file as json: %v", err)
		}
		filename := fi.Name()
		ext := filepath.Ext(filename)
		id := filename[0 : len(filename)-len(ext)]
		err = index.Index(id, fileDoc)
		if err != nil {
			t.Errorf("error indexing data: %v", err)
			return
		}
	}

	// read the searches
	searchBytes, err := ioutil.ReadFile(dir + string(filepath.Separator) + "searches.json")
	if err != nil {
		t.Errorf("error reading searches: %v", err)
		return
	}
	var searches SearchTests
	err = json.Unmarshal(searchBytes, &searches)
	if err != nil {
		t.Errorf("error unmarshalling searches: %v", err)
		return
	}

	// run the searches
	for testNum, search := range searches {
		if *onlynum < 0 || (*onlynum > 0 && testNum == *onlynum) {
			res, err := index.Search(search.Search)
			if err != nil {
				t.Errorf("error running search: %v", err)
			}
			if res.Total != search.Result.Total {
				t.Errorf("test error - %s", search.Comment)
				t.Errorf("test %d - expected total: %d got %d", testNum, search.Result.Total, res.Total)
				continue
			}
			if len(res.Hits) != len(search.Result.Hits) {
				t.Errorf("test error - %s", search.Comment)
				t.Errorf("test %d - expected hits len: %d got %d", testNum, len(search.Result.Hits), len(res.Hits))
				continue
			}
			for hi, hit := range search.Result.Hits {
				if hit.ID != res.Hits[hi].ID {
					t.Errorf("test error - %s", search.Comment)
					t.Errorf("test %d - expected hit %d to have ID %s got %s", testNum, hi, hit.ID, res.Hits[hi].ID)
				}
				if hit.Fields != nil {
					if !reflect.DeepEqual(hit.Fields, res.Hits[hi].Fields) {
						t.Errorf("test error - %s", search.Comment)
						t.Errorf("test  %d - expected hit %d to have fields %#v got %#v", testNum, hi, hit.Fields, res.Hits[hi].Fields)
					}
				}
				if hit.Fragments != nil {
					if !reflect.DeepEqual(hit.Fragments, res.Hits[hi].Fragments) {
						t.Errorf("test error - %s", search.Comment)
						t.Errorf("test %d - expected hit %d to have fragments %#v got %#v", testNum, hi, hit.Fragments, res.Hits[hi].Fragments)
					}
				}
				if hit.Locations != nil {
					if !reflect.DeepEqual(hit.Locations, res.Hits[hi].Locations) {
						t.Errorf("test error - %s", search.Comment)
						t.Errorf("test %d - expected hit %d to have locations %v got %v", testNum, hi, hit.Locations, res.Hits[hi].Locations)
					}
				}
				// assert that none of the scores were NaN,+Inf,-Inf
				if math.IsInf(res.Hits[hi].Score, 0) || math.IsNaN(res.Hits[hi].Score) {
					t.Errorf("test error - %s", search.Comment)
					t.Errorf("test %d - invalid score %f", testNum, res.Hits[hi].Score)
				}
			}
			if search.Result.Facets != nil {
				if !reflect.DeepEqual(search.Result.Facets, res.Facets) {
					t.Errorf("test error - %s", search.Comment)
					t.Errorf("test %d - expected facets: %#v got %#v", testNum, search.Result.Facets, res.Facets)
				}
			}
			// check that custom index name is in results
			for _, hit := range res.Hits {
				if hit.Index != datasetName {
					t.Fatalf("expected name: %s, got: %s", datasetName, hit.Index)
				}
			}
		}
	}
}
