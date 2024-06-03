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
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/social"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func AuthenticateApple(ctx context.Context, logger *zap.Logger, db *sql.DB, client *social.Client, bundleId, token, username string, create bool) (string, string, bool, error) {
	profile, err := client.CheckAppleToken(ctx, bundleId, token)
	if err != nil {
		logger.Info("Could not authenticate Apple profile.", zap.Error(err))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Apple profile.")
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE apple_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err = db.QueryRowContext(ctx, query, profile.ID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by Apple ID.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("appleID", profile.ID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, email, apple_id, create_time, update_time) VALUES ($1, $2, nullif($3, ''), $4, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, profile.Email, profile.ID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_apple_id_key") {
				// A concurrent write has inserted this Apple ID.
				logger.Info("Did not insert new user as Apple ID already exists.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Apple ID.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	// Import email address, if it exists.
	if profile.Email != "" {
		_, err = db.ExecContext(ctx, "UPDATE users SET email = $1 WHERE id = $2", profile.Email, userID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_email_key") {
				logger.Warn("Skipping apple account email import as it is already set in another user.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("username", username), zap.Bool("create", create), zap.String("created_user_id", userID))
			} else {
				logger.Error("Failed to import apple account email.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("username", username), zap.Bool("create", create), zap.String("created_user_id", userID))
				return "", "", false, status.Error(codes.Internal, "Error importing apple account email.")
			}
		}
	}

	return userID, username, true, nil
}

func AuthenticateCustom(ctx context.Context, logger *zap.Logger, db *sql.DB, customID, username string, create bool) (string, string, bool, error) {
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE custom_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err := db.QueryRowContext(ctx, query, customID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, custom_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, customID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_custom_id_key") {
				// A concurrent write has inserted this custom ID.
				logger.Info("Did not insert new user as custom ID already exists.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func AuthenticateDevice(ctx context.Context, logger *zap.Logger, db *sql.DB, deviceID, username string, create bool) (string, string, bool, error) {
	found := true

	// Look for an existing account.
	query := "SELECT user_id FROM user_device WHERE id = $1"
	var dbUserID string
	err := db.QueryRowContext(ctx, query, deviceID).Scan(&dbUserID)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Load its details.
		query = "SELECT username, disable_time FROM users WHERE id = $1"
		var dbUsername string
		var dbDisableTime pgtype.Timestamptz
		err = db.QueryRowContext(ctx, query, dbUserID).Scan(&dbUsername, &dbDisableTime)
		if err != nil {
			logger.Error("Error looking up user by device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}

		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()

	err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		query := `
INSERT INTO users (id, username, create_time, update_time)
SELECT $1 AS id,
		 $2 AS username,
		 now(),
		 now()
WHERE NOT EXISTS
  (SELECT id
   FROM user_device
   WHERE id = $3::VARCHAR)`

		result, err := tx.ExecContext(ctx, query, userID, username, deviceID)
		if err != nil {
			var pgErr *pgconn.PgError
			ok := errors.As(err, &pgErr)
			if err == sql.ErrNoRows || (ok && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "user_device_pkey")) {
				// A concurrent write has inserted this device ID.
				logger.Info("Did not insert new user as device ID already exists.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return StatusError(codes.Internal, "Error finding or creating user account.", err)
			} else if ok && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_username_key") {
				return StatusError(codes.AlreadyExists, "Username is already in use.", err)
			}
			logger.Debug("Cannot find or create user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return err
		}

		if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
			logger.Debug("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
			return StatusError(codes.Internal, "Error finding or creating user account.", ErrRowsAffectedCount)
		}

		query = "INSERT INTO user_device (id, user_id) VALUES ($1, $2)"
		result, err = tx.ExecContext(ctx, query, deviceID, userID)
		if err != nil {
			logger.Debug("Cannot add device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return err
		}

		if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
			logger.Debug("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
			return StatusError(codes.Internal, "Error finding or creating user account.", ErrRowsAffectedCount)
		}

		return nil
	})
	if err != nil {
		if e, ok := err.(*statusError); ok {
			return "", "", false, e.Status()
		}
		logger.Error("Error in database transaction.", zap.Error(err))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func AuthenticateEmail(ctx context.Context, logger *zap.Logger, db *sql.DB, email, password, username string, create bool) (string, string, bool, error) {
	found := true

	// Look for an existing account.
	query := "SELECT id, username, password, disable_time FROM users WHERE email = $1"
	var dbUserID string
	var dbUsername string
	var dbPassword []byte
	var dbDisableTime pgtype.Timestamptz
	err := db.QueryRowContext(ctx, query, email).Scan(&dbUserID, &dbUsername, &dbPassword, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		// Check if password matches.
		err = bcrypt.CompareHashAndPassword(dbPassword, []byte(password))
		if err != nil {
			return "", "", false, status.Error(codes.Unauthenticated, "Invalid credentials.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		logger.Error("Error hashing password.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}
	query = "INSERT INTO users (id, username, email, password, create_time, update_time) VALUES ($1, $2, $3, $4, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, email, hashedPassword)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_email_key") {
				// A concurrent write has inserted this email.
				logger.Info("Did not insert new user as email already exists.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func AuthenticateUsername(ctx context.Context, logger *zap.Logger, db *sql.DB, username, password string) (string, error) {
	// Look for an existing account.
	query := "SELECT id, password, disable_time FROM users WHERE username = $1"
	var dbUserID string
	var dbPassword []byte
	var dbDisableTime pgtype.Timestamptz
	err := db.QueryRowContext(ctx, query, username).Scan(&dbUserID, &dbPassword, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			// Account not found and creation is never allowed for this type.
			return "", status.Error(codes.NotFound, "User account not found.")
		}
		logger.Error("Error looking up user by username.", zap.Error(err), zap.String("username", username))
		return "", status.Error(codes.Internal, "Error finding user account.")
	}

	// Check if it's disabled.
	if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
		logger.Info("User account is disabled.", zap.String("username", username))
		return "", status.Error(codes.PermissionDenied, "User account banned.")
	}

	// Check if the account has a password.
	if len(dbPassword) == 0 {
		// Do not disambiguate between bad password and password login not possible at all in client-facing error messages.
		return "", status.Error(codes.Unauthenticated, "Invalid credentials.")
	}

	// Check if password matches.
	err = bcrypt.CompareHashAndPassword(dbPassword, []byte(password))
	if err != nil {
		return "", status.Error(codes.Unauthenticated, "Invalid credentials.")
	}

	return dbUserID, nil
}

func AuthenticateFacebook(ctx context.Context, logger *zap.Logger, db *sql.DB, client *social.Client, appId, accessToken, username string, create bool) (string, string, bool, error) {
	var facebookProfile *social.FacebookProfile
	var err error

	// Try Facebook Limited Login first.
	facebookProfile, err = client.CheckFacebookLimitedLoginToken(ctx, appId, accessToken)
	if err != nil {
		// If that failed try standard Facebook auth.
		facebookProfile, err = client.GetFacebookProfile(ctx, accessToken)
		if err != nil {
			logger.Info("Could not authenticate Facebook profile.", zap.Error(err))
			return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
		}
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE facebook_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err = db.QueryRowContext(ctx, query, facebookProfile.ID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by Facebook ID.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, display_name, avatar_url, facebook_id, create_time, update_time) VALUES ($1, $2, $3, $4, $5, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, facebookProfile.Name, facebookProfile.Picture.Data.Url, facebookProfile.ID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_facebook_id_key") {
				// A concurrent write has inserted this Facebook ID.
				logger.Info("Did not insert new user as Facebook ID already exists.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Facebook ID.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	// Import email address, if it exists.
	if facebookProfile.Email != "" {
		_, err = db.ExecContext(ctx, "UPDATE users SET email = $1 WHERE id = $2", facebookProfile.Email, userID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_email_key") {
				logger.Warn("Skipping facebook account email import as it is already set in another user.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create), zap.String("created_user_id", userID))
			} else {
				logger.Error("Failed to import facebook account email.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create), zap.String("created_user_id", userID))
				return "", "", false, status.Error(codes.Internal, "Error importing facebook account email.")
			}
		}
	}

	return userID, username, true, nil
}

func AuthenticateFacebookInstantGame(ctx context.Context, logger *zap.Logger, db *sql.DB, client *social.Client, appSecret string, signedPlayerInfo string, username string, create bool) (string, string, bool, error) {
	facebookInstantGameID, err := client.ExtractFacebookInstantGameID(signedPlayerInfo, appSecret)
	if err != nil {
		logger.Error("Error extracting the Facebook Instant Game player ID or validating the signature", zap.Error(err), zap.String("signedPlayerInfo", signedPlayerInfo))
		return "", "", false, status.Error(codes.DataLoss, "Error extracting the Facebook Instant Game player ID or validating the signature")
	}

	// Look for an existing account.
	found := true
	query := "SELECT id, username, disable_time FROM users WHERE facebook_instant_game_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err = db.QueryRowContext(ctx, query, facebookInstantGameID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by Facebook Instant Game ID.", zap.Error(err), zap.String("facebookInstantGameID", facebookInstantGameID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("facebookInstantGameID", facebookInstantGameID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, facebook_instant_game_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, facebookInstantGameID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_facebook_instant_game_id_key") {
				// A concurrent write has inserted this Facebook ID.
				logger.Info("Did not insert new user as this Facebook Instant Game ID already exists.", zap.Error(err), zap.String("facebookInstantGameID", facebookInstantGameID), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Facebook Instant Game ID.", zap.Error(err), zap.String("facebookInstantGameID", facebookInstantGameID), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func AuthenticateGameCenter(ctx context.Context, logger *zap.Logger, db *sql.DB, client *social.Client, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl, username string, create bool) (string, string, bool, error) {
	valid, err := client.CheckGameCenterID(ctx, playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
	if !valid || err != nil {
		logger.Info("Could not authenticate GameCenter profile.", zap.Error(err), zap.Bool("valid", valid))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate GameCenter profile.")
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE gamecenter_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err = db.QueryRowContext(ctx, query, playerID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by GameCenter ID.", zap.Error(err), zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, gamecenter_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, playerID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_gamecenter_id_key") {
				// A concurrent write has inserted this GameCenter ID.
				logger.Info("Did not insert new user as GameCenter ID already exists.", zap.Error(err), zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with GameCenter ID.", zap.Error(err), zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func RemapGoogleId(ctx context.Context, logger *zap.Logger, db *sql.DB, googleProfile social.GoogleProfile) error {
	// Look for an account with original ID if different, and remap to new ID
	var err error = nil
	if len(googleProfile.GetOriginalGoogleId()) > 0 && googleProfile.GetGoogleId() != googleProfile.GetOriginalGoogleId() {
		_, err = db.ExecContext(ctx, "UPDATE users SET google_id = $1 where google_id = $2", googleProfile.GetGoogleId(), googleProfile.GetOriginalGoogleId())
	}
	return err
}

func AuthenticateGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, client *social.Client, idToken, username string, create bool) (string, string, bool, error) {
	googleProfile, err := client.CheckGoogleToken(ctx, idToken)
	if err != nil {
		logger.Info("Could not authenticate Google profile.", zap.Error(err))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Google profile.")
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time, display_name, avatar_url FROM users WHERE google_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	var dbDisplayName sql.NullString
	var dbAvatarURL sql.NullString
	err = db.QueryRowContext(ctx, query, googleProfile.GetGoogleId()).Scan(&dbUserID, &dbUsername, &dbDisableTime, &dbDisplayName, &dbAvatarURL)
	if err != nil {
		if err == sql.ErrNoRows {
			err = RemapGoogleId(ctx, logger, db, googleProfile)
			if err == nil {
				err = db.QueryRowContext(ctx, query, googleProfile.GetGoogleId()).Scan(&dbUserID, &dbUsername, &dbDisableTime, &dbDisplayName, &dbAvatarURL)
			}
		}

		if err == sql.ErrNoRows {
			found = false
		} else if err != nil {
			logger.Error("Error looking up user by Google ID.", zap.Error(err),
				zap.String("googleID", googleProfile.GetGoogleId()),
				zap.String("originalGoogleID", googleProfile.GetOriginalGoogleId()),
				zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	var displayName string
	if len(googleProfile.GetDisplayName()) <= 255 {
		displayName = googleProfile.GetDisplayName()
	} else {
		logger.Warn("Skipping updating display_name: value received from Google longer than max length of 255 chars.", zap.String("display_name", googleProfile.GetDisplayName()))
	}

	var avatarURL string
	if len(googleProfile.GetAvatarImageUrl()) <= 512 {
		avatarURL = googleProfile.GetAvatarImageUrl()
	} else {
		logger.Warn("Skipping updating avatar_url: value received from Google longer than max length of 512 chars.", zap.String("avatar_url", avatarURL))
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.String("googleID", googleProfile.GetGoogleId()), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		// Check if the display name or avatar received from Google have values but the DB does not.
		if (dbDisplayName.String == "" && displayName != "") || (dbAvatarURL.String == "" && avatarURL != "") {
			// At least one valid change found, update the DB to reflect changes.
			params := make([]interface{}, 0, 3)
			params = append(params, dbUserID)

			// Ensure only changed values are applied.
			statements := make([]string, 0, 2)
			if dbDisplayName.String == "" && displayName != "" {
				params = append(params, displayName)
				statements = append(statements, "display_name = $"+strconv.Itoa(len(params)))
			}
			if dbAvatarURL.String == "" && avatarURL != "" {
				params = append(params, avatarURL)
				statements = append(statements, "avatar_url = $"+strconv.Itoa(len(params)))
			}

			if len(statements) > 0 {
				if _, err = db.ExecContext(ctx, "UPDATE users SET "+strings.Join(statements, ", ")+", update_time = now() WHERE id = $1", params...); err != nil {
					// Failure to update does not interrupt the execution. Just log the error and continue.
					logger.Error("Error in updating google profile details", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("display_name", googleProfile.GetDisplayName()), zap.String("avatar_url", googleProfile.GetAvatarImageUrl()))
				}
			}
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, google_id, display_name, avatar_url, create_time, update_time) VALUES ($1, $2, $3, $4, $5, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, googleProfile.GetGoogleId(), displayName, avatarURL)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_google_id_key") {
				// A concurrent write has inserted this Google ID.
				logger.Info("Did not insert new user as Google ID already exists.", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Google ID.", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	// Import email address, if it exists.
	if googleProfile.GetEmail() != "" {
		_, err = db.ExecContext(ctx, "UPDATE users SET email = $1 WHERE id = $2", googleProfile.GetEmail(), userID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_email_key") {
				logger.Warn("Skipping google account email import as it is already set in another user.", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("username", username), zap.Bool("create", create), zap.String("created_user_id", userID))
			} else {
				logger.Error("Failed to import google account email.", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("username", username), zap.Bool("create", create), zap.String("created_user_id", userID))
				return "", "", false, status.Error(codes.Internal, "Error importing google account email.")
			}
		}
	}

	return userID, username, true, nil
}

func AuthenticateSteam(ctx context.Context, logger *zap.Logger, db *sql.DB, client *social.Client, appID int, publisherKey, token, username string, create bool) (string, string, string, bool, error) {
	steamProfile, err := client.GetSteamProfile(ctx, publisherKey, appID, token)
	if err != nil {
		logger.Info("Could not authenticate Steam profile.", zap.Error(err))
		return "", "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Steam profile.")
	}
	steamID := strconv.FormatUint(steamProfile.SteamID, 10)
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE steam_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime pgtype.Timestamptz
	err = db.QueryRowContext(ctx, query, steamID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Error looking up user by Steam ID.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
			return "", "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if dbDisableTime.Valid && dbDisableTime.Time.Unix() != 0 {
			logger.Info("User account is disabled.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
			return "", "", "", false, status.Error(codes.PermissionDenied, "User account banned.")
		}

		return dbUserID, dbUsername, steamID, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.Must(uuid.NewV4()).String()
	query = "INSERT INTO users (id, username, steam_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.ExecContext(ctx, query, userID, username, steamID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
			if strings.Contains(pgErr.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(pgErr.Message, "users_steam_id_key") {
				// A concurrent write has inserted this Steam ID.
				logger.Info("Did not insert new user as Steam ID already exists.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
				return "", "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Steam ID.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
		return "", "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, steamID, true, nil
}

func importSteamFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, client *social.Client, userID uuid.UUID, username, publisherKey, steamId string, reset bool) error {
	logger = logger.With(zap.String("userID", userID.String()))

	steamProfiles, err := client.GetSteamFriends(ctx, publisherKey, steamId)
	var unauthorizedErr *social.UnauthorizedError
	if err != nil && !errors.As(err, &unauthorizedErr) {
		// If error is unauthorized it means the profile or friends is private, ignore.
		logger.Error("Could not import Steam friends.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Steam profile.")
	}

	if len(steamProfiles) == 0 && !reset {
		// No Steam friends to import, and friend reset not requested - no work to do.
		return nil
	}

	var friendUserIDs []uuid.UUID
	err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		if reset {
			if err := resetUserFriends(ctx, tx, userID); err != nil {
				logger.Error("Could not reset user friends", zap.Error(err))
				return err
			}
		}

		// A reset was requested, but now there are no Steam friend profiles to look for.
		if len(steamProfiles) == 0 {
			return nil
		}

		steamIDs := make([]string, 0, len(steamProfiles))
		for _, steamProfile := range steamProfiles {
			steamIDs = append(steamIDs, strconv.FormatUint(steamProfile.SteamID, 10))
		}

		query := "SELECT id FROM users WHERE steam_id = ANY($1::text[])"
		rows, err := tx.QueryContext(ctx, query, steamIDs)
		if err != nil {
			if err == sql.ErrNoRows {
				// None of the friend profiles exist.
				return nil
			}
			return err
		}

		var id string
		possibleFriendIDs := make([]uuid.UUID, 0, len(steamIDs))
		for rows.Next() {
			err = rows.Scan(&id)
			if err != nil {
				// Error scanning the ID, try to skip this user and move on.
				continue
			}
			friendID, err := uuid.FromString(id)
			if err != nil {
				continue
			}
			possibleFriendIDs = append(possibleFriendIDs, friendID)
		}
		_ = rows.Close()

		friendUserIDs = importFriendsByUUID(ctx, logger, tx, userID, possibleFriendIDs, "Steam")
		return nil
	})
	if err != nil {
		logger.Error("Error importing Steam friends.", zap.Error(err))
		return status.Error(codes.Internal, "Error importing Steam friends.")
	}

	if len(friendUserIDs) != 0 {
		sendFriendAddedNotification(ctx, logger, db, tracker, messageRouter, userID, username, friendUserIDs)
	}

	return nil
}

func importFacebookFriends(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, client *social.Client, userID uuid.UUID, username, token string, reset bool) error {
	logger = logger.With(zap.String("userID", userID.String()))

	facebookProfiles, err := client.GetFacebookFriends(ctx, token)
	if err != nil {
		logger.Error("Could not import Facebook friends.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
	}

	if len(facebookProfiles) == 0 && !reset {
		// No Facebook friends to import, and friend reset not requested - no work to do.
		return nil
	}

	var friendUserIDs []uuid.UUID
	err = ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		if reset {
			if err := resetUserFriends(ctx, tx, userID); err != nil {
				logger.Error("Could not reset user friends", zap.Error(err))
				return err
			}
		}

		// A reset was requested, but now there are no Facebook friend profiles to look for.
		if len(facebookProfiles) == 0 {
			return nil
		}

		params := make([]string, 0, len(facebookProfiles))
		for _, facebookProfile := range facebookProfiles {
			params = append(params, facebookProfile.ID)
		}

		query := "SELECT id FROM users WHERE facebook_id = ANY($1::text[])"
		rows, err := tx.QueryContext(ctx, query, params)
		if err != nil {
			if err == sql.ErrNoRows {
				// None of the friend profiles exist.
				return nil
			}
			return err
		}

		var id string
		possibleFriendIDs := make([]uuid.UUID, 0, len(params))
		for rows.Next() {
			err = rows.Scan(&id)
			if err != nil {
				// Error scanning the ID, try to skip this user and move on.
				continue
			}
			friendID, err := uuid.FromString(id)
			if err != nil {
				continue
			}
			possibleFriendIDs = append(possibleFriendIDs, friendID)
		}
		_ = rows.Close()

		friendUserIDs = importFriendsByUUID(ctx, logger, tx, userID, possibleFriendIDs, "Facebook")
		return nil
	})
	if err != nil {
		logger.Error("Error importing Facebook friends.", zap.Error(err))
		return status.Error(codes.Internal, "Error importing Facebook friends.")
	}

	if len(friendUserIDs) != 0 {
		sendFriendAddedNotification(ctx, logger, db, tracker, messageRouter, userID, username, friendUserIDs)
	}

	return nil
}

func resetUserFriends(ctx context.Context, tx *sql.Tx, userID uuid.UUID) error {
	// Reset all friends for the current user, replacing them entirely with their Facebook friends.
	// Note: will NOT remove blocked users.
	query := "DELETE FROM user_edge WHERE source_id = $1 AND state != 3"
	result, err := tx.ExecContext(ctx, query, userID)
	if err != nil {
		return err
	}
	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 0 {
		// Update edge count to reflect removed friends.
		query = "UPDATE users SET edge_count = edge_count - $2 WHERE id = $1"
		result, err := tx.ExecContext(ctx, query, userID, rowsAffectedCount)
		if err != nil {
			return err
		}
		if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
			return errors.New("error updating edge count after friends reset")
		}
	}

	// Remove links to the current user.
	// Note: will NOT remove blocks.
	query = "DELETE FROM user_edge WHERE destination_id = $1 AND state != 3 RETURNING source_id"
	rows, err := tx.QueryContext(ctx, query, userID)
	if err != nil {
		return err
	}
	params := make([]string, 0, 10)
	for rows.Next() {
		var id string
		err = rows.Scan(&id)
		if err != nil {
			_ = rows.Close()
			return err
		}
		params = append(params, id)
	}
	_ = rows.Close()

	if len(params) > 0 {
		query = "UPDATE users SET edge_count = edge_count - 1 WHERE id = ANY($1)"
		result, err := tx.ExecContext(ctx, query, params)
		if err != nil {
			return err
		}
		if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != int64(len(params)) {
			return errors.New("error updating edge count after friend reset")
		}
	}

	return nil
}

func importFriendsByUUID(ctx context.Context, logger *zap.Logger, tx *sql.Tx, userID uuid.UUID, possibleFriendIDs []uuid.UUID, provider string) []uuid.UUID {
	logger = logger.With(zap.String("provider", provider))
	// If the transaction is retried ensure we wipe any friend user IDs that may have been recorded by previous attempts.
	friendUserIDs := make([]uuid.UUID, 0, len(possibleFriendIDs))

	for _, friendID := range possibleFriendIDs {
		position := fmt.Sprintf("%v", time.Now().UTC().UnixNano())

		var state sql.NullInt64
		err := tx.QueryRowContext(ctx, "SELECT state FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state = 3", userID, friendID).Scan(&state)
		if err != nil && err != sql.ErrNoRows {
			logger.Error("Error checking blocked status in friend import.", zap.Error(err))
			continue
		}

		// Attempt to mark as accepted any previous invite between these users, in any direction.
		res, err := tx.ExecContext(ctx, `
UPDATE user_edge SET state = 0, update_time = now()
WHERE (source_id = $1 AND destination_id = $2 AND (state = 1 OR state = 2))
OR (source_id = $2 AND destination_id = $1 AND (state = 1 OR state = 2))
`, friendID, userID)
		if err != nil {
			logger.Error("Error accepting invite in friend import.", zap.Error(err))
			continue
		}
		if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
			// Success, move on.
			friendUserIDs = append(friendUserIDs, friendID)
			continue
		}

		_, err = tx.ExecContext(ctx, `
INSERT INTO user_edge (source_id, destination_id, state, position, update_time)
SELECT source_id, destination_id, state, position, update_time
FROM (VALUES
  ($1::UUID, $2::UUID, 0, $3::BIGINT, now()),
  ($2::UUID, $1::UUID, 0, $3::BIGINT, now())
) AS ue(source_id, destination_id, state, position, update_time)
WHERE EXISTS (SELECT id FROM users WHERE id = $2::UUID)
AND NOT EXISTS
	(SELECT state
	 FROM user_edge
	 WHERE source_id = $2::UUID AND destination_id = $1::UUID AND state = 3)
ON CONFLICT (source_id, destination_id) DO NOTHING
`, userID, friendID, position)
		if err != nil {
			logger.Error("Error adding new edges in friend import.", zap.Error(err))
			continue
		}

		res, err = tx.ExecContext(ctx, `
UPDATE users
SET edge_count = edge_count + 1, update_time = now()
WHERE (id = $1::UUID OR id = $2::UUID)
AND EXISTS
  (SELECT state
   FROM user_edge
   WHERE (source_id = $1::UUID AND destination_id = $2::UUID AND position = $3)
   OR (source_id = $2::UUID AND destination_id = $1::UUID AND position = $3))
`, userID, friendID, position)
		if err != nil {
			logger.Error("Error updating edge count in friend import.", zap.Error(err))
			continue
		}
		if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
			// Success, move on.
			friendUserIDs = append(friendUserIDs, friendID)
		}
	}

	return friendUserIDs
}

func sendFriendAddedNotification(ctx context.Context, logger *zap.Logger, db *sql.DB, tracker Tracker, messageRouter MessageRouter, userID uuid.UUID, username string, friendUserIDs []uuid.UUID) {
	notifications := make(map[uuid.UUID][]*api.Notification, len(friendUserIDs))
	content, _ := json.Marshal(map[string]interface{}{"username": username})
	subject := "Your friend has just joined the game"
	createTime := time.Now().UTC().Unix()
	for _, friendUserID := range friendUserIDs {
		notifications[friendUserID] = []*api.Notification{{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    subject,
			Content:    string(content),
			SenderId:   userID.String(),
			Code:       NotificationCodeFriendJoinGame,
			Persistent: true,
			CreateTime: &timestamppb.Timestamp{Seconds: createTime},
		}}
	}
	// Any error is already logged before it's returned here.
	_ = NotificationSend(ctx, logger, db, tracker, messageRouter, notifications)
}
