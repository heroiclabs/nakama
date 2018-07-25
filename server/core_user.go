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

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
)

func GetUsers(logger *zap.Logger, db *sql.DB, tracker Tracker, ids, usernames, fbIDs []string) (*api.Users, error) {
	query := `
SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata,
	facebook_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time
FROM users
WHERE`

	idStatements := make([]string, 0, len(ids))
	usernameStatements := make([]string, 0, len(usernames))
	facebookStatements := make([]string, 0, len(fbIDs))
	params := make([]interface{}, 0)
	counter := 1
	useSqlOr := false

	if len(ids) > 0 {
		for _, id := range ids {
			params = append(params, id)
			statement := "$" + strconv.Itoa(counter)
			idStatements = append(idStatements, statement)
			counter++
		}
		query = query + " id IN (" + strings.Join(idStatements, ", ") + ")"
		useSqlOr = true
	}

	if len(usernames) > 0 {
		for _, username := range usernames {
			params = append(params, username)
			statement := "$" + strconv.Itoa(counter)
			usernameStatements = append(usernameStatements, statement)
			counter++
		}
		if useSqlOr {
			query = query + " OR"
		}
		query = query + " username IN (" + strings.Join(usernameStatements, ", ") + ")"
		useSqlOr = true
	}

	if len(fbIDs) > 0 {
		for _, id := range fbIDs {
			params = append(params, id)
			statement := "$" + strconv.Itoa(counter)
			facebookStatements = append(facebookStatements, statement)
			counter++
		}
		if useSqlOr {
			query = query + " OR"
		}
		query = query + " facebook_id IN (" + strings.Join(facebookStatements, ", ") + ")"
	}

	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Strings("user_ids", ids), zap.Strings("usernames", usernames), zap.Strings("facebook_ids", fbIDs))
		return nil, err
	}
	defer rows.Close()

	users := &api.Users{Users: make([]*api.User, 0)}
	for rows.Next() {
		user, err := convertUser(tracker, rows)
		if err != nil {
			logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Strings("user_ids", ids), zap.Strings("usernames", usernames), zap.Strings("facebook_ids", fbIDs))
			return nil, err
		}
		users.Users = append(users.Users, user)
	}
	if err = rows.Err(); err != nil {
		logger.Error("Error retrieving user accounts.", zap.Error(err), zap.Strings("user_ids", ids), zap.Strings("usernames", usernames), zap.Strings("facebook_ids", fbIDs))
		return nil, err
	}

	return users, nil
}

func DeleteUser(tx *sql.Tx, userID uuid.UUID) (int64, error) {
	res, err := tx.Exec("DELETE FROM users WHERE id = $1", userID)
	if err != nil {
		return 0, err
	}

	return res.RowsAffected()
}

func BanUsers(logger *zap.Logger, db *sql.DB, ids []string) error {
	statements := make([]string, 0, len(ids))
	params := make([]interface{}, 0, len(ids))
	for i, id := range ids {
		statements = append(statements, "$"+strconv.Itoa(i+1))
		params = append(params, id)
	}

	query := "UPDATE users SET disable_time = now() WHERE id IN (" + strings.Join(statements, ", ") + ")"
	_, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Error banning user accounts.", zap.Error(err), zap.Strings("ids", ids))
		return err
	}
	return nil
}

func UnbanUsers(logger *zap.Logger, db *sql.DB, ids []string) error {
	statements := make([]string, 0, len(ids))
	params := make([]interface{}, 0, len(ids))
	for i, id := range ids {
		statements = append(statements, "$"+strconv.Itoa(i+1))
		params = append(params, id)
	}

	query := "UPDATE users SET disable_time = CAST(0 AS TIMESTAMPTZ) WHERE id IN (" + strings.Join(statements, ", ") + ")"
	_, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Error unbanning user accounts.", zap.Error(err), zap.Strings("ids", ids))
		return err
	}
	return nil
}

func UserExistsAndDoesNotBlock(db *sql.DB, checkUserID, blocksUserID uuid.UUID) (bool, error) {
	var count int
	err := db.QueryRow(`
SELECT COUNT(id) FROM users
WHERE id = $1::UUID AND NOT EXISTS (
	SELECT state FROM user_edge
	WHERE source_id = $1::UUID AND destination_id = $2::UUID AND state = 3
)
`, checkUserID, blocksUserID).Scan(&count)

	return count != 0, err
}

func convertUser(tracker Tracker, rows *sql.Rows) (*api.User, error) {
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
	var edge_count int
	var createTime pq.NullTime
	var updateTime pq.NullTime

	err := rows.Scan(&id, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata,
		&facebook, &google, &gamecenter, &steam, &edge_count, &createTime, &updateTime)
	if err != nil {
		return nil, err
	}

	userID := uuid.FromStringOrNil(id)
	return &api.User{
		Id:           userID.String(),
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
		EdgeCount:    int32(edge_count),
		CreateTime:   &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
		UpdateTime:   &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
		Online:       tracker.StreamExists(PresenceStream{Mode: StreamModeNotifications, Subject: userID}),
	}, nil
}

func fetchUserID(db *sql.DB, usernames []string) ([]string, error) {
	ids := make([]string, 0)
	if len(usernames) == 0 {
		return ids, nil
	}

	statements := make([]string, 0, len(usernames))
	params := make([]interface{}, 0, len(usernames))
	counter := 1
	for _, username := range usernames {
		params = append(params, username)
		statement := "$" + strconv.Itoa(counter)
		statements = append(statements, statement)
		counter++
	}

	query := "SELECT id FROM users WHERE username IN (" + strings.Join(statements, ", ") + ")"
	rows, err := db.Query(query, params...)
	if err != nil {
		if err == sql.ErrNoRows {
			return ids, nil
		}
		return nil, err
	}
	defer rows.Close()

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
