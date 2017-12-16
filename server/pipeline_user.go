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

func (p *pipeline) usersFetch(logger *zap.Logger, session session, envelope *Envelope) {
	e := envelope.GetUsersFetch()

	if len(e.Users) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "At least one item must be present"), true)
		return
	}

	userIds := make([]string, 0)
	handles := make([]string, 0)

	for _, u := range e.Users {
		switch u.Id.(type) {
		case *TUsersFetch_UsersFetch_UserId:
			userIds = append(userIds, u.GetUserId())
		case *TUsersFetch_UsersFetch_Handle:
			handles = append(handles, u.GetHandle())
		case nil:
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Users fetch identifier missing"), true)
			return
		default:
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Users fetch identifier missing"), true)
			return
		}
	}

	users, err := UsersFetchIdsHandles(logger, p.db, p.tracker, userIds, handles)
	if err != nil {
		logger.Warn("Could not retrieve users", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not retrieve users"), true)
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Users{Users: &TUsers{Users: users}}}, true)
}
