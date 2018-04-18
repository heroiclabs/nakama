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
	"database/sql"
	"strconv"
	"strings"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"github.com/pkg/errors"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func GetAccount(logger *zap.Logger, db *sql.DB, tracker Tracker, userID uuid.UUID) (*api.Account, error) {
	var displayName sql.NullString
	var username sql.NullString
	var avatarURL sql.NullString
	var langTag sql.NullString
	var locat sql.NullString
	var timezone sql.NullString
	var metadata sql.NullString
	var wallet sql.NullString
	var email sql.NullString
	var facebook sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var customID sql.NullString
	var edge_count int
	var createTime pq.NullTime
	var updateTime pq.NullTime
	var verifyTime pq.NullTime

	query := `
SELECT username, display_name, avatar_url, lang_tag, location, timezone, metadata, wallet,
	email, facebook_id, google_id, gamecenter_id, steam_id, custom_id, edge_count,
	create_time, update_time, verify_time
FROM users
WHERE id = $1`

	if err := db.QueryRow(query, userID).Scan(&username, &displayName, &avatarURL, &langTag, &locat, &timezone, &metadata,
		&wallet, &email, &facebook, &google, &gamecenter, &steam, &customID, &edge_count, &createTime, &updateTime, &verifyTime); err != nil {
		logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, err
	}

	rows, err := db.Query(`SELECT id FROM user_device WHERE user_id = $1`, userID)
	if err != nil {
		logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	deviceIDs := make([]*api.AccountDevice, 0)
	for rows.Next() {
		var deviceID sql.NullString
		err = rows.Scan(&deviceID)
		if err != nil {
			logger.Error("Error retrieving user account.", zap.Error(err))
			return nil, err
		}
		if deviceID.Valid {
			deviceIDs = append(deviceIDs, &api.AccountDevice{Id: deviceID.String})
		}
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, err
	}

	var verifyTimestamp *timestamp.Timestamp = nil
	if verifyTime.Valid && verifyTime.Time.Unix() != 0 {
		verifyTimestamp = &timestamp.Timestamp{Seconds: verifyTime.Time.Unix()}
	}

	online := false
	if tracker != nil {
		online = tracker.StreamExists(PresenceStream{Mode: StreamModeNotifications, Subject: userID})
	}

	return &api.Account{
		User: &api.User{
			Id:           userID.String(),
			Username:     username.String,
			DisplayName:  displayName.String,
			AvatarUrl:    avatarURL.String,
			LangTag:      langTag.String,
			Location:     locat.String,
			Timezone:     timezone.String,
			Metadata:     metadata.String,
			FacebookId:   facebook.String,
			GoogleId:     google.String,
			GamecenterId: gamecenter.String,
			SteamId:      steam.String,
			EdgeCount:    int32(edge_count),
			CreateTime:   &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:   &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
			Online:       online,
		},
		Wallet:     wallet.String,
		Email:      email.String,
		Devices:    deviceIDs,
		CustomId:   customID.String,
		VerifyTime: verifyTimestamp,
	}, nil
}

func UpdateAccount(db *sql.DB, logger *zap.Logger, userID uuid.UUID, username string,
	displayName, timezone, location, langTag, avatarURL *wrappers.StringValue) error {

	index := 1
	statements := make([]string, 0)
	params := make([]interface{}, 0)

	if username != "" {
		if invalidCharsRegex.MatchString(username) {
			return errors.New("Username invalid, no spaces or control characters allowed.")
		}
		statements = append(statements, "username = $"+strconv.Itoa(index))
		params = append(params, username)
		index++
	}

	if displayName != nil {
		if d := displayName.GetValue(); d == "" {
			statements = append(statements, "display_name = NULL")
		} else {
			statements = append(statements, "display_name = $"+strconv.Itoa(index))
			params = append(params, d)
			index++
		}
	}

	if timezone != nil {
		if t := timezone.GetValue(); t == "" {
			statements = append(statements, "timezone = NULL")
		} else {
			statements = append(statements, "timezone = $"+strconv.Itoa(index))
			params = append(params, t)
			index++
		}
	}

	if location != nil {
		if l := location.GetValue(); l == "" {
			statements = append(statements, "location = NULL")
		} else {
			statements = append(statements, "location = $"+strconv.Itoa(index))
			params = append(params, l)
			index++
		}
	}

	if langTag != nil {
		if l := langTag.GetValue(); l == "" {
			statements = append(statements, "lang_tag = NULL")
		} else {
			statements = append(statements, "lang_tag = $"+strconv.Itoa(index))
			params = append(params, l)
			index++
		}
	}

	if avatarURL != nil {
		if a := avatarURL.GetValue(); a == "" {
			statements = append(statements, "avatar_url = NULL")
		} else {
			statements = append(statements, "avatar_url = $"+strconv.Itoa(index))
			params = append(params, a)
			index++
		}
	}

	if len(statements) == 0 {
		return errors.New("No fields to update.")
	}

	params = append(params, userID)

	query := "UPDATE users SET update_time = now(), " + strings.Join(statements, ", ") + " WHERE id = $" + strconv.Itoa(index)

	if _, err := db.Exec(query, params...); err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
			return errors.New("Username is already in use.")
		}

		logger.Error("Could not update user account.", zap.Error(err),
			zap.String("username", username),
			zap.Any("display_name", displayName.GetValue()),
			zap.Any("timezone", timezone.GetValue()),
			zap.Any("location", location.GetValue()),
			zap.Any("lang_tag", langTag.GetValue()),
			zap.Any("avatar_url", avatarURL.GetValue()))
		return err
	}

	return nil
}
