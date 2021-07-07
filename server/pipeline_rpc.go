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

	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

func (p *Pipeline) rpc(logger *zap.Logger, session Session, envelope *rtapi.Envelope) {
	rpcMessage := envelope.GetRpc()
	if rpcMessage.Id == "" {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_BAD_INPUT),
			Message: "RPC ID must be set",
		}}}, true)
		return
	}

	id := strings.ToLower(rpcMessage.Id)

	fn := p.runtime.Rpc(id)
	if fn == nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_FUNCTION_NOT_FOUND),
			Message: "RPC function not found",
		}}}, true)
		return
	}

	result, fnErr, _ := fn(session.Context(), nil, session.UserID().String(), session.Username(), session.Vars(), session.Expiry(), session.ID().String(), session.ClientIP(), session.ClientPort(), session.Lang(), rpcMessage.Payload)
	if fnErr != nil {
		session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Error{Error: &rtapi.Error{
			Code:    int32(rtapi.Error_RUNTIME_FUNCTION_EXCEPTION),
			Message: fnErr.Error(),
		}}}, true)
		return
	}

	session.Send(&rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Rpc{Rpc: &api.Rpc{
		Id:      rpcMessage.Id,
		Payload: result,
	}}}, true)
}
