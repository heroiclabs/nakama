// Copyright 2019 The Nakama Authors
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

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v2/console"
	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) BanUser(ctx context.Context, in *console.AccountId) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot ban the system user.")
	}

	if err := BanUsers(ctx, s.logger, s.db, []string{in.Id}); err != nil {
		// Error logged in the core function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to ban the user.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) UnbanUser(ctx context.Context, in *console.AccountId) (*empty.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if userID == uuid.Nil {
		return nil, status.Error(codes.InvalidArgument, "Cannot unban the system user.")
	}

	if err := UnbanUsers(ctx, s.logger, s.db, []string{in.Id}); err != nil {
		// Error logged in the core function above.
		return nil, status.Error(codes.Internal, "An error occurred while trying to unban the user.")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteUsers(ctx context.Context, in *empty.Empty) (*empty.Empty, error) {
	// Delete all but the system user. Related data will be removed by cascading constraints.
	_, err := s.db.ExecContext(ctx, "DELETE FROM users WHERE id <> '00000000-0000-0000-0000-000000000000'")
	if err != nil {
		s.logger.Error("Error deleting all user accounts.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to delete all users.")
	}
	return &empty.Empty{}, nil
}

func (s *ConsoleServer) ListUsers(ctx context.Context, in *console.ListUsersRequest) (*console.UserList, error) {
	// Searching only through tombstone records.
	if in.Tombstones {
		var userID *uuid.UUID
		if in.Filter != "" {
			uid, err := uuid.FromString(in.Filter)
			if err != nil {
				// Filtering for a tombstone using username, no results are possible.
				return &console.UserList{
					TotalCount: countUsers(ctx, s.logger, s.db),
				}, nil
			}
			userID = &uid
		}

		if userID != nil {
			// Looking up a single specific tombstone.
			var createTime pgtype.Timestamptz
			err := s.db.QueryRowContext(ctx, "SELECT create_time FROM user_tombstone WHERE user_id = $1", *userID).Scan(&createTime)
			if err != nil {
				if err == sql.ErrNoRows {
					return &console.UserList{
						TotalCount: countUsers(ctx, s.logger, s.db),
					}, nil
				}
				s.logger.Error("Error looking up user tombstone.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}

			return &console.UserList{
				Users: []*api.User{
					{
						Id:         in.Filter,
						UpdateTime: &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
					},
				},
				TotalCount: countUsers(ctx, s.logger, s.db),
			}, nil
		}

		query := "SELECT user_id, create_time FROM user_tombstone LIMIT 50"

		rows, err := s.db.QueryContext(ctx, query)
		if err != nil {
			s.logger.Error("Error querying user tombstones.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}

		users := make([]*api.User, 0, 50)

		for rows.Next() {
			var id string
			var createTime pgtype.Timestamptz
			if err = rows.Scan(&id, &createTime); err != nil {
				_ = rows.Close()
				s.logger.Error("Error scanning user tombstones.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}

			users = append(users, &api.User{
				Id:         id,
				UpdateTime: &timestamp.Timestamp{Seconds: createTime.Time.Unix()},
			})
		}
		_ = rows.Close()

		return &console.UserList{
			Users:      users,
			TotalCount: countUsers(ctx, s.logger, s.db),
		}, nil
	}

	if in.Filter != "" {
		_, err := uuid.FromString(in.Filter)
		// If the filter is not a valid user ID treat it as a username instead.

		var query string
		params := []interface{}{in.Filter}
		if err != nil {
			query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, facebook_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users WHERE username = $1"
		} else {
			query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, facebook_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users WHERE id = $1"
		}

		if in.Banned {
			query += " AND disable_time <> '1970-01-01 00:00:00 UTC'"
		}

		rows, err := s.db.QueryContext(ctx, query, params...)
		if err != nil {
			s.logger.Error("Error querying users.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}

		users := make([]*api.User, 0, 2)

		for rows.Next() {
			user, err := convertUser(s.tracker, rows)
			if err != nil {
				_ = rows.Close()
				s.logger.Error("Error scanning users.", zap.Any("in", in), zap.Error(err))
				return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
			}
			users = append(users, user)
		}
		_ = rows.Close()

		return &console.UserList{
			Users:      users,
			TotalCount: countUsers(ctx, s.logger, s.db),
		}, nil
	}

	var query string

	if in.Banned {
		query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, facebook_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users WHERE disable_time <> '1970-01-01 00:00:00 UTC' LIMIT 50"
	} else {
		query = "SELECT id, username, display_name, avatar_url, lang_tag, location, timezone, metadata, facebook_id, google_id, gamecenter_id, steam_id, edge_count, create_time, update_time FROM users LIMIT 50"
	}

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		s.logger.Error("Error querying users.", zap.Any("in", in), zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
	}

	users := make([]*api.User, 0, 50)

	for rows.Next() {
		user, err := convertUser(s.tracker, rows)
		if err != nil {
			_ = rows.Close()
			s.logger.Error("Error scanning users.", zap.Any("in", in), zap.Error(err))
			return nil, status.Error(codes.Internal, "An error occurred while trying to list users.")
		}

		users = append(users, user)
	}
	_ = rows.Close()

	return &console.UserList{
		Users:      users,
		TotalCount: countUsers(ctx, s.logger, s.db),
	}, nil
}

func countUsers(ctx context.Context, logger *zap.Logger, db *sql.DB) int32 {
	var count sql.NullInt64
	// First try a fast count on table metadata.
	if err := db.QueryRowContext(ctx, "SELECT reltuples::BIGINT FROM pg_class WHERE relname = 'users'").Scan(&count); err != nil {
		logger.Warn("Error counting users.", zap.Error(err))
		if err == context.Canceled {
			// If the context was cancelled do not attempt any further counts.
			return 0
		}
	}
	if count.Valid && count.Int64 != 0 {
		// Use this count result.
		return int32(count.Int64)
	}

	// If the first fast count failed, returned NULL, or returned 0 try a fast count on partitioned table metadata.
	if err := db.QueryRowContext(ctx, "SELECT sum(reltuples::BIGINT) FROM pg_class WHERE relname ilike 'users%_pkey'").Scan(&count); err != nil {
		logger.Warn("Error counting users.", zap.Error(err))
		if err == context.Canceled {
			// If the context was cancelled do not attempt any further counts.
			return 0
		}
	}
	if count.Valid && count.Int64 != 0 {
		// Use this count result.
		return int32(count.Int64)
	}

	// If both fast counts failed, returned NULL, or returned 0 try a full count.
	if err := db.QueryRowContext(ctx, "SELECT count(id) FROM users").Scan(&count); err != nil {
		logger.Warn("Error counting users.", zap.Error(err))
	}
	return int32(count.Int64)
}
