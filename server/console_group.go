package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/gob"
	"fmt"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
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

	for rows.Next() {
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
			break
		}
	}
	_ = rows.Close()

	response := &console.GroupList{
		Groups:      groups,
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
	const fields = "id, creator_id, name, description, avatar_url, lang_tag, metadata, state, edge_count, max_count, create_time, update_time"
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