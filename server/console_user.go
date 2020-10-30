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
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/v2/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) AddUser(ctx context.Context, in *console.AddUserRequest) (*empty.Empty, error) {

	var creatorRole = ctx.Value(ctxConsoleRoleKey{}).(console.UserRole)
	if creatorRole != console.UserRole_USER_ROLE_ADMIN {
		//TODO any other roles are allowed to create users?
		return nil, status.Error(codes.PermissionDenied, "Forbidden")
	}

	if in.Username == "" {
		return nil, status.Error(codes.InvalidArgument, "Username is required")
	} else {
		//TODO validate username doesn't have illegal characters -> 400 Bad Request
	}

	if in.Email == "" {
		return nil, status.Error(codes.InvalidArgument, "Email is required")
	} else {
		//TODO validate email is a valid email address -> 400 Bad Request
	}

	if in.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "Password is required")
	} else {
		//TODO validate password passes all requirements (length, capitals, ...)  -> 400 Bad Request
	}

	//TODO insert user in the db -> 409 Conflict if uname/email exists
	//TODO any other error 500 Internal Server Error
	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteUser(ctx context.Context, in *console.UserId) (*empty.Empty, error) {

	var creatorRole = ctx.Value(ctxConsoleRoleKey{}).(console.UserRole)
	if creatorRole != console.UserRole_USER_ROLE_ADMIN {
		//TODO any other roles are allowed to delete users?
		return nil, status.Error(codes.PermissionDenied, "Forbidden")
	}

	if deleted, err := s.dbDeleteConsoleUser(ctx, in.Id); err != nil {
		s.logger.Error("failed to delete console user", zap.Error(err), zap.String("user", in.Id))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	} else if !deleted {
		return nil, status.Error(codes.InvalidArgument, "User not found")
	}

	return &empty.Empty{}, nil
}

func (s *ConsoleServer) ListUsers(ctx context.Context, in *empty.Empty) (*console.UserList, error) {
	users, err := s.dbListConsoleUsers(ctx)
	if err != nil {
		s.logger.Error("failed to list console users", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}
	return &console.UserList{Users: users}, nil
}

func (s *ConsoleServer) dbListConsoleUsers(ctx context.Context) ([]*console.UserList_User, error) {
	result := make([]*console.UserList_User, 0)
	rows, err := s.db.QueryContext(ctx, "SELECT username, email, role FROM console_users")
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		user := &console.UserList_User{}
		if err := rows.Scan(&user.Username, &user.Email, &user.Role); err != nil {
			return nil, err
		}
		result = append(result, user)
	}
	return result, nil
}

func (s *ConsoleServer) dbDeleteConsoleUser(ctx context.Context, id string) (bool, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM console_users WHERE id = $1", id)
	if err != nil {
		return false, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return false, err
	} else if n == 0 {
		return false, nil
	}
	return true, nil
}
