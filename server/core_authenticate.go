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
	"database/sql"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
INSERT INTO users (id, username, custom_id, create_time, update_time)
VALUES ($1, $2, $3, $4, $4)
ON CONFLICT (custom_id) DO UPDATE SET custom_id = $3
RETURNING id, username, disable_time`

		var dbUserID string
		var dbUsername string
		var dbDisableTime int64
		err := db.QueryRow(query, userID, username, customID, ts).Scan(&dbUserID, &dbUsername, &dbDisableTime)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			logger.Error("Cannot find or create user with custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if dbDisableTime != 0 {
			logger.Debug("User account is disabled.", zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	} else {
		// Do not create a new user account.
		query := `
SELECT id, username, disable_time
FROM users
WHERE custom_id = $1`

		var dbUserID string
		var dbUsername string
		var dbDisableTime int64
		err := db.QueryRow(query, customID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return "", "", status.Error(codes.NotFound, "User account not found.")
			} else {
				logger.Error("Cannot find user with custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
				return "", "", status.Error(codes.Internal, "Error finding user account.")
			}
		}

		if dbDisableTime != 0 {
			logger.Debug("User account is disabled.", zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	}
}

func AuthenticateDevice(logger *zap.Logger, db *sql.DB, deviceID, username string, create bool) (string, string, error) {
	if !create {
		return LoginDevice(logger, db, deviceID, username, create)
	}

	// Use existing user account if found, otherwise create a new user account.
	var dbUserID string
	var dbUsername string
	fnErr := Transact(logger, db, func(tx *sql.Tx) error {
		userID := uuid.NewV4().String()
		ts := time.Now().UTC().Unix()
		query := `
INSERT INTO users (id, username, create_time, update_time)
SELECT $1 AS id,
		 $2 AS username,
		 $4 AS create_time,
		 $4 AS update_time
WHERE NOT EXISTS
  (SELECT id
   FROM user_device
   WHERE id = $3::VARCHAR)
ON CONFLICT(id) DO NOTHING
RETURNING id, username, disable_time`

		var dbDisableTime int64
		err := tx.QueryRow(query, userID, username, deviceID, ts).Scan(&dbUserID, &dbUsername, &dbDisableTime)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				return status.Error(codes.AlreadyExists, "Username is already in use.")
			}

			if err == sql.ErrNoRows {
				// let's catch this case as it could be there could be a device ID already
				// linked to a ID so let's attempt a vanilla login
				dbUserID, dbUsername, err = LoginDevice(logger, db, deviceID, username, create)
				return err
			} else {
				logger.Error("Cannot find or create user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}

		if dbDisableTime != 0 {
			logger.Debug("User account is disabled.", zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		query = "INSERT INTO user_device (id, user_id) VALUES ($1, $2) ON CONFLICT(id) DO NOTHING"
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
}

func LoginDevice(logger *zap.Logger, db *sql.DB, deviceID, username string, create bool) (string, string, error) {
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

	query = "SELECT username, disable_time FROM users WHERE id = $1"
	var dbUsername string
	var dbDisableTime int64

	err = db.QueryRow(query, dbUserID).Scan(&dbUsername, &dbDisableTime)
	if err != nil {
		logger.Error("Cannot find user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
		return "", "", status.Error(codes.Internal, "Error finding user account.")
	}

	if dbDisableTime != 0 {
		logger.Debug("User account is disabled.", zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
		return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
	}

	return dbUserID, dbUsername, nil
}

func AuthenticateEmail(logger *zap.Logger, db *sql.DB, email, password, username string, create bool) (string, string, error) {
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

	if create {
		// Use existing user account if found, otherwise create a new user account.
		userID := uuid.NewV4().String()
		ts := time.Now().UTC().Unix()
		query := `
INSERT INTO users (id, username, email, password, create_time, update_time)
VALUES ($1, $2, $3, $4, $5, $5)
ON CONFLICT (email) DO UPDATE SET email = $3, password = $4
RETURNING id, username, disable_time`

		var dbUserID string
		var dbUsername string
		var dbDisableTime int64
		err := db.QueryRow(query, userID, username, email, hashedPassword, ts).Scan(&dbUserID, &dbUsername, &dbDisableTime)
		if err != nil {
			if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			logger.Error("Cannot find or create user with email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if dbDisableTime != 0 {
			logger.Debug("User account is disabled.", zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, nil
	} else {
		// Do not create a new user account.
		query := `
SELECT id, username, password, disable_time
FROM users
WHERE email = $1`

		var dbUserID string
		var dbUsername string
		var dbPassword string
		var dbDisableTime int64
		err := db.QueryRow(query, email).Scan(&dbUserID, &dbUsername, &dbPassword, &dbDisableTime)
		if err != nil {
			if err == sql.ErrNoRows {
				// No user account found.
				return "", "", status.Error(codes.NotFound, "User account not found.")
			} else {
				logger.Error("Cannot find user with email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
				return "", "", status.Error(codes.Internal, "Error finding user account.")
			}
		}

		if dbDisableTime != 0 {
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
