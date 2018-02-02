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
	"golang.org/x/net/context"
	"github.com/heroiclabs/nakama/api"
	"github.com/golang/protobuf/ptypes/empty"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"go.uber.org/zap"
	"time"
	"database/sql"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
	"strings"
)

func (s *ApiServer) LinkCustomFunc(ctx context.Context, in *api.AccountCustom) (*empty.Empty, error) {
	customID := in.Id
	if customID == "" {
		return nil, status.Error(codes.InvalidArgument, "Custom ID is required")
	} else if invalidCharsRegex.MatchString(customID) {
		return nil, status.Error(codes.InvalidArgument,  "Invalid custom ID, no spaces or control characters allowed")
	} else if len(customID) < 10 || len(customID) > 128 {
		return nil, status.Error(codes.InvalidArgument,  "Invalid custom ID, must be 10-128 bytes")
	}

	userID := ctx.Value(ctxUserIDKey{})
	ts := time.Now().UTC().Unix()
	res, err := s.db.Exec(`
UPDATE users
SET custom_id = $2, updated_at = $3
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE custom_id = $2)`,
		userID,
		customID,
		ts)

	if err != nil {
		s.logger.Warn("Could not link custom ID", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error while trying to link Custom ID")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Custom ID is already in use.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkDeviceFunc(ctx context.Context, in *api.AccountDevice) (*empty.Empty, error) {
	deviceID := in.Id
	if deviceID == "" {
		return nil, status.Error(codes.InvalidArgument, "Device ID is required")
	} else if invalidCharsRegex.MatchString(deviceID) {
		return nil, status.Error(codes.InvalidArgument,  "Device ID invalid, no spaces or control characters allowed")
	} else if len(deviceID) < 10 || len(deviceID) > 128 {
		return nil, status.Error(codes.InvalidArgument,  "Device ID invalid, must be 10-128 bytes")
	}

	fnErr := Transact(s.logger, s.db, func (tx *sql.Tx) error {
		userID := ctx.Value(ctxUserIDKey{})
		ts := time.Now().UTC().Unix()
		_, err := s.db.Exec("INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, userID, ts)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
				return status.Error(codes.AlreadyExists, "Device ID already in use.")
			}
			s.logger.Error("Cannot link device ID, query error", zap.Error(err))
			return status.Error(codes.Internal, "Error linking Device ID")
		}

		_, err = tx.Exec("UPDATE users SET updated_at = $1 WHERE id = $2", ts, userID)
		if err != nil {
			s.logger.Error("Cannot update users table while linking, query error", zap.Error(err))
			return status.Error(codes.Internal, "Error linking Device ID")
		}
		return nil
	})

	if fnErr != nil {
		return nil, fnErr
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkEmailFunc(ctx context.Context, in *api.AccountEmail) (*empty.Empty, error) {
	if in.Email == "" || in.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "Email address and password is required")
	} else if invalidCharsRegex.MatchString(in.Email) {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address, no spaces or control characters allowed")
	} else if len(in.Password) < 8 {
		return nil, status.Error(codes.InvalidArgument, "Password must be longer than 8 characters")
	} else if !emailRegex.MatchString(in.Email) {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address format")
	} else if len(in.Email) < 10 || len(in.Email) > 255 {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address, must be 10-255 bytes")
	}

	cleanEmail := strings.ToLower(in.Email)
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)

	userID := ctx.Value(ctxUserIDKey{})
	ts := time.Now().UTC().Unix()
	res, err := s.db.Exec(`
UPDATE users
SET email = $2, password = $3, updated_at = $4
WHERE id = $1
AND NOT EXISTS
    (SELECT id
     FROM users
     WHERE email = $2)`,
		userID,
		cleanEmail,
		hashedPassword,
		ts)

	if err != nil {
		s.logger.Warn("Could not link email", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error while trying to link email")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Email is already in use.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkFacebookFunc(ctx context.Context, in *api.AccountFacebook) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) LinkGameCenterFunc(ctx context.Context, in *api.AccountGameCenter) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) LinkGoogleFunc(ctx context.Context, in *api.AccountGoogle) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) LinkSteamFunc(ctx context.Context, in *api.AccountSteam) (*empty.Empty, error) {
	return nil, nil
}
