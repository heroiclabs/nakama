package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"strconv"
	"strings"
)

type consoleGroupCursor struct {
	ID   uuid.UUID
	Name string
}

func (s *ConsoleServer) ListGroups(ctx context.Context, in *console.ListGroupsRequest) (*console.GroupList, error) {
	const defaultLimit = 50

	// Validate cursor, if provided.
	var cursor *consoleGroupCursor
	if in.Cursor != "" {
		cb, err := base64.RawURLEncoding.DecodeString(in.Cursor)
		if err != nil {
			s.logger.Error("Error decoding group list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode group list request cursor.")
		}
		cursor = &consoleGroupCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(&cursor); err != nil {
			s.logger.Error("Error decoding account list cursor.", zap.String("cursor", in.Cursor), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to decode group list request cursor.")
		}
	}

	query, params, limit := buildListGroupsQuery(defaultLimit, cursor, in.Filter)

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		s.logger.Error("Error querying groups.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list groups.")
	}

	groups := make([]*api.Group, 0, defaultLimit)
	var nextCursor *consoleGroupCursor

	foundLimit := false
	validNextCursor := false
	for rows.Next() {
		// checks if there are further pages to display after limit
		if foundLimit {
			validNextCursor = true
			break
		}

		group, err := convertGroup(rows)
		if err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning groups.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list groups.")
		}

		groups = append(groups, group)
		if limit > 0 && len(groups) >= limit {
			nextCursor = &consoleGroupCursor{
				ID:   uuid.FromStringOrNil(group.Id),
				Name: group.Name,
			}
			foundLimit = true
		}
	}
	_ = rows.Close()
	if !validNextCursor {
		// cancels next cursor as there are no more rows after limit
		nextCursor = nil
	}

	response := &console.GroupList{
		Groups:     groups,
		TotalCount: countDatabase(ctx, s.logger, s.db, "groups"),
	}

	if nextCursor != nil {
		cursorBuf := &bytes.Buffer{}
		if err := gob.NewEncoder(cursorBuf).Encode(nextCursor); err != nil {
			s.logger.Error("Error encoding groups cursor.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list groups.")
		}
		response.NextCursor = base64.RawURLEncoding.EncodeToString(cursorBuf.Bytes())
	}

	return response, nil
}

func (s *ConsoleServer) DeleteGroup(ctx context.Context, in *console.DeleteGroupRequest) (*emptypb.Empty, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	if err = DeleteGroup(ctx, s.logger, s.db, groupID, uuid.Nil); err != nil {
		// Error already logged in function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete the user.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) GetGroup(ctx context.Context, in *console.GroupId) (*api.Group, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	group, err := getGroup(ctx, s.logger, s.db, groupID)
	if err != nil {
		if err == ErrGroupNotFound {
			return nil, status.Error(codes.NotFound, "Group not found.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to retrieve group.")
	}

	return group, nil
}

func (s *ConsoleServer) ExportGroup(ctx context.Context, in *console.GroupId) (*console.GroupExport, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}
	if groupID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot export the group.")
	}

	export, err := exportGroup(ctx, s.logger, s.db, groupID)
	if err != nil {
		return nil, err
	}
	return export, nil
}

func buildListGroupsQuery(defaultLimit int, cursor *consoleGroupCursor, filter string) (query string, params []interface{}, limit int) {
	// Check if we have a filter and it's a group ID.
	var groupIDFilter *uuid.UUID
	if filter != "" {
		groupID, err := uuid.FromString(filter)
		if err == nil {
			groupIDFilter = &groupID
		}
	}

	limit = defaultLimit
	const fields = "id, creator_id, name, description, avatar_url, state, edge_count, lang_tag, max_count, metadata, create_time, update_time"
	switch {
	case groupIDFilter != nil:
		// Filtering for a single exact group ID. Querying on primary key (id).
		query = fmt.Sprintf("SELECT %s FROM groups WHERE id = $1", fields)
		params = []interface{}{*groupIDFilter}
		limit = 0
		// Pagination not possible.
	case filter != "" && strings.Contains(filter, "%"):
		// Filtering for a partial username. Querying and paginating on unique index (name).
		query = fmt.Sprintf("SELECT %s FROM groups WHERE name ILIKE $1", fields)
		params = []interface{}{filter}
		// Pagination is possible.
		if cursor != nil {
			query += " AND name > $2"
			params = append(params, cursor.Name)
		}
		// Order and limit.
		params = append(params, limit+1)
		query += "ORDER BY name ASC LIMIT $" + strconv.Itoa(len(params))
	case filter != "":
		// Filtering for an exact username. Querying on unique index (name).
		query = fmt.Sprintf("SELECT %s FROM groups WHERE name = $1", fields)
		params = []interface{}{filter}
		limit = 0
		// Pagination not possible.
	case cursor != nil:
		// Non-filtered, but paginated query. Assume pagination on group ID. Querying and paginating on primary key (id).
		query = fmt.Sprintf("SELECT %s FROM groups WHERE id > $1 ORDER BY id ASC LIMIT $2", fields)
		params = []interface{}{cursor.ID, limit + 1}
	default:
		// Non-filtered, non-paginated query. Querying and paginating on primary key (id).
		query = fmt.Sprintf("SELECT %s FROM groups ORDER BY id ASC LIMIT $1", fields)
		params = []interface{}{limit + 1}
	}

	return query, params, limit
}

func exportGroup(ctx context.Context, logger *zap.Logger, db *sql.DB, groupID uuid.UUID) (*console.GroupExport, error) {
	group, err := getGroup(ctx, logger, db, groupID)
	if err != nil {
		if err == ErrGroupNotFound {
			return nil, status.Error(codes.NotFound, "Group not found.")
		}
		logger.Error("Could not export group data", zap.Error(err), zap.String("group_id", groupID.String()))
		return nil, status.Error(codes.Internal, "An error occurred while trying to export group data.")
	}

	return &console.GroupExport{
		Group: group,
	}, nil
}

func (s *ConsoleServer) UpdateGroup(ctx context.Context, in *console.UpdateGroupRequest) (*emptypb.Empty, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	statements := make([]string, 0)
	params := []interface{}{groupID}

	if v := in.Name; v != nil {
		if len(v.Value) == 0 {
			return nil, status.Error(codes.InvalidArgument, "Name cannot be empty.")
		}
		if invalidUsernameRegex.MatchString(v.Value) {
			return nil, status.Error(codes.InvalidArgument, "Name cannot contain spaces or control characters.")
		}
		params = append(params, v.Value)
		statements = append(statements, "name = $"+strconv.Itoa(len(params)))
	}

	updateStringCheck(in.Description, "description", &params, &statements)

	if v := in.Metadata; v != nil && v.Value != "" {
		if maybeJSON := []byte(v.Value); !json.Valid(maybeJSON) || bytes.TrimSpace(maybeJSON)[0] != byteBracket {
			return nil, status.Error(codes.InvalidArgument, "Metadata must be a valid JSON object.")
		}
		params = append(params, v.Value)
		statements = append(statements, "metadata = $"+strconv.Itoa(len(params)))
	}

	updateStringCheck(in.AvatarUrl, "avatar_url", &params, &statements)
	updateStringCheck(in.LangTag, "lang_tag", &params, &statements)

	// Bool
	if v := in.Open; v != nil {
		if a := v.Value; a == true {
			statements = append(statements, "state = 0")
		} else {
			statements = append(statements, "state = 1")
		}
	}

	// Integer
	if v := in.MaxCount; v != nil {
		params = append(params, v.Value)
		statements = append(statements, "max_count = $"+strconv.Itoa(len(params)))
	}

	// ...
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the user.")
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		for oldDeviceID, newDeviceID := range in.DeviceIds {
			if newDeviceID == "" {
				query := `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (apple_id IS NOT NULL
     OR facebook_id IS NOT NULL
     OR facebook_instant_game_id IS NOT NULL
     OR google_id IS NOT NULL
     OR gamecenter_id IS NOT NULL
     OR steam_id IS NOT NULL
     OR email IS NOT NULL
     OR custom_id IS NOT NULL))
   OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2 LIMIT 1))`

				res, err := tx.ExecContext(ctx, query, groupID, oldDeviceID)
				if err != nil {
					s.logger.Error("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
					return err
				}
				if count, _ := res.RowsAffected(); count == 0 {
					return StatusError(codes.InvalidArgument, "Cannot unlink device ID when there are no other identifiers.", ErrRowsAffectedCount)
				}
			} else {
				query := `UPDATE user_device SET id = $1 WHERE id = $2 AND user_id = $3`
				res, err := tx.ExecContext(ctx, query, newDeviceID, oldDeviceID, groupID)
				if err != nil {
					s.logger.Error("Could not update device ID.", zap.Error(err), zap.Any("input", in))
					return err
				}
				if count, _ := res.RowsAffected(); count == 0 {
					return StatusError(codes.InvalidArgument, "Device ID is already linked to a different user.", ErrRowsAffectedCount)
				}
			}
		}

		if len(statements) != 0 {
			query := "UPDATE users SET update_time = now(), " + strings.Join(statements, ", ") + " WHERE id = $1"
			_, err := tx.ExecContext(ctx, query, params...)
			if err != nil {
				s.logger.Error("Could not update user account.", zap.Error(err), zap.Any("input", in))
				return err
			}
		}

		if removeCustomID && removeEmail {
			query := `UPDATE users SET custom_id = NULL, email = NULL, update_time = now()
WHERE id = $1
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

			res, err := tx.ExecContext(ctx, query, groupID)
			if err != nil {
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				return StatusError(codes.InvalidArgument, "Cannot unlink both custom ID and email address when there are no other identifiers.", ErrRowsAffectedCount)
			}
		} else if removeCustomID {
			query := `UPDATE users SET custom_id = NULL, update_time = now()
WHERE id = $1
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

			res, err := tx.ExecContext(ctx, query, groupID)
			if err != nil {
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				return StatusError(codes.InvalidArgument, "Cannot unlink custom ID when there are no other identifiers.", ErrRowsAffectedCount)
			}
		} else if removeEmail {
			query := `UPDATE users SET email = NULL, password = NULL, update_time = now()
WHERE id = $1
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

			res, err := tx.ExecContext(ctx, query, groupID)
			if err != nil {
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 0 {
				return StatusError(codes.InvalidArgument, "Cannot unlink email address when there are no other identifiers.", ErrRowsAffectedCount)
			}
		}

		if len(newPassword) != 0 {
			// Update the password on the user account only if they have an email associated.
			res, err := tx.ExecContext(ctx, "UPDATE users SET password = $2, update_time = now() WHERE id = $1 AND email IS NOT NULL", groupID, newPassword)
			if err != nil {
				s.logger.Error("Could not update password.", zap.Error(err), zap.Any("user_id", groupID))
				return err
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected != 1 {
				return StatusError(codes.InvalidArgument, "Cannot set a password on an account with no email address.", ErrRowsAffectedCount)
			}
		}

		if len(in.DeviceIds) != 0 && len(statements) == 0 && !removeCustomID && !removeEmail && len(newPassword) == 0 {
			// Ensure the user account update time is touched if the device IDs have changed but no other updates were applied to the core user record.
			_, err := tx.ExecContext(ctx, "UPDATE users SET update_time = now() WHERE id = $1", groupID)
			if err != nil {
				s.logger.Error("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
				return err
			}
		}

		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			// Errors such as unlinking the last profile or username in use.
			return nil, e.Status()
		}
		s.logger.Error("Error updating user.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the user.")
	}

	return &emptypb.Empty{}, nil
}

func updateStringCheck(field *wrapperspb.StringValue, colName string, params *[]interface{}, statements *[]string) {
	if field != nil {
		if a := field.Value; a == "" {
			*statements = append(*statements, colName+" = NULL")
		} else {
			*params = append(*params, a)
			*statements = append(*statements, fmt.Sprintf("%s = $%s", colName, strconv.Itoa(len(*params))))
		}
	}
}
