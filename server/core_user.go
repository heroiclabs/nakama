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

	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func querySocialGraph(logger *zap.Logger, db *sql.DB, filterQuery string, params []interface{}) ([]*User, error) {
	users := []*User{}

	query := `
SELECT id, handle, fullname, avatar_url,
	lang, location, timezone, metadata,
	created_at, users.updated_at, last_online_at
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
	var createdAt sql.NullInt64
	var updatedAt sql.NullInt64
	var lastOnlineAt sql.NullInt64

	for rows.Next() {
		err = rows.Scan(&id, &handle, &fullname, &avatarURL, &lang, &location, &timezone, &metadata, &createdAt, &updatedAt, &lastOnlineAt)
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
		})
	}
	if err = rows.Err(); err != nil {
		logger.Error("Could not execute social graph query", zap.Error(err))
		return nil, err
	}

	return users, nil
}

func UsersFetch(logger *zap.Logger, db *sql.DB, userIds [][]byte) ([]*User, error) {
	statements := make([]string, 0)
	params := make([]interface{}, 0)

	counter := 1
	for _, uid := range userIds {
		userID, err := uuid.FromBytes(uid)
		if err == nil {
			statement := "$" + strconv.Itoa(counter)
			counter += 1
			statements = append(statements, statement)
			params = append(params, userID.Bytes())
		}
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
