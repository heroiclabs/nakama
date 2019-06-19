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
	"fmt"
	"strconv"
	"strings"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/console"
	"github.com/pkg/errors"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) DeleteAccount(ctx context.Context, in *console.AccountDeleteRequest) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot delete the system user.")
	}

	if err = DeleteAccount(ctx, s.logger, s.db, userID, in.RecordDeletion != nil && in.RecordDeletion.Value); err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteFriend(ctx context.Context, in *console.DeleteFriendRequest) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if _, err := uuid.FromString(in.FriendId); err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid friend ID.")
	}

	if err = DeleteFriends(ctx, s.logger, s.db, userID, []string{in.FriendId}); err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the friend relationship.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteGroupUser(ctx context.Context, in *console.DeleteGroupUserRequest) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	groupID, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	if err = KickGroupUsers(ctx, s.logger, s.db, uuid.Nil, groupID, []uuid.UUID{userID}); err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to remove the user from the group.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteWalletLedger(ctx context.Context, in *console.DeleteWalletLedgerRequest) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	walletID, err := uuid.FromString(in.WalletId)
	if err != nil || walletID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid wallet ledger item ID.")
	}

	_, err = s.db.ExecContext(ctx, "DELETE FROM wallet_ledger WHERE id = $1 AND user_id = $2", walletID, userID)
	if err != nil {
		s.logger.Error("Error deleting from wallet ledger.", zap.String("id", walletID.String()), zap.String("user_id", userID.String()), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to remove the user's wallet ledger item.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) ExportAccount(ctx context.Context, in *console.AccountId) (*console.AccountExport, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot export the system user.")
	}

	// Core user account.
	account, _, err := GetAccount(ctx, s.logger, s.db, nil, userID)
	if err != nil {
		if err == ErrAccountNotFound {
			return nil, status.Error(codes.NotFound, "Account not found.")
		}
		s.logger.Error("Could not export account data", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Friends.
	friends, err := GetFriendIDs(ctx, s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch friend IDs", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Messages.
	messages, err := GetChannelMessages(ctx, s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch messages", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Leaderboard records.
	leaderboardRecords, err := LeaderboardRecordReadAll(ctx, s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch leaderboard records", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	groups := make([]*api.Group, 0)
	groupUsers, err := ListUserGroups(ctx, s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch groups that belong to the user", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}
	for _, g := range groupUsers.UserGroups {
		groups = append(groups, g.Group)
	}

	// Notifications.
	notifications, err := NotificationList(ctx, s.logger, s.db, userID, 0, "", nil)
	if err != nil {
		s.logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Storage objects where user is the owner.
	storageObjects, err := StorageReadAllUserObjects(ctx, s.logger, s.db, userID)
	if err != nil {
		s.logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", in.Id))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// History of user's wallet.
	walletLedgers, err := ListWalletLedger(ctx, s.logger, s.db, userID)
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

	export := &console.AccountExport{
		Account:            account,
		Objects:            storageObjects,
		Friends:            friends.GetFriends(),
		Messages:           messages,
		Groups:             groups,
		LeaderboardRecords: leaderboardRecords,
		Notifications:      notifications.GetNotifications(),
		WalletLedgers:      wl,
	}

	return export, nil
}

func (s *ConsoleServer) GetAccount(ctx context.Context, in *console.AccountId) (*console.Account, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	account, disableTime, err := GetAccount(ctx, s.logger, s.db, s.tracker, userID)
	if err != nil {
		// Error already logged in function above.
		if err == ErrAccountNotFound {
			return nil, status.Error(codes.NotFound, "Account not found.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to retrieve user account.")
	}

	acc := &console.Account{Account: account}
	if disableTime.Unix() != 0 {
		acc.DisableTime = &timestamp.Timestamp{Seconds: disableTime.Unix()}
	}

	return acc, nil
}

func (s *ConsoleServer) GetFriends(ctx context.Context, in *console.AccountId) (*api.Friends, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	friends, err := GetFriends(ctx, s.logger, s.db, s.tracker, userID)
	if err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to list the user's friends.")
	}

	return friends, nil
}

func (s *ConsoleServer) GetGroups(ctx context.Context, in *console.AccountId) (*api.UserGroupList, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	groups, err := ListUserGroups(ctx, s.logger, s.db, userID)
	if err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to list the user's groups.")
	}

	return groups, nil
}

func (s *ConsoleServer) GetWalletLedger(ctx context.Context, in *console.AccountId) (*console.WalletLedgerList, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	ledger, err := ListWalletLedger(ctx, s.logger, s.db, userID)
	if err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to list the user's wallet ledger.")
	}

	// Convert to console wire format.
	consoleLedger := make([]*console.WalletLedger, 0, len(ledger))
	for _, ledgerItem := range ledger {
		changeset, err := json.Marshal(ledgerItem.Changeset)
		if err != nil {
			s.logger.Error("Error encoding wallet ledger changeset.", zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list the user's wallet ledger.")
		}
		metadata, err := json.Marshal(ledgerItem.Metadata)
		if err != nil {
			s.logger.Error("Error encoding wallet ledger metadata.", zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list the user's wallet ledger.")
		}
		consoleLedger = append(consoleLedger, &console.WalletLedger{
			Id:         ledgerItem.ID,
			UserId:     ledgerItem.UserID,
			Changeset:  string(changeset),
			Metadata:   string(metadata),
			CreateTime: &timestamp.Timestamp{Seconds: ledgerItem.CreateTime},
			UpdateTime: &timestamp.Timestamp{Seconds: ledgerItem.UpdateTime},
		})
	}

	return &console.WalletLedgerList{Items: consoleLedger}, nil
}

func (s *ConsoleServer) UpdateAccount(ctx context.Context, in *console.UpdateAccountRequest) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot update the system user.")
	}

	statements := make([]string, 0)
	params := []interface{}{userID}

	if v := in.Username; v != nil {
		if len(v.Value) == 0 {
			return nil, status.Error(codes.InvalidArgument, "Username cannot be empty.")
		}
		if invalidCharsRegex.MatchString(v.Value) {
			return nil, status.Error(codes.InvalidArgument, "Username cannot contain spaces or control characters.")
		}
		params = append(params, v.Value)
		statements = append(statements, "username = $"+strconv.Itoa(len(params)))
	}

	if v := in.DisplayName; v != nil {
		if d := v.Value; d == "" {
			statements = append(statements, "display_name = NULL")
		} else {
			params = append(params, d)
			statements = append(statements, "display_name = $"+strconv.Itoa(len(params)))
		}
	}

	if v := in.Metadata; v != nil && v.Value != "" {
		var metadataMap map[string]interface{}
		if err := json.Unmarshal([]byte(v.Value), &metadataMap); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Metadata must be a valid JSON object.")
		}
		params = append(params, v.Value)
		statements = append(statements, "metadata = $"+strconv.Itoa(len(params)))
	}

	if v := in.AvatarUrl; v != nil {
		if a := v.Value; a == "" {
			statements = append(statements, "avatar_url = NULL")
		} else {
			params = append(params, a)
			statements = append(statements, "avatar_url = $"+strconv.Itoa(len(params)))
		}
	}

	if v := in.LangTag; v != nil {
		if l := v.Value; l == "" {
			statements = append(statements, "lang_tag = NULL")
		} else {
			params = append(params, l)
			statements = append(statements, "lang_tag = $"+strconv.Itoa(len(params)))
		}
	}

	if v := in.Location; v != nil {
		if l := v.Value; l == "" {
			statements = append(statements, "location = NULL")
		} else {
			params = append(params, l)
			statements = append(statements, "location = $"+strconv.Itoa(len(params)))
		}
	}

	if v := in.Timezone; v != nil {
		if t := v.Value; t == "" {
			statements = append(statements, "timezone = NULL")
		} else {
			params = append(params, t)
			statements = append(statements, "timezone = $"+strconv.Itoa(len(params)))
		}
	}

	var removeCustomId bool
	if v := in.CustomId; v != nil {
		if c := v.Value; c == "" {
			removeCustomId = true
		} else {
			if invalidCharsRegex.MatchString(c) {
				return nil, status.Error(codes.InvalidArgument, "Custom ID invalid, no spaces or control characters allowed.")
			} else if len(c) < 6 || len(c) > 128 {
				return nil, status.Error(codes.InvalidArgument, "Custom ID invalid, must be 6-128 bytes.")
			} else {
				params = append(params, c)
				statements = append(statements, "custom_id = $"+strconv.Itoa(len(params)))
			}
		}
	}

	var removeEmail bool
	if v := in.Email; v != nil {
		if e := v.Value; e == "" {
			removeEmail = true
		} else {
			if invalidCharsRegex.MatchString(e) {
				return nil, status.Error(codes.InvalidArgument, "Invalid email address, no spaces or control characters allowed.")
			} else if !emailRegex.MatchString(e) {
				return nil, status.Error(codes.InvalidArgument, "Invalid email address format.")
			} else if len(e) < 10 || len(e) > 255 {
				return nil, status.Error(codes.InvalidArgument, "Invalid email address, must be 10-255 bytes.")
			} else {
				params = append(params, e)
				statements = append(statements, "email = $"+strconv.Itoa(len(params)))
			}
		}
	}

	if v := in.Wallet; v != nil && v.Value != "" {
		var walletMap map[string]interface{}
		if err := json.Unmarshal([]byte(v.Value), &walletMap); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Wallet must be a valid JSON object.")
		}
		if err := checkWalletFormat(walletMap, ""); err != nil {
			return nil, status.Error(codes.InvalidArgument, err.Error())
		}
		params = append(params, v.Value)
		statements = append(statements, "wallet = $"+strconv.Itoa(len(params)))
	}

	for oldDeviceID, newDeviceID := range in.DeviceIds {
		if invalidCharsRegex.MatchString(oldDeviceID) {
			return nil, status.Error(codes.InvalidArgument, "Old device ID invalid, no spaces or control characters allowed.")
		} else if len(oldDeviceID) < 10 || len(oldDeviceID) > 128 {
			return nil, status.Error(codes.InvalidArgument, "Old device ID invalid, must be 10-128 bytes.")
		}

		if newDeviceID != "" {
			// Only validate if device ID is not being removed.
			if invalidCharsRegex.MatchString(newDeviceID) {
				return nil, status.Error(codes.InvalidArgument, "New device ID invalid, no spaces or control characters allowed.")
			} else if len(newDeviceID) < 10 || len(newDeviceID) > 128 {
				return nil, status.Error(codes.InvalidArgument, "New device ID invalid, must be 10-128 bytes.")
			}
		}
	}

	if len(statements) == 0 && !removeCustomId && !removeEmail && len(in.DeviceIds) == 0 {
		// Nothing to update.
		return &empty.Empty{}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the user.")
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		for oldDeviceID, newDeviceID := range in.DeviceIds {
			if newDeviceID == "" {
				query := `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (facebook_id IS NOT NULL
     OR google_id IS NOT NULL
     OR gamecenter_id IS NOT NULL
     OR steam_id IS NOT NULL
     OR email IS NOT NULL
     OR custom_id IS NOT NULL))
   OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2 LIMIT 1))`

				res, err := tx.ExecContext(ctx, query, userID, oldDeviceID)
				if err != nil {
					s.logger.Error("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
					return err
				}
				if count, _ := res.RowsAffected(); count == 0 {
					return StatusError(codes.InvalidArgument, "Cannot unlink device ID when there are no other identifiers.", ErrRowsAffectedCount)
				}
			} else {
				query := `UPDATE user_device SET id = $1 WHERE id = $2 AND user_id = $3`
				res, err := tx.ExecContext(ctx, query, newDeviceID, oldDeviceID, userID)
				if err != nil {
					s.logger.Error("Could not update device ID.", zap.Error(err), zap.Any("input", in))
					return err
				}
				if count, _ := res.RowsAffected(); count == 0 {
					return StatusError(codes.InvalidArgument, "Device ID is already linked to a different user.", ErrRowsAffectedCount)
				}
			}
		}

		if len(statements) != 0 {
			query := "UPDATE users SET update_time = now(), " + strings.Join(statements, ", ") + " WHERE id = $1"
			_, err := tx.ExecContext(ctx, query, params...)
			if err != nil {
				s.logger.Error("Could not update user account.", zap.Error(err), zap.Any("input", in))
				return err
			}
		}

		if removeCustomId && removeEmail {
			query := `UPDATE users SET custom_id = NULL, email = NULL, update_time = now()
WHERE id = $1
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

			res, err := tx.ExecContext(ctx, query, userID)
			if err != nil {
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				return StatusError(codes.InvalidArgument, "Cannot unlink both custom ID and email address when there are no other identifiers.", ErrRowsAffectedCount)
			}
		} else if removeCustomId {
			query := `UPDATE users SET custom_id = NULL, update_time = now()
WHERE id = $1
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

			res, err := tx.ExecContext(ctx, query, userID)
			if err != nil {
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				return StatusError(codes.InvalidArgument, "Cannot unlink custom ID when there are no other identifiers.", ErrRowsAffectedCount)
			}
		} else if removeEmail {
			query := `UPDATE users SET email = NULL, password = NULL, update_time = now()
WHERE id = $1
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

			res, err := tx.ExecContext(ctx, query, userID)
			if err != nil {
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				return StatusError(codes.InvalidArgument, "Cannot unlink email address when there are no other identifiers.", ErrRowsAffectedCount)
			}
		}

		if len(in.DeviceIds) != 0 && len(statements) == 0 && !removeCustomId && !removeEmail {
			// Ensure the user account update time is touched if the device IDs have changed but no other updates were applied to the core user record.
			_, err := tx.ExecContext(ctx, "UPDATE users SET update_time = now() WHERE id = $1", userID)
			if err != nil {
				s.logger.Error("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
				return err
			}
		}

		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			// Errors such as unlinking the last profile or username in use.
			return nil, e.Status()
		}
		s.logger.Error("Error updating user.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the user.")
	}

	return &empty.Empty{}, nil
}

func checkWalletFormat(wallet map[string]interface{}, path string) error {
	for k, v := range wallet {
		var currentPath string
		if path == "" {
			currentPath = k
		} else {
			currentPath = fmt.Sprintf("%v.%v", path, k)
		}

		if vm, ok := v.(map[string]interface{}); ok {
			// Nested wallets are fine.
			if err := checkWalletFormat(vm, currentPath); err != nil {
				return err
			}
		} else if vf, ok := v.(float64); ok {
			// If it's a value, check it's not negative.
			if vf < 0 {
				return errors.Errorf("Wallet rejected negative value at path '%v'.", currentPath)
			}
		} else {
			// Not a nested wallet a value.
			return errors.Errorf("Wallet value type at path '%v' must be map or float64.", currentPath)
		}
	}

	return nil
}
