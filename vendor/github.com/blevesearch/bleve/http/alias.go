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
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
)

type AliasAction struct {
	Alias         string   `json:"alias"`
	AddIndexes    []string `json:"add"`
	RemoveIndexes []string `json:"remove"`
}

type AliasHandler struct{}

func NewAliasHandler() *AliasHandler {
	return &AliasHandler{}
}

func (h *AliasHandler) ServeHTTP(w http.ResponseWriter, req *http.Request) {

	// read the request body
	requestBody, err := ioutil.ReadAll(req.Body)
	if err != nil {
		showError(w, req, fmt.Sprintf("error reading request body: %v", err), 400)
		return
	}

	var aliasAction AliasAction
	// interpret request body as alias actions
	if len(requestBody) > 0 {
		err := json.Unmarshal(requestBody, &aliasAction)
		if err != nil {
			showError(w, req, fmt.Sprintf("error parsing alias actions: %v", err), 400)
			return
		}
	} else {
		showError(w, req, "request body must contain alias actions", 400)
		return
	}

	err = UpdateAlias(aliasAction.Alias, aliasAction.AddIndexes, aliasAction.RemoveIndexes)
	if err != nil {
		showError(w, req, fmt.Sprintf("error updating alias: %v", err), 400)
		return
	}

	rv := struct {
		Status string `json:"status"`
	}{
		Status: "ok",
	}
	mustEncode(w, rv)
}
