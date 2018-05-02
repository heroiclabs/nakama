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
	"strconv"
	"strings"
	"time"

	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"github.com/pkg/errors"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
)

func CreateGroup(logger *zap.Logger, db *sql.DB, userID uuid.UUID, creatorID uuid.UUID, name, lang, desc, avatarURL, metadata string, open bool, maxCount int) (*api.Group, error) {
	if uuid.Equal(uuid.Nil, userID) {
		logger.Panic("This function must be used with non-system user ID.")
	}

	state := 1
	if open {
		state = 0
	}

	params := []interface{}{uuid.Must(uuid.NewV4()), creatorID, name, desc, avatarURL, state}
	query := `
INSERT INTO groups
	(id, creator_id, name, description, avatar_url, state, edge_count)
VALUES
	($1, $2, $3, $4, $5, $6, 1)
RETURNING id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time`
	if lang != "" {
		params = append(params, lang)
		query = `
INSERT INTO groups
	(id, creator_id, name, description, avatar_url, state, edge_count, lang_tag)
VALUES
	($1, $2, $3, $4, $5, $6, 1, $7)
RETURNING id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time`
	}

	// called from the client
	if maxCount > 0 && metadata != "" {
		params = append(params, maxCount, metadata) //no need to add 'lang' again

		if lang != "" {
			query = `
INSERT INTO groups
	(id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata)
VALUES
	($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)
RETURNING id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time`
		} else {
			query = `
INSERT INTO groups
	(id, creator_id, name, description, avatar_url, state, edge_count, max_count, metadata)
VALUES
	($1, $2, $3, $4, $5, $6, 1, $7, $8)
RETURNING id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time`
		}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, err
	}

	var group *api.Group
	duplicateGroup := false
	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		rows, err := tx.Query(query, params...)
		if err != nil {
			logger.Debug("Could not create group.", zap.Error(err))
			return err
		}

		groups, err := groupConvertRows(rows)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
				logger.Info("Could not create group as it already exists.", zap.String("name", name))
				duplicateGroup = true
				return nil
			}
			logger.Debug("Could not parse rows.", zap.Error(err))
			return err
		}

		group = groups[0]
		_, err = groupAddUser(db, tx, uuid.Must(uuid.FromString(group.Id)), userID, 0)
		if err != nil {
			logger.Debug("Could not add user to group.", zap.Error(err))
			return err
		}

		return nil
	}); err != nil {
		if duplicateGroup {
			return nil, nil
		}
		logger.Error("Error creating group.", zap.Error(err))
		return nil, err
	}

	return group, nil
}

func UpdateGroup(logger *zap.Logger, db *sql.DB, groupID uuid.UUID, userID uuid.UUID, creatorID []byte, name, lang, desc, avatar, metadata *wrappers.StringValue, open *wrappers.BoolValue, maxCount int) (bool, error) {
	if !uuid.Equal(uuid.Nil, userID) {
		allowedUser, err := groupCheckUserPermission(logger, db, groupID, userID, 1)
		if err != nil {
			return false, err
		}

		if !allowedUser {
			logger.Info("User does not have permission to update group.", zap.String("group", groupID.String()), zap.String("user", userID.String()))
			return false, nil
		}
	}

	statements := make([]string, 0)
	params := []interface{}{groupID}
	index := 2

	if name != nil {
		statements = append(statements, "name = $"+strconv.Itoa(index))
		params = append(params, name.GetValue())
		index++
	}

	if lang != nil {
		statements = append(statements, "lang = $"+strconv.Itoa(index))
		params = append(params, lang.GetValue())
		index++
	}

	if desc != nil {
		if u := desc.GetValue(); u == "" {
			statements = append(statements, "description = NULL")
		} else {
			statements = append(statements, "description = $"+strconv.Itoa(index))
			params = append(params, u)
			index++
		}
	}

	if avatar != nil {
		if u := avatar.GetValue(); u == "" {
			statements = append(statements, "avatar_url = NULL")
		} else {
			statements = append(statements, "avatar_url = $"+strconv.Itoa(index))
			params = append(params, u)
			index++
		}
	}

	if open != nil {
		state := 0
		if !open.GetValue() {
			state = 1
		}
		statements = append(statements, "state = $"+strconv.Itoa(index))
		params = append(params, state)
		index++
	}

	if metadata != nil {
		statements = append(statements, "metadata = $"+strconv.Itoa(index))
		params = append(params, metadata.GetValue())
		index++
	}

	if maxCount >= 1 {
		statements = append(statements, "max_count = $"+strconv.Itoa(index))
		params = append(params, maxCount)
		index++
	}

	if creatorID != nil {
		statements = append(statements, "creator_id = $"+strconv.Itoa(index)+"::UUID")
		params = append(params, creatorID)
		index++
	}

	if len(statements) == 0 {
		logger.Info("Did not update group as no fields were changed.")
		return false, nil
	}

	query := "UPDATE groups SET update_time = now(), " + strings.Join(statements, ", ") + " WHERE id = $1"
	res, err := db.Exec(query, params...)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			logger.Info("Could not update group as it already exists.", zap.String("group_id", groupID.String()))
			return false, nil
		}
		logger.Error("Could not update group.", zap.Error(err))
		return false, err
	}

	if rowsAffected, err := res.RowsAffected(); err != nil {
		logger.Error("Could not get rows affected after group update query.", zap.Error(err))
		return false, err
	} else {
		if rowsAffected == 0 {
			return false, nil
		}

		return true, nil
	}
}

func DeleteGroup(logger *zap.Logger, db *sql.DB, groupID uuid.UUID, userID uuid.UUID) (bool, error) {
	if !uuid.Equal(uuid.Nil, userID) {
		// only super-admins can delete group.
		allowedUser, err := groupCheckUserPermission(logger, db, groupID, userID, 0)
		if err != nil {
			return false, err
		}

		if !allowedUser {
			logger.Info("User does not have permission to delete group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return false, nil
		}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return false, err
	}

	deletedGroup := true
	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		query := "DELETE FROM groups WHERE id = $1::UUID"
		res, err := tx.Exec(query, groupID)
		if err != nil {
			logger.Debug("Could not delete group.", zap.Error(err))
			return err
		}

		if rowsAffected, err := res.RowsAffected(); err != nil {
			logger.Debug("Could not count deleted groups.", zap.Error(err))
			return err
		} else if rowsAffected == 0 {
			logger.Info("Did not delete group as group with given ID does not exist.", zap.Error(err), zap.String("group_id", groupID.String()))
			deletedGroup = false
			return nil
		}

		query = "DELETE FROM group_edge WHERE source_id = $1::UUID OR destination_id = $1::UUID"
		if _, err = tx.Exec(query, groupID); err != nil {
			logger.Debug("Could not delete group_edge relationships.", zap.Error(err))
			return err
		}

		return nil
	}); err != nil {
		logger.Error("Error deleting group.", zap.Error(err))
		return false, err
	}

	return deletedGroup, nil
}

func JoinGroup(logger *zap.Logger, db *sql.DB, groupID uuid.UUID, userID uuid.UUID) (bool, error) {
	query := `
SELECT id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time
FROM groups 
WHERE id = $1`
	rows, err := db.Query(query, groupID)
	if err != nil {
		if err == sql.ErrNoRows {
			logger.Info("Group does not exist.", zap.Error(err), zap.String("group_id", groupID.String()))
			return false, nil
		}
		logger.Error("Could not look up group while trying to join it.", zap.Error(err))
		return false, err
	}

	groups, err := groupConvertRows(rows)
	if err != nil {
		logger.Error("Could not parse groups.", zap.Error(err))
		return false, err
	}

	group := groups[0]
	if group.EdgeCount >= group.MaxCount {
		logger.Info("Group maximum count has reached.", zap.Error(err), zap.String("group_id", groupID.String()))
		return false, nil
	}

	state := 2
	if !group.Open.Value {
		state = 3
		_, err = groupAddUser(db, nil, uuid.Must(uuid.FromString(group.Id)), userID, state)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
				logger.Info("Could not add user to group as relationship already exists.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return true, nil // completed successfully
			}

			logger.Error("Could not add user to group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return false, err
		}

		logger.Info("Added join request to group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
		return true, nil
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return false, err
	}

	if err = crdb.ExecuteInTx(context.Background(), tx, func() error {
		_, err = groupAddUser(db, tx, uuid.Must(uuid.FromString(group.Id)), userID, state)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
				logger.Info("Could not add user to group as relationship already exists.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return nil // completed successfully
			}

			logger.Debug("Could not add user to group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		query = "UPDATE groups SET edge_count = edge_count + 1, update_time = now() WHERE id = $1::UUID AND edge_count+1 <= max_count"
		_, err := tx.Exec(query, groupID)
		if err != nil {
			logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return err
		}

		return nil
	}); err != nil {
		logger.Error("Error joining group.", zap.Error(err))
		return false, err
	}

	logger.Info("Successfully joined group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	return true, nil
}

func LeaveGroup(logger *zap.Logger, db *sql.DB, groupID uuid.UUID, userID uuid.UUID) (bool, error) {
	var myState sql.NullInt64
	query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
	if err := db.QueryRow(query, groupID, userID).Scan(&myState); err != nil {
		if err == sql.ErrNoRows {
			logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return true, nil //completed successfully
		}
		logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
		return false, err
	}

	if myState.Int64 == 0 {
		// check for other superadmins
		var otherSuperadminCount sql.NullInt64
		query := "SELECT COUNT(destination_id) FROM group_edge WHERE source_id = $1::UUID AND destination_id != $2::UUID AND state = 0"
		if err := db.QueryRow(query, groupID, userID).Scan(&otherSuperadminCount); err != nil {
			logger.Error("Could not look up superadmin count group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return false, err
		}

		if otherSuperadminCount.Int64 == 0 {
			logger.Info("Cannot leave group as user is last superadmin.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
			return false, nil
		}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return false, err
	}

	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		query = "DELETE FROM group_edge WHERE (source_id = $1::UUID AND destination_id = $2::UUID) OR (source_id = $2::UUID AND destination_id = $1::UUID)"
		// don't need to check affectedRows as we've confirmed the existence of the relationship above
		if _, err = tx.Exec(query, groupID, userID); err != nil {
			logger.Debug("Could not delete group_edge relationships.", zap.Error(err))
			return err
		}

		// check to ensure we are not decrementing the count when the relationship was an invite.
		if myState.Int64 < 3 {
			query = "UPDATE groups SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID"
			_, err = tx.Exec(query, groupID)
			if err != nil {
				logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
				return err
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error leaving group.", zap.Error(err))
		return false, err
	}

	logger.Info("Successfully left group.", zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
	return true, nil
}

func AddGroupUsers(logger *zap.Logger, db *sql.DB, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) (bool, error) {
	if !uuid.Equal(uuid.Nil, caller) {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRow(query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return false, nil
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return false, err
		}

		if dbState.Int64 > 1 {
			logger.Info("Cannot add users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int64("state", dbState.Int64))
			return false, nil
		}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return false, err
	}

	maxCountReached := false
	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		for _, uid := range userIDs {
			if uuid.Equal(caller, uid) {
				continue
			}

			incrementEdgeCount := true
			var userExists sql.NullBool
			query := "SELECT EXISTS(SELECT 1 FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID)"
			if err := tx.QueryRow(query, groupID, uid).Scan(&userExists); err != nil {
				logger.Debug("Could not retrieve user state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			if !userExists.Bool {
				if _, err = groupAddUser(db, tx, groupID, uid, 2); err != nil {
					logger.Debug("Could not add user to group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
			} else {
				res, err := groupUpdateUserState(db, tx, groupID, uid, 3, 2)
				if err != nil {
					logger.Debug("Could not update user state in group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
				if res != 2 {
					incrementEdgeCount = false
				}
			}

			if incrementEdgeCount {
				query = "UPDATE groups SET edge_count = edge_count + 1, update_time = now() WHERE id = $1::UUID AND edge_count+1 <= max_count"
				res, err := tx.Exec(query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}

				if rowsAffected, err := res.RowsAffected(); err != nil {
					logger.Debug("Could not update group edge_count.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				} else if rowsAffected == 0 {
					logger.Info("Could not add users as group maximum count was reached.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					maxCountReached = true
					return errors.New("Could not add users as group maximum count was reached.")
				}
			}
		}
		return nil
	}); err != nil {
		if !maxCountReached {
			logger.Error("Error adding users to group.", zap.Error(err))
			return false, err
		} else {
			return false, nil
		}
	}

	return true, err
}

func KickGroupUsers(logger *zap.Logger, db *sql.DB, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) error {
	myState := 0
	if !uuid.Equal(uuid.Nil, caller) {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRow(query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return err
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return err
		}

		myState = int(dbState.Int64)
		if myState > 1 {
			logger.Info("Cannot kick users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
			return errors.New("Cannot kick users as user does not have correct permissions.")
		}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return err
	}

	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		for _, uid := range userIDs {
			// shouldn't kick self
			if uuid.Equal(caller, uid) {
				continue
			}

			params := []interface{}{groupID, uid}
			query := ""
			if myState == 0 {
				// ensure we aren't removing the last superadmin when deleting authoritatively.
				// query is for superadmin or if done authoritatively
				query = `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID)
	)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1 AND disable_time::INT = 0)
AND
	NOT (
		(EXISTS (SELECT 1 FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID AND state = 0))
		AND 
		((SELECT COUNT(destination_id) FROM group_edge WHERE (source_id = $1::UUID AND destination_id != $2::UUID AND state = 0)) = 0)
	)
RETURNING state`
			} else {
				// query is just for admins
				query = `
DELETE FROM group_edge
WHERE
	(
		(source_id = $1::UUID AND destination_id = $2::UUID AND state > 1)
		OR
		(source_id = $2::UUID AND destination_id = $1::UUID AND state > 1)
	)
AND
	EXISTS (SELECT id FROM groups WHERE id = $1 AND disable_time::INT = 0)
RETURNING state`
			}

			var deletedState sql.NullInt64
			logger.Debug("Kick user from group query.", zap.String("query", query), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()), zap.String("caller", caller.String()), zap.Int("caller_state", myState))
			if err := tx.QueryRow(query, params...).Scan(&deletedState); err != nil {
				if err == sql.ErrNoRows {
					// ignore - move to the next uid
					continue
				} else {
					logger.Debug("Could not delete relationship from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
			}

			// make sure that we kicked valid members, not invites
			if deletedState.Int64 < 3 {
				query = "UPDATE groups SET edge_count = edge_count - 1, update_time = now() WHERE id = $1::UUID"
				_, err = tx.Exec(query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
					return err
				}
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error kicking users from group.", zap.Error(err))
		return err
	}

	return nil
}

func PromoteGroupUsers(logger *zap.Logger, db *sql.DB, caller uuid.UUID, groupID uuid.UUID, userIDs []uuid.UUID) (bool, error) {
	myState := 0
	if !uuid.Equal(uuid.Nil, caller) {
		var dbState sql.NullInt64
		query := "SELECT state FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID"
		if err := db.QueryRow(query, groupID, caller).Scan(&dbState); err != nil {
			if err == sql.ErrNoRows {
				logger.Info("Could not retrieve state as no group relationship exists.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
				return false, nil
			}
			logger.Error("Could not retrieve state from group_edge.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()))
			return false, err
		}

		myState = int(dbState.Int64)
		if myState > 1 {
			logger.Info("Cannot promote users as user does not have correct permissions.", zap.String("group_id", groupID.String()), zap.String("user_id", caller.String()), zap.Int("state", myState))
			return false, nil
		}
	}

	tx, err := db.Begin()
	if err != nil {
		logger.Error("Could not begin database transaction.", zap.Error(err))
		return false, err
	}

	if err := crdb.ExecuteInTx(context.Background(), tx, func() error {
		for _, uid := range userIDs {
			if uuid.Equal(caller, uid) {
				continue
			}

			query := `
UPDATE group_edge SET state = state - 1 
WHERE
	(source_id = $1::UUID AND destination_id = $2::UUID AND state > 0 AND state > $3)
OR
	(source_id = $2::UUID AND destination_id = $1::UUID AND state > 0 AND state > $3)
RETURNING state`

			var newState sql.NullInt64
			if err := tx.QueryRow(query, groupID, uid, myState).Scan(&newState); err != nil {
				if err == sql.ErrNoRows {
					return nil
				}
				logger.Debug("Could not promote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
				return err
			}

			if newState.Int64 == 2 {
				query = "UPDATE groups SET edge_count = edge_count + 1, update_time = now() WHERE id = $1::UUID AND edge_count+1 <= max_count"
				_, err := tx.Exec(query, groupID)
				if err != nil {
					logger.Debug("Could not update group edge_count.", zap.String("group_id", groupID.String()))
					return err
				}
			}
		}
		return nil
	}); err != nil {
		logger.Error("Error promote users from group.", zap.Error(err))
		return false, err
	}

	return true, nil
}

func ListGroupUsers(logger *zap.Logger, db *sql.DB, tracker Tracker, groupID uuid.UUID) (*api.GroupUserList, error) {
	query := `
SELECT u.id, u.username, u.display_name, u.avatar_url,
	u.lang_tag, u.location, u.timezone, u.metadata,
	u.facebook_id, u.google_id, u.gamecenter_id, u.steam_id, u.edge_count,
	u.create_time, u.update_time, ge.state
FROM users u, group_edge ge
WHERE u.id = ge.source_id AND ge.destination_id = $1`

	rows, err := db.Query(query, groupID)
	if err != nil {
		logger.Debug("Could not list users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
		return nil, err
	}
	defer rows.Close()

	groupUsers := make([]*api.GroupUserList_GroupUser, 0)
	for rows.Next() {
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
		var edgeCount int
		var createTime pq.NullTime
		var updateTime pq.NullTime
		var state sql.NullInt64

		if err := rows.Scan(&id, &username, &displayName, &avatarURL, &langTag, &location, &timezone, &metadata,
			&facebook, &google, &gamecenter, &steam, &edgeCount, &createTime, &updateTime, &state); err != nil {
			logger.Error("Could not parse rows when listing users in a group.", zap.Error(err), zap.String("group_id", groupID.String()))
			return nil, err
		}

		userID := uuid.Must(uuid.FromString(id))
		user := &api.User{
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
			EdgeCount:    int32(edgeCount),
			CreateTime:   &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:   &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
			Online:       tracker.StreamExists(PresenceStream{Mode: StreamModeNotifications, Subject: userID}),
		}

		groupUser := &api.GroupUserList_GroupUser{User: user}
		switch state.Int64 {
		case 0:
			groupUser.State = int32(api.GroupUserList_GroupUser_SUPERADMIN)
		case 1:
			groupUser.State = int32(api.GroupUserList_GroupUser_ADMIN)
		case 2:
			groupUser.State = int32(api.GroupUserList_GroupUser_MEMBER)
		case 3:
			groupUser.State = int32(api.GroupUserList_GroupUser_JOIN_REQUEST)
		}
		groupUsers = append(groupUsers, groupUser)
	}

	return &api.GroupUserList{GroupUsers: groupUsers}, nil
}

func ListUserGroups(logger *zap.Logger, db *sql.DB, userID uuid.UUID) (*api.UserGroupList, error) {
	query := `
SELECT id, creator_id, name, description, avatar_url, 
lang_tag, metadata, groups.state, edge_count, max_count, 
create_time, groups.update_time, group_edge.state
FROM groups 
JOIN group_edge ON (group_edge.source_id = id)
WHERE group_edge.destination_id = $1 AND disable_time::INT = 0`

	rows, err := db.Query(query, userID)
	if err != nil {
		logger.Debug("Could not list groups for a user.", zap.Error(err), zap.String("user_id", userID.String()))
		return nil, err
	}
	defer rows.Close()

	userGroups := make([]*api.UserGroupList_UserGroup, 0)
	for rows.Next() {
		var id string
		var creatorID sql.NullString
		var name sql.NullString
		var description sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var metadata []byte
		var state sql.NullInt64
		var edgeCount sql.NullInt64
		var maxCount sql.NullInt64
		var createTime pq.NullTime
		var updateTime pq.NullTime
		var userState sql.NullInt64

		if err := rows.Scan(&id, &creatorID, &name,
			&description, &avatarURL, &lang, &metadata, &state,
			&edgeCount, &maxCount, &createTime, &updateTime, &userState); err != nil {
			logger.Error("Could not parse rows when listing groups for a user.", zap.Error(err), zap.String("user_id", userID.String()))
			return nil, err
		}

		open := true
		if state.Int64 == 1 {
			open = false
		}

		group := &api.Group{
			Id:          uuid.Must(uuid.FromString(id)).String(),
			CreatorId:   uuid.Must(uuid.FromString(creatorID.String)).String(),
			Name:        name.String,
			Description: description.String,
			AvatarUrl:   avatarURL.String,
			LangTag:     lang.String,
			Metadata:    string(metadata),
			Open:        &wrappers.BoolValue{Value: open},
			EdgeCount:   int32(edgeCount.Int64),
			MaxCount:    int32(maxCount.Int64),
			CreateTime:  &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:  &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
		}

		userGroup := &api.UserGroupList_UserGroup{Group: group}
		switch userState.Int64 {
		case 0:
			userGroup.State = int32(api.UserGroupList_UserGroup_SUPERADMIN)
		case 1:
			userGroup.State = int32(api.UserGroupList_UserGroup_ADMIN)
		case 2:
			userGroup.State = int32(api.UserGroupList_UserGroup_MEMBER)
		case 3:
			userGroup.State = int32(api.UserGroupList_UserGroup_JOIN_REQUEST)
		}

		userGroups = append(userGroups, userGroup)
	}

	return &api.UserGroupList{UserGroups: userGroups}, nil

}

func groupConvertRows(rows *sql.Rows) ([]*api.Group, error) {
	defer rows.Close()

	groups := make([]*api.Group, 0)

	for rows.Next() {
		var id string
		var creatorID sql.NullString
		var name sql.NullString
		var description sql.NullString
		var avatarURL sql.NullString
		var lang sql.NullString
		var metadata []byte
		var state sql.NullInt64
		var edgeCount sql.NullInt64
		var maxCount sql.NullInt64
		var createTime pq.NullTime
		var updateTime pq.NullTime

		if err := rows.Scan(&id, &creatorID, &name, &description, &avatarURL, &state, &edgeCount, &lang, &maxCount, &metadata, &createTime, &updateTime); err != nil {
			return nil, err
		}

		open := true
		if state.Int64 == 1 {
			open = false
		}

		group := &api.Group{
			Id:          uuid.Must(uuid.FromString(id)).String(),
			CreatorId:   uuid.Must(uuid.FromString(creatorID.String)).String(),
			Name:        name.String,
			Description: description.String,
			AvatarUrl:   avatarURL.String,
			LangTag:     lang.String,
			Metadata:    string(metadata),
			Open:        &wrappers.BoolValue{Value: open},
			EdgeCount:   int32(edgeCount.Int64),
			MaxCount:    int32(maxCount.Int64),
			CreateTime:  &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			UpdateTime:  &timestamp.Timestamp{Seconds: updateTime.Time.Unix()},
		}

		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return groups, nil
}

func groupAddUser(db *sql.DB, tx *sql.Tx, groupID uuid.UUID, userID uuid.UUID, state int) (int64, error) {
	query := `
INSERT INTO group_edge 
	(position, state, source_id, destination_id)
VALUES
	($1, $2, $3, $4),
	($1, $2, $4, $3)`

	position := time.Now().UTC().UnixNano()

	var res sql.Result
	var err error
	if tx != nil {
		res, err = tx.Exec(query, position, state, groupID, userID)
	} else {
		res, err = db.Exec(query, position, state, groupID, userID)
	}

	if err != nil {
		return 0, err
	}

	if rowsAffected, err := res.RowsAffected(); err != nil {
		return 0, err
	} else {
		return rowsAffected, nil
	}
}

func groupUpdateUserState(db *sql.DB, tx *sql.Tx, groupID uuid.UUID, userID uuid.UUID, fromState int, toState int) (int64, error) {
	query := `
UPDATE group_edge SET 
	update_time = now(), state = $4 
WHERE 
	(source_id = $1::UUID AND destination_id = $2::UUID AND state = $3)
OR
	(source_id = $2::UUID AND destination_id = $1::UUID AND state = $3)`

	var res sql.Result
	var err error
	if tx != nil {
		res, err = tx.Exec(query, groupID, userID, fromState, toState)
	} else {
		res, err = db.Exec(query, groupID, userID, fromState, toState)
	}

	if err != nil {
		return 0, err
	}

	if rowsAffected, err := res.RowsAffected(); err != nil {
		return 0, err
	} else {
		return rowsAffected, nil
	}
}

func groupCheckUserPermission(logger *zap.Logger, db *sql.DB, groupID, userID uuid.UUID, state int) (bool, error) {
	var allowedUser sql.NullBool
	query := "SELECT EXISTS (SELECT 1 FROM group_edge WHERE source_id = $1::UUID AND destination_id = $2::UUID AND state > -1 AND state <= $3)"
	if err := db.QueryRow(query, groupID, userID, state).Scan(&allowedUser); err != nil {
		logger.Error("Could not look up user state with group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", userID.String()))
		return false, err
	}

	return allowedUser.Bool, nil
}
