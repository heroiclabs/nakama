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

import "go.uber.org/zap"

func (p *pipeline) usersFetch(logger *zap.Logger, session *session, envelope *Envelope) {
	f := envelope.GetUsersFetch()

	var users []*User
	var err error

	switch f.Set.(type) {
	case *TUsersFetch_UserIds_:
		userIds := envelope.GetUsersFetch().GetUserIds().UserIds
		if len(userIds) == 0 {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "List must contain at least one user ID"))
			return
		}
		users, err = UsersFetchIds(logger, p.db, userIds)
	case TUsersFetch_Handles_:
		handles := envelope.GetUsersFetch().GetHandles().Handles
		if len(handles) == 0 {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "List must contain at least one handle"))
			return
		}
		users, err = UsersFetchHandle(logger, p.db, handles)
	}

	if err != nil {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not retrieve users"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Users{Users: &TUsers{Users: users}}})
}
