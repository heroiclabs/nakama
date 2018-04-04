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
	"context"

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/console"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) DeleteAccount(ctx context.Context, in *console.AccountIdRequest) (*empty.Empty, error) {
	userID := uuid.FromStringOrNil(in.Id)
	if uuid.Equal(uuid.Nil, userID) {
		return nil, status.Error(codes.InvalidArgument, "Invalid user ID was provided.")
	}

	count, err := DeleteUser(s.db, userID)
	if err != nil {
		s.logger.Error("Could not delete user", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	} else if count == 0 {
		s.logger.Info("No user was found to delete. Skipping blacklist.", zap.String("user_id", in.Id))
		return &empty.Empty{}, nil
	}

	if _, err = s.db.Exec(`INSERT INTO user_tombstone (id) VALUES ($1) ON CONFLICT DO NOTHING`, userID); err != nil {
		s.logger.Error("Could not insert user ID into tombstone", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) ExportAccount(ctx context.Context, in *console.AccountIdRequest) (*console.AccountExport, error) {
	userID := uuid.FromStringOrNil(in.Id)
	if uuid.Equal(uuid.Nil, userID) {
		return nil, status.Error(codes.InvalidArgument, "Invalid user ID was provided.")
	}

	account, err := GetAccount(s.db, s.logger, nil, userID)
	if err != nil {
		s.logger.Error("Could not export account data", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	friends, err := GetFriendIDs(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch friend IDs", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	notifications, err := NotificationList(s.logger, s.db, userID, 0, "", nil)
	if err != nil {
		s.logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	storageObjects, err := StorageReadAllUserObjects(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// TODO(mo, zyro) add wallet, groups, chat messages, leaderboard and leaderboard records
	export := &console.AccountExport{
		Account:       account,
		Objects:       storageObjects,
		Friends:       friends.GetFriends(),
		Notifications: notifications.GetNotifications(),
	}

	return export, nil
}
