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
	"regexp"
	"strconv"
	"strings"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var validTrigramFilterRegex = regexp.MustCompile("^%?[^%]{3,}%?$")

type consoleAccountCursor struct {
	ID       uuid.UUID
	Username string
}

func (s *ConsoleServer) BanAccount(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot ban the system user.")
	}

	if err := BanUsers(ctx, s.logger, s.db, s.config, s.sessionCache, s.sessionRegistry, s.tracker, []uuid.UUID{userID}); err != nil {
		// Error logged in the core function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to ban the user.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnbanAccount(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot unban the system user.")
	}

	if err := UnbanUsers(ctx, s.logger, s.db, s.sessionCache, []uuid.UUID{userID}); err != nil {
		// Error logged in the core function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to unban the user.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) DeleteAccount(ctx context.Context, in *console.AccountDeleteRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	if err = DeleteAccount(ctx, s.logger, s.db, s.config, s.leaderboardCache, s.leaderboardRankCache, s.sessionRegistry, s.sessionCache, s.tracker, userID, in.RecordDeletion != nil && in.RecordDeletion.Value); err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	return &emptypb.Empty{}, nil
}

// Deprecated: replaced by DeleteAllData
func (s *ConsoleServer) DeleteAccounts(ctx context.Context, in *emptypb.Empty) (*emptypb.Empty, error) {
	// Delete all but the system user. Related data will be removed by cascading constraints.
	_, err := s.db.ExecContext(ctx, "DELETE FROM users WHERE id <> '00000000-0000-0000-0000-000000000000'")
	if err != nil {
		s.logger.Error("Error deleting all user accounts.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete all users.")
	}
	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) DeleteFriend(ctx context.Context, in *console.DeleteFriendRequest) (*emptypb.Empty, error) {
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

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) DeleteGroupUser(ctx context.Context, in *console.DeleteGroupUserRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	groupID, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	if err = KickGroupUsers(ctx, s.logger, s.db, s.tracker, s.router, s.streamManager, uuid.Nil, groupID, []uuid.UUID{userID}, true); err != nil {
		// Error already logged in function above.
		if err == ErrEmptyMemberKick {
			return nil, status.Error(codes.FailedPrecondition, "Cannot kick user from group.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to remove the user from the group.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) DeleteWalletLedger(ctx context.Context, in *console.DeleteWalletLedgerRequest) (*emptypb.Empty, error) {
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

	return &emptypb.Empty{}, nil
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

	account, err := GetAccount(ctx, s.logger, s.db, s.statusRegistry, userID)
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

	friends, err := ListFriends(ctx, s.logger, s.db, s.statusRegistry, userID, 0, nil, "")
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

func (s *ConsoleServer) GetWalletLedger(ctx context.Context, in *console.GetWalletLedgerRequest) (*console.WalletLedgerList, error) {
	userID, err := uuid.FromString(in.AccountId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	limit := int(in.Limit)
	if limit < 1 || limit > 100 {
		return nil, status.Error(codes.InvalidArgument, "expects a limit value between 1 and 100")
	}

	ledger, nextCursorStr, prevCursorStr, err := ListWalletLedger(ctx, s.logger, s.db, userID, &limit, in.Cursor)
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
			CreateTime: &timestamppb.Timestamp{Seconds: ledgerItem.CreateTime},
			UpdateTime: &timestamppb.Timestamp{Seconds: ledgerItem.UpdateTime},
		})
	}

	return &console.WalletLedgerList{Items: consoleLedger, NextCursor: nextCursorStr, PrevCursor: prevCursorStr}, nil
}

func (s *ConsoleServer) ListAccounts(ctx context.Context, in *console.ListAccountsRequest) (*console.AccountList, error) {
	const defaultLimit = 50

	// Searching only through tombstone records.
	if in.Tombstones {
		var userID *uuid.UUID
		if in.Filter != "" {
			uid, err := uuid.FromString(in.Filter)
			if err != nil {
				// Filtering for a tombstone using username, no results are possible.
				return &console.AccountList{
					TotalCount: 0,
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
						TotalCount: 0,
					}, nil
				}
				s.logger.Error("Error looking up user tombstone.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}

			return &console.AccountList{
				Users: []*api.User{
					{
						Id:         in.Filter,
						UpdateTime: &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
					},
				},
				TotalCount: 1,
			}, nil
		}

		query := "SELECT user_id, create_time FROM user_tombstone LIMIT $1"
		rows, err := s.db.QueryContext(ctx, query, defaultLimit)
		if err != nil {
			s.logger.Error("Error querying user tombstones.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}

		users := make([]*api.User, 0, defaultLimit)

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
				UpdateTime: &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			})
		}
		_ = rows.Close()

		return &console.AccountList{
			Users:      users,
			TotalCount: countDatabase(ctx, s.logger, s.db, "user_tombstone"),
		}, nil
	}

	// Listing live (non-tombstone) users.
	// Validate cursor, if provided. Only applies for non-filtered listings.
	var cursor *consoleAccountCursor
	if in.Filter == "" && in.Cursor != "" {
		cb, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Error("Error decoding account list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode account list request cursor.")
		}
		cursor = &consoleAccountCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(&cursor); err != nil {
			s.logger.Error("Error decoding account list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode account list request cursor.")
		}
	}

	// If a filter is supplied, check if it's a valid user ID.
	var userIDFilter *uuid.UUID
	if in.Filter != "" {
		userID, err := uuid.FromString(in.Filter)
		if err == nil {
			userIDFilter = &userID
		}
	}

	limit := defaultLimit

	// Filtered queries do not observe cursor or limit inputs, and do not return cursors.
	if in.Filter != "" {
		// Exact match based on username or social identifiers, if any.
		params := []interface{}{in.Filter}
		query := `
			SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
				FROM users
				WHERE username = $1
					OR facebook_id = $1
					OR google_id = $1
					OR gamecenter_id = $1
					OR steam_id = $1
					OR custom_id = $1
				  OR facebook_instant_game_id = $1
					OR apple_id = $1
			UNION
			SELECT u.id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
      	FROM users u JOIN user_device ud on u.id = ud.user_id
      	WHERE ud.id = $1
		`
		if userIDFilter != nil {
			params = append(params, *userIDFilter)
			query += `
				UNION
				SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
        	FROM users
					WHERE id = $2`
		}

		users := make([]*api.User, 0, defaultLimit)

		rows, err := s.db.QueryContext(ctx, query, params...)
		if err != nil {
			s.logger.Error("Error querying users.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}

		for rows.Next() {
			user, err := convertUser(rows)
			if err != nil {
				_ = rows.Close()
				s.logger.Error("Error scanning users.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}
			users = append(users, user)
		}
		_ = rows.Close()

		// Secondary query for fuzzy matching, if the filter is eligible.
		// Executed separately due to cost of query - enables separate limits and potentially extended context deadline.
		if strings.Contains(in.Filter, "%") && validTrigramFilterRegex.MatchString(in.Filter) {
			params = []interface{}{in.Filter, limit - len(users)}
			query = `
		SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
        FROM users
				WHERE username ILIKE $1
				LIMIT $2`

			rows, err := s.db.QueryContext(ctx, query, params...)
			if err != nil {
				s.logger.Error("Error querying users.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}

			for rows.Next() {
				user, err := convertUser(rows)
				if err != nil {
					_ = rows.Close()
					s.logger.Error("Error scanning users.", zap.Any("in", in), zap.Error(err))
					return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
				}
				users = append(users, user)
			}
			_ = rows.Close()

			// De-duplicate users in case of overlaps between the two queries.
			seenUserIDs := make(map[string]struct{}, len(users))
			for i := 0; i < len(users); i++ {
				if _, seen := seenUserIDs[users[i].Id]; seen {
					users = append(users[:i], users[i+1:]...)
					i--
					continue
				}
				seenUserIDs[users[i].Id] = struct{}{}
			}
		}

		s.statusRegistry.FillOnlineUsers(users)

		return &console.AccountList{
			Users:      users,
			TotalCount: countDatabase(ctx, s.logger, s.db, "users"),
		}, nil
	}

	var params []interface{}
	var query string

	// Non-filtered query, pagination possible.
	switch {
	case cursor != nil:
		// Non-filtered, but paginated query. Assume pagination on user ID. Querying and paginating on primary key (id).
		query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users WHERE id > $1 ORDER BY id ASC LIMIT $2"
		params = []interface{}{cursor.ID, limit + 1}
	default:
		// Non-filtered, non-paginated query. Querying and paginating on primary key (id).
		query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, apple_id, facebook_id, facebook_instant_game_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users ORDER BY id ASC LIMIT $1"
		params = []interface{}{limit + 1}
	}

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		s.logger.Error("Error querying users.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
	}

	users := make([]*api.User, 0, defaultLimit)
	var nextCursor *consoleAccountCursor
	var previousUser *api.User

	for rows.Next() {
		// Checks limit before processing for the edge case where (last page == limit) => null cursor.
		if len(users) >= limit {
			nextCursor = &consoleAccountCursor{
				ID:       uuid.FromStringOrNil(previousUser.Id),
				Username: previousUser.Username,
			}
			break
		}

		user, err := convertUser(rows)
		if err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning users.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}
		users = append(users, user)
		previousUser = user
	}
	_ = rows.Close()

	s.statusRegistry.FillOnlineUsers(users)

	response := &console.AccountList{
		Users:      users,
		TotalCount: countDatabase(ctx, s.logger, s.db, "users"),
	}

	if nextCursor != nil {
		cursorBuf := &bytes.Buffer{}
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			s.logger.Error("Error encoding users cursor.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}
		response.NextCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return response, nil
}

func (s *ConsoleServer) UpdateAccount(ctx context.Context, in *console.UpdateAccountRequest) (*emptypb.Empty, error) {
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
		if invalidUsernameRegex.MatchString(v.Value) {
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

	var newPassword []byte
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
		newPassword = hashedPassword
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

	if len(statements) == 0 && !removeCustomID && !removeEmail && len(in.DeviceIds) == 0 && len(newPassword) == 0 {
		// Nothing to update.
		return &emptypb.Empty{}, nil
	}

	if err = ExecuteInTx(ctx, s.db, func(tx *sql.Tx) error {
		for oldDeviceID, newDeviceID := range in.DeviceIds {
			if newDeviceID == "" {
				query := `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (apple_id IS NOT NULL
     OR facebook_id IS NOT NULL
     OR facebook_instant_game_id IS NOT NULL
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

	return &emptypb.Empty{}, nil
}
