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
	"bytes"
	"database/sql"
	"encoding/gob"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/lib/pq"
	"github.com/satori/go.uuid"
	"github.com/uber-go/zap"
)

type scanner interface {
	Scan(dest ...interface{}) error
}

type groupCursor struct {
	Primary   interface{}
	Secondary int64
	GroupID   []byte
}

func (p *pipeline) extractGroup(r scanner) (*Group, error) {
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
		return &Group{}, err
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

func (p *pipeline) groupCreate(logger zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupCreate()

	if g.Name == "" {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group name is mandatory."))
		return
	}

	var group *Group

	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not create group", zap.Error(err))
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Could not create group"))
		return
	}

	defer func() {
		if err != nil {
			logger.Error("Could not create group", zap.Error(err))
			if tx != nil {
				txErr := tx.Rollback()
				if txErr != nil {
					logger.Error("Could not rollback transaction", zap.Error(txErr))
				}
			}
			if strings.HasSuffix(err.Error(), "violates unique constraint \"groups_name_key\"") {
				session.Send(ErrorMessage(envelope.CollationId, GROUP_NAME_INUSE, "Name is in use"))
			} else {
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not create group"))
			}
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not create group"))
			} else {
				logger.Info("Created new group", zap.String("name", group.Name))
				session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Group{Group: &TGroup{Group: group}}})
			}
		}
	}()

	state := 0
	if g.Private {
		state = 1
	}

	columns := make([]string, 0)
	params := make([]string, 0)
	values := make([]interface{}, 5)

	updatedAt := nowMs()

	values[0] = uuid.NewV4().Bytes()
	values[1] = session.userID.Bytes()
	values[2] = g.Name
	values[3] = state
	values[4] = updatedAt

	if g.Description != "" {
		columns = append(columns, "description")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Description)
	}

	if g.AvatarUrl != "" {
		columns = append(columns, "avatar_url")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.AvatarUrl)
	}

	if g.Lang != "" {
		columns = append(columns, "lang")
		params = append(params, "$"+strconv.Itoa(len(values)+1))
		values = append(values, g.Lang)
	}

	if g.Metadata != nil {
		// Make this `var js interface{}` if we want to allow top-level JSON arrays.
		var maybeJSON map[string]interface{}
		if json.Unmarshal(g.Metadata, &maybeJSON) != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Metadata must be a valid JSON object"))
			return
		}

		columns = append(columns, "metadata")
		params = append(params, "$"+strconv.Itoa(len(values)))
		values = append(values, g.Metadata)
	}

	r := tx.QueryRow(`
INSERT INTO groups (id, creator_id, name, state, created_at, updated_at, `+strings.Join(columns, ", ")+")"+`
VALUES ($1, $2, $3, $4, $5, $5, `+strings.Join(params, ",")+")"+`
RETURNING id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, state, count, created_at, updated_at
`, values...)

	group, err = p.extractGroup(r)
	if err != nil {
		return
	}

	res, err := tx.Exec(`
INSERT INTO group_edge (source_id, position, updated_at, destination_id, state)
VALUES ($1, $2, $2, $3, 0), ($3, $2, $2, $1, 0)`,
		group.Id, updatedAt, session.userID.Bytes())

	if err != nil {
		return
	}

	rowAffected, err := res.RowsAffected()
	if err != nil {
		return
	}
	if rowAffected == 0 {
		err = errors.New("Could not insert into group_edge table")
		return
	}
}

func (p *pipeline) groupUpdate(l zap.Logger, session *session, envelope *Envelope) {
	//TODO notify members that group has been updated.
	g := envelope.GetGroupUpdate()
	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid."))
		return
	}

	// Make this `var js interface{}` if we want to allow top-level JSON arrays.
	var maybeJSON map[string]interface{}
	if len(g.Metadata) != 0 && json.Unmarshal(g.Metadata, &maybeJSON) != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Metadata must be a valid JSON object"))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()))

	statements := make([]string, 6)
	params := make([]interface{}, 8)

	params[0] = groupID.Bytes()
	params[1] = session.userID.Bytes()

	statements[0] = "updated_at = $3"
	params[2] = nowMs()

	statements[1] = "description = $4"
	params[3] = g.Description

	statements[2] = "avatar_url = $5"
	params[4] = g.AvatarUrl

	statements[3] = "lang = $6"
	params[5] = g.Lang

	statements[4] = "metadata = $7"
	params[6] = g.Metadata

	statements[5] = "state = $8"
	params[7] = 0
	if g.Private {
		params[7] = 1
	}

	if g.Name != "" {
		statements = append(statements, "name = $"+strconv.Itoa(len(statements)))
		params = append(params, g.Name)
	}

	_, err = p.db.Exec(`
UPDATE groups SET `+strings.Join(statements, ", ")+`
WHERE id = $1 AND
EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1 AND destination_id = $2 AND state = 0)`,
		params...)

	if err != nil {
		if strings.HasSuffix(err.Error(), "violates unique constraint \"groups_name_key\"") {
			session.Send(ErrorMessage(envelope.CollationId, GROUP_NAME_INUSE, "Name is in use"))
		} else {
			logger.Error("Could not update group", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not update group"))
		}
		return
	}

	logger.Info("Updated group")
	session.Send(&Envelope{CollationId: envelope.CollationId})
}

func (p *pipeline) groupRemove(l zap.Logger, session *session, envelope *Envelope) {
	//TODO kick all users out
	g := envelope.GetGroupRemove()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid."))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()))
	failureReason := "Failed to remove group"

	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not remove group", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
		return
	}
	defer func() {
		if err != nil {
			logger.Error("Could not remove group", zap.Error(err))
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
			} else {
				logger.Info("Removed group")
				session.Send(&Envelope{CollationId: envelope.CollationId})
			}
		}
	}()

	res, err := tx.Exec(`
DELETE FROM groups
WHERE
	id = $1
AND
	EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1 AND destination_id = $2 AND state = 0)
	`, groupID.Bytes(), session.userID.Bytes())

	if err != nil {
		return
	}

	rowAffected, err := res.RowsAffected()
	if err != nil {
		return
	}
	if rowAffected == 0 {
		err = errors.New("Could not remove group. User may not be group admin or group may not exist")
		failureReason = "Could not remove group. Make sure you are a group admin and group exists"
		return
	}

	_, err = tx.Exec("DELETE FROM group_edge WHERE source_id = $1 OR destination_id = $1", groupID.Bytes())
}

func (p *pipeline) groupsFetch(logger zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupsFetch()

	validGroupIds := make([]interface{}, 0)
	statements := make([]string, 0)

	for _, gid := range g.GroupIds {
		groupID, err := uuid.FromBytes(gid)
		if err != nil {
			logger.Warn("Could not get group")
		} else {
			validGroupIds = append(validGroupIds, groupID.Bytes())
			statements = append(statements, "id = $"+strconv.Itoa(len(validGroupIds)))
		}
	}

	rows, err := p.db.Query(
		`SELECT id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, state, count, created_at, updated_at
FROM groups WHERE disabled_at = 0 AND ( `+strings.Join(statements, " OR ")+" )",
		validGroupIds...)
	if err != nil {
		logger.Error("Could not get groups", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not get groups"))
		return
	}
	defer rows.Close()

	groups := make([]*Group, 0)
	for rows.Next() {
		group, err := p.extractGroup(rows)
		if err != nil {
			logger.Error("Could not get groups", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not get groups"))
			return
		}
		groups = append(groups, group)
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Groups{Groups: &TGroups{Groups: groups}}})
}

func (p *pipeline) groupsList(logger zap.Logger, session *session, envelope *Envelope) {
	incoming := envelope.GetGroupsList()
	params := make([]interface{}, 0)

	limit := incoming.PageLimit
	if limit == 0 {
		limit = 10
	} else if limit < 10 || limit > 100 {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Page limit must be between 10 and 100"))
		return
	}

	foundCursor := false
	paramNumber := 1
	if incoming.Cursor != nil {
		var c groupCursor
		if err := gob.NewDecoder(bytes.NewReader(incoming.Cursor)).Decode(&c); err != nil {
			session.Send(ErrorMessageBadInput(envelope.CollationId, "Invalid cursor data"))
			return
		}

		foundCursor = true
		params = append(params, c.Primary)
		params = append(params, c.Secondary)
		params = append(params, c.GroupID)
		paramNumber = len(params)
	}

	orderBy := "DESC"
	comparison := "<"
	if incoming.OrderByAsc {
		orderBy = "ASC"
		comparison = ">"
	}

	cursorQuery := ""
	filterQuery := ""
	if incoming.GetLang() != "" {
		if foundCursor {
			cursorQuery = "(lang, count, id) " + comparison + " ($1, $2, $3) AND"
		}
		filterQuery = "lang >= $" + strconv.Itoa(paramNumber) + " AND"
		params = append(params, incoming.GetLang())
	} else if incoming.GetCreatedAt() != 0 {
		if foundCursor {
			cursorQuery = "(created_at, count, id) " + comparison + " ($1, $2, $3) AND"
		}
		filterQuery = "created_at >= $" + strconv.Itoa(paramNumber) + " AND"
		params = append(params, incoming.GetCreatedAt())
	} else if incoming.GetCount() != 0 {
		if foundCursor {
			cursorQuery = "(count, updated_at, id) " + comparison + " ($1, $2, $3) AND"
		}
		filterQuery = "count <= $" + strconv.Itoa(paramNumber) + " AND"
		params = append(params, incoming.GetCount())
	}

	params = append(params, limit+1)
	query := `
SELECT id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, state, count, created_at, updated_at
FROM groups WHERE ` + cursorQuery + " " + filterQuery + " disabled_at = 0" + `
ORDER BY count ` + orderBy + " " + `
LIMIT $` + strconv.Itoa(len(params))

	rows, err := p.db.Query(query, params...)
	if err != nil {
		logger.Error("Could not list groups", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list groups"))
		return
	}
	defer rows.Close()

	groups := make([]*Group, 0)
	var cursor []byte
	var lastGroup *Group
	for rows.Next() {
		if int64(len(groups)) >= limit {
			cursorBuf := new(bytes.Buffer)
			newCursor := &groupCursor{GroupID: lastGroup.Id}
			if incoming.GetLang() != "" {
				newCursor.Primary = lastGroup.Lang
				newCursor.Secondary = lastGroup.Count
			} else if incoming.GetCreatedAt() != 0 {
				newCursor.Primary = lastGroup.CreatedAt
				newCursor.Secondary = lastGroup.Count
			} else {
				newCursor.Primary = lastGroup.Count
				newCursor.Secondary = lastGroup.UpdatedAt
			}
			if gob.NewEncoder(cursorBuf).Encode(newCursor); err != nil {
				logger.Error("Could not create group list cursor", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list groups"))
				return
			}
			cursor = cursorBuf.Bytes()
			break
		}
		lastGroup, err = p.extractGroup(rows)
		if err != nil {
			logger.Error("Could not list groups", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list groups"))
			return
		}
		groups = append(groups, lastGroup)
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Groups{Groups: &TGroups{
		Groups: groups,
		Cursor: cursor,
	}}})
}

func (p *pipeline) groupsSelfList(logger zap.Logger, session *session, envelope *Envelope) {
	envelope.GetGroupsSelfList()
	rows, err := p.db.Query(`
SELECT id, creator_id, name, description, avatar_url, lang, utc_offset_ms, metadata, groups.state, count, created_at, groups.updated_at
FROM groups
JOIN group_edge ON (group_edge.source_id = id)
WHERE group_edge.destination_id = $1 AND disabled_at = 0 AND (group_edge.state = 1 OR group_edge.state = 0)
`, session.userID.Bytes())

	if err != nil {
		logger.Error("Could not list joined groups", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list joined groups"))
		return
	}
	defer rows.Close()

	groups := make([]*Group, 0)
	var lastGroup *Group
	for rows.Next() {
		lastGroup, err = p.extractGroup(rows)
		if err != nil {
			logger.Error("Could not list joined groups", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not list joined groups"))
			return
		}
		groups = append(groups, lastGroup)
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_Groups{Groups: &TGroups{Groups: groups}}})
}

func (p *pipeline) groupUsersList(l zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupUsersList()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid"))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()))

	query := `
SELECT u.id, u.handle, u.fullname, u.avatar_url,
	u.lang, u.location, u.timezone, u.metadata,
	u.created_at, u.updated_at, u.last_online_at, ge.state
FROM users u, group_edge ge
WHERE u.id = ge.source_id AND ge.destination_id = $1`
	rows, err := p.db.Query(query, groupID.Bytes())
	if err != nil {
		logger.Error("Could not get group users", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not get group users"))
		return
	}
	defer rows.Close()

	users := make([]*GroupUser, 0)

	for rows.Next() {
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
		var state sql.NullInt64

		err = rows.Scan(&id, &handle, &fullname, &avatarURL, &lang, &location, &timezone, &metadata, &createdAt, &updatedAt, &lastOnlineAt, &state)
		if err != nil {
			logger.Error("Could not get group users", zap.Error(err))
			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not get group users"))
			return
		}

		users = append(users, &GroupUser{
			User: &User{
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
			},
			Type: state.Int64,
		})
	}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: &Envelope_GroupUsers{GroupUsers: &TGroupUsers{Users: users}}})
}

func (p *pipeline) groupJoin(l zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupJoin()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid."))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()))

	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not add user to group", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not add user to group"))
		return
	}
	defer func() {
		if err != nil {
			logger.Error("Could not join group", zap.Error(err))
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}

			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not join group"))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not join group"))
			} else {
				logger.Info("User joined group")
				session.Send(&Envelope{CollationId: envelope.CollationId})

				err = p.storeAndDeliverMessage(logger, session, &TopicId{Id: &TopicId_GroupId{GroupId: groupID.Bytes()}}, 1, []byte("{}"))
				if err != nil {
					logger.Error("Error handling group user join notification topic message", zap.Error(err))
				}
			}
		}
	}()

	var groupState sql.NullInt64
	err = tx.QueryRow("SELECT state FROM groups WHERE id = $1 AND disabled_at = 0", groupID.Bytes()).Scan(&groupState)
	if err != nil {
		return
	}

	userState := 1
	if groupState.Int64 == 1 {
		userState = 2
	}

	updatedAt := nowMs()

	res, err := tx.Exec(`
INSERT INTO group_edge (source_id, position, updated_at, destination_id, state)
VALUES ($1, $2, $2, $3, $4), ($3, $2, $2, $1, $4)`,
		groupID.Bytes(), updatedAt, session.userID.Bytes(), userState)

	if err != nil {
		return
	}

	if affectedRows, _ := res.RowsAffected(); affectedRows == 0 {
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not accept group join envelope. Group may not exists with the given ID"))
		return
	}

	if groupState.Int64 == 0 {
		_, err = tx.Exec("UPDATE groups SET count = count + 1, updated_at = $2 WHERE id = $1", groupID.Bytes(), updatedAt)
	}
	if err != nil {
		return
	}
}

func (p *pipeline) groupLeave(l zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupLeave()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid"))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()))

	failureReason := "Could not leave group"
	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not leave group", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
		return
	}
	defer func() {
		if err != nil {
			logger.Error("Could not leave group", zap.Error(err))
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}

			session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
			} else {
				logger.Info("User left group")
				session.Send(&Envelope{CollationId: envelope.CollationId})

				err = p.storeAndDeliverMessage(logger, session, &TopicId{Id: &TopicId_GroupId{GroupId: groupID.Bytes()}}, 3, []byte("{}"))
				if err != nil {
					logger.Error("Error handling group user leave notification topic message", zap.Error(err))
				}
			}
		}
	}()

	// first remove any invitation from user
	// and if this wasn't an invitation then
	// look to see if the user is an admin
	// and remove the user from group and update group count
	res, err := tx.Exec(`
DELETE FROM group_edge
WHERE
	(source_id = $1 AND destination_id = $2 AND state = 2)
OR
	(source_id = $2 AND destination_id = $1 AND state = 2)`,
		groupID.Bytes(), session.userID.Bytes())

	if err != nil {
		return
	}

	if count, _ := res.RowsAffected(); count > 0 {
		logger.Info("Group invitation removed.")
		return
	}

	var adminCount sql.NullInt64
	err = tx.QueryRow(`
SELECT COUNT(source_id)	FROM group_edge
WHERE
	source_id = $1 AND state = 0
AND
	EXISTS (SELECT id FROM groups WHERE id = $1 AND disabled_at = 0)
AND
	EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1 AND destination_id = $2 AND state = 0)`,
		groupID.Bytes(), session.userID.Bytes()).Scan(&adminCount)

	if err != nil {
		return
	}

	if adminCount.Int64 == 1 {
		failureReason = "Cannot leave group when you are the last group admin"
		err = errors.New("Cannot leave group when you are the last group admin")
		return
	}

	res, err = tx.Exec(`
DELETE FROM group_edge
WHERE
	(source_id = $1 AND destination_id = $2)
OR
	(source_id = $2 AND destination_id = $1)`,
		groupID.Bytes(), session.userID.Bytes())

	if err != nil {
		return
	}

	if count, _ := res.RowsAffected(); count == 0 {
		failureReason = "Cannot leave group - Make sure you are part of the group or group exists"
		err = errors.New("Cannot leave group - Make sure you are part of the group or group exists")
		return
	}

	_, err = tx.Exec(`UPDATE groups SET count = count - 1, updated_at = $1 WHERE id = $2`, nowMs(), groupID.Bytes())
	if err != nil {
		return
	}
}

func (p *pipeline) groupUserAdd(l zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupUserAdd()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid"))
		return
	}

	userID, err := uuid.FromBytes(g.UserId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "User ID is not valid"))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	var handle string

	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not add user to group", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not add user to group"))
		return
	}
	defer func() {
		if err != nil {
			if _, ok := err.(*pq.Error); ok {
				logger.Error("Could not add user to group", zap.Error(err))
			} else {
				logger.Warn("Could not add user to group", zap.Error(err))
			}
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}

			session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not add user to group"))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not add user to group"))
			} else {
				logger.Info("Added user to the group")
				session.Send(&Envelope{CollationId: envelope.CollationId})

				data, _ := json.Marshal(map[string]string{"user_id": userID.String(), "handle": handle})
				err = p.storeAndDeliverMessage(logger, session, &TopicId{Id: &TopicId_GroupId{GroupId: groupID.Bytes()}}, 2, data)
				if err != nil {
					logger.Error("Error handling group user added notification topic message", zap.Error(err))
				}
			}
		}
	}()

	// Look up the user being added.
	err = tx.QueryRow("SELECT handle FROM users WHERE id = $1 AND disabled_at = 0", userID.Bytes()).Scan(&handle)
	if err != nil {
		return
	}

	res, err := tx.Exec(`
INSERT INTO group_edge (source_id, position, updated_at, destination_id, state)
SELECT data.id, data.position, data.updated_at, data.destination, data.state
FROM (
  SELECT $1::BYTEA AS id, $2::INT AS position, $2::INT AS updated_at, $3::BYTEA AS destination, 1 AS state
  UNION ALL
  SELECT $3::BYTEA AS id, $2::INT AS position, $2::INT AS updated_at, $1::BYTEA AS destination, 1 AS state
) AS data
WHERE
  EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1::BYTEA AND destination_id = $4::BYTEA AND state = 0)
AND
  EXISTS (SELECT id FROM groups WHERE id = $1::BYTEA AND disabled_at = 0)
ON CONFLICT (source_id, destination_id)
DO UPDATE SET state = 1, updated_at = $2::INT`,
		groupID.Bytes(), nowMs(), userID.Bytes(), session.userID.Bytes())

	if err != nil {
		return
	}

	if affectedRows, _ := res.RowsAffected(); affectedRows == 0 {
		err = errors.New("Could not add user to group. Group may not exists or you may not be group admin")
		return
	}

	_, err = tx.Exec(`UPDATE groups SET count = count + 1, updated_at = $1 WHERE id = $2`, nowMs(), groupID.Bytes())
	if err != nil {
		return
	}
}

func (p *pipeline) groupUserKick(l zap.Logger, session *session, envelope *Envelope) {
	// TODO Force kick the user out.
	g := envelope.GetGroupUserKick()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid"))
		return
	}

	userID, err := uuid.FromBytes(g.UserId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "User ID is not valid"))
		return
	}

	if userID == session.userID {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "You can't kick yourself from the group"))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	var handle string

	failureReason := "Could not kick user from group"
	tx, err := p.db.Begin()
	if err != nil {
		logger.Error("Could not kick user from group", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
		return
	}
	defer func() {
		if err != nil {
			if _, ok := err.(*pq.Error); ok {
				logger.Error("Could not kick user from group", zap.Error(err))
			} else {
				logger.Warn("Could not kick user from group", zap.Error(err))
			}
			err = tx.Rollback()
			if err != nil {
				logger.Error("Could not rollback transaction", zap.Error(err))
			}

			session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
		} else {
			err = tx.Commit()
			if err != nil {
				logger.Error("Could not commit transaction", zap.Error(err))
				session.Send(ErrorMessageRuntimeException(envelope.CollationId, failureReason))
			} else {
				logger.Info("Kicked user from group")
				session.Send(&Envelope{CollationId: envelope.CollationId})

				data, _ := json.Marshal(map[string]string{"user_id": userID.String(), "handle": handle})
				err = p.storeAndDeliverMessage(logger, session, &TopicId{Id: &TopicId_GroupId{GroupId: groupID.Bytes()}}, 4, data)
				if err != nil {
					logger.Error("Error handling group user kicked notification topic message", zap.Error(err))
				}
			}
		}
	}()

	res, err := tx.Exec(`
DELETE FROM group_edge
WHERE
	EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1 AND destination_id = $3 AND state = 0)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1 AND disabled_at = 0)
AND
	(
		(source_id = $1 AND destination_id = $2)
	OR
		(source_id = $2 AND destination_id = $1)
	)`, groupID.Bytes(), userID.Bytes(), session.userID.Bytes())

	if err != nil {
		return
	}

	if count, _ := res.RowsAffected(); count == 0 {
		failureReason = "Cannot kick from group - Make sure user is part of the group and is admin or group exists"
		err = errors.New("Cannot kick from group - Make sure user is part of the group and is admin or group exists")
		return
	}

	_, err = tx.Exec(`UPDATE groups SET count = count - 1, updated_at = $1 WHERE id = $2`, nowMs(), groupID.Bytes())
	if err != nil {
		return
	}

	// Look up the user being kicked. Allow kicking disabled users.
	err = tx.QueryRow("SELECT handle FROM users WHERE id = $1", userID.Bytes()).Scan(&handle)
	if err != nil {
		return
	}
}

func (p *pipeline) groupUserPromote(l zap.Logger, session *session, envelope *Envelope) {
	g := envelope.GetGroupUserPromote()

	groupID, err := uuid.FromBytes(g.GroupId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "Group ID is not valid"))
		return
	}

	userID, err := uuid.FromBytes(g.UserId)
	if err != nil {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "User ID is not valid"))
		return
	}

	if userID == session.userID {
		session.Send(ErrorMessageBadInput(envelope.CollationId, "You can't promote yourself"))
		return
	}

	logger := l.With(zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))

	res, err := p.db.Exec(`
UPDATE group_edge SET state = 0, updated_at = $4
WHERE
	EXISTS (SELECT source_id FROM group_edge WHERE source_id = $1 AND destination_id = $3 AND state = 0)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1 AND disabled_at = 0)
AND
	(
		(source_id = $1 AND destination_id = $2)
	OR
		(source_id = $2 AND destination_id = $1)
	)`, groupID.Bytes(), userID.Bytes(), session.userID.Bytes(), nowMs())

	if err != nil {
		logger.Warn("Could not promote user", zap.Error(err))
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not promote user"))
		return
	}

	if count, _ := res.RowsAffected(); count == 0 {
		logger.Warn("Could not promote user - Make sure user is part of the group or group exists")
		session.Send(ErrorMessageRuntimeException(envelope.CollationId, "Could not promote user - Make sure user is part of the group or group exists"))
		return
	}

	// Look up the user being promoted. Allow promoting disabled users as long as they're still part of the group.
	var handle string
	err = p.db.QueryRow("SELECT handle FROM users WHERE id = $1", userID.Bytes()).Scan(&handle)
	if err != nil {
		return
	}

	data, _ := json.Marshal(map[string]string{"user_id": userID.String(), "handle": handle})
	err = p.storeAndDeliverMessage(logger, session, &TopicId{Id: &TopicId_GroupId{GroupId: groupID.Bytes()}}, 5, data)
	if err != nil {
		logger.Error("Error handling group user promoted notification topic message", zap.Error(err))
	}

	session.Send(&Envelope{CollationId: envelope.CollationId})
}
