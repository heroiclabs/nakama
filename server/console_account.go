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
	"database/sql"
	"encoding/json"

	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) DeleteAccount(ctx context.Context, in *console.AccountDeleteRequest) (*empty.Empty, error) {
	userID := uuid.FromStringOrNil(in.Id)
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid user ID was provided.")
	}

	tx, err := s.db.Begin()
	if err != nil {
		s.logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		count, err := DeleteUser(tx, userID)
		if err != nil {
			s.logger.Debug("Could not delete user", zap.Error(err), zap.String("user_id", in.Id))
			return err
		} else if count == 0 {
			s.logger.Info("No user was found to delete. Skipping blacklist.", zap.String("user_id", in.Id))
			return nil
		}

		err = LeaderboardRecordsDeleteAll(s.logger, tx, userID)
		if err != nil {
			s.logger.Debug("Could not delete leaderboard records.", zap.Error(err), zap.String("user_id", in.Id))
			return err
		}

		err = GroupDeleteAll(s.logger, tx, userID)
		if err != nil {
			s.logger.Debug("Could not delete groups and relationships.", zap.Error(err), zap.String("user_id", in.Id))
			return err
		}

		if in.RecordDeletion == nil || in.RecordDeletion.GetValue() {
			return s.RecordAccountDeletion(tx, userID)
		}

		return nil
	}); err != nil {
		s.logger.Error("Error occurred while trying to delete the user.", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteAccounts(context.Context, *empty.Empty) (*empty.Empty, error) {
	query := "TRUNCATE TABLE users, leaderboard, groups CASCADE"
	_, err := s.db.Exec(query)

	if err != nil {
		s.logger.Error("Error occurred while trying to deleting all users.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete all users.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) GetAccount(ctx context.Context, in *console.AccountIdRequest) (*console.Account, error) {
	userID := uuid.FromStringOrNil(in.Id)
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid user ID was provided.")
	}

	// Core user account.
	account, err := GetAccount(s.logger, s.db, nil, userID)
	if err != nil {
		if err == ErrAccountNotFound {
			return nil, status.Error(codes.NotFound, "Account not found.")
		}
		s.logger.Error("Could not export account data", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Friends.
	friends, err := GetFriendIDs(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch friend IDs", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	groups := make([]*api.Group, 0)
	groupUsers, err := ListUserGroups(s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch groups that belong to the user", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}
	for _, g := range groupUsers.UserGroups {
		groups = append(groups, g.Group)
	}

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

	return &console.Account{
		Account:       account,
		Friends:       friends.GetFriends(),
		Groups:        groups,
		WalletLedgers: wl,
	}, nil
}

func (s *ConsoleServer) ListAccounts(context.Context, *empty.Empty) (*console.AccountList, error) {
	rows, err := s.db.Query("SELECT id FROM users WHERE id != $1 ORDER BY update_time DESC LIMIT 100", uuid.Nil)
	if err != nil {
		s.logger.Error("Could not list users.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
	}

	userIDs := make([]string, 0)
	for rows.Next() {
		var userID sql.NullString
		if rows.Scan(&userID); err != nil {
			s.logger.Error("Could not list users.", zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}
		userIDs = append(userIDs, userID.String)
	}

	accounts := make([]*api.Account, 0)
	for _, id := range userIDs {
		account, err := GetAccount(s.logger, s.db, nil, uuid.Must(uuid.FromString(id)))
		if err != nil {
			s.logger.Error("Could not get user while listing.", zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}
		accounts = append(accounts, account)
	}

	return &console.AccountList{Accounts: accounts}, nil
}
