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

func (p *pipeline) listNotifications(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetNotificationsList()

	if incoming.GetLimit() < 10 || incoming.GetLimit() > 100 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Limit must be between 10 and 100"))
		return
	}

	nots, cursor, err := p.notificationService.NotificationsList(session.userID, incoming.GetLimit(), incoming.GetResumableCursor())
	if err != nil {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, err.Error()))
		return
	}

	notifications := convertTNotifications(nots, cursor)
	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Notifications{Notifications: notifications}})
}

func (p *pipeline) removeNotifications(logger *zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetNotificationsRemove()

	if len(incoming.NotificationIds) == 0 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "There must be at least one notification ID to remove."))
	}

	if err := p.notificationService.NotificationsRemove(session.userID, incoming.NotificationIds); err != nil {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, err.Error()))
		return
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}
