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

package tests

import (
	"nakama/server"
	"testing"

	"github.com/gogo/protobuf/proto"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

var (
	notificationUserID  = uuid.NewV4().String()
	notificationId      string
	notificationService *server.NotificationService
)

type fakeMessageRouter struct{}

func (f *fakeMessageRouter) Send(logger *zap.Logger, ps []server.Presence, msg proto.Message, reliable bool) {

}

func setupNotificationService() (*server.NotificationService, error) {
	db, err := setupDB()
	if err != nil {
		return nil, err
	}

	logger, _ := zap.NewDevelopment(zap.AddStacktrace(zap.ErrorLevel))
	tracker := server.NewTrackerService("test-tracker")
	msgRouter := &fakeMessageRouter{}
	ns := server.NewNotificationService(logger, db, tracker, msgRouter, server.NewSocialConfig().Notification)
	return ns, nil
}

func TestNotificationService(t *testing.T) {
	ns, err := setupNotificationService()
	if err != nil {
		t.Fatal(err)
	}
	notificationService = ns
	t.Run("notification-service-send", testNotificationServiceSend)
	t.Run("notification-service-list", testNotificationServiceList)
	t.Run("notification-service-remove", testNotificationServiceRemove)
}

func testNotificationServiceSend(t *testing.T) {
	err := notificationService.NotificationSend([]*server.NNotification{
		{
			UserID:     notificationUserID,
			Persistent: true,
			Content:    []byte("{\"key\":\"value\"}"),
			Code:       101,
			Subject:    "test",
		},
	})

	if err != nil {
		t.Error(err)
		t.FailNow()
	}
}

func testNotificationServiceList(t *testing.T) {
	notifications, cursor, err := notificationService.NotificationsList(notificationUserID, 10, "")
	if err != nil {
		t.Error(err)
		t.FailNow()
	}

	if len(cursor) == 0 {
		t.Error("cursor was nil")
		t.FailNow()
	}

	if len(notifications) != 1 {
		t.Error("notification count was not 1.")
		t.FailNow()
	}

	n := notifications[0]

	if n.UserID != notificationUserID {
		t.Error("notification user Id was not the same")
		t.FailNow()
	}

	if n.Subject != "test" || n.Code != 101 || n.CreatedAt == 0 || n.ExpiresAt == 0 {
		t.Error("unexpected notification field data")
	}

	notificationId = n.Id
}

func testNotificationServiceRemove(t *testing.T) {
	err := notificationService.NotificationsRemove(notificationUserID, []string{notificationId})

	if err != nil {
		t.Error(err)
		t.FailNow()
	}
}
