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

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/jsonpb"
	"github.com/golang/protobuf/proto"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func invokeReqBeforeHook(logger *zap.Logger, config Config, runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, sessionID string, uid uuid.UUID, username string, expiry int64, clientIP string, clientPort string, callbackID string, req interface{}) (interface{}, error) {
	id := strings.ToLower(callbackID)
	if !runtimePool.HasCallback(ExecutionModeBefore, id) {
		return req, nil
	}

	runtime := runtimePool.Get()
	lf := runtime.GetCallback(ExecutionModeBefore, id)
	if lf == nil {
		runtimePool.Put(runtime)
		logger.Error("Expected runtime Before function but didn't find it.", zap.String("id", id))
		return nil, status.Error(codes.NotFound, "Runtime Before function not found.")
	}

	reqProto, ok := req.(proto.Message)
	if !ok {
		runtimePool.Put(runtime)
		logger.Error("Could not cast request to message", zap.Any("request", req))
		return nil, status.Error(codes.Internal, "Could not run runtime Before function.")
	}
	reqJSON, err := jsonpbMarshaler.MarshalToString(reqProto)
	if err != nil {
		runtimePool.Put(runtime)
		logger.Error("Could not marshall request to JSON", zap.Any("request", req), zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not run runtime Before function.")
	}
	var reqMap map[string]interface{}
	if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
		runtimePool.Put(runtime)
		logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not run runtime Before function.")
	}

	userID := ""
	if uid != uuid.Nil {
		userID = uid.String()
	}
	result, fnErr, code := runtime.InvokeFunction(ExecutionModeBefore, lf, nil, userID, username, expiry, sessionID, clientIP, clientPort, reqMap)
	runtimePool.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !logger.Core().Enabled(zapcore.InfoLevel) {
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

func invokeReqAfterHook(logger *zap.Logger, config Config, runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, sessionID string, uid uuid.UUID, username string, expiry int64, clientIP string, clientPort string, callbackID string, req interface{}) {
	id := strings.ToLower(callbackID)
	if !runtimePool.HasCallback(ExecutionModeAfter, id) {
		return
	}

	runtime := runtimePool.Get()
	lf := runtime.GetCallback(ExecutionModeAfter, id)
	if lf == nil {
		runtimePool.Put(runtime)
		logger.Error("Expected runtime After function but didn't find it.", zap.String("id", id))
		return
	}

	reqProto, ok := req.(proto.Message)
	if !ok {
		runtimePool.Put(runtime)
		logger.Error("Could not cast request to message", zap.Any("request", req))
		return
	}
	reqJSON, err := jsonpbMarshaler.MarshalToString(reqProto)
	if err != nil {
		runtimePool.Put(runtime)
		logger.Error("Could not marshall request to JSON", zap.Any("request", req), zap.Error(err))
		return
	}

	var reqMap map[string]interface{}
	if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
		runtimePool.Put(runtime)
		logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
		return
	}

	userID := ""
	if uid != uuid.Nil {
		userID = uid.String()
	}
	_, fnErr, _ := runtime.InvokeFunction(ExecutionModeAfter, lf, nil, userID, username, expiry, sessionID, clientIP, clientPort, reqMap)
	runtimePool.Put(runtime)

	if fnErr != nil {
		logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !logger.Core().Enabled(zapcore.InfoLevel) {
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

func invokeMatchmakerMatchedHook(logger *zap.Logger, runtimePool *RuntimePool, entries []*MatchmakerEntry) (string, bool) {
	if !runtimePool.HasCallback(ExecutionModeMatchmaker, "") {
		return "", false
	}

	runtime := runtimePool.Get()
	lf := runtime.GetCallback(ExecutionModeMatchmaker, "")
	if lf == nil {
		runtimePool.Put(runtime)
		logger.Error("Expected runtime Matchmaker Matched function but didn't find it.")
		return "", false
	}

	ctx := NewLuaContext(runtime.vm, runtime.luaEnv, ExecutionModeMatchmaker, nil, 0, "", "", "", "", "")

	entriesTable := runtime.vm.CreateTable(len(entries), 0)
	for i, entry := range entries {
		presenceTable := runtime.vm.CreateTable(0, 4)
		presenceTable.RawSetString("user_id", lua.LString(entry.Presence.UserId))
		presenceTable.RawSetString("session_id", lua.LString(entry.Presence.SessionId))
		presenceTable.RawSetString("username", lua.LString(entry.Presence.Username))
		presenceTable.RawSetString("node", lua.LString(entry.Presence.Node))

		propertiesTable := runtime.vm.CreateTable(0, len(entry.StringProperties)+len(entry.NumericProperties))
		for k, v := range entry.StringProperties {
			propertiesTable.RawSetString(k, lua.LString(v))
		}
		for k, v := range entry.NumericProperties {
			propertiesTable.RawSetString(k, lua.LNumber(v))
		}

		entryTable := runtime.vm.CreateTable(0, 2)
		entryTable.RawSetString("presence", presenceTable)
		entryTable.RawSetString("properties", propertiesTable)

		entriesTable.RawSetInt(i+1, entryTable)
	}

	retValue, err, _ := runtime.invokeFunction(runtime.vm, lf, ctx, entriesTable)
	runtimePool.Put(runtime)
	if err != nil {
		logger.Error("Error running runtime Matchmaker Matched hook.", zap.Error(err))
		return "", false
	}

	if retValue == nil || retValue == lua.LNil {
		// No return value or hook decided not to return an authoritative match ID.
		return "", false
	}

	if retValue.Type() == lua.LTString {
		// Hook (maybe) returned an authoritative match ID.
		matchIDString := retValue.String()

		// Validate the match ID.
		matchIDComponents := strings.SplitN(matchIDString, ".", 2)
		if len(matchIDComponents) != 2 {
			logger.Error("Invalid return value from runtime Matchmaker Matched hook, not a valid match ID.")
			return "", false
		}
		_, err = uuid.FromString(matchIDComponents[0])
		if err != nil {
			logger.Error("Invalid return value from runtime Matchmaker Matched hook, not a valid match ID.")
			return "", false
		}

		return matchIDString, true
	}

	logger.Error("Unexpected return type from runtime Matchmaker Matched hook, must be string or nil.")
	return "", false
}
