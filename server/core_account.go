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
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

var ErrAccountNotFound = errors.New("account not found")

// Not an API entity, only used to receive data from runtime environment.
type accountUpdate struct {
	userID      uuid.UUID
	username    string
	displayName *wrapperspb.StringValue
	timezone    *wrapperspb.StringValue
	location    *wrapperspb.StringValue
	langTag     *wrapperspb.StringValue
	avatarURL   *wrapperspb.StringValue
	metadata    *wrapperspb.StringValue
}

func GetAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, userID uuid.UUID) (*api.Account, error) {
	var username sql.NullString
	var displayName sql.NullString
	var avatarURL sql.NullString
	var langTag sql.NullString
	var location sql.NullString
	var timezone sql.NullString
	var metadata sql.NullString
	var wallet sql.NullString
	var email sql.NullString
	var apple sql.NullString
	var facebook sql.NullString
	var facebookInstantGame sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var customID sql.NullString
	var edgeCount int
	var createTime pgtype.Timestamptz
	var updateTime pgtype.Timestamptz
	var verifyTime pgtype.Timestamptz
	var disableTime pgtype.Timestamptz
	var deviceIDs pgtype.FlatArray[string]

	m := pgtype.NewMap()

	query := `
SELECT u.username, u.display_name, u.avatar_url, u.lang_tag, u.location, u.timezone, u.metadata, u.wallet,
	u.email, u.apple_id, u.facebook_id, u.facebook_instant_game_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id, u.edge_count,
	u.create_time, u.update_time, u.verify_time, u.disable_time, array(select ud.id from user_device ud where u.id = ud.user_id)
FROM users u
WHERE u.id = $1`

	if err := db.QueryRowContext(ctx, query, userID).Scan(&username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata, &wallet, &email, &apple, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &customID, &edgeCount, &createTime, &updateTime, &verifyTime, &disableTime, m.SQLScanner(&deviceIDs)); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAccountNotFound
		}
		logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, err
	}

	devices := make([]*api.AccountDevice, 0, len(deviceIDs))
	for _, deviceID := range deviceIDs {
		devices = append(devices, &api.AccountDevice{Id: deviceID})
	}

	var verifyTimestamp *timestamppb.Timestamp
	if verifyTime.Valid && verifyTime.Time.Unix() != 0 {
		verifyTimestamp = &timestamppb.Timestamp{Seconds: verifyTime.Time.Unix()}
	}
	var disableTimestamp *timestamppb.Timestamp
	if disableTime.Valid && disableTime.Time.Unix() != 0 {
		disableTimestamp = &timestamppb.Timestamp{Seconds: disableTime.Time.Unix()}
	}

	online := false
	if statusRegistry != nil {
		online = statusRegistry.IsOnline(userID)
	}

	return &api.Account{
		User: &api.User{
			Id:                    userID.String(),
			Username:              username.String,
			DisplayName:           displayName.String,
			AvatarUrl:             avatarURL.String,
			LangTag:               langTag.String,
			Location:              location.String,
			Timezone:              timezone.String,
			Metadata:              metadata.String,
			AppleId:               apple.String,
			FacebookId:            facebook.String,
			FacebookInstantGameId: facebookInstantGame.String,
			GoogleId:              google.String,
			GamecenterId:          gamecenter.String,
			SteamId:               steam.String,
			EdgeCount:             int32(edgeCount),
			CreateTime:            &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:            &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
			Online:                online,
		},
		Wallet:      wallet.String,
		Email:       email.String,
		Devices:     devices,
		CustomId:    customID.String,
		VerifyTime:  verifyTimestamp,
		DisableTime: disableTimestamp,
	}, nil
}

func GetAccounts(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, userIDs []string) ([]*api.Account, error) {
	query := `
SELECT u.id, u.username, u.display_name, u.avatar_url, u.lang_tag, u.location, u.timezone, u.metadata, u.wallet,
	u.email, u.apple_id, u.facebook_id, u.facebook_instant_game_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id, u.edge_count,
	u.create_time, u.update_time, u.verify_time, u.disable_time, array(select ud.id from user_device ud where u.id = ud.user_id)
FROM users u
WHERE u.id = ANY($1)`
	rows, err := db.QueryContext(ctx, query, userIDs)
	if err != nil {
		logger.Error("Error retrieving user accounts.", zap.Error(err))
		return nil, err
	}

	accounts := make([]*api.Account, 0, len(userIDs))
	for rows.Next() {
		var userID string
		var username sql.NullString
		var displayName sql.NullString
		var avatarURL sql.NullString
		var langTag sql.NullString
		var location sql.NullString
		var timezone sql.NullString
		var metadata sql.NullString
		var wallet sql.NullString
		var email sql.NullString
		var apple sql.NullString
		var facebook sql.NullString
		var facebookInstantGame sql.NullString
		var google sql.NullString
		var gamecenter sql.NullString
		var steam sql.NullString
		var customID sql.NullString
		var edgeCount int
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var verifyTime pgtype.Timestamptz
		var disableTime pgtype.Timestamptz
		var deviceIDs pgtype.FlatArray[string]

		m := pgtype.NewMap()

		err = rows.Scan(&userID, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata, &wallet, &email, &apple, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &customID, &edgeCount, &createTime, &updateTime, &verifyTime, &disableTime, m.SQLScanner(&deviceIDs))
		if err != nil {
			_ = rows.Close()
			logger.Error("Error retrieving user accounts.", zap.Error(err))
			return nil, err
		}

		devices := make([]*api.AccountDevice, 0, len(deviceIDs))
		for _, deviceID := range deviceIDs {
			devices = append(devices, &api.AccountDevice{Id: deviceID})
		}

		var verifyTimestamp *timestamppb.Timestamp
		if verifyTime.Valid && verifyTime.Time.Unix() != 0 {
			verifyTimestamp = &timestamppb.Timestamp{Seconds: verifyTime.Time.Unix()}
		}
		var disableTimestamp *timestamppb.Timestamp
		if disableTime.Valid && disableTime.Time.Unix() != 0 {
			disableTimestamp = &timestamppb.Timestamp{Seconds: disableTime.Time.Unix()}
		}

		accounts = append(accounts, &api.Account{
			User: &api.User{
				Id:                    userID,
				Username:              username.String,
				DisplayName:           displayName.String,
				AvatarUrl:             avatarURL.String,
				LangTag:               langTag.String,
				Location:              location.String,
				Timezone:              timezone.String,
				Metadata:              metadata.String,
				AppleId:               apple.String,
				FacebookId:            facebook.String,
				FacebookInstantGameId: facebookInstantGame.String,
				GoogleId:              google.String,
				GamecenterId:          gamecenter.String,
				SteamId:               steam.String,
				EdgeCount:             int32(edgeCount),
				CreateTime:            &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
				UpdateTime:            &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
				// Online filled below.
			},
			Wallet:      wallet.String,
			Email:       email.String,
			Devices:     devices,
			CustomId:    customID.String,
			VerifyTime:  verifyTimestamp,
			DisableTime: disableTimestamp,
		})
	}
	_ = rows.Close()

	if statusRegistry != nil {
		statusRegistry.FillOnlineAccounts(accounts)
	}

	return accounts, nil
}

func UpdateAccounts(ctx context.Context, logger *zap.Logger, db *sql.DB, updates []*accountUpdate) error {
	if err := ExecuteInTxPgx(ctx, db, func(tx pgx.Tx) error {
		updateErr := updateAccounts(ctx, logger, tx, updates)
		if updateErr != nil {
			return updateErr
		}
		return nil
	}); err != nil {
		var statusErr *statusError
		if errors.As(err, &statusErr) {
			return statusErr.Cause()
		}
		logger.Error("Error updating user accounts.", zap.Error(err))
		return err
	}

	return nil
}

func updateAccounts(ctx context.Context, logger *zap.Logger, tx pgx.Tx, updates []*accountUpdate) error {
	for _, update := range updates {
		updateStatements := make([]string, 0, 7)
		distinctStatements := make([]string, 0, 7)
		params := make([]interface{}, 0, 8)

		// Ensure user ID is always present.
		params = append(params, update.userID)

		if update.username != "" {
			if invalidUsernameRegex.MatchString(update.username) {
				return errors.New("Username invalid, no spaces or control characters allowed.")
			}
			params = append(params, update.username)
			updateStatements = append(updateStatements, "username = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "username IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}

		if update.displayName != nil {
			if d := update.displayName.GetValue(); d == "" {
				updateStatements = append(updateStatements, "display_name = NULL")
				distinctStatements = append(distinctStatements, "display_name IS NOT NULL")
			} else {
				params = append(params, d)
				updateStatements = append(updateStatements, "display_name = $"+strconv.Itoa(len(params)))
				distinctStatements = append(distinctStatements, "display_name IS DISTINCT FROM $"+strconv.Itoa(len(params)))
			}
		}

		if update.timezone != nil {
			if t := update.timezone.GetValue(); t == "" {
				updateStatements = append(updateStatements, "timezone = NULL")
				distinctStatements = append(distinctStatements, "timezone IS NOT NULL")
			} else {
				params = append(params, t)
				updateStatements = append(updateStatements, "timezone = $"+strconv.Itoa(len(params)))
				distinctStatements = append(distinctStatements, "timezone IS DISTINCT FROM $"+strconv.Itoa(len(params)))
			}
		}

		if update.location != nil {
			if l := update.location.GetValue(); l == "" {
				updateStatements = append(updateStatements, "location = NULL")
				distinctStatements = append(distinctStatements, "location IS NOT NULL")
			} else {
				params = append(params, l)
				updateStatements = append(updateStatements, "location = $"+strconv.Itoa(len(params)))
				distinctStatements = append(distinctStatements, "location IS DISTINCT FROM $"+strconv.Itoa(len(params)))
			}
		}

		if update.langTag != nil {
			if l := update.langTag.GetValue(); l == "" {
				updateStatements = append(updateStatements, "lang_tag = NULL")
				distinctStatements = append(distinctStatements, "lang_tag IS NOT NULL")
			} else {
				params = append(params, l)
				updateStatements = append(updateStatements, "lang_tag = $"+strconv.Itoa(len(params)))
				distinctStatements = append(distinctStatements, "lang_tag IS DISTINCT FROM $"+strconv.Itoa(len(params)))
			}
		}

		if update.avatarURL != nil {
			if a := update.avatarURL.GetValue(); a == "" {
				updateStatements = append(updateStatements, "avatar_url = NULL")
				distinctStatements = append(distinctStatements, "avatar_url IS NOT NULL")
			} else {
				params = append(params, a)
				updateStatements = append(updateStatements, "avatar_url = $"+strconv.Itoa(len(params)))
				distinctStatements = append(distinctStatements, "avatar_url IS DISTINCT FROM $"+strconv.Itoa(len(params)))
			}
		}

		if update.metadata != nil {
			params = append(params, update.metadata.GetValue())
			updateStatements = append(updateStatements, "metadata = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "metadata IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}

		if len(updateStatements) == 0 {
			return errors.New("No fields to update.")
		}

		query := "UPDATE users SET update_time = now(), " + strings.Join(updateStatements, ", ") +
			" WHERE id = $1 AND (" + strings.Join(distinctStatements, " OR ") + ")"

		if _, err := tx.Exec(ctx, query, params...); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_username_key") {
				return status.Error(codes.AlreadyExists, "Username is already in use.")
			}

			logger.Error("Could not update user account.", zap.Error(err),
				zap.String("username", update.username),
				zap.Any("display_name", update.displayName),
				zap.Any("timezone", update.timezone),
				zap.Any("location", update.location),
				zap.Any("lang_tag", update.langTag),
				zap.Any("avatar_url", update.avatarURL))
			return err
		}
	}

	return nil
}

func ExportAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) (*console.AccountExport, error) {
	// Core user account.
	account, err := GetAccount(ctx, logger, db, nil, userID)
	if err != nil {
		if errors.Is(err, ErrAccountNotFound) {
			return nil, status.Error(codes.NotFound, "Account not found.")
		}
		logger.Error("Could not export account data", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Friends.
	friends, err := GetFriendIDs(ctx, logger, db, userID)
	if err != nil {
		logger.Error("Could not fetch friend IDs", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Messages.
	messages, err := GetChannelMessages(ctx, logger, db, userID)
	if err != nil {
		logger.Error("Could not fetch messages", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Leaderboard records.
	leaderboardRecords, err := LeaderboardRecordReadAll(ctx, logger, db, userID)
	if err != nil {
		logger.Error("Could not fetch leaderboard records", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	groups := make([]*api.Group, 0, 1)
	groupUsers, err := ListUserGroups(ctx, logger, db, userID, 0, nil, "")
	if err != nil {
		logger.Error("Could not fetch groups that belong to the user", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}
	for _, g := range groupUsers.UserGroups {
		groups = append(groups, g.Group)
	}

	// Notifications.
	notifications, err := NotificationList(ctx, logger, db, userID, 0, "", true)
	if err != nil {
		logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// Storage objects where user is the owner.
	storageObjects, err := StorageReadAllUserObjects(ctx, logger, db, userID)
	if err != nil {
		logger.Error("Could not fetch notifications", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}

	// History of user's wallet.
	walletLedgers, _, _, err := ListWalletLedger(ctx, logger, db, userID, nil, "", time.Time{}, time.Time{})
	if err != nil {
		logger.Error("Could not fetch wallet ledger items", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}
	wl := make([]*console.WalletLedger, len(walletLedgers))
	for i, w := range walletLedgers {
		changeset, err := json.Marshal(w.Changeset)
		if err != nil {
			logger.Error("Could not fetch wallet ledger items, error encoding changeset", zap.Error(err), zap.String("user_id", userID.String()))
			return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
		}
		metadata, err := json.Marshal(w.Metadata)
		if err != nil {
			logger.Error("Could not fetch wallet ledger items, error encoding metadata", zap.Error(err), zap.String("user_id", userID.String()))
			return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
		}
		wl[i] = &console.WalletLedger{
			Id:         w.ID,
			UserId:     w.UserID,
			Changeset:  string(changeset),
			Metadata:   string(metadata),
			CreateTime: &timestamppb.Timestamp{Seconds: w.CreateTime},
			UpdateTime: &timestamppb.Timestamp{Seconds: w.UpdateTime},
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

func ImportAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, statusRegistry StatusRegistry, userID uuid.UUID, data *console.AccountExport) (*console.Account, error) {
	var account *console.Account
	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		account = nil

		// Check if importing a completely new account, and create it if needed.
		if userID == uuid.Nil {
			query := `
INSERT INTO users (id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, wallet, email, password, facebook_id, google_id, gamecenter_id, steam_id, custom_id, create_time, update_time, verify_time, disable_time)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`
			_, err := tx.ExecContext(ctx, query, data.Account.User.Id, data.Account.User.Username, data.Account.User.DisplayName, data.Account.User.AvatarUrl, data.Account.User.LangTag,
				data.Account.User.Location, data.Account.User.Timezone, data.Account.User.Metadata, data.Account.Wallet, data.Account.Email, "", data.Account.User.FacebookId,
				data.Account.User.GoogleId, data.Account.User.GamecenterId, data.Account.User.SteamId, data.Account.CustomId, data.Account.User.CreateTime.AsTime(),
				data.Account.User.UpdateTime.AsTime(), data.Account.VerifyTime.AsTime(), data.Account.DisableTime.AsTime())
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return err
				}
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) {
					if pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_pkey") {
						return errors.New("User identifier already exists.")
					}
					if pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_username_key") {
						return errors.New("Username already in use.")
					}
				}
				logger.Error("Error creating user account during import", zap.Error(err), zap.String("user_id", userID.String()))
				return err
			}

			if len(data.Account.Devices) > 0 {
				query = `INSERT INTO user_device (id, user_id)`
				params := []interface{}{data.Account.User.Id}
				for _, d := range data.Account.Devices {
					params = append(params, d.Id)
					if l := len(params); l == 2 {
						query += " VALUES ($2, $1)"
					} else {
						query += fmt.Sprintf(", ($%v, $1)", l)
					}
				}

				_, err := tx.ExecContext(ctx, query, params...)
				if err != nil {
					if errors.Is(err, context.Canceled) {
						return err
					}
					logger.Error("Error creating user devices during import", zap.Error(err), zap.String("user_id", userID.String()))
					return err
				}
			}
		} else {
			query := "UPDATE users SET metadata = $1, wallet = $2 WHERE id = $3"
			res, err := tx.ExecContext(ctx, query, data.Account.User.Metadata, data.Account.Wallet, userID.String())
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return err
				}
				logger.Error("Error updating user account during import", zap.Error(err), zap.String("user_id", userID.String()))
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				logger.Error("Error updating user account during import, no rows affected", zap.String("user_id", userID.String()))
				return errors.New("Error updating user account during import.")
			}
		}

		// Ensure all storage objects for the user match what is in the data import.
		if userID != uuid.Nil {
			// First wipe out any existing storage.
			query := "DELETE FROM storage WHERE user_id = $1"
			_, err := tx.ExecContext(ctx, query, userID.String())
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return err
				}
				logger.Error("Error deleting user storage during import", zap.Error(err), zap.String("user_id", userID.String()))
				return err
			}
		}
		if l := len(data.Objects); l > 0 {
			query := `INSERT INTO storage (user_id, collection, key, "value", "version", "read", "write", create_time, update_time)`
			params := make([]interface{}, 0, l*8+1)
			if userID == uuid.Nil {
				params = append(params, data.Account.User.Id)
			} else {
				params = append(params, userID.String())
			}
			for i, d := range data.Objects {
				params = append(params, d.Collection, d.Key, d.Value, d.Version, d.PermissionRead, d.PermissionWrite, d.CreateTime.AsTime(), d.UpdateTime.AsTime())
				if i == 0 {
					query += fmt.Sprintf(" VALUES ($1, $%v, $%v, $%v, $%v, $%v, $%v, $%v, $%v)", i*8+2, i*8+3, i*8+4, i*8+5, i*8+6, i*8+7, i*8+8, i*8+9)
				} else {
					query += fmt.Sprintf(", ($1, $%v, $%v, $%v, $%v, $%v, $%v, $%v, $%v)", i*8+2, i*8+3, i*8+4, i*8+5, i*8+6, i*8+7, i*8+8, i*8+9)
				}
			}

			res, err := tx.ExecContext(ctx, query, params...)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return err
				}
				logger.Error("Error writing user storage during import", zap.Error(err), zap.String("user_id", userID.String()))
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected != int64(l) {
				logger.Error("Error updating user account during import, rows affected mismatch", zap.String("user_id", userID.String()), zap.Int64("rows_affected", rowsAffected), zap.Int("expected_rows", l))
				return errors.New("Error writing user storage during import.")
			}
		}

		// Look up the final state of the user account.
		var lookupUserID string
		if userID != uuid.Nil {
			lookupUserID = userID.String()
		} else {
			lookupUserID = data.Account.User.Id
		}
		var username sql.NullString
		var displayName sql.NullString
		var avatarURL sql.NullString
		var langTag sql.NullString
		var location sql.NullString
		var timezone sql.NullString
		var metadata sql.NullString
		var wallet sql.NullString
		var email sql.NullString
		var apple sql.NullString
		var facebook sql.NullString
		var facebookInstantGame sql.NullString
		var google sql.NullString
		var gamecenter sql.NullString
		var steam sql.NullString
		var customID sql.NullString
		var edgeCount int
		var createTime pgtype.Timestamptz
		var updateTime pgtype.Timestamptz
		var verifyTime pgtype.Timestamptz
		var disableTime pgtype.Timestamptz
		var deviceIDs pgtype.FlatArray[string]

		m := pgtype.NewMap()

		query := `
SELECT u.username, u.display_name, u.avatar_url, u.lang_tag, u.location, u.timezone, u.metadata, u.wallet,
	u.email, u.apple_id, u.facebook_id, u.facebook_instant_game_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id, u.edge_count,
	u.create_time, u.update_time, u.verify_time, u.disable_time, array(select ud.id from user_device ud where u.id = ud.user_id)
FROM users u
WHERE u.id = $1`

		if err := tx.QueryRowContext(ctx, query, lookupUserID).Scan(&username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata, &wallet, &email, &apple, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &customID, &edgeCount, &createTime, &updateTime, &verifyTime, &disableTime, m.SQLScanner(&deviceIDs)); err != nil {
			if errors.Is(err, context.Canceled) {
				return err
			}
			if errors.Is(err, sql.ErrNoRows) {
				return ErrAccountNotFound
			}
			logger.Error("Error retrieving user account during import", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		}

		devices := make([]*api.AccountDevice, 0, len(deviceIDs))
		for _, deviceID := range deviceIDs {
			devices = append(devices, &api.AccountDevice{Id: deviceID})
		}

		var verifyTimestamp *timestamppb.Timestamp
		if verifyTime.Valid && verifyTime.Time.Unix() != 0 {
			verifyTimestamp = &timestamppb.Timestamp{Seconds: verifyTime.Time.Unix()}
		}
		var disableTimestamp *timestamppb.Timestamp
		if disableTime.Valid && disableTime.Time.Unix() != 0 {
			disableTimestamp = &timestamppb.Timestamp{Seconds: disableTime.Time.Unix()}
		}

		online := false
		if statusRegistry != nil {
			online = statusRegistry.IsOnline(userID)
		}

		account = &console.Account{
			Account: &api.Account{
				User: &api.User{
					Id:                    userID.String(),
					Username:              username.String,
					DisplayName:           displayName.String,
					AvatarUrl:             avatarURL.String,
					LangTag:               langTag.String,
					Location:              location.String,
					Timezone:              timezone.String,
					Metadata:              metadata.String,
					AppleId:               apple.String,
					FacebookId:            facebook.String,
					FacebookInstantGameId: facebookInstantGame.String,
					GoogleId:              google.String,
					GamecenterId:          gamecenter.String,
					SteamId:               steam.String,
					EdgeCount:             int32(edgeCount),
					CreateTime:            &timestamppb.Timestamp{Seconds: createTime.Time.Unix()},
					UpdateTime:            &timestamppb.Timestamp{Seconds: updateTime.Time.Unix()},
					Online:                online,
				},
				Wallet:      wallet.String,
				Email:       email.String,
				Devices:     devices,
				CustomId:    customID.String,
				VerifyTime:  verifyTimestamp,
				DisableTime: disableTimestamp,
			},
			DisableTime: disableTimestamp,
		}

		return nil
	}); err != nil {
		logger.Error("Error importing account.", zap.Error(err))
		return nil, err
	}

	return account, nil
}

func DeleteAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, sessionRegistry SessionRegistry, sessionCache SessionCache, tracker Tracker, userID uuid.UUID, recorded bool) error {
	if userID == uuid.Nil {
		return errors.New("cannot delete the system user")
	}

	ts := time.Now().UTC().Unix()

	var deleted bool
	if err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		count, err := DeleteUser(ctx, tx, userID)
		if err != nil {
			logger.Debug("Could not delete user", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		} else if count == 0 {
			logger.Info("No user was found to delete. Skipping blacklist.", zap.String("user_id", userID.String()))
			return nil
		}

		err = LeaderboardRecordsDeleteAll(ctx, logger, leaderboardCache, leaderboardRankCache, tx, userID, ts)
		if err != nil {
			logger.Debug("Could not delete leaderboard records.", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		}

		err = GroupDeleteAll(ctx, logger, tx, userID)
		if err != nil {
			logger.Debug("Could not delete groups and relationships.", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		}

		if recorded {
			_, err = tx.ExecContext(ctx, `INSERT INTO user_tombstone (user_id) VALUES ($1) ON CONFLICT(user_id) DO NOTHING`, userID)
			if err != nil {
				logger.Debug("Could not insert user ID into tombstone", zap.Error(err), zap.String("user_id", userID.String()))
				return err
			}
		}

		deleted = true

		return nil
	}); err != nil {
		logger.Error("Error occurred while trying to delete the user.", zap.Error(err), zap.String("user_id", userID.String()))
		return err
	}

	if deleted {
		// Logout and disconnect.
		if err := SessionLogout(config, sessionCache, userID, "", ""); err != nil {
			return err
		}
		for _, presence := range tracker.ListPresenceIDByStream(PresenceStream{Mode: StreamModeNotifications, Subject: userID}) {
			if err := sessionRegistry.Disconnect(ctx, presence.SessionID, false); err != nil {
				return err
			}
		}
	}

	return nil
}
