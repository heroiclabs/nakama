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

type GroupCreateParam struct {
	Name        string    // mandatory
	Creator     uuid.UUID // mandatory
	Description string
	AvatarURL   string
	Lang        string
	Metadata    []byte
	Private     bool
}

func extractGroup(r scanner) (*Group, error) {
	var id []byte
	var creatorID []byte
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
		Id:          id,
		CreatorId:   creatorID,
		Name:        name.String,
		Description: desc,
		AvatarUrl:   avatar,
		Lang:        lang.String,
		UtcOffsetMs: utcOffsetMs.Int64,
		Metadata:    metadata,
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
	if uuid.Equal(uuid.Nil, g.Creator) {
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
		uuid.NewV4().Bytes(),
		g.Creator.Bytes(),
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

	r := tx.QueryRow(`
INSERT INTO groups (id, creator_id, name, state, count, created_at, updated_at, `+strings.Join(columns, ", ")+")"+`
VALUES ($1, $2, $3, $4, 1, $5, $5, `+strings.Join(params, ",")+")"+`
RETURNING id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, state, count, created_at, updated_at
`, values...)

	group, err := extractGroup(r)
	if err != nil {
		return nil, err
	}

	res, err := tx.Exec(`
INSERT INTO group_edge (source_id, position, updated_at, destination_id, state)
VALUES ($1, $2, $2, $3, 0), ($3, $2, $2, $1, 0)`,
		group.Id, updatedAt, g.Creator.Bytes())

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
