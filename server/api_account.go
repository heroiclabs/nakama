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

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strconv"
	"strings"
	"time"
)

func (s *ApiServer) GetAccount(ctx context.Context, in *empty.Empty) (*api.Account, error) {
	userID := ctx.Value(ctxUserIDKey{})
	rows, err := s.db.Query(`
SELECT u.username, u.display_name, u.avatar_url, u.lang_tag, u.location, u.timezone, u.metadata,
	u.email, u.facebook_id, u.google_id, u.gamecenter_id, u.steam_id, u.custom_id,
	u.create_time, u.update_time, u.verify_time,
	ud.id
FROM users u
LEFT JOIN user_device ud ON u.id = ud.user_id
WHERE u.id = $1`, userID)
	if err != nil {
		s.logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error retrieving user account.")
	}
	defer rows.Close()

	var displayName sql.NullString
	var username sql.NullString
	var avatarURL sql.NullString
	var langTag sql.NullString
	var location sql.NullString
	var timezone sql.NullString
	var metadata []byte
	var email sql.NullString
	var facebook sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var customID sql.NullString
	var createTime sql.NullInt64
	var updateTime sql.NullInt64
	var verifyTime sql.NullInt64

	deviceIDs := make([]*api.AccountDevice, 0)

	for rows.Next() {
		var deviceID sql.NullString
		err = rows.Scan(&username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata,
			&email, &facebook, &google, &gamecenter, &steam, &customID,
			&createTime, &updateTime, &verifyTime, &deviceID)
		if err != nil {
			s.logger.Error("Error retrieving user account.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error retrieving user account.")
		}
		if deviceID.Valid {
			deviceIDs = append(deviceIDs, &api.AccountDevice{Id: deviceID.String})
		}
	}
	if err = rows.Err(); err != nil {
		s.logger.Error("Error retrieving user account.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error retrieving user account.")
	}

	var verifyTimestamp *timestamp.Timestamp = nil
	if verifyTime.Valid && verifyTime.Int64 != 0 {
		verifyTimestamp = &timestamp.Timestamp{Seconds: verifyTime.Int64}
	}

	return &api.Account{
		User: &api.User{
			Id:           userID.(uuid.UUID).String(),
			Username:     username.String,
			DisplayName:  displayName.String,
			AvatarUrl:    avatarURL.String,
			LangTag:      langTag.String,
			Location:     location.String,
			Timezone:     timezone.String,
			Metadata:     string(metadata),
			FacebookId:   facebook.String,
			GoogleId:     google.String,
			GamecenterId: gamecenter.String,
			SteamId:      steam.String,
			CreateTime:   &timestamp.Timestamp{Seconds: createTime.Int64},
			UpdateTime:   &timestamp.Timestamp{Seconds: updateTime.Int64},
			Online:       false, // TODO(zyro): Must enrich the field from the presence map.
		},
		Email:      email.String,
		Devices:    deviceIDs,
		CustomId:   customID.String,
		VerifyTime: verifyTimestamp,
	}, nil
}

func (s *ApiServer) UpdateAccount(ctx context.Context, in *api.UpdateAccountRequest) (*empty.Empty, error) {
	index := 1
	statements := make([]string, 0)
	params := make([]interface{}, 0)

	username := in.GetUsername().GetValue()
	if username != "" {
		if len(username) > 128 {
			return nil, status.Error(codes.InvalidArgument, "Username invalid, must be 1-128 bytes.")
		}
		statements = append(statements, "username = $"+strconv.Itoa(index))
		params = append(params, strings.ToLower(username))
		index++
	}

	if in.GetDisplayName() != nil {
		if in.GetDisplayName().GetValue() == "" {
			statements = append(statements, "display_name = NULL")
		} else {
			statements = append(statements, "display_name = $"+strconv.Itoa(index))
			params = append(params, in.GetDisplayName().GetValue())
			index++
		}
	}

	if in.GetTimezone() != nil {
		if in.GetTimezone().GetValue() == "" {
			statements = append(statements, "timezone = NULL")
		} else {
			statements = append(statements, "timezone = $"+strconv.Itoa(index))
			params = append(params, in.GetTimezone().GetValue())
			index++
		}
	}

	if in.GetLocation() != nil {
		if in.GetLocation().GetValue() == "" {
			statements = append(statements, "location = NULL")
		} else {
			statements = append(statements, "location = $"+strconv.Itoa(index))
			params = append(params, in.GetLocation().GetValue())
			index++
		}
	}

	if in.GetLangTag() != nil {
		if in.GetLangTag().GetValue() == "" {
			statements = append(statements, "lang_tag = NULL")
		} else {
			statements = append(statements, "lang_tag = $"+strconv.Itoa(index))
			params = append(params, in.GetLangTag().GetValue())
			index++
		}
	}

	if in.GetLangTag() != nil {
		if in.GetAvatarUrl().GetValue() == "" {
			statements = append(statements, "avatar_url = NULL")
		} else {
			statements = append(statements, "avatar_url = $"+strconv.Itoa(index))
			params = append(params, in.GetAvatarUrl().GetValue())
			index++
		}
	}

	if len(statements) == 0 {
		return nil, status.Error(codes.InvalidArgument, "No fields to update.")
	}

	ts := time.Now().UTC().Unix()
	userID := ctx.Value(ctxUserIDKey{})
	params = append(params, ts, userID)

	query := "UPDATE users SET update_time = $" + strconv.Itoa(index) + ", " + strings.Join(statements, ", ") + " WHERE id = $" + strconv.Itoa(index+1)

	if _, err := s.db.Exec(query, params...); err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
			return nil, status.Error(codes.InvalidArgument, "Username is already in use.")
		}

		s.logger.Error("Could not update user account.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to update account.")
	}

	return &empty.Empty{}, nil
}
