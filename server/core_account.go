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
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v2/console"
	"github.com/jackc/pgx"
	"github.com/jackc/pgx/pgtype"
	"github.com/pkg/errors"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strconv"
	"strings"
)

var ErrAccountNotFound = errors.New("account not found")

func GetAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, userID uuid.UUID) (*api.Account, error) {
	var displayName sql.NullString
	var username sql.NullString
	var avatarURL sql.NullString
	var langTag sql.NullString
	var location sql.NullString
	var timezone sql.NullString
	var metadata sql.NullString
	var wallet sql.NullString
	var email sql.NullString
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
	var deviceIDs pgtype.VarcharArray

	query := `
SELECT u.username, u.display_name, u.avatar_url, u.lang_tag, u.location, u.timezone, u.metadata, u.wallet,
	u.email, u.facebook_id, u.facebook_instant_game_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id, u.edge_count,
	u.create_time, u.update_time, u.verify_time, u.disable_time, array(select ud.id from user_device ud where u.id = ud.user_id)
FROM users u
WHERE u.id = $1`

	if err := db.QueryRowContext(ctx, query, userID).Scan(&username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata, &wallet, &email, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &customID, &edgeCount, &createTime, &updateTime, &verifyTime, &disableTime, &deviceIDs); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrAccountNotFound
		}
		logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, err
	}

	devices := make([]*api.AccountDevice, 0, len(deviceIDs.Elements))
	for _, deviceID := range deviceIDs.Elements {
		devices = append(devices, &api.AccountDevice{Id: deviceID.String})
	}

	var verifyTimestamp *timestamp.Timestamp
	if verifyTime.Status == pgtype.Present && verifyTime.Time.Unix() != 0 {
		verifyTimestamp = &timestamp.Timestamp{Seconds: verifyTime.Time.Unix()}
	}
	var disableTimestamp *timestamp.Timestamp
	if disableTime.Status == pgtype.Present && disableTime.Time.Unix() != 0 {
		disableTimestamp = &timestamp.Timestamp{Seconds: disableTime.Time.Unix()}
	}

	online := false
	if tracker != nil {
		online = tracker.StreamExists(PresenceStream{Mode: StreamModeNotifications, Subject: userID})
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
			FacebookId:            facebook.String,
			FacebookInstantGameId: facebookInstantGame.String,
			GoogleId:              google.String,
			GamecenterId:          gamecenter.String,
			SteamId:               steam.String,
			EdgeCount:             int32(edgeCount),
			CreateTime:            &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:            &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
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

func GetAccounts(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, userIDs []string) ([]*api.Account, error) {
	statements := make([]string, 0, len(userIDs))
	parameters := make([]interface{}, 0, len(userIDs))
	for _, userID := range userIDs {
		parameters = append(parameters, userID)
		statements = append(statements, "$"+strconv.Itoa(len(parameters)))
	}

	query := `
SELECT u.id, u.username, u.display_name, u.avatar_url, u.lang_tag, u.location, u.timezone, u.metadata, u.wallet,
	u.email, u.facebook_id, u.facebook_instant_game_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id, u.edge_count,
	u.create_time, u.update_time, u.verify_time, u.disable_time, array(select ud.id from user_device ud where u.id = ud.user_id)
FROM users u
WHERE u.id IN (` + strings.Join(statements, ",") + `)`
	rows, err := db.QueryContext(ctx, query, parameters...)
	if err != nil {
		logger.Error("Error retrieving user accounts.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

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
		var deviceIDs pgtype.VarcharArray

		err = rows.Scan(&userID, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata, &wallet, &email, &facebook, &facebookInstantGame, &google, &gamecenter, &steam, &customID, &edgeCount, &createTime, &updateTime, &verifyTime, &disableTime, &deviceIDs)
		if err != nil {
			logger.Error("Error retrieving user accounts.", zap.Error(err))
			return nil, err
		}

		devices := make([]*api.AccountDevice, 0, len(deviceIDs.Elements))
		for _, deviceID := range deviceIDs.Elements {
			devices = append(devices, &api.AccountDevice{Id: deviceID.String})
		}

		var verifyTimestamp *timestamp.Timestamp
		if verifyTime.Status == pgtype.Present && verifyTime.Time.Unix() != 0 {
			verifyTimestamp = &timestamp.Timestamp{Seconds: verifyTime.Time.Unix()}
		}
		var disableTimestamp *timestamp.Timestamp
		if disableTime.Status == pgtype.Present && disableTime.Time.Unix() != 0 {
			disableTimestamp = &timestamp.Timestamp{Seconds: disableTime.Time.Unix()}
		}

		online := false
		if tracker != nil {
			online = tracker.StreamExists(PresenceStream{Mode: StreamModeNotifications, Subject: uuid.FromStringOrNil(userID)})
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
				FacebookId:            facebook.String,
				FacebookInstantGameId: facebookInstantGame.String,
				GoogleId:              google.String,
				GamecenterId:          gamecenter.String,
				SteamId:               steam.String,
				EdgeCount:             int32(edgeCount),
				CreateTime:            &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
				UpdateTime:            &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
				Online:                online,
			},
			Wallet:      wallet.String,
			Email:       email.String,
			Devices:     devices,
			CustomId:    customID.String,
			VerifyTime:  verifyTimestamp,
			DisableTime: disableTimestamp,
		})
	}

	return accounts, nil
}

func UpdateAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, username string, displayName, timezone, location, langTag, avatarURL, metadata *wrappers.StringValue) error {
	updateStatements := make([]string, 0, 7)
	distinctStatements := make([]string, 0, 7)
	params := make([]interface{}, 0, 8)

	// Ensure user ID is always present.
	params = append(params, userID)

	if username != "" {
		if invalidCharsRegex.MatchString(username) {
			return errors.New("Username invalid, no spaces or control characters allowed.")
		}
		params = append(params, username)
		updateStatements = append(updateStatements, "username = $"+strconv.Itoa(len(params)))
		distinctStatements = append(distinctStatements, "username IS DISTINCT FROM $"+strconv.Itoa(len(params)))
	}

	if displayName != nil {
		if d := displayName.GetValue(); d == "" {
			updateStatements = append(updateStatements, "display_name = NULL")
			distinctStatements = append(distinctStatements, "display_name IS NOT NULL")
		} else {
			params = append(params, d)
			updateStatements = append(updateStatements, "display_name = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "display_name IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}
	}

	if timezone != nil {
		if t := timezone.GetValue(); t == "" {
			updateStatements = append(updateStatements, "timezone = NULL")
			distinctStatements = append(distinctStatements, "timezone IS NOT NULL")
		} else {
			params = append(params, t)
			updateStatements = append(updateStatements, "timezone = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "timezone IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}
	}

	if location != nil {
		if l := location.GetValue(); l == "" {
			updateStatements = append(updateStatements, "location = NULL")
			distinctStatements = append(distinctStatements, "location IS NOT NULL")
		} else {
			params = append(params, l)
			updateStatements = append(updateStatements, "location = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "location IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}
	}

	if langTag != nil {
		if l := langTag.GetValue(); l == "" {
			updateStatements = append(updateStatements, "lang_tag = NULL")
			distinctStatements = append(distinctStatements, "lang_tag IS NOT NULL")
		} else {
			params = append(params, l)
			updateStatements = append(updateStatements, "lang_tag = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "lang_tag IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}
	}

	if avatarURL != nil {
		if a := avatarURL.GetValue(); a == "" {
			updateStatements = append(updateStatements, "avatar_url = NULL")
			distinctStatements = append(distinctStatements, "avatar_url IS NOT NULL")
		} else {
			params = append(params, a)
			updateStatements = append(updateStatements, "avatar_url = $"+strconv.Itoa(len(params)))
			distinctStatements = append(distinctStatements, "avatar_url IS DISTINCT FROM $"+strconv.Itoa(len(params)))
		}
	}

	if metadata != nil {
		params = append(params, metadata.GetValue())
		updateStatements = append(updateStatements, "metadata = $"+strconv.Itoa(len(params)))
		distinctStatements = append(distinctStatements, "metadata IS DISTINCT FROM $"+strconv.Itoa(len(params)))
	}

	if len(updateStatements) == 0 {
		return errors.New("No fields to update.")
	}

	query := "UPDATE users SET update_time = now(), " + strings.Join(updateStatements, ", ") +
		" WHERE id = $1 AND (" + strings.Join(distinctStatements, " OR ") + ")"

	if _, err := db.ExecContext(ctx, query, params...); err != nil {
		if e, ok := err.(pgx.PgError); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
			return errors.New("Username is already in use.")
		}

		logger.Error("Could not update user account.", zap.Error(err),
			zap.String("username", username),
			zap.Any("display_name", displayName),
			zap.Any("timezone", timezone),
			zap.Any("location", location),
			zap.Any("lang_tag", langTag),
			zap.Any("avatar_url", avatarURL))
		return err
	}

	return nil
}

func ExportAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID) (*console.AccountExport, error) {
	// Core user account.
	account, err := GetAccount(ctx, logger, db, nil, userID)
	if err != nil {
		if err == ErrAccountNotFound {
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

	groups := make([]*api.Group, 0)
	groupUsers, err := ListUserGroups(ctx, logger, db, userID, 0, nil, "")
	if err != nil {
		logger.Error("Could not fetch groups that belong to the user", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export user data.")
	}
	for _, g := range groupUsers.UserGroups {
		groups = append(groups, g.Group)
	}

	// Notifications.
	notifications, err := NotificationList(ctx, logger, db, userID, 0, "", nil)
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
	walletLedgers, _, err := ListWalletLedger(ctx, logger, db, userID, nil, "")
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

func DeleteAccount(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, recorded bool) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := ExecuteInTx(ctx, tx, func() error {
		count, err := DeleteUser(ctx, tx, userID)
		if err != nil {
			logger.Debug("Could not delete user", zap.Error(err), zap.String("user_id", userID.String()))
			return err
		} else if count == 0 {
			logger.Info("No user was found to delete. Skipping blacklist.", zap.String("user_id", userID.String()))
			return nil
		}

		err = LeaderboardRecordsDeleteAll(ctx, logger, tx, userID)
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

		return nil
	}); err != nil {
		logger.Error("Error occurred while trying to delete the user.", zap.Error(err), zap.String("user_id", userID.String()))
		return err
	}

	return nil
}
