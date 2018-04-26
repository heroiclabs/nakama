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
	"net/http"
)

type ListIndexesHandler struct {
}

func NewListIndexesHandler() *ListIndexesHandler {
	return &ListIndexesHandler{}
}

func (h *ListIndexesHandler) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	indexNames := IndexNames()
	rv := struct {
		Status  string   `json:"status"`
		Indexes []string `json:"indexes"`
	}{
		Status:  "ok",
		Indexes: indexNames,
	}
	mustEncode(w, rv)
}
