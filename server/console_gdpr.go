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

	"encoding/json"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
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

	if _, err = s.db.Exec(`INSERT INTO user_tombstone (user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING`, userID); err != nil {
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

	// Core user account.
	account, err := GetAccount(s.logger, s.db, nil, userID)
	if err != nil {
		s.logger.Error("Could not export account data", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Friends.
	friends, err := GetFriendIDs(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch friend IDs", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Leaderboard records.
	leaderboardRecords, err := LeaderboardRecordReadAll(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch leaderboard records", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Notifications.
	notifications, err := NotificationList(s.logger, s.db, userID, 0, "", nil)
	if err != nil {
		s.logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Storage objects where user is the owner.
	storageObjects, err := StorageReadAllUserObjects(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// History of user's wallet.
	walletLedgers, err := ListWalletLedger(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch wallet ledger items", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}
	wl := make([]*console.WalletLedger, len(walletLedgers))
	for i, w := range walletLedgers {
		changeset, err := json.Marshal(w.Changeset)
		if err != nil {
			s.logger.Error("Could not fetch wallet ledger items, error encoding changeset", zap.Error(err), zap.String("user_id", in.Id))
			return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
		}
		metadata, err := json.Marshal(w.Metadata)
		if err != nil {
			s.logger.Error("Could not fetch wallet ledger items, error encoding metadata", zap.Error(err), zap.String("user_id", in.Id))
			return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
		}
		wl[i] = &console.WalletLedger{
			Id:         w.ID,
			UserId:     w.UserID,
			Changeset:  string(changeset),
			Metadata:   string(metadata),
			CreateTime: &timestamp.Timestamp{Seconds: w.CreateTime},
			UpdateTime: &timestamp.Timestamp{Seconds: w.UpdateTime},
		}
	}

	// TODO(mo, zyro) add groups, chat messages
	export := &console.AccountExport{
		Account:            account,
		Objects:            storageObjects,
		Friends:            friends.GetFriends(),
		LeaderboardRecords: leaderboardRecords,
		Notifications:      notifications.GetNotifications(),
		WalletLedgers:      wl,
	}

	return export, nil
}
