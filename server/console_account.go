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
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/pgtype"
	"golang.org/x/crypto/bcrypt"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama-common/api"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/heroiclabs/nakama/v2/console"
)

func (s *ConsoleServer) BanAccount(ctx context.Context, in *console.AccountId) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot ban the system user.")
	}

	if err := BanUsers(ctx, s.logger, s.db, []string{in.Id}); err != nil {
		// Error logged in the core function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to ban the user.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) UnbanAccount(ctx context.Context, in *console.AccountId) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot unban the system user.")
	}

	if err := UnbanUsers(ctx, s.logger, s.db, []string{in.Id}); err != nil {
		// Error logged in the core function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to unban the user.")
	}

	return &empty.Empty{}, nil
}

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

func (s *ConsoleServer) DeleteAccounts(ctx context.Context, in *empty.Empty) (*empty.Empty, error) {
	// Delete all but the system user. Related data will be removed by cascading constraints.
	_, err := s.db.ExecContext(ctx, "DELETE FROM users WHERE id <> '00000000-0000-0000-0000-000000000000'")
	if err != nil {
		s.logger.Error("Error deleting all user accounts.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete all users.")
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

	if err = KickGroupUsers(ctx, s.logger, s.db, s.router, uuid.Nil, groupID, []uuid.UUID{userID}); err != nil {
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

	export, err := ExportAccount(ctx, s.logger, s.db, userID)
	if err != nil {
		return nil, err
	}
	return export, nil
}

func (s *ConsoleServer) GetAccount(ctx context.Context, in *console.AccountId) (*console.Account, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	account, err := GetAccount(ctx, s.logger, s.db, s.tracker, userID)
	if err != nil {
		// Error already logged in function above.
		if err == ErrAccountNotFound {
			return nil, status.Error(codes.NotFound, "Account not found.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to retrieve user account.")
	}

	return &console.Account{
		Account:     account,
		DisableTime: account.DisableTime,
	}, nil
}

func (s *ConsoleServer) GetFriends(ctx context.Context, in *console.AccountId) (*api.FriendList, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	friends, err := ListFriends(ctx, s.logger, s.db, s.tracker, userID, 0, nil, "")
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

	groups, err := ListUserGroups(ctx, s.logger, s.db, userID, 0, nil, "")
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

	ledger, _, err := ListWalletLedger(ctx, s.logger, s.db, userID, nil, "")
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

func (s *ConsoleServer) ListAccounts(ctx context.Context, in *console.ListAccountsRequest) (*console.AccountList, error) {
	const limit = 50

	// Searching only through tombstone records.
	if in.Tombstones {
		var userID *uuid.UUID
		if in.Filter != "" {
			uid, err := uuid.FromString(in.Filter)
			if err != nil {
				// Filtering for a tombstone using username, no results are possible.
				return &console.AccountList{
					TotalCount: countAccounts(ctx, s.logger, s.db),
				}, nil
			}
			userID = &uid
		}

		if userID != nil {
			// Looking up a single specific tombstone.
			var createTime pgtype.Timestamptz
			err := s.db.QueryRowContext(ctx, "SELECT create_time FROM user_tombstone WHERE user_id = $1", *userID).Scan(&createTime)
			if err != nil {
				if err == sql.ErrNoRows {
					return &console.AccountList{
						TotalCount: countAccounts(ctx, s.logger, s.db),
					}, nil
				}
				s.logger.Error("Error looking up user tombstone.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}

			return &console.AccountList{
				Users: []*api.User{
					{
						Id:         in.Filter,
						UpdateTime: &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
					},
				},
				TotalCount: countAccounts(ctx, s.logger, s.db),
			}, nil
		}

		query := "SELECT user_id, create_time FROM user_tombstone LIMIT 50"

		rows, err := s.db.QueryContext(ctx, query)
		if err != nil {
			s.logger.Error("Error querying user tombstones.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}

		users := make([]*api.User, 0, limit)

		for rows.Next() {
			var id string
			var createTime pgtype.Timestamptz
			if err = rows.Scan(&id, &createTime); err != nil {
				_ = rows.Close()
				s.logger.Error("Error scanning user tombstones.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}

			users = append(users, &api.User{
				Id:         id,
				UpdateTime: &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			})
		}
		_ = rows.Close()

		return &console.AccountList{
			Users:      users,
			TotalCount: countAccounts(ctx, s.logger, s.db),
		}, nil
	}

	params := make([]interface{}, 0)
	var query string
	addQueryCondition := func(predicate string, value interface{}) {
		if query == "" {
			query += " WHERE "
		} else {
			query += " AND "
		}
		params = append(params, value)
		query += fmt.Sprintf("%s $%d", predicate, len(params))
	}

	if in.Banned {
		addQueryCondition("disable_time <>", "'1970-01-01 00:00:00 UTC'")
	}

	if in.Filter != "" {
		_, err := uuid.FromString(in.Filter)
		// If the filter is a valid user ID check for user_id otherwise either exact or pattern search on username
		if err == nil {
			addQueryCondition("id =", in.Filter)
		} else if strings.Contains(in.Filter, "%") {
			addQueryCondition("username LIKE", in.Filter)
		} else {
			addQueryCondition("username =", in.Filter)
		}
	}

	if in.Cursor != "" {
		cursor, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Error("Error decoding account list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode account list request cursor.")
		}
		var decodedCursor string
		if err := gob.NewDecoder(bytes.NewReader(cursor)).Decode(&decodedCursor); err != nil {
			s.logger.Error("Error decoding account list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode account list request cursor.")
		}
		if in.Prev {
			addQueryCondition("id <= ", decodedCursor)
		} else {
			addQueryCondition("id >", decodedCursor)
		}
	}

	query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users " + query
	query += fmt.Sprintf(" ORDER BY id ASC LIMIT %d", limit)

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		s.logger.Error("Error querying users.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
	}

	users := make([]*api.User, 0, 2)

	cursor := ""
	for rows.Next() {
		user, err := convertUser(s.tracker, rows)
		if err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning users.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}
		cursor = user.Id
		users = append(users, user)
	}
	_ = rows.Close()

	if len(users) < limit {
		cursor = ""
	}
	if cursor != "" {
		buf := bytes.NewBuffer([]byte{})
		err := gob.NewEncoder(buf).Encode(cursor)
		if err != nil {
			s.logger.Error("Error encoding account list cursor.", zap.String("cursor", cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to encoding account list request cursor.")
		}
		cursor = base64.RawURLEncoding.EncodeToString(buf.Bytes())
	}

	return &console.AccountList{
		Users:      users,
		TotalCount: countAccounts(ctx, s.logger, s.db),
		Cursor: 		cursor,
	}, nil

}

func countAccounts(ctx context.Context, logger *zap.Logger, db *sql.DB) int32 {
	var count sql.NullInt64
	// First try a fast count on table metadata.
	if err := db.QueryRowContext(ctx, "SELECT reltuples::BIGINT FROM pg_class WHERE relname = 'users'").Scan(&count); err != nil {
		logger.Warn("Error counting users.", zap.Error(err))
		if err == context.Canceled {
			// If the context was cancelled do not attempt any further counts.
			return 0
		}
	}
	if count.Valid && count.Int64 != 0 {
		// Use this count result.
		return int32(count.Int64)
	}

	// If the first fast count failed, returned NULL, or returned 0 try a fast count on partitioned table metadata.
	if err := db.QueryRowContext(ctx, "SELECT sum(reltuples::BIGINT) FROM pg_class WHERE relname ilike 'users%_pkey'").Scan(&count); err != nil {
		logger.Warn("Error counting users.", zap.Error(err))
		if err == context.Canceled {
			// If the context was cancelled do not attempt any further counts.
			return 0
		}
	}
	if count.Valid && count.Int64 != 0 {
		// Use this count result.
		return int32(count.Int64)
	}

	// If both fast counts failed, returned NULL, or returned 0 try a full count.
	if err := db.QueryRowContext(ctx, "SELECT count(id) FROM users").Scan(&count); err != nil {
		logger.Warn("Error counting users.", zap.Error(err))
	}
	return int32(count.Int64)
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
		if maybeJSON := []byte(v.Value); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
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

	var removeCustomID bool
	if v := in.CustomId; v != nil {
		if c := v.Value; c == "" {
			removeCustomID = true
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

	var newPassword string
	if v := in.Password; v != nil {
		p := v.Value
		if len(p) < 8 {
			return nil, status.Error(codes.InvalidArgument, "Password must be at least 8 characters long.")
		}
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
		if err != nil {
			s.logger.Error("Error hashing password.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error updating user account password.")
		}
		newPassword = string(hashedPassword)
	}

	if v := in.Wallet; v != nil && v.Value != "" {
		var walletMap map[string]int64
		if err := json.Unmarshal([]byte(v.Value), &walletMap); err != nil {
			return nil, status.Error(codes.InvalidArgument, "Wallet must be a valid JSON object with only string keys and integer values.")
		}
		for k, v := range walletMap {
			if v < 0 {
				return nil, status.Errorf(codes.InvalidArgument, "Wallet rejected negative value at path '%v'.", k)
			}
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

	if len(statements) == 0 && !removeCustomID && !removeEmail && len(in.DeviceIds) == 0 {
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

		if removeCustomID && removeEmail {
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
		} else if removeCustomID {
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

		if len(newPassword) != 0 {
			// Update the password on the user account only if they have an email associated.
			res, err := tx.ExecContext(ctx, "UPDATE users SET password = $2, update_time = now() WHERE id = $1 AND email IS NOT NULL", userID, newPassword)
			if err != nil {
				s.logger.Error("Could not update password.", zap.Error(err), zap.Any("user_id", userID))
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
				return StatusError(codes.InvalidArgument, "Cannot set a password on an account with no email address.", ErrRowsAffectedCount)
			}
		}

		if len(in.DeviceIds) != 0 && len(statements) == 0 && !removeCustomID && !removeEmail && len(newPassword) == 0 {
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
