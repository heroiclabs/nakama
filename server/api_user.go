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
	"github.com/heroiclabs/nakama/api"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) GetUsers(ctx context.Context, in *api.GetUsersRequest) (*api.Users, error) {
	if in.GetIds() == nil && in.GetUsernames() == nil && in.GetFacebookIds() == nil {
		return nil, status.Error(codes.InvalidArgument, "Specify at least one ID or Username or Facebook ID.")
	}

	query := `
SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata,
	facebook_id, google_id, gamecenter_id, steam_id, create_time, update_time
FROM users
WHERE`

	ids := make([]string, 0)
	usernames := make([]string, 0)
	facebookIDs := make([]string, 0)
	params := make([]interface{}, 0)
	counter := 1
	useSqlOr := false

	if in.GetIds() != nil {
		for _, id := range in.GetIds() {
			if _, uuidErr := uuid.FromString(id); uuidErr != nil {
				return nil, status.Error(codes.InvalidArgument, "ID '"+id+"' is not a valid system ID.")
			}

			params = append(params, id)
			statement := "$" + strconv.Itoa(counter)
			ids = append(ids, statement)
			counter++
		}
		query = query + " id IN (" + strings.Join(ids, ", ") + ")"
		useSqlOr = true
	}

	if in.GetUsernames() != nil {
		for _, username := range in.GetUsernames() {
			params = append(params, username)
			statement := "$" + strconv.Itoa(counter)
			usernames = append(usernames, statement)
			counter++
		}
		if useSqlOr {
			query = query + " OR"
		}
		query = query + " username IN (" + strings.Join(usernames, ", ") + ")"
		useSqlOr = true
	}

	if in.GetFacebookIds() != nil {
		for _, id := range in.GetFacebookIds() {
			params = append(params, id)
			statement := "$" + strconv.Itoa(counter)
			facebookIDs = append(facebookIDs, statement)
			counter++
		}
		if useSqlOr {
			query = query + " OR"
		}
		query = query + " facebook_id IN (" + strings.Join(facebookIDs, ", ") + ")"
	}

	rows, err := s.db.Query(query, params...)
	if err != nil {
		s.logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error retrieving user accounts.")
	}
	defer rows.Close()

	users := &api.Users{Users: make([]*api.User, 0)}
	for rows.Next() {
		user, err := convertUser(rows)
		if err != nil {
			s.logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Any("input", in))
			return nil, status.Error(codes.Internal, "Error retrieving user accounts.")
		}
		users.Users = append(users.Users, user)
	}
	if err = rows.Err(); err != nil {
		s.logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error retrieving user accounts.")
	}

	return users, nil
}

func convertUser(rows *sql.Rows) (*api.User, error) {
	var id string
	var displayName sql.NullString
	var username sql.NullString
	var avatarURL sql.NullString
	var langTag sql.NullString
	var location sql.NullString
	var timezone sql.NullString
	var metadata []byte
	var facebook sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var createTime sql.NullInt64
	var updateTime sql.NullInt64

	err := rows.Scan(&id, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata,
		&facebook, &google, &gamecenter, &steam, &createTime, &updateTime)
	if err != nil {
		return nil, err
	}

	return &api.User{
		Id:           uuid.FromStringOrNil(id).String(),
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
		Online:       false, //TODO(mo/zyro): Fix this when this is wired in?
	}, nil
}

func fetchUserID(db *sql.DB, usernames []string) ([]string, error) {
	ids := make([]string, 0)
	if len(usernames) == 0 {
		return ids, nil
	}

	statements := make([]string, 0)
	params := make([]interface{}, 0)
	counter := 1
	for _, username := range usernames {
		params = append(params, username)
		statement := "$" + strconv.Itoa(counter)
		statements = append(statements, statement)
		counter++
	}

	query := "SELECT id FROM users WHERE username IN ("+ strings.Join(statements, ", ") + ")"
	rows, err := db.Query(query, params...)
	if err != nil {
		return nil, err
	}

	for rows.Next() {
		var id string
		err := rows.Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}

	return ids, nil
}
