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
	"strconv"
	"strings"

	"github.com/satori/go.uuid"
	"github.com/uber-go/zap"
)

func (p *pipeline) usersFetch(logger zap.Logger, session *session, envelope *Envelope) {
	userIds := envelope.GetUsersFetch().UserIds
	if len(userIds) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "List must contain at least one user ID"))
		return
	}

	statements := make([]string, 0)
	params := make([]interface{}, 0)

	counter := 1
	for _, uid := range userIds {
		userID, err := uuid.FromBytes(uid)
		if err == nil {
			statement := "$" + strconv.Itoa(counter)
			counter += 1
			statements = append(statements, statement)
			params = append(params, userID.Bytes())
		}
	}

	if len(statements) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "No valid user IDs received"))
		return
	}

	query := "WHERE users.id IN (" + strings.Join(statements, ", ") + ")"
	users, err := p.querySocialGraph(logger, query, params)
	if err != nil {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not retrieve users"))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Users{Users: &TUsers{Users: users}}})
}
