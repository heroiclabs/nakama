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

	"fmt"
	"go.uber.org/zap"
)

type GroupCreateParam struct {
	Name        string // mandatory
	Creator     string // mandatory
	Description string
	AvatarURL   string
	Lang        string
	Metadata    []byte
	Private     bool
}

func extractGroup(r scanner) (*Group, error) {
	var id sql.NullString
	var creatorID sql.NullString
	var name sql.NullString
	var description sql.NullString
	var avatarURL sql.NullString
	var lang sql.NullString
	var utcOffsetMs sql.NullInt64
	var metadata []byte
	var state sql.NullInt64
	var count sql.NullInt64
	var createdAt sql.NullInt64
	var updatedAt sql.NullInt64

	err := r.Scan(&id, &creatorID, &name,
		&description, &avatarURL, &lang,
		&utcOffsetMs, &metadata, &state,
		&count, &createdAt, &updatedAt)

	if err != nil {
		return nil, err
	}

	desc := ""
	if description.Valid {
		desc = description.String
	}

	avatar := ""
	if avatarURL.Valid {
		avatar = avatarURL.String
	}

	private := state.Int64 == 1

	return &Group{
		Id:          id.String,
		CreatorId:   creatorID.String,
		Name:        name.String,
		Description: desc,
		AvatarUrl:   avatar,
		Lang:        lang.String,
		UtcOffsetMs: utcOffsetMs.Int64,
		Metadata:    string(metadata),
		Private:     private,
		Count:       count.Int64,
		CreatedAt:   createdAt.Int64,
		UpdatedAt:   updatedAt.Int64,
	}, nil
}

func GroupsCreate(logger *zap.Logger, db *sql.DB, groupCreateParams []*GroupCreateParam) ([]*Group, error) {
	if groupCreateParams == nil || len(groupCreateParams) == 0 {
		return nil, errors.New("Could not create groups. At least one group param must be supplied")
	}

	groups := make([]*Group, 0)
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not create groups", zap.Error(err))
		return nil, err
	}

	defer func() {
		if err != nil {
			logger.Error("Could not create groups", zap.Error(err))
			if tx != nil {
				txErr := tx.Rollback()
				if txErr != nil {
					logger.Error("Could not rollback transaction", zap.Error(txErr))
				}
			}
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
			} else {
				groupNames := make([]string, 0)
				for _, p := range groups {
					groupNames = append(groupNames, p.Name)
				}
				logger.Debug("Created new groups", zap.Strings("names", groupNames))
			}
		}
	}()

	for _, g := range groupCreateParams {
		newGroup, err := groupCreate(tx, g)
		if err != nil {
			logger.Warn("Could not create group", zap.String("name", g.Name), zap.Error(err))
			return nil, err
		}

		groups = append(groups, newGroup)
	}

	return groups, err
}

func groupCreate(tx *sql.Tx, g *GroupCreateParam) (*Group, error) {
	if g.Name == "" {
		return nil, errors.New("Group name must not be empty")
	}
	if g.Creator == "" {
		return nil, errors.New("Group creator must be set")
	}

	state := 0
	if g.Private {
		state = 1
	}

	columns := make([]string, 0)
	params := make([]string, 0)
	updatedAt := nowMs()
	values := []interface{}{
		generateNewId(),
		g.Creator,
		g.Name,
		state,
		updatedAt,
	}

	if g.Description != "" {
		columns = append(columns, "description")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Description)
	}

	if g.AvatarURL != "" {
		columns = append(columns, "avatar_url")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.AvatarURL)
	}

	if g.Lang != "" {
		columns = append(columns, "lang")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Lang)
	}

	if g.Metadata != nil {
		columns = append(columns, "metadata")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Metadata)
	}

	query := "INSERT INTO groups (id, creator_id, name, state, count, created_at, updated_at"
	if len(columns) != 0 {
		query += ", " + strings.Join(columns, ", ")
	}
	query += ") VALUES ($1, $2, $3, $4, 1, $5, $5"
	if len(params) != 0 {
		query += ", " + strings.Join(params, ",")
	}
	query += ") RETURNING id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, state, count, created_at, updated_at"

	r := tx.QueryRow(query, values...)

	group, err := extractGroup(r)
	if err != nil {
		return nil, err
	}

	res, err := tx.Exec(`
INSERT INTO group_edge (source_id, position, updated_at, destination_id, state)
VALUES ($1, $2, $2, $3, 0), ($3, $2, $2, $1, 0)`,
		group.Id, updatedAt, g.Creator)

	if err != nil {
		return nil, err
	}

	rowAffected, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rowAffected == 0 {
		err = errors.New("Could not insert into group_edge table")
		return nil, err
	}

	return group, nil
}

func GroupsUpdate(logger *zap.Logger, db *sql.DB, caller string, updates []*TGroupsUpdate_GroupUpdate) (Error_Code, error) {
	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not update groups, begin error", zap.Error(err))
		return RUNTIME_EXCEPTION, errors.New("Could not update groups")
	}

	code := RUNTIME_EXCEPTION
	defer func() {
		if err != nil {
			logger.Error("Could not update groups", zap.Error(err))
			if tx != nil {
				if e := tx.Rollback(); e != nil {
					logger.Error("Could not update groups, rollback error", zap.Error(e))
				}
			}
		} else {
			if e := tx.Commit(); e != nil {
				logger.Error("Could not update groups, commit error", zap.Error(e))
				err = errors.New("Could not update groups")
			}
		}
	}()

	for _, g := range updates {
		// TODO notify members that group has been updated.
		if g.GroupId == "" {
			code = BAD_INPUT
			err = errors.New("Group ID is not valid.")
			return code, err
		}

		groupLogger := logger.With(zap.String("group_id", g.GroupId))

		statements := make([]string, 5)
		params := make([]interface{}, 6)

		params[0] = g.GroupId

		statements[0] = "updated_at = $2"
		params[1] = nowMs()

		statements[1] = "description = $3"
		params[2] = g.Description

		statements[2] = "avatar_url = $4"
		params[3] = g.AvatarUrl

		statements[3] = "lang = $5"
		params[4] = g.Lang

		statements[4] = "state = $6"
		params[5] = 0
		if g.Private {
			params[5] = 1
		}

		if len(g.Metadata) != 0 {
			statements = append(statements, fmt.Sprintf("metadata = $%v", len(params)+1))
			params = append(params, []byte(g.Metadata))
		}

		if g.Name != "" {
			statements = append(statements, fmt.Sprintf("name = $%v", len(params)+1))
			params = append(params, g.Name)
		}

		query := "UPDATE groups SET " + strings.Join(statements, ", ") + " WHERE id = $1"

		// If the caller is not the script runtime, apply group membership and admin role checks.
		if caller != "" {
			params = append(params, caller)
			query += fmt.Sprintf(" AND EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1 AND destination_id = $%v AND state = 0)", len(params))
		}

		res, err := db.Exec(query, params...)
		if err != nil {
			if strings.HasSuffix(err.Error(), "violates unique constraint \"groups_name_key\"") {
				code = GROUP_NAME_INUSE
				err = fmt.Errorf("Name is in use: %v", g.Name)
			} else {
				groupLogger.Error("Could not update group, exec error", zap.Error(err))
				err = errors.New("Could not update group")
			}
			return code, err
		}
		if affectedRows, _ := res.RowsAffected(); affectedRows == 0 {
			code = BAD_INPUT
			err = errors.New("Could not accept group join envelope. Group may not exists with the given ID")
			return code, err
		}

		groupLogger.Debug("Updated group")
	}

	return code, err
}

func GroupsSelfList(logger *zap.Logger, db *sql.DB, caller string, userID string) ([]*TGroupsSelf_GroupSelf, Error_Code, error) {
	// Pipeline callers can only list their own groups.
	if caller != "" && caller != userID {
		return nil, BAD_INPUT, errors.New("Users can only list their own joined groups")
	}

	rows, err := db.Query(`
SELECT id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, groups.state, count, created_at, groups.updated_at, group_edge.state
FROM groups
JOIN group_edge ON (group_edge.source_id = id)
WHERE group_edge.destination_id = $1 AND disabled_at = 0 AND (group_edge.state = 1 OR group_edge.state = 0)
`, userID)

	if err != nil {
		logger.Error("Could not list joined groups, query error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not list joined groups")
	}
	defer rows.Close()

	groups := make([]*TGroupsSelf_GroupSelf, 0)
	for rows.Next() {
		var id sql.NullString
		var creatorID sql.NullString
		var name sql.NullString
		var description sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var utcOffsetMs sql.NullInt64
		var metadata []byte
		var state sql.NullInt64
		var count sql.NullInt64
		var createdAt sql.NullInt64
		var updatedAt sql.NullInt64
		var userState sql.NullInt64

		err := rows.Scan(&id, &creatorID, &name,
			&description, &avatarURL, &lang,
			&utcOffsetMs, &metadata, &state,
			&count, &createdAt, &updatedAt, &userState)

		if err != nil {
			logger.Error("Could not list joined groups, scan error", zap.Error(err))
			return nil, RUNTIME_EXCEPTION, errors.New("Could not list joined groups")
		}

		desc := ""
		if description.Valid {
			desc = description.String
		}

		avatar := ""
		if avatarURL.Valid {
			avatar = avatarURL.String
		}

		private := state.Int64 == 1

		groups = append(groups, &TGroupsSelf_GroupSelf{
			Group: &Group{
				Id:          id.String,
				CreatorId:   creatorID.String,
				Name:        name.String,
				Description: desc,
				AvatarUrl:   avatar,
				Lang:        lang.String,
				UtcOffsetMs: utcOffsetMs.Int64,
				Metadata:    string(metadata),
				Private:     private,
				Count:       count.Int64,
				CreatedAt:   createdAt.Int64,
				UpdatedAt:   updatedAt.Int64,
			},
			State: userState.Int64,
		})
	}

	return groups, 0, nil
}

func GroupUsersList(logger *zap.Logger, db *sql.DB, tracker Tracker, caller string, groupID string) ([]*GroupUser, Error_Code, error) {
	groupLogger := logger.With(zap.String("group_id", groupID))

	query := `
SELECT u.id, u.handle, u.fullname, u.avatar_url,
	u.lang, u.location, u.timezone, u.metadata,
	u.created_at, u.updated_at, ge.state
FROM users u, group_edge ge
WHERE u.id = ge.source_id AND ge.destination_id = $1`

	rows, err := db.Query(query, groupID)
	if err != nil {
		groupLogger.Error("Could not get group users, query error", zap.Error(err))
		return nil, RUNTIME_EXCEPTION, errors.New("Could not get group users")
	}
	defer rows.Close()

	// If the user is currently online this will be their 'last online at' value.
	ts := nowMs()
	users := make([]*GroupUser, 0)

	for rows.Next() {
		var id sql.NullString
		var handle sql.NullString
		var fullname sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var location sql.NullString
		var timezone sql.NullString
		var metadata []byte
		var createdAt sql.NullInt64
		var updatedAt sql.NullInt64
		var state sql.NullInt64

		err = rows.Scan(&id, &handle, &fullname, &avatarURL, &lang, &location, &timezone, &metadata, &createdAt, &updatedAt, &state)
		if err != nil {
			groupLogger.Error("Could not get group users, scan error", zap.Error(err))
			return nil, RUNTIME_EXCEPTION, errors.New("Could not get group users")
		}

		user := &User{
			Id:        id.String,
			Handle:    handle.String,
			Fullname:  fullname.String,
			AvatarUrl: avatarURL.String,
			Lang:      lang.String,
			Location:  location.String,
			Timezone:  timezone.String,
			Metadata:  string(metadata),
			CreatedAt: createdAt.Int64,
			UpdatedAt: updatedAt.Int64,
		}
		if len(tracker.ListByTopic("notifications:"+id.String)) != 0 {
			user.LastOnlineAt = ts
		}

		users = append(users, &GroupUser{
			User:  user,
			State: state.Int64,
		})
	}

	return users, 0, nil
}
