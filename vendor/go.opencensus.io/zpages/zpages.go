// Copyright 2017, OpenCensus Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

// Package zpages implements a collection of HTML pages that display RPC stats
// and trace data, and also functions to write that same data in plain text to
// an io.Writer.
//
// Users can also embed the HTML for stats and traces in custom status pages.
//
// To add the handlers to the default HTTP request multiplexer with the patterns
// /rpcz and /tracez, call:
// 	zpages.AddDefaultHTTPHandlers()
// If your program does not already start an HTTP server, you can use:
// 	go func() { log.Fatal(http.ListenAndServe(":8080", nil)) }()
package zpages

import (
	"net/http"
	"sync"
)

var once sync.Once

// AddDefaultHTTPHandlers adds handlers for /rpcz and /tracez to the default HTTP request multiplexer.
func AddDefaultHTTPHandlers() {
	once.Do(func() {
		http.HandleFunc("/rpcz", RpczHandler)
		http.HandleFunc("/tracez", TracezHandler)
	})
}
