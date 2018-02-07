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
	"google.golang.org/grpc/codes"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"database/sql"
	"github.com/satori/go.uuid"
	"time"
	"google.golang.org/grpc/status"
	"strings"
	"golang.org/x/crypto/bcrypt"
)

func AuthenticateCustom(logger *zap.Logger, db *sql.DB, customID, username string, create bool) (string, string, error) {
	if create {
		// Use existing user account if found, otherwise create a new user account.
		userID := uuid.NewV4().String()
		ts := time.Now().UTC().Unix()
		// NOTE: This query relies on the `custom_id` conflict triggering before the `users_username_key`
		// constraint violation to ensure we fall to the RETURNING case and ignore the new username for
		// existing user accounts. The DO UPDATE SET is to trick the DB into having the data we need to return.
		query := `
INSERT INTO users (id, username, custom_id, created_at, updated_at)
VALUES ($1, $2, $3, $4, $4)
ON CONFLICT (custom_id) DO UPDATE SET custom_id = $3
RETURNING id, username, disabled_at`

		var dbUserID string
		var dbUsername string
		var dbDisabledAt int64
		err := db.QueryRow(query, userID, username, customID, ts).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			logger.Error("Cannot find or create user with custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if dbDisabledAt != 0 {
			logger.Debug("User account is disabled.", zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	} else {
		// Do not create a new user account.
		query := `
SELECT id, username, disabled_at
FROM users
WHERE custom_id = $1`

		var dbUserID string
		var dbUsername string
		var dbDisabledAt int64
		err := db.QueryRow(query, customID).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return "", "", status.Error(codes.NotFound, "User account not found.")
			} else {
				logger.Error("Cannot find user with custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
				return "", "", status.Error(codes.Internal, "Error finding user account.")
			}
		}

		if dbDisabledAt != 0 {
			logger.Debug("User account is disabled.", zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	}
}

func AuthenticateDevice(logger *zap.Logger, db *sql.DB, deviceID, username string, create bool) (string, string, error) {
	if create {
		// Use existing user account if found, otherwise create a new user account.
		var dbUserID string
		var dbUsername string
		fnErr := Transact(logger, db, func (tx *sql.Tx) error {
			userID := uuid.NewV4().String()
			ts := time.Now().UTC().Unix()
			query := `
INSERT INTO users (id, username, created_at, updated_at)
SELECT $1 AS id,
			 $2 AS username,
			 $4 AS created_at,
			 $4 AS updated_at
WHERE NOT EXISTS
    (SELECT id
     FROM user_device
     WHERE id = $3::VARCHAR)
RETURNING id, username, disabled_at`

			var dbDisabledAt int64
			err := tx.QueryRow(query, userID, username, deviceID, ts).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
			if err != nil {
				if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
					return status.Error(codes.AlreadyExists, "Username is already in use.")
				}
				logger.Error("Cannot find or create user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return status.Error(codes.Internal, "Error finding or creating user account.")
			}

			if dbDisabledAt != 0 {
				logger.Debug("User account is disabled.", zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return status.Error(codes.Unauthenticated, "Error finding or creating user account.")
			}

			query = "INSERT INTO user_device (id, user_id) VALUES ($1, $2)"
			_, err = tx.Exec(query, deviceID, userID)
			if err != nil {
				logger.Error("Cannot add device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return status.Error(codes.Internal, "Error finding or creating user account.")
			}

			return nil
		})

		if fnErr != nil {
			return dbUserID, dbUsername, fnErr
		}

		return dbUserID, dbUsername, nil
	} else {
		query := "SELECT user_id FROM user_device WHERE id = $1"

		var dbUserID string
		err := db.QueryRow(query, deviceID).Scan(&dbUserID)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return "", "", status.Error(codes.NotFound, "Device ID not found.")
			} else {
				logger.Error("Cannot find user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return "", "", status.Error(codes.Internal, "Error finding user account.")
			}
		}

		query = "SELECT username, disabled_at FROM users WHERE id = $1"
		var dbUsername string
		var dbDisabledAt int64

		err = db.QueryRow(query, dbUserID).Scan(&dbUsername, &dbDisabledAt)
		if err != nil {
			logger.Error("Cannot find user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Internal, "Error finding user account.")
		}

		if dbDisabledAt != 0 {
			logger.Debug("User account is disabled.", zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	}
}

func AuthenticateEmail(logger *zap.Logger, db *sql.DB, email, password, username string, create bool) (string, string, error) {
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

	if create {
		// Use existing user account if found, otherwise create a new user account.
		userID := uuid.NewV4().String()
		ts := time.Now().UTC().Unix()
		query := `
INSERT INTO users (id, username, email, password, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $5)
ON CONFLICT (email) DO UPDATE SET email = $3, password = $4
RETURNING id, username, disabled_at`

		var dbUserID string
		var dbUsername string
		var dbDisabledAt int64
		err := db.QueryRow(query, userID, username, email, hashedPassword, ts).Scan(&dbUserID, &dbUsername, &dbDisabledAt)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			logger.Error("Cannot find or create user with email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if dbDisabledAt != 0 {
			logger.Debug("User account is disabled.", zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	} else {
		// Do not create a new user account.
		query := `
SELECT id, username, password, disabled_at
FROM users
WHERE email = $1`

		var dbUserID string
		var dbUsername string
		var dbPassword string
		var dbDisabledAt int64
		err := db.QueryRow(query, email).Scan(&dbUserID, &dbUsername, &dbPassword, &dbDisabledAt)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return "", "", status.Error(codes.NotFound, "User account not found.")
			} else {
				logger.Error("Cannot find user with email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
				return "", "", status.Error(codes.Internal, "Error finding user account.")
			}
		}

		if dbDisabledAt != 0 {
			logger.Debug("User account is disabled.", zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(password))
		if err != nil {
			return "", "", status.Error(codes.Unauthenticated, "Invalid credentials.")
		}

		return dbUserID, dbUsername, nil
	}
}
