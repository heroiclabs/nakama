// Copyright 2017 The Nakama Authors
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

	"errors"
	"strconv"
	"strings"

	"go.uber.org/zap"
)

func querySocialGraph(logger *zap.Logger, db *sql.DB, filterQuery string, params []interface{}) ([]*User, error) {
	users := []*User{}

	query := `
SELECT id, handle, fullname, avatar_url,
	lang, location, timezone, metadata, 
    email, facebook_id, google_id, gamecenter_id, steam_id, custom_id,
	created_at, users.updated_at, verified_at, last_online_at
FROM users ` + filterQuery

	rows, err := db.Query(query, params...)
	if err != nil {
		logger.Error("Could not execute social graph query", zap.String("query", query), zap.Error(err))
		return nil, err
	}
	defer rows.Close()

	var id []byte
	var handle sql.NullString
	var fullname sql.NullString
	var avatarURL sql.NullString
	var lang sql.NullString
	var location sql.NullString
	var timezone sql.NullString
	var metadata []byte
	var email sql.NullString
	var facebook sql.NullString
	var google sql.NullString
	var gamecenter sql.NullString
	var steam sql.NullString
	var customID sql.NullString
    var verifiedAt sql.NullInt64
	var createdAt sql.NullInt64
	var updatedAt sql.NullInt64
	var lastOnlineAt sql.NullInt64
    
	for rows.Next() {
		err = rows.Scan(&id, &handle, &fullname, &avatarURL, &lang, &location, &timezone, &metadata, &email, &facebook, &google, &gamecenter, &steam, &customID, &createdAt, &updatedAt, &verifiedAt, &lastOnlineAt)
		if err != nil {
			logger.Error("Could not execute social graph query", zap.Error(err))
			return nil, err
		}

		users = append(users, &User{
			Id:           id,
			Handle:       handle.String,
			Fullname:     fullname.String,
			AvatarUrl:    avatarURL.String,
			Lang:         lang.String,
			Location:     location.String,
			Timezone:     timezone.String,
			Metadata:     metadata,
			CreatedAt:    createdAt.Int64,
			UpdatedAt:    updatedAt.Int64,
			LastOnlineAt: lastOnlineAt.Int64,
            Email:        email.String,
            FacebookId:   facebook.String,
            GoogleId:     google.String,
            GamecenterId: gamecenter.String,
            SteamId:      steam.String,
            CustomId:     customID.String,
            Verified:     verifiedAt.Int64 > 0,
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not execute social graph query", zap.Error(err))
		return nil, err
	}

	return users, nil
}

func UsersFetchIds(logger *zap.Logger, db *sql.DB, userIds [][]byte) ([]*User, error) {
	statements := make([]string, 0)
	params := make([]interface{}, 0)

	counter := 1
	for _, userID := range userIds {
		statement := "$" + strconv.Itoa(counter)
		counter += 1
		statements = append(statements, statement)
		params = append(params, userID)
	}

	if len(statements) == 0 {
		return nil, errors.New("No valid user IDs received")
	}

	query := "WHERE users.id IN (" + strings.Join(statements, ", ") + ")"
	users, err := querySocialGraph(logger, db, query, params)
	if err != nil {
		return nil, errors.New("Could not retrieve users")
	}

	return users, nil
}

func UsersFetchHandle(logger *zap.Logger, db *sql.DB, handles []string) ([]*User, error) {
	statements := make([]string, 0)
	params := make([]interface{}, 0)

	counter := 1
	for _, handle := range handles {
		statement := "$" + strconv.Itoa(counter)
		counter += 1
		statements = append(statements, statement)
		params = append(params, handle)
	}

	query := "WHERE users.handle IN (" + strings.Join(statements, ", ") + ")"
	users, err := querySocialGraph(logger, db, query, params)
	if err != nil {
		return nil, errors.New("Could not retrieve users")
	}

	return users, nil
}

func UsersFetchIdsHandles(logger *zap.Logger, db *sql.DB, userIds [][]byte, handles []string) ([]*User, error) {
	idStatements := make([]string, 0)
	handleStatements := make([]string, 0)
	params := make([]interface{}, 0)

	counter := 1
	for _, userID := range userIds {
		statement := "$" + strconv.Itoa(counter)
		counter += 1
		idStatements = append(idStatements, statement)
		params = append(params, userID)
	}
	for _, handle := range handles {
		statement := "$" + strconv.Itoa(counter)
		counter += 1
		handleStatements = append(handleStatements, statement)
		params = append(params, handle)
	}

	query := "WHERE "
	if len(userIds) > 0 {
		query += "users.id IN (" + strings.Join(idStatements, ", ") + ")"
	}

	if len(handles) > 0 {
		if len(userIds) > 0 {
			query += " OR "
		}
		query += "users.handle IN (" + strings.Join(handleStatements, ", ") + ")"
	}

	users, err := querySocialGraph(logger, db, query, params)
	if err != nil {
		return nil, errors.New("Could not retrieve users")
	}

	return users, nil
}

func UsersBan(logger *zap.Logger, db *sql.DB, userIds [][]byte, handles []string) error {
	idStatements := make([]string, 0)
	handleStatements := make([]string, 0)
	params := []interface{}{nowMs()} // $1

	counter := 2
	for _, userID := range userIds {
		statement := "$" + strconv.Itoa(counter)
		idStatements = append(idStatements, statement)
		params = append(params, userID)
		counter++
	}
	for _, handle := range handles {
		statement := "$" + strconv.Itoa(counter)
		handleStatements = append(handleStatements, statement)
		params = append(params, handle)
		counter++
	}

	query := "UPDATE users SET disabled_at = $1 WHERE "
	if len(userIds) > 0 {
		query += "users.id IN (" + strings.Join(idStatements, ", ") + ")"
	}

	if len(handles) > 0 {
		if len(userIds) > 0 {
			query += " OR "
		}
		query += "users.handle IN (" + strings.Join(handleStatements, ", ") + ")"
	}

	logger.Debug("ban user query", zap.String("query", query))
	_, err := db.Exec(query, params...)
	if err != nil {
		logger.Error("Failed to ban users", zap.Error(err))
	}

	return err
}
