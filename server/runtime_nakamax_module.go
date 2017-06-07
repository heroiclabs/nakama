// Copyright 2017 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"encoding/json"
	"io"
	"io/ioutil"
	"net/http"
	"strings"
	"time"

	"encoding/base64"

	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"encoding/hex"
)

type NakamaxModule struct {
	logger *zap.Logger
	client *http.Client
}

func NewNakamaxModule(logger *zap.Logger) *NakamaxModule {
	return &NakamaxModule{
		logger: logger,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (nx *NakamaxModule) Loader(l *lua.LState) int {
	mod := l.SetFuncs(l.NewTable(), map[string]lua.LGFunction{
		"uuid_v4":       nx.uuidV4,
		"http_request":  nx.httpRequest,
		"json_encode":   nx.jsonEncode,
		"json_decode":   nx.jsonDecode,
		"base64_encode": nx.base64Encode,
		"base64_decode": nx.base64Decode,
		"base16_encode": nx.base16Encode,
		"base16_decode": nx.base16decode,
	})

	l.Push(mod)
	return 1
}

func (nx *NakamaxModule) uuidV4(l *lua.LState) int {
	// TODO ensure there were no arguments to the function
	l.Push(lua.LString(uuid.NewV4().String()))
	return 1
}

func (nx *NakamaxModule) httpRequest(l *lua.LState) int {
	url := l.CheckString(1)
	method := l.CheckString(2)
	headers := l.CheckTable(3)
	body := l.OptString(4, "")
	if url == "" {
		l.ArgError(1, "Expects URL string")
		return 0
	}
	if method == "" {
		l.ArgError(2, "Expects method string")
		return 0
	}

	// Prepare request body, if any.
	var requestBody io.Reader
	if body != "" {
		requestBody = strings.NewReader(body)
	}
	// Prepare the request.
	req, err := http.NewRequest(method, url, requestBody)
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Apply any request headers.
	httpHeaders := ConvertLuaTable(headers)
	for k, v := range httpHeaders {
		if vs, ok := v.(string); !ok {
			l.RaiseError("HTTP header values must be strings")
			return 0
		} else {
			req.Header.Add(k, vs)
		}
	}
	// Execute the request.
	resp, err := nx.client.Do(req)
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Read the response body.
	responseBody, err := ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		l.RaiseError("HTTP response body error: %v", err.Error())
		return 0
	}
	// Read the response headers.
	responseHeaders := make(map[string]interface{}, len(resp.Header))
	for k, vs := range resp.Header {
		// TODO accept multiple values per header
		for _, v := range vs {
			responseHeaders[k] = v
			break
		}
	}

	l.Push(lua.LNumber(resp.StatusCode))
	l.Push(ConvertMap(l, responseHeaders))
	l.Push(lua.LString(string(responseBody)))
	return 3
}

func (nx *NakamaxModule) jsonEncode(l *lua.LState) int {
	// TODO allow top-level arrays or primitives?
	jsonTable := l.CheckTable(1)
	if jsonTable == nil {
		l.ArgError(1, "Expects a table to encode")
		return 0
	}

	jsonData := ConvertLuaTable(jsonTable)
	jsonBytes, err := json.Marshal(jsonData)
	if err != nil {
		l.ArgError(1, "Error encoding to JSON")
		return 0
	}

	l.Push(lua.LString(string(jsonBytes)))
	return 1
}

func (nx *NakamaxModule) jsonDecode(l *lua.LState) int {
	jsonString := l.CheckString(1)
	if jsonString == "" {
		l.ArgError(1, "Expects JSON string")
		return 0
	}

	// TODO allow top-level arrays or primitives?
	var jsonData map[string]interface{}
	if err := json.Unmarshal([]byte(jsonString), &jsonData); err != nil {
		l.RaiseError("Not a valid JSON string: %v", err.Error())
		return 0
	}

	l.Push(ConvertMap(l, jsonData))
	return 1
}

func (nx *NakamaxModule) base64Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output := base64.StdEncoding.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}
func (nx *NakamaxModule) base64Decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		l.RaiseError("Not a valid base64 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}
func (nx *NakamaxModule) base16Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output := hex.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}
func (nx *NakamaxModule) base16decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "Expects string")
		return 0
	}

	output, err := hex.DecodeString(input)
	if err != nil {
		l.RaiseError("Not a valid base16 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}
