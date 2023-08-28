// Copyright 2019 The Nakama Authors
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
	"github.com/heroiclabs/nakama-common/rtapi"
	"go.uber.org/zap"
)

func (p *Pipeline) ping(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	out := &rtapi.Envelope{Cid: envelope.Cid, Message: &rtapi.Envelope_Pong{Pong: &rtapi.Pong{}}}
	_ = session.Send(out, true)

	return true, out
}

func (p *Pipeline) pong(logger *zap.Logger, session Session, envelope *rtapi.Envelope) (bool, *rtapi.Envelope) {
	// No application-level action in response to a pong message.
	return true, nil
}
