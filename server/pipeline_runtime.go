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
	"strings"

	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
)

func (p *pipeline) rpc(logger *zap.Logger, session session, envelope *Envelope) {
	rpcMessage := envelope.GetRpc()
	if rpcMessage.Id == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "RPC ID must be set"), true)
		return
	}

	if !p.runtimePool.HasRPC(rpcMessage.Id) {
		session.Send(ErrorMessage(envelope.CollationId, RUNTIME_FUNCTION_NOT_FOUND, "RPC function not found"), true)
		return
	}

	runtime := p.runtimePool.Get()
	lf := runtime.GetRuntimeCallback(RPC, rpcMessage.Id)
	if lf == nil {
		p.runtimePool.Put(runtime)
		session.Send(ErrorMessage(envelope.CollationId, RUNTIME_FUNCTION_NOT_FOUND, "RPC function not found"), true)
		return
	}

	result, fnErr := runtime.InvokeFunctionRPC(lf, session.UserID(), session.Handle(), session.Expiry(), rpcMessage.Payload)
	p.runtimePool.Put(runtime)
	if fnErr != nil {
		logger.Error("Runtime RPC function caused an error", zap.String("id", rpcMessage.Id), zap.Error(fnErr))
		if apiErr, ok := fnErr.(*lua.ApiError); ok && !p.config.GetLog().Verbose {
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
			session.Send(ErrorMessage(envelope.CollationId, RUNTIME_FUNCTION_EXCEPTION, msg), true)
		} else {
			session.Send(ErrorMessage(envelope.CollationId, RUNTIME_FUNCTION_EXCEPTION, fnErr.Error()), true)
		}
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Rpc{Rpc: &TRpc{Id: rpcMessage.Id, Payload: result}}}, true)
}
