// Copyright 2021 The Nakama Authors
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

	"github.com/jackc/pgx/pgtype"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func SessionRefresh(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, token string) (string, string, map[string]string, error) {
	userID, _, vars, _, ok := parseToken([]byte(config.GetSession().RefreshEncryptionKey), token)
	if !ok {
		return "", "", nil, status.Error(codes.Unauthenticated, "Refresh token invalid or expired.")
	}

	// Look for an existing account.
	query := "SELECT username, disable_time FROM users WHERE id = $1 LIMIT 1"
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err := db.QueryRowContext(ctx, query, userID).Scan(&dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			// Account not found and creation is never allowed for this type.
			return "", "", nil, status.Error(codes.NotFound, "User account not found.")
		}
		logger.Error("Error looking up user by ID.", zap.Error(err), zap.String("id", userID.String()))
		return "", "", nil, status.Error(codes.Internal, "Error finding user account.")
	}

	// Check if it's disabled.
	if dbDisableTime.Status == pgtype.Present && dbDisableTime.Time.Unix() != 0 {
		logger.Info("User account is disabled.", zap.String("id", userID.String()))
		return "", "", nil, status.Error(codes.PermissionDenied, "User account banned.")
	}

	return userID.String(), dbUsername, vars, nil
}
