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
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"

	"github.com/jackc/pgx/v5/pgconn"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

var usernameRegex = regexp.MustCompile("^[a-zA-Z0-9][a-zA-Z0-9._].*[a-zA-Z0-9]$")

func (s *ConsoleServer) AddUser(ctx context.Context, in *console.AddUserRequest) (*emptypb.Empty, error) {

	if in.Username == "" {
		return nil, status.Error(codes.InvalidArgument, "Username is required")
	} else if len(in.Username) < 3 || len(in.Username) > 20 || !usernameRegex.MatchString(in.Username) {
		return nil, status.Error(codes.InvalidArgument, "Username must be 3-20 long sequence of alphanumeric characters _ or . and cannot start and end with _ or .")
	}
	in.Username = strings.ToLower(in.Username)

	if in.Username == "admin" || in.Username == s.config.GetConsole().Username {
		return nil, status.Error(codes.InvalidArgument, "Username cannot be the console configured username")
	}

	if in.Email == "" {
		return nil, status.Error(codes.InvalidArgument, "Email is required")
	} else if len(in.Email) < 3 || len(in.Email) > 254 || !emailRegex.MatchString(in.Email) || invalidCharsRegex.MatchString(in.Email) {
		return nil, status.Error(codes.InvalidArgument, "Not a valid email address")
	}
	in.Email = strings.ToLower(in.Email)

	if in.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "Password is required")
	} else if !isValidPassword(in.Password) {
		return nil, status.Error(codes.InvalidArgument, "Password must be at least 8 characters long and contain 1 number and 1 upper case character")
	}

	inviterUsername := ctx.Value(ctxConsoleUsernameKey{}).(string)
	inviterEmail := ctx.Value(ctxConsoleEmailKey{}).(string)
	payload := map[string]interface{}{
		"email":            in.Email,
		"username":         in.Username,
		"cookie":           s.cookie,
		"inviter_username": inviterUsername,
		"inviter_email":    inviterEmail,
		"newsletter":       in.NewsletterSubscription,
	}

	if payloadJson, err := json.Marshal(payload); err != nil {
		s.logger.Debug("Failed to create newsletter request payload.", zap.Error(err))
	} else {
		if req, err := http.NewRequest("POST", "https://cloud.heroiclabs.com/v1/nakama-newsletter/subscribe", bytes.NewBuffer(payloadJson)); err != nil {
			s.logger.Debug("Failed to create newsletter request.", zap.Error(err))
		} else {
			req.Header.Set("Content-Type", "application/json")
			if resp, err := s.httpClient.Do(req); err != nil {
				s.logger.Debug("Failed to add newsletter subscription.", zap.Error(err))
			} else {
				s.logger.Debug("Added newsletter subscription.", zap.Int("status", resp.StatusCode))
			}
		}
	}

	if inserted, err := s.dbInsertConsoleUser(ctx, in); err != nil {
		s.logger.Error("failed to insert console user", zap.Error(err), zap.String("username", in.Username), zap.String("email", in.Email))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	} else if !inserted {
		return nil, status.Error(codes.FailedPrecondition, "Username or Email already exists")
	}
	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) dbInsertConsoleUser(ctx context.Context, in *console.AddUserRequest) (bool, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return false, err
	}
	id, err := uuid.NewV4()
	if err != nil {
		return false, err
	}
	query := "INSERT INTO console_user (id, username, email, password, role) VALUES ($1, $2, $3, $4, $5)"
	_, err = s.db.ExecContext(ctx, query, id.String(), in.Username, in.Email, hashedPassword, in.Role)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == dbErrorUniqueViolation {
				return false, nil
			}
		}
		return false, err
	}
	return true, nil
}

func (s *ConsoleServer) DeleteUser(ctx context.Context, in *console.Username) (*emptypb.Empty, error) {
	deleted, id, err := s.dbDeleteConsoleUser(ctx, in.Username)
	if err != nil {
		s.logger.Error("failed to delete console user", zap.Error(err), zap.String("username", in.Username))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	} else if !deleted {
		return nil, status.Error(codes.InvalidArgument, "User not found")
	}
	s.consoleSessionCache.RemoveAll(id)

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) ListUsers(ctx context.Context, in *emptypb.Empty) (*console.UserList, error) {
	users, err := s.dbListConsoleUsers(ctx)
	if err != nil {
		s.logger.Error("failed to list console users", zap.Error(err))
		return nil, status.Error(codes.Internal, "Internal Server Error")
	}
	return &console.UserList{Users: users}, nil
}

func (s *ConsoleServer) dbListConsoleUsers(ctx context.Context) ([]*console.UserList_User, error) {
	result := make([]*console.UserList_User, 0, 10)
	rows, err := s.db.QueryContext(ctx, "SELECT username, email, role FROM console_user")
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

func (s *ConsoleServer) dbDeleteConsoleUser(ctx context.Context, username string) (bool, uuid.UUID, error) {
	var deletedID uuid.UUID
	if err := s.db.QueryRowContext(ctx, "DELETE FROM console_user WHERE username = $1 RETURNING id", username).Scan(&deletedID); err != nil {
		if err == sql.ErrNoRows {
			return false, uuid.Nil, nil
		}
		return false, uuid.Nil, err
	}
	return true, deletedID, nil
}

func isValidPassword(pwd string) bool {
	if len(pwd) < 8 {
		return false
	}
	var number bool
	var upper bool
	for _, c := range pwd {
		switch {
		case unicode.IsNumber(c):
			number = true
		case unicode.IsUpper(c):
			upper = true
		}
	}
	return number && upper
}
