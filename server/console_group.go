package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"strconv"
	"strings"
	"time"
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

	group, err := getGroup(ctx, s.logger, s.db, groupID)
	if err != nil {
		if err == ErrGroupNotFound {
			return nil, status.Error(codes.NotFound, "Group not found.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to export group data.")
	}

	users, err := ListGroupUsers(ctx, s.logger, s.db, s.tracker, groupID, 0, nil, "")
	if err != nil {
		return nil, status.Error(codes.Internal, "An error occurred while trying to export group members.")
	}

	return &console.GroupExport{
		Group:   group,
		Members: users.GroupUsers,
	}, nil
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

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the group.")
	}

	if err = ExecuteInTx(ctx, tx, func() error {
		if len(statements) != 0 {
			query := "UPDATE groups SET update_time = now(), " + strings.Join(statements, ", ") + " WHERE id = $1"
			_, err := tx.ExecContext(ctx, query, params...)
			if err != nil {
				s.logger.Error("Could not update group.", zap.Error(err), zap.Any("input", in))
				return err
			}
		}
		return nil
	}); err != nil {
		if e, ok := err.(*statusError); ok {
			// Errors such as unlinking the last profile or username in use.
			return nil, e.Status()
		}
		s.logger.Error("Error updating group.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the group.")
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

func (s *ConsoleServer) GetMembers(ctx context.Context, in *console.GroupId) (*api.GroupUserList, error) {
	groupID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	users, err := ListGroupUsers(ctx, s.logger, s.db, s.tracker, groupID, 0, nil, "")
	if err != nil {
		return nil, status.Error(codes.Internal, "An error occurred while trying to list group members.")
	}

	return users, nil
}

func (s *ConsoleServer) DemoteGroupMember(ctx context.Context, in *console.ChangeGroupUserStateRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	groupID, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	if err = demoteGroupUser(ctx, s.logger, s.db, s.router, uuid.Nil, groupID, userID); err != nil {
		if err == ErrEmptyMemberDemote {
			return nil, status.Error(codes.FailedPrecondition, "Cannot demote user in the group.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to demote the user in the group.")
	}
	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) PromoteGroupMember(ctx context.Context, in *console.ChangeGroupUserStateRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	groupID, err := uuid.FromString(in.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid group ID.")
	}

	if err = promoteGroupUser(ctx, s.logger, s.db, s.router, uuid.Nil, groupID, userID); err != nil {
		if err == ErrEmptyMemberPromote {
			return nil, status.Error(codes.FailedPrecondition, "Cannot promote user in the group.")
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to promote the user in the group.")
	}

	return &emptypb.Empty{}, nil
}

func demoteGroupUser(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, uid uuid.UUID) error {
	myState, tx, err := preGroupUserStateChangeValidate(ctx, logger, db, groupID, caller)
	if err != nil {
		return err
	}
	channelID, stream, err := prepareGroupStream(logger, groupID)
	if err != nil {
		return err
	}

	var message *api.ChannelMessage
	ts := time.Now().Unix()
	if err := ExecuteInTx(ctx, tx, func() error {
		if uid == caller {
			return errors.New("cannot demote self")
		}

		query := ""
		if myState == 0 {
			// Ensure we aren't removing the last superadmin when deleting authoritatively.
			// Query is for superadmin or if done authoritatively.
			query = `
UPDATE group_edge SET state = state + 1
WHERE
  (
    (source_id = $1::UUID AND destination_id = $2::UUID AND state >= $3 AND state < $4)
    OR
    (source_id = $2::UUID AND destination_id = $1::UUID AND state >= $3 AND state < $4)
  )
AND
  (
    (SELECT COUNT(destination_id) FROM group_edge WHERE source_id = $1::UUID AND destination_id != $2::UUID AND state = 0) > 0
  )
RETURNING state`
		}

		var newState sql.NullInt64
		if err := tx.QueryRowContext(ctx, query, groupID, uid, myState, api.GroupUserList_GroupUser_MEMBER).Scan(&newState); err != nil {
			if err == sql.ErrNoRows {
				return ErrEmptyMemberDemote
			}
			logger.Debug("Could not demote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
			return err
		}

		message, err = postGroupUserStateChangeAction(ctx, logger, uid, tx, groupID, channelID, ts, stream, ChannelMessageTypeGroupDemote)
		if err != nil {
			return err
		}
		return nil
	}); err != nil {
		if err != ErrEmptyMemberDemote {
			logger.Error("Error demoting users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
		}
		return err
	}
	router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	return nil
}

func promoteGroupUser(ctx context.Context, logger *zap.Logger, db *sql.DB, router MessageRouter, caller uuid.UUID, groupID uuid.UUID, uid uuid.UUID) error {
	myState, tx, err := preGroupUserStateChangeValidate(ctx, logger, db, groupID, caller)
	if err != nil {
		return err
	}
	channelID, stream, err := prepareGroupStream(logger, groupID)
	if err != nil {
		return err
	}

	var message *api.ChannelMessage
	ts := time.Now().Unix()
	if err := ExecuteInTx(ctx, tx, func() error {
		if uid == caller {
			return errors.New("cannot promote self")
		}

		query := `
UPDATE group_edge SET state = state - 1
WHERE
	(source_id = $1::UUID AND destination_id = $2::UUID AND state > 0 AND state > $3)
OR
	(source_id = $2::UUID AND destination_id = $1::UUID AND state > 0 AND state > $3)
RETURNING state`

		var newState sql.NullInt64
		if err := tx.QueryRowContext(ctx, query, groupID, uid, myState).Scan(&newState); err != nil {
			if err == sql.ErrNoRows {
				return ErrEmptyMemberPromote
			}
			logger.Debug("Could not promote user in group.", zap.Error(err), zap.String("group_id", groupID.String()), zap.String("user_id", uid.String()))
			return err
		}

		if newState.Int64 == 2 {
			err := incrementGroupEdge(ctx, logger, tx, uid, groupID)
			if err != nil {
				return err
			}
		}

		message, err = postGroupUserStateChangeAction(ctx, logger, uid, tx, groupID, channelID, ts, stream, ChannelMessageTypeGroupPromote)
		if err != nil {
			return err
		}
		return nil
	}); err != nil {
		if err != ErrEmptyMemberPromote {
			logger.Error("Error promoting users in group.", zap.Error(err), zap.String("group_id", groupID.String()))
		}
		return err
	}
	router.SendToStream(logger, stream, &rtapi.Envelope{Message: &rtapi.Envelope_ChannelMessage{ChannelMessage: message}}, true)
	return nil
}
