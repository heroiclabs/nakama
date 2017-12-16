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
	"bytes"
	"encoding/json"

	"fmt"

	"github.com/gogo/protobuf/jsonpb"
	"go.uber.org/zap"
)

func RuntimeBeforeHook(runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, messageType string, envelope *Envelope, session session) (*Envelope, error) {
	if !runtimePool.HasBefore(messageType) {
		return envelope, nil
	}

	runtime := runtimePool.Get()
	fn := runtime.GetRuntimeCallback(BEFORE, messageType)
	if fn == nil {
		runtimePool.Put(runtime)
		return envelope, nil
	}

	userId := ""
	handle := ""
	expiry := int64(0)
	if session != nil {
		userId = session.UserID()
		handle = session.Handle()
		expiry = session.Expiry()
	}

	env, err := runtime.InvokeFunctionBefore(fn, userId, handle, expiry, jsonpbMarshaler, jsonpbUnmarshaler, envelope)
	runtimePool.Put(runtime)
	return env, err
}

func RuntimeAfterHook(logger *zap.Logger, runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, messageType string, envelope *Envelope, session session) {
	if !runtimePool.HasAfter(messageType) {
		return
	}

	runtime := runtimePool.Get()
	fn := runtime.GetRuntimeCallback(AFTER, messageType)
	if fn == nil {
		runtimePool.Put(runtime)
		return
	}

	strEnvelope, err := jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		logger.Error("Failed to convert proto message to protoJSON in After invocation", zap.String("message", messageType), zap.Error(err))
		return
	}

	var jsonEnvelope map[string]interface{}
	if err = json.Unmarshal([]byte(strEnvelope), &jsonEnvelope); err != nil {
		logger.Error("Failed to convert protoJSON message to Map in After invocation", zap.String("message", messageType), zap.Error(err))
		return
	}

	userId := ""
	handle := ""
	expiry := int64(0)
	if session != nil {
		userId = session.UserID()
		handle = session.Handle()
		expiry = session.Expiry()
	}

	if fnErr := runtime.InvokeFunctionAfter(fn, userId, handle, expiry, jsonEnvelope); fnErr != nil {
		logger.Error("Runtime after function caused an error", zap.String("message", messageType), zap.Error(fnErr))
	}
	runtimePool.Put(runtime)
}

func RuntimeBeforeHookAuthentication(runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, envelope *AuthenticateRequest) (*AuthenticateRequest, error) {
	messageType := RUNTIME_MESSAGES[fmt.Sprintf("%T", envelope.Id)]
	if !runtimePool.HasBefore(messageType) {
		return envelope, nil
	}

	runtime := runtimePool.Get()
	fn := runtime.GetRuntimeCallback(BEFORE, messageType)
	if fn == nil {
		runtimePool.Put(runtime)
		return envelope, nil
	}

	strEnvelope, err := jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		runtimePool.Put(runtime)
		return nil, err
	}

	var jsonEnvelope map[string]interface{}
	if err = json.Unmarshal([]byte(strEnvelope), &jsonEnvelope); err != nil {
		runtimePool.Put(runtime)
		return nil, err
	}

	userId := ""
	handle := ""
	expiry := int64(0)

	result, fnErr := runtime.InvokeFunctionBeforeAuthentication(fn, userId, handle, expiry, jsonEnvelope)
	runtimePool.Put(runtime)
	if fnErr != nil {
		return nil, fnErr
	}

	bytesEnvelope, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}

	authenticationResult := &AuthenticateRequest{}
	if err = jsonpbUnmarshaler.Unmarshal(bytes.NewReader(bytesEnvelope), authenticationResult); err != nil {
		return nil, err
	}

	return authenticationResult, nil
}

func RuntimeAfterHookAuthentication(logger *zap.Logger, runtimePool *RuntimePool, jsonpbMarshaler *jsonpb.Marshaler, envelope *AuthenticateRequest, userId string, handle string, expiry int64) {
	messageType := RUNTIME_MESSAGES[fmt.Sprintf("%T", envelope.Id)]
	if !runtimePool.HasAfter(messageType) {
		return
	}

	runtime := runtimePool.Get()
	fn := runtime.GetRuntimeCallback(AFTER, messageType)
	if fn == nil {
		runtimePool.Put(runtime)
		return
	}

	strEnvelope, err := jsonpbMarshaler.MarshalToString(envelope)
	if err != nil {
		runtimePool.Put(runtime)
		logger.Error("Failed to convert proto message to protoJSON in After invocation", zap.String("message", messageType), zap.Error(err))
		return
	}

	var jsonEnvelope map[string]interface{}
	if err = json.Unmarshal([]byte(strEnvelope), &jsonEnvelope); err != nil {
		runtimePool.Put(runtime)
		logger.Error("Failed to convert protoJSON message to Map in After invocation", zap.String("message", messageType), zap.Error(err))
		return
	}

	if fnErr := runtime.InvokeFunctionAfter(fn, userId, handle, expiry, jsonEnvelope); fnErr != nil {
		logger.Error("Runtime after function caused an error", zap.String("message", messageType), zap.Error(fnErr))
	}
	runtimePool.Put(runtime)
}
