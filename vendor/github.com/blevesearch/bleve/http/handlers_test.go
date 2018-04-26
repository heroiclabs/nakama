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

package http

import (
	"bytes"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"testing"
)

func docIDLookup(req *http.Request) string {
	return req.FormValue("docID")
}

func indexNameLookup(req *http.Request) string {
	return req.FormValue("indexName")
}

func TestHandlers(t *testing.T) {

	basePath := "testbase"
	err := os.MkdirAll(basePath, 0700)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		err := os.RemoveAll(basePath)
		if err != nil {
			t.Fatal(err)
		}
	}()

	createIndexHandler := NewCreateIndexHandler(basePath)
	createIndexHandler.IndexNameLookup = indexNameLookup

	getIndexHandler := NewGetIndexHandler()
	getIndexHandler.IndexNameLookup = indexNameLookup

	deleteIndexHandler := NewDeleteIndexHandler(basePath)
	deleteIndexHandler.IndexNameLookup = indexNameLookup

	listIndexesHandler := NewListIndexesHandler()

	docIndexHandler := NewDocIndexHandler("")
	docIndexHandler.IndexNameLookup = indexNameLookup
	docIndexHandler.DocIDLookup = docIDLookup

	docCountHandler := NewDocCountHandler("")
	docCountHandler.IndexNameLookup = indexNameLookup

	docGetHandler := NewDocGetHandler("")
	docGetHandler.IndexNameLookup = indexNameLookup
	docGetHandler.DocIDLookup = docIDLookup

	docDeleteHandler := NewDocDeleteHandler("")
	docDeleteHandler.IndexNameLookup = indexNameLookup
	docDeleteHandler.DocIDLookup = docIDLookup

	searchHandler := NewSearchHandler("")
	searchHandler.IndexNameLookup = indexNameLookup

	listFieldsHandler := NewListFieldsHandler("")
	listFieldsHandler.IndexNameLookup = indexNameLookup

	debugHandler := NewDebugDocumentHandler("")
	debugHandler.IndexNameLookup = indexNameLookup
	debugHandler.DocIDLookup = docIDLookup

	aliasHandler := NewAliasHandler()

	tests := []struct {
		Desc          string
		Handler       http.Handler
		Path          string
		Method        string
		Params        url.Values
		Body          []byte
		Status        int
		ResponseBody  []byte
		ResponseMatch map[string]bool
	}{
		{
			Desc:         "create index",
			Handler:      createIndexHandler,
			Path:         "/create",
			Method:       "PUT",
			Params:       url.Values{"indexName": []string{"ti1"}},
			Body:         []byte("{}"),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "create existing index",
			Handler: createIndexHandler,
			Path:    "/create",
			Method:  "PUT",
			Params:  url.Values{"indexName": []string{"ti1"}},
			Body:    []byte("{}"),
			Status:  http.StatusInternalServerError,
			ResponseMatch: map[string]bool{
				`path already exists`: true,
			},
		},
		{
			Desc:         "create index missing index",
			Handler:      createIndexHandler,
			Path:         "/create",
			Method:       "PUT",
			Body:         []byte("{}"),
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`index name is required`),
		},
		{
			Desc:    "create index invalid json",
			Handler: createIndexHandler,
			Path:    "/create",
			Method:  "PUT",
			Params:  url.Values{"indexName": []string{"ti9"}},
			Body:    []byte("{"),
			Status:  http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`error parsing index mapping`: true,
			},
		},
		{
			Desc:    "get index",
			Handler: getIndexHandler,
			Path:    "/get",
			Method:  "GET",
			Params:  url.Values{"indexName": []string{"ti1"}},
			Status:  http.StatusOK,
			ResponseMatch: map[string]bool{
				`"status":"ok"`: true,
				`"name":"ti1"`:  true,
			},
		},
		{
			Desc:    "get index does not exist",
			Handler: getIndexHandler,
			Path:    "/get",
			Method:  "GET",
			Params:  url.Values{"indexName": []string{"dne"}},
			Status:  http.StatusNotFound,
			ResponseMatch: map[string]bool{
				`no such index`: true,
			},
		},
		{
			Desc:         "get index missing name",
			Handler:      getIndexHandler,
			Path:         "/get",
			Method:       "GET",
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`index name is required`),
		},
		{
			Desc:         "create another index",
			Handler:      createIndexHandler,
			Path:         "/create",
			Method:       "PUT",
			Params:       url.Values{"indexName": []string{"ti2"}},
			Body:         []byte("{}"),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "list indexes",
			Handler: listIndexesHandler,
			Path:    "/list",
			Method:  "GET",
			Status:  http.StatusOK,
			ResponseMatch: map[string]bool{
				`"status":"ok"`: true,
				`"ti1"`:         true,
				`"ti2"`:         true,
			},
		},
		{
			Desc:         "delete index",
			Handler:      deleteIndexHandler,
			Path:         "/delete",
			Method:       "DELETE",
			Params:       url.Values{"indexName": []string{"ti2"}},
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:         "delete index missing name",
			Handler:      deleteIndexHandler,
			Path:         "/delete",
			Method:       "DELETE",
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`index name is required`),
		},
		{
			Desc:    "list indexes after delete",
			Handler: listIndexesHandler,
			Path:    "/list",
			Method:  "GET",
			Status:  http.StatusOK,
			ResponseMatch: map[string]bool{
				`"status":"ok"`: true,
				`"ti1"`:         true,
				`"ti2"`:         false,
			},
		},
		{
			Desc:    "index doc",
			Handler: docIndexHandler,
			Path:    "/ti1/a",
			Method:  "PUT",
			Params: url.Values{
				"indexName": []string{"ti1"},
				"docID":     []string{"a"},
			},
			Body:         []byte(`{"name":"a","body":"test","rating":7,"created":"2014-11-26","former_ratings":[3,4,2]}`),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "index doc invalid index",
			Handler: docIndexHandler,
			Path:    "/tix/a",
			Method:  "PUT",
			Params: url.Values{
				"indexName": []string{"tix"},
				"docID":     []string{"a"},
			},
			Body:         []byte(`{"name":"a","body":"test","rating":7,"created":"2014-11-26","former_ratings":[3,4,2]}`),
			Status:       http.StatusNotFound,
			ResponseBody: []byte(`no such index 'tix'`),
		},
		{
			Desc:    "index doc missing ID",
			Handler: docIndexHandler,
			Path:    "/ti1/a",
			Method:  "PUT",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Body:         []byte(`{"name":"a","body":"test","rating":7,"created":"2014-11-26","former_ratings":[3,4,2]}`),
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`document id cannot be empty`),
		},
		{
			Desc:    "doc count",
			Handler: docCountHandler,
			Path:    "/ti1/count",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok","count":1}`),
		},
		{
			Desc:    "doc count invalid index",
			Handler: docCountHandler,
			Path:    "/tix/count",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"tix"},
			},
			Status:       http.StatusNotFound,
			ResponseBody: []byte(`no such index 'tix'`),
		},
		{
			Desc:    "doc get",
			Handler: docGetHandler,
			Path:    "/ti1/a",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"ti1"},
				"docID":     []string{"a"},
			},
			Status: http.StatusOK,
			ResponseMatch: map[string]bool{
				`"id":"a"`:      true,
				`"body":"test"`: true,
				`"name":"a"`:    true,
			},
		},
		{
			Desc:    "doc get invalid index",
			Handler: docGetHandler,
			Path:    "/tix/a",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"tix"},
				"docID":     []string{"a"},
			},
			Status:       http.StatusNotFound,
			ResponseBody: []byte(`no such index 'tix'`),
		},
		{
			Desc:    "doc get missing ID",
			Handler: docGetHandler,
			Path:    "/ti1/a",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`document id cannot be empty`),
		},
		{
			Desc:    "index another doc",
			Handler: docIndexHandler,
			Path:    "/ti1/b",
			Method:  "PUT",
			Params: url.Values{
				"indexName": []string{"ti1"},
				"docID":     []string{"b"},
			},
			Body:         []byte(`{"name":"b","body":"del"}`),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "doc count again",
			Handler: docCountHandler,
			Path:    "/ti1/count",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok","count":2}`),
		},
		{
			Desc:    "delete doc",
			Handler: docDeleteHandler,
			Path:    "/ti1/b",
			Method:  "DELETE",
			Params: url.Values{
				"indexName": []string{"ti1"},
				"docID":     []string{"b"},
			},
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "delete doc invalid index",
			Handler: docDeleteHandler,
			Path:    "/tix/b",
			Method:  "DELETE",
			Params: url.Values{
				"indexName": []string{"tix"},
				"docID":     []string{"b"},
			},
			Status:       http.StatusNotFound,
			ResponseBody: []byte(`no such index 'tix'`),
		},
		{
			Desc:    "delete doc missing docID",
			Handler: docDeleteHandler,
			Path:    "/ti1/b",
			Method:  "DELETE",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`document id cannot be empty`),
		},
		{
			Desc:    "doc get",
			Handler: docGetHandler,
			Path:    "/ti1/b",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"ti1"},
				"docID":     []string{"b"},
			},
			Status: http.StatusNotFound,
			ResponseMatch: map[string]bool{
				`no such document`: true,
			},
		},
		{
			Desc:    "search",
			Handler: searchHandler,
			Path:    "/ti1/search",
			Method:  "POST",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Body: []byte(`{
				"from": 0,
				"size": 10,
				"query": {
					"fuzziness": 0,
					"prefix_length": 0,
					"field": "body",
					"match": "test"
				}
			}`),
			Status: http.StatusOK,
			ResponseMatch: map[string]bool{
				`"total_hits":1`: true,
				`"id":"a"`:       true,
			},
		},
		{
			Desc:    "search index doesn't exist",
			Handler: searchHandler,
			Path:    "/tix/search",
			Method:  "POST",
			Params: url.Values{
				"indexName": []string{"tix"},
			},
			Body: []byte(`{
				"from": 0,
				"size": 10,
				"query": {
					"fuzziness": 0,
					"prefix_length": 0,
					"field": "body",
					"match": "test"
				}
			}`),
			Status:       http.StatusNotFound,
			ResponseBody: []byte(`no such index 'tix'`),
		},
		{
			Desc:    "search invalid json",
			Handler: searchHandler,
			Path:    "/ti1/search",
			Method:  "POST",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Body:   []byte(`{`),
			Status: http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`error parsing query`: true,
			},
		},
		{
			Desc:    "search query does not validate",
			Handler: searchHandler,
			Path:    "/ti1/search",
			Method:  "POST",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Body: []byte(`{
				"from": 0,
				"size": 10,
				"query": {
					"field": "body",
					"terms": []
				}
			}`),
			Status: http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`error validating query`: true,
			},
		},
		{
			Desc:    "list fields",
			Handler: listFieldsHandler,
			Path:    "/ti1/fields",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"ti1"},
			},
			Status: http.StatusOK,
			ResponseMatch: map[string]bool{
				`"fields":`: true,
				`"name"`:    true,
				`"body"`:    true,
				`"_all"`:    true,
			},
		},
		{
			Desc:    "list fields invalid index",
			Handler: listFieldsHandler,
			Path:    "/tix/fields",
			Method:  "GET",
			Params: url.Values{
				"indexName": []string{"tix"},
			},
			Status:       http.StatusNotFound,
			ResponseBody: []byte(`no such index 'tix'`),
		},
		{
			Desc:    "create alias",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a1",
				"add": ["ti1"]
			}`),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "create alias invalid json",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body:    []byte(`{`),
			Status:  http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`error parsing alias actions`: true,
			},
		},
		{
			Desc:    "create alias empty",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body:    []byte(``),
			Status:  http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`request body must contain alias actions`: true,
			},
		},
		{
			Desc:    "create alias referring to non-existent index",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a2",
				"add": ["tix"]
			}`),
			Status: http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`index named 'tix' does not exist`: true,
			},
		},
		{
			Desc:    "create alias removing from new",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a2",
				"remove": ["ti1"]
			}`),
			Status: http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`cannot remove indexes from a new alias`: true,
			},
		},
		{
			Desc:    "create alias same name as index",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "ti1",
				"remove": ["ti1"]
			}`),
			Status: http.StatusBadRequest,
			ResponseMatch: map[string]bool{
				`is not an alias`: true,
			},
		},
		{
			Desc:    "search alias",
			Handler: searchHandler,
			Path:    "/a1/search",
			Method:  "POST",
			Params: url.Values{
				"indexName": []string{"a1"},
			},
			Body: []byte(`{
				"from": 0,
				"size": 10,
				"query": {
					"fuzziness": 0,
					"prefix_length": 0,
					"field": "body",
					"match": "test"
				}
			}`),
			Status: http.StatusOK,
			ResponseMatch: map[string]bool{
				`"total_hits":1`: true,
				`"id":"a"`:       true,
			},
		},
		{
			Desc:         "create index to add to alias",
			Handler:      createIndexHandler,
			Path:         "/create",
			Method:       "PUT",
			Params:       url.Values{"indexName": []string{"ti6"}},
			Body:         []byte("{}"),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "update alias add ti6",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a1",
				"add": ["ti6"]
			}`),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "update alias add doesn't exist",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a1",
				"add": ["ti99"]
			}`),
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`error updating alias: index named 'ti99' does not exist`),
		},
		{
			Desc:    "update alias remove ti6",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a1",
				"remove": ["ti6"]
			}`),
			Status:       http.StatusOK,
			ResponseBody: []byte(`{"status":"ok"}`),
		},
		{
			Desc:    "update alias remove doesn't exist",
			Handler: aliasHandler,
			Path:    "/alias",
			Method:  "POST",
			Body: []byte(`{
				"alias": "a1",
				"remove": ["ti98"]
			}`),
			Status:       http.StatusBadRequest,
			ResponseBody: []byte(`error updating alias: index named 'ti98' does not exist`),
		},
	}

	for _, test := range tests {
		record := httptest.NewRecorder()
		req := &http.Request{
			Method: test.Method,
			URL:    &url.URL{Path: test.Path},
			Form:   test.Params,
			Body:   ioutil.NopCloser(bytes.NewBuffer(test.Body)),
		}
		test.Handler.ServeHTTP(record, req)
		if got, want := record.Code, test.Status; got != want {
			t.Errorf("%s: response code = %d, want %d", test.Desc, got, want)
			t.Errorf("%s: response body = %s", test.Desc, record.Body)
		}

		got := bytes.TrimRight(record.Body.Bytes(), "\n")
		if test.ResponseBody != nil {
			if !reflect.DeepEqual(got, test.ResponseBody) {
				t.Errorf("%s: expected: '%s', got: '%s'", test.Desc, test.ResponseBody, got)
			}
		}
		for pattern, shouldMatch := range test.ResponseMatch {
			didMatch := bytes.Contains(got, []byte(pattern))
			if didMatch != shouldMatch {
				t.Errorf("%s: expected match %t for pattern %s, got %t", test.Desc, shouldMatch, pattern, didMatch)
				t.Errorf("%s: response body was: %s", test.Desc, got)
			}
		}
	}

	// close indexes
	for _, indexName := range IndexNames() {
		index := UnregisterIndexByName(indexName)
		if index != nil {
			err := index.Close()
			if err != nil {
				t.Errorf("error closing index %s: %v", indexName, err)
			}
		}
	}
}
