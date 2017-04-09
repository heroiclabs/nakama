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
	"fmt"

	"go.uber.org/zap"
)

func (p *pipeline) rpc(logger *zap.Logger, session *session, envelope *Envelope) {
	rpcMessage := envelope.GetRpc()
	if rpcMessage.Id == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "RPC ID must be set"))
		return
	}

	lf := p.runtime.GetRuntimeCallback(RPC, rpcMessage.Id)
	if lf == nil {
		session.Send(ErrorMessage(envelope.CollationId, RUNTIME_FUNCTION_NOT_FOUND, "RPC function not found"))
		return
	}

	result, fnErr := p.runtime.InvokeFunctionRPC(lf, session.userID, session.handle.Load(), session.expiry, rpcMessage.Payload)
	if fnErr != nil {
		logger.Error("Runtime RPC function caused an error", zap.String("id", rpcMessage.Id), zap.Error(fnErr))
		session.Send(ErrorMessage(envelope.CollationId, RUNTIME_FUNCTION_EXCEPTION, fmt.Sprintf("Runtime function caused an error: %s", fnErr.Error())))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Rpc{Rpc: &TRpc{Id: rpcMessage.Id, Payload: result}}})
}
