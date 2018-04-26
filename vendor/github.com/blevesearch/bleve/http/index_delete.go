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
	"fmt"
	"net/http"
	"os"
)

type DeleteIndexHandler struct {
	basePath        string
	IndexNameLookup varLookupFunc
}

func NewDeleteIndexHandler(basePath string) *DeleteIndexHandler {
	return &DeleteIndexHandler{
		basePath: basePath,
	}
}

func (h *DeleteIndexHandler) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	// find the name of the index to delete
	var indexName string
	if h.IndexNameLookup != nil {
		indexName = h.IndexNameLookup(req)
	}
	if indexName == "" {
		showError(w, req, "index name is required", 400)
		return
	}

	indexToDelete := UnregisterIndexByName(indexName)
	if indexToDelete == nil {
		showError(w, req, fmt.Sprintf("no such index '%s'", indexName), 404)
		return
	}

	// close the index
	err := indexToDelete.Close()
	if err != nil {
		showError(w, req, fmt.Sprintf("error closing index: %v", err), 500)
		return
	}

	// now delete it
	err = os.RemoveAll(h.indexPath(indexName))
	if err != nil {
		showError(w, req, fmt.Sprintf("error deleting index: %v", err), 500)
		return
	}

	rv := struct {
		Status string `json:"status"`
	}{
		Status: "ok",
	}
	mustEncode(w, rv)
}

func (h *DeleteIndexHandler) indexPath(name string) string {
	return h.basePath + string(os.PathSeparator) + name
}
