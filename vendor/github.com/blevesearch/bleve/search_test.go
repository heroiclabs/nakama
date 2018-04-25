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
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/blevesearch/bleve/search"
)

func TestSearchResultString(t *testing.T) {

	tests := []struct {
		result *SearchResult
		str    string
	}{
		{
			result: &SearchResult{
				Request: &SearchRequest{
					Size: 10,
				},
				Total: 5,
				Took:  1 * time.Second,
				Hits: search.DocumentMatchCollection{
					&search.DocumentMatch{},
					&search.DocumentMatch{},
					&search.DocumentMatch{},
					&search.DocumentMatch{},
					&search.DocumentMatch{},
				},
			},
			str: "5 matches, showing 1 through 5, took 1s",
		},
		{
			result: &SearchResult{
				Request: &SearchRequest{
					Size: 0,
				},
				Total: 5,
				Hits:  search.DocumentMatchCollection{},
			},
			str: "5 matches",
		},
		{
			result: &SearchResult{
				Request: &SearchRequest{
					Size: 10,
				},
				Total: 0,
				Hits:  search.DocumentMatchCollection{},
			},
			str: "No matches",
		},
	}

	for _, test := range tests {
		srstring := test.result.String()
		if !strings.HasPrefix(srstring, test.str) {
			t.Errorf("expected to start %s, got %s", test.str, srstring)
		}
	}
}

func TestSearchResultMerge(t *testing.T) {
	l := &SearchResult{
		Status: &SearchStatus{
			Total:      1,
			Successful: 1,
			Errors:     make(map[string]error),
		},
		Total:    1,
		MaxScore: 1,
		Hits: search.DocumentMatchCollection{
			&search.DocumentMatch{
				ID:    "a",
				Score: 1,
			},
		},
	}

	r := &SearchResult{
		Status: &SearchStatus{
			Total:      1,
			Successful: 1,
			Errors:     make(map[string]error),
		},
		Total:    1,
		MaxScore: 2,
		Hits: search.DocumentMatchCollection{
			&search.DocumentMatch{
				ID:    "b",
				Score: 2,
			},
		},
	}

	expected := &SearchResult{
		Status: &SearchStatus{
			Total:      2,
			Successful: 2,
			Errors:     make(map[string]error),
		},
		Total:    2,
		MaxScore: 2,
		Hits: search.DocumentMatchCollection{
			&search.DocumentMatch{
				ID:    "a",
				Score: 1,
			},
			&search.DocumentMatch{
				ID:    "b",
				Score: 2,
			},
		},
	}

	l.Merge(r)

	if !reflect.DeepEqual(l, expected) {
		t.Errorf("expected %#v, got %#v", expected, l)
	}
}

func TestUnmarshalingSearchResult(t *testing.T) {

	searchResponse := []byte(`{
    "status":{
      "total":1,
      "failed":1,
      "successful":0,
      "errors":{
        "default_index_362ce020b3d62b13_348f5c3c":"context deadline exceeded"
      }
    },
    "request":{
      "query":{
        "match":"emp",
        "field":"type",
        "boost":1,
        "prefix_length":0,
        "fuzziness":0
      },
    "size":10000000,
    "from":0,
    "highlight":null,
    "fields":[],
    "facets":null,
    "explain":false
  },
  "hits":null,
  "total_hits":0,
  "max_score":0,
  "took":0,
  "facets":null
}`)

	rv := &SearchResult{
		Status: &SearchStatus{
			Errors: make(map[string]error),
		},
	}
	err = json.Unmarshal(searchResponse, rv)
	if err != nil {
		t.Error(err)
	}
	if len(rv.Status.Errors) != 1 {
		t.Errorf("expected 1 error, got %d", len(rv.Status.Errors))
	}
}

func TestFacetNumericDateRangeRequests(t *testing.T) {
	var drMissingErr = fmt.Errorf("date range query must specify either start, end or both for range name 'testName'")
	var nrMissingErr = fmt.Errorf("numeric range query must specify either min, max or both for range name 'testName'")
	var drNrErr = fmt.Errorf("facet can only conain numeric ranges or date ranges, not both")
	var drNameDupErr = fmt.Errorf("date ranges contains duplicate name 'testName'")
	var nrNameDupErr = fmt.Errorf("numeric ranges contains duplicate name 'testName'")
	value := float64(5)

	tests := []struct {
		facet  *FacetRequest
		result error
	}{
		{
			facet: &FacetRequest{
				Field: "Date_Range_Success_With_StartEnd",
				Size:  1,
				DateTimeRanges: []*dateTimeRange{
					&dateTimeRange{Name: "testName", Start: time.Unix(0, 0), End: time.Now()},
				},
			},
			result: nil,
		},
		{
			facet: &FacetRequest{
				Field: "Date_Range_Success_With_Start",
				Size:  1,
				DateTimeRanges: []*dateTimeRange{
					&dateTimeRange{Name: "testName", Start: time.Unix(0, 0)},
				},
			},
			result: nil,
		},
		{
			facet: &FacetRequest{
				Field: "Date_Range_Success_With_End",
				Size:  1,
				DateTimeRanges: []*dateTimeRange{
					&dateTimeRange{Name: "testName", End: time.Now()},
				},
			},
			result: nil,
		},
		{
			facet: &FacetRequest{
				Field: "Numeric_Range_Success_With_MinMax",
				Size:  1,
				NumericRanges: []*numericRange{
					&numericRange{Name: "testName", Min: &value, Max: &value},
				},
			},
			result: nil,
		},
		{
			facet: &FacetRequest{
				Field: "Numeric_Range_Success_With_Min",
				Size:  1,
				NumericRanges: []*numericRange{
					&numericRange{Name: "testName", Min: &value},
				},
			},
			result: nil,
		},
		{
			facet: &FacetRequest{
				Field: "Numeric_Range_Success_With_Max",
				Size:  1,
				NumericRanges: []*numericRange{
					&numericRange{Name: "testName", Max: &value},
				},
			},
			result: nil,
		},
		{
			facet: &FacetRequest{
				Field: "Date_Range_Missing_Failure",
				Size:  1,
				DateTimeRanges: []*dateTimeRange{
					&dateTimeRange{Name: "testName2", Start: time.Unix(0, 0)},
					&dateTimeRange{Name: "testName1", End: time.Now()},
					&dateTimeRange{Name: "testName"},
				},
			},
			result: drMissingErr,
		},
		{
			facet: &FacetRequest{
				Field: "Numeric_Range_Missing_Failure",
				Size:  1,
				NumericRanges: []*numericRange{
					&numericRange{Name: "testName2", Min: &value},
					&numericRange{Name: "testName1", Max: &value},
					&numericRange{Name: "testName"},
				},
			},
			result: nrMissingErr,
		},
		{
			facet: &FacetRequest{
				Field: "Numeric_And_DateRanges_Failure",
				Size:  1,
				NumericRanges: []*numericRange{
					&numericRange{Name: "testName", Max: &value},
				},
				DateTimeRanges: []*dateTimeRange{
					&dateTimeRange{Name: "testName", End: time.Now()},
				},
			},
			result: drNrErr,
		},
		{
			facet: &FacetRequest{
				Field: "Numeric_Range_Name_Repeat_Failure",
				Size:  1,
				NumericRanges: []*numericRange{
					&numericRange{Name: "testName", Min: &value},
					&numericRange{Name: "testName", Max: &value},
				},
			},
			result: nrNameDupErr,
		},
		{
			facet: &FacetRequest{
				Field: "Date_Range_Name_Repeat_Failure",
				Size:  1,
				DateTimeRanges: []*dateTimeRange{
					&dateTimeRange{Name: "testName", Start: time.Unix(0, 0)},
					&dateTimeRange{Name: "testName", End: time.Now()},
				},
			},
			result: drNameDupErr,
		},
	}

	for _, test := range tests {
		result := test.facet.Validate()
		if !reflect.DeepEqual(result, test.result) {
			t.Errorf("expected %#v, got %#v", test.result, result)
		}
	}

}

func TestSearchResultFacetsMerge(t *testing.T) {
	lowmed := "2010-01-01"
	medhi := "2011-01-01"
	hihigher := "2012-01-01"

	fr := &search.FacetResult{
		Field:   "birthday",
		Total:   100,
		Missing: 25,
		Other:   25,
		DateRanges: []*search.DateRangeFacet{
			{
				Name:  "low",
				End:   &lowmed,
				Count: 25,
			},
			{
				Name:  "med",
				Count: 24,
				Start: &lowmed,
				End:   &medhi,
			},
			{
				Name:  "hi",
				Count: 1,
				Start: &medhi,
				End:   &hihigher,
			},
		},
	}
	frs := search.FacetResults{
		"birthdays": fr,
	}

	l := &SearchResult{
		Status: &SearchStatus{
			Total:      10,
			Successful: 1,
			Errors:     make(map[string]error),
		},
		Total:    10,
		MaxScore: 1,
	}

	r := &SearchResult{
		Status: &SearchStatus{
			Total:      1,
			Successful: 1,
			Errors:     make(map[string]error),
		},
		Total:    1,
		MaxScore: 2,
		Facets:   frs,
	}

	expected := &SearchResult{
		Status: &SearchStatus{
			Total:      11,
			Successful: 2,
			Errors:     make(map[string]error),
		},
		Total:    11,
		MaxScore: 2,
		Facets:   frs,
	}

	l.Merge(r)

	if !reflect.DeepEqual(l, expected) {
		t.Errorf("expected %#v, got %#v", expected, l)
	}
}
