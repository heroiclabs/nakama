// Copyright 2018 The Nakama Authors
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
	"strings"

	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/proto"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func invokeReqBeforeHook(logger *zap.Logger,
	config Config,
	runtimePool *RuntimePool,
	jsonpbMarshaler *jsonpb.Marshaler,
	jsonpbUnmarshaler *jsonpb.Unmarshaler,
	sessionID string,
	uid uuid.UUID,
	username string,
	expiry int64,
	callbackID string,
	req interface{}) (interface{}, error) {
	id := strings.ToLower(callbackID)
	if !runtimePool.HasCallback(BEFORE, id) {
		return req, nil
	}

	runtime := runtimePool.Get()
	lf := runtime.GetCallback(BEFORE, id)
	if lf == nil {
		runtimePool.Put(runtime)
		logger.Error("Expected runtime Before function but didn't find it.", zap.String("id", id))
		return nil, status.Error(codes.NotFound, "Runtime Before function not found.")
	}

	reqProto := req.(proto.Message)
	reqJSON, err := jsonpbMarshaler.MarshalToString(reqProto)
	if err != nil {
		logger.Error("Could not marshall request to JSON", zap.Any("request", req), zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not run runtime Before function.")
	}
	var reqMap map[string]interface{}
	if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
		logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not run runtime Before function.")
	}

	userID := ""
	if uid != uuid.Nil {
		userID = uid.String()
	}
	result, fnErr, code := runtime.InvokeFunction(BEFORE, lf, userID, username, expiry, sessionID, reqMap)
	runtimePool.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !config.GetLog().Verbose {
			msg := apiErr.Object.String()
			if strings.HasPrefix(msg, lf.Proto.SourceName) {
				msg = msg[len(lf.Proto.SourceName):]
				msgParts := strings.SplitN(msg, ": ", 2)
				if len(msgParts) == 2 {
					msg = msgParts[1]
				} else {
					msg = msgParts[0]
				}
			}
			return nil, status.Error(code, msg)
		} else {
			return nil, status.Error(code, fnErr.Error())
		}
	}

	if result == nil {
		return nil, nil
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshall result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not complete runtime Before function.")
	}

	if err = jsonpbUnmarshaler.Unmarshal(strings.NewReader(string(resultJSON)), reqProto); err != nil {
		logger.Error("Could not marshall result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not complete runtime Before function.")
	}

	return reqProto, nil
}

func invokeReqAfterHook(logger *zap.Logger,
	config Config,
	runtimePool *RuntimePool,
	jsonpbMarshaler *jsonpb.Marshaler,
	sessionID string,
	uid uuid.UUID,
	username string,
	expiry int64,
	callbackID string,
	req interface{}) {
	id := strings.ToLower(callbackID)
	if !runtimePool.HasCallback(AFTER, id) {
		return
	}

	runtime := runtimePool.Get()
	lf := runtime.GetCallback(AFTER, id)
	if lf == nil {
		runtimePool.Put(runtime)
		logger.Error("Expected runtime After function but didn't find it.", zap.String("id", id))
	}

	reqProto := req.(proto.Message)
	reqJSON, err := jsonpbMarshaler.MarshalToString(reqProto)
	if err != nil {
		logger.Error("Could not marshall request to JSON", zap.Any("request", req), zap.Error(err))
	}

	var reqMap map[string]interface{}
	if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
		logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
	}

	userID := ""
	if uid != uuid.Nil {
		userID = uid.String()
	}
	_, fnErr, _ := runtime.InvokeFunction(AFTER, lf, userID, username, expiry, sessionID, reqMap)
	runtimePool.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !config.GetLog().Verbose {
			msg := apiErr.Object.String()
			if strings.HasPrefix(msg, lf.Proto.SourceName) {
				msg = msg[len(lf.Proto.SourceName):]
				msgParts := strings.SplitN(msg, ": ", 2)
				if len(msgParts) == 2 {
					msg = msgParts[1]
				} else {
					msg = msgParts[0]
				}
			}
		}
	}
}
