// Copyright 2020 The Nakama Authors
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
	"fmt"

	"github.com/dop251/goja"
)

const (
	__RUNTIME_JAVASCRIPT_CTX_ENV              = "env"
	__RUNTIME_JAVASCRIPT_CTX_MODE             = "executionMode"
	__RUNTIME_JAVASCRIPT_CTX_NODE             = "node"
	__RUNTIME_JAVASCRIPT_CTX_VERSION          = "version"
	__RUNTIME_JAVASCRIPT_CTX_QUERY_PARAMS     = "queryParams"
	__RUNTIME_JAVASCRIPT_CTX_USER_ID          = "userId"
	__RUNTIME_JAVASCRIPT_CTX_USERNAME         = "username"
	__RUNTIME_JAVASCRIPT_CTX_VARS             = "vars"
	__RUNTIME_JAVASCRIPT_CTX_USER_SESSION_EXP = "userSessionExp"
	__RUNTIME_JAVASCRIPT_CTX_SESSION_ID       = "sessionId"
	__RUNTIME_JAVASCRIPT_CTX_LANG             = "lang"
	__RUNTIME_JAVASCRIPT_CTX_CLIENT_IP        = "clientIp"
	__RUNTIME_JAVASCRIPT_CTX_CLIENT_PORT      = "clientPort"
	__RUNTIME_JAVASCRIPT_CTX_HTTP_HEADERS     = "headers"
	__RUNTIME_JAVASCRIPT_CTX_MATCH_ID         = "matchId"
	__RUNTIME_JAVASCRIPT_CTX_MATCH_NODE       = "matchNode"
	__RUNTIME_JAVASCRIPT_CTX_MATCH_LABEL      = "matchLabel"
	__RUNTIME_JAVASCRIPT_CTX_MATCH_TICK_RATE  = "matchTickRate"
)

func NewRuntimeJsContext(r *goja.Runtime, node, version string, env goja.Value, mode RuntimeExecutionMode, httpHeaders, queryParams map[string][]string, sessionExpiry int64, userID, username string, vars map[string]string, sessionID, clientIP, clientPort, lang string) *goja.Object {
	ctxObj := r.NewObject()
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_NODE, node)
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_VERSION, version)
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_ENV, env)
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_MODE, mode.String())
	if httpHeaders != nil {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_HTTP_HEADERS, httpHeaders)
	}
	if queryParams != nil {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_QUERY_PARAMS, queryParams)
	}
	if sessionExpiry != 0 {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_USER_SESSION_EXP, sessionExpiry)
	}
	if userID != "" {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_USER_ID, userID)
	}
	if username != "" {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_USERNAME, username)
	}
	if vars != nil {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_VARS, vars)
	}
	if sessionID != "" {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_SESSION_ID, sessionID)
		// Lang is never reported without session ID.
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_LANG, lang)
	}
	if clientIP != "" {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_CLIENT_IP, clientIP)
	}
	if clientPort != "" {
		_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_CLIENT_PORT, clientPort)
	}

	return ctxObj
}

func NewRuntimeJsInitContext(r *goja.Runtime, node, version string, env map[string]string) *goja.Object {
	ctxObj := r.NewObject()
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_NODE, node)
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_VERSION, version)
	_ = ctxObj.Set(__RUNTIME_JAVASCRIPT_CTX_ENV, env)

	return ctxObj
}

func RuntimeJsConvertJsValue(jv interface{}) interface{} {
	switch v := jv.(type) {
	case map[string]interface{}:
		newMap := make(map[string]interface{}, len(v))
		for mapKey, mapValue := range v {
			newMap[mapKey] = RuntimeJsConvertJsValue(mapValue)
		}
		return newMap
	case []interface{}:
		newSlice := make([]interface{}, len(v))
		for i, sliceValue := range v {
			newSlice[i] = RuntimeJsConvertJsValue(sliceValue)
		}
		return newSlice
	case func(goja.FunctionCall) goja.Value:
		return fmt.Sprintf("function: %p", v)
	default:
		return v
	}
}
