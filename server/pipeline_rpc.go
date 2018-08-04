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
	"strings"

	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func (p *Pipeline) rpc(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	rpcMessage := envelope.GetRpc()
	if rpcMessage.Id == "" {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "RPC ID must be set",
		}}})
		return
	}

	id := strings.ToLower(rpcMessage.Id)

	if !p.runtimePool.HasCallback(ExecutionModeRPC, id) {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_FUNCTION_NOT_FOUND),
			Message: "RPC function not found",
		}}})
		return
	}

	runtime := p.runtimePool.Get()
	lf := runtime.GetCallback(ExecutionModeRPC, id)
	if lf == nil {
		p.runtimePool.Put(runtime)
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_FUNCTION_NOT_FOUND),
			Message: "RPC function not found",
		}}})
		return
	}

	result, fnErr, _ := runtime.InvokeFunction(ExecutionModeRPC, lf, nil, session.UserID().String(), session.Username(), session.Expiry(), session.ID().String(), session.ClientIP(), session.ClientPort(), rpcMessage.Payload)
	p.runtimePool.Put(runtime)
	if fnErr != nil {
		logger.Error("Runtime RPC function caused an error", zap.String("id", rpcMessage.Id), zap.Error(fnErr))
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
			session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
				Message: msg,
			}}})
		} else {
			session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
				Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
				Message: fnErr.Error(),
			}}})
		}
		return
	}

	if result == nil {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Rpc{Rpc: &api.Rpc{
			Id: rpcMessage.Id,
		}}})
		return
	}

	if payload, ok := result.(string); !ok {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
			Message: "Runtime function returned invalid data - only allowed one return value of type String/Byte.",
		}}})
	} else {
		session.Send(false, 0, &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Rpc{Rpc: &api.Rpc{
			Id:      rpcMessage.Id,
			Payload: payload,
		}}})
	}
}
