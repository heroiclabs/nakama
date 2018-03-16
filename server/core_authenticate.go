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

	"encoding/json"
	"strconv"

	"errors"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/social"
	"github.com/lib/pq"
	"github.com/satori/go.uuid"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func AuthenticateCustom(logger *zap.Logger, db *sql.DB, customID, username string, create bool) (string, string, bool, error) {
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE custom_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime *pq.NullTime
	err := db.QueryRow(query, customID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Cannot find user with custom ID.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.NewV4().String()
	query = "INSERT INTO users (id, username, custom_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.Exec(query, userID, username, customID)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			if strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(e.Message, "users_custom_id_key") {
				// A concurrent write has inserted this custom ID.
				logger.Debug("Did not insert new user as custom ID already exists.", zap.Error(err), zap.String("customID", customID), zap.String("username", username), zap.Bool("create", create))
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

func AuthenticateDevice(logger *zap.Logger, db *sql.DB, deviceID, username string, create bool) (string, string, bool, error) {
	found := true

	// Look for an existing account.
	query := "SELECT user_id FROM user_device WHERE id = $1"
	var dbUserID string
	err := db.QueryRow(query, deviceID).Scan(&dbUserID)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
			// No user account found.
			//return "", "", status.Error(codes.NotFound, "Device ID not found.")
		} else {
			logger.Error("Cannot find user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Load its details.
		query = "SELECT username, disable_time FROM users WHERE id = $1"
		var dbUsername string
		var dbDisableTime *pq.NullTime
		err = db.QueryRow(query, dbUserID).Scan(&dbUsername, &dbDisableTime)
		if err != nil {
			logger.Error("Cannot find user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}

		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.NewV4().String()
	fnErr := Transact(logger, db, func(tx *sql.Tx) error {
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

		result, err := tx.Exec(query, userID, username, deviceID)
		if err != nil {
			if err == sql.ErrNoRows {
				// A concurrent write has inserted this device ID.
				logger.Debug("Did not insert new user as device ID already exists.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
				return status.Error(codes.Internal, "Error finding or creating user account.")
			} else if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation && strings.Contains(e.Message, "users_username_key") {
				return status.Error(codes.AlreadyExists, "Username is already in use.")
			}
			logger.Error("Cannot find or create user with device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
			logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
			return status.Error(codes.Internal, "Error finding or creating user account.")
		}

		query = "INSERT INTO user_device (id, user_id) VALUES ($1, $2)"
		result, err = tx.Exec(query, deviceID, userID)
		if err != nil {
			logger.Error("Cannot add device ID.", zap.Error(err), zap.String("deviceID", deviceID), zap.String("username", username), zap.Bool("create", create))
			return status.Error(codes.Internal, "Error finding or creating user account.")
		}

		if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
			logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
			return status.Error(codes.Internal, "Error finding or creating user account.")
		}

		return nil
	})
	if fnErr != nil {
		return "", "", false, fnErr
	}

	return userID, username, true, nil
}

func AuthenticateEmail(logger *zap.Logger, db *sql.DB, email, password, username string, create bool) (string, string, bool, error) {
	found := true
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

	// Look for an existing account.
	query := "SELECT id, username, password, disable_time FROM users WHERE email = $1"
	var dbUserID string
	var dbUsername string
	var dbPassword string
	var dbDisableTime *pq.NullTime
	err := db.QueryRow(query, email).Scan(&dbUserID, &dbUsername, &dbPassword, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Cannot find user with email.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(password))
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
	userID := uuid.NewV4().String()
	query = "INSERT INTO users (id, username, email, password, create_time, update_time) VALUES ($1, $2, $3, $4, now(), now())"
	result, err := db.Exec(query, userID, username, email, hashedPassword)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			if strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(e.Message, "users_email_key") {
				// A concurrent write has inserted this email.
				logger.Debug("Did not insert new user as email already exists.", zap.Error(err), zap.String("email", email), zap.String("username", username), zap.Bool("create", create))
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

func AuthenticateFacebook(logger *zap.Logger, db *sql.DB, client *social.Client, accessToken, username string, create bool) (string, string, bool, error) {
	facebookProfile, err := client.GetFacebookProfile(accessToken)
	if err != nil {
		logger.Debug("Could not authenticate Facebook profile.", zap.Error(err))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE facebook_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime *pq.NullTime
	err = db.QueryRow(query, facebookProfile.ID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Cannot find user with Facebook ID.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.NewV4().String()
	query = "INSERT INTO users (id, username, facebook_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.Exec(query, userID, username, facebookProfile.ID)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			if strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(e.Message, "users_facebook_id_key") {
				// A concurrent write has inserted this Facebook ID.
				logger.Debug("Did not insert new user as Facebook ID already exists.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.Bool("create", create))
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

	return userID, username, true, nil
}

func AuthenticateGameCenter(logger *zap.Logger, db *sql.DB, client *social.Client, playerID, bundleID string, timestamp int64, salt, signature, publicKeyUrl, username string, create bool) (string, string, bool, error) {
	valid, err := client.CheckGameCenterID(playerID, bundleID, timestamp, salt, signature, publicKeyUrl)
	if !valid || err != nil {
		logger.Debug("Could not authenticate GameCenter profile.", zap.Error(err), zap.Bool("valid", valid))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate GameCenter profile.")
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE gamecenter_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime *pq.NullTime
	err = db.QueryRow(query, playerID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Cannot find user with GameCenter ID.", zap.Error(err), zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.NewV4().String()
	query = "INSERT INTO users (id, username, gamecenter_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.Exec(query, userID, username, playerID)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			if strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(e.Message, "users_gamecenter_id_key") {
				// A concurrent write has inserted this GameCenter ID.
				logger.Debug("Did not insert new user as GameCenter ID already exists.", zap.Error(err), zap.String("gameCenterID", playerID), zap.String("username", username), zap.Bool("create", create))
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

func AuthenticateGoogle(logger *zap.Logger, db *sql.DB, client *social.Client, idToken, username string, create bool) (string, string, bool, error) {
	googleProfile, err := client.CheckGoogleToken(idToken)
	if err != nil {
		logger.Debug("Could not authenticate Google profile.", zap.Error(err))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Google profile.")
	}
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE google_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime *pq.NullTime
	err = db.QueryRow(query, googleProfile.Sub).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Cannot find user with Google ID.", zap.Error(err), zap.String("googleID", googleProfile.Sub), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.String("googleID", googleProfile.Sub), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.NewV4().String()
	query = "INSERT INTO users (id, username, google_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.Exec(query, userID, username, googleProfile.Sub)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			if strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(e.Message, "users_google_id_key") {
				// A concurrent write has inserted this Google ID.
				logger.Debug("Did not insert new user as Google ID already exists.", zap.Error(err), zap.String("googleID", googleProfile.Sub), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Google ID.", zap.Error(err), zap.String("googleID", googleProfile.Sub), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func AuthenticateSteam(logger *zap.Logger, db *sql.DB, client *social.Client, appID int, publisherKey, token, username string, create bool) (string, string, bool, error) {
	steamProfile, err := client.GetSteamProfile(publisherKey, appID, token)
	if err != nil {
		logger.Debug("Could not authenticate Steam profile.", zap.Error(err))
		return "", "", false, status.Error(codes.Unauthenticated, "Could not authenticate Steam profile.")
	}
	steamID := strconv.FormatUint(steamProfile.SteamID, 10)
	found := true

	// Look for an existing account.
	query := "SELECT id, username, disable_time FROM users WHERE steam_id = $1"
	var dbUserID string
	var dbUsername string
	var dbDisableTime *pq.NullTime
	err = db.QueryRow(query, steamID).Scan(&dbUserID, &dbUsername, &dbDisableTime)
	if err != nil {
		if err == sql.ErrNoRows {
			found = false
		} else {
			logger.Error("Cannot find user with Steam ID.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Internal, "Error finding user account.")
		}
	}

	// Existing account found.
	if found {
		// Check if it's disabled.
		if !time.Unix(0, 0).Equal(dbDisableTime.Time) {
			logger.Debug("User account is disabled.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
			return "", "", false, status.Error(codes.Unauthenticated, "Error finding or creating user account.")
		}

		return dbUserID, dbUsername, false, nil
	}

	if !create {
		// No user account found, and creation is not allowed.
		return "", "", false, status.Error(codes.NotFound, "User account not found.")
	}

	// Create a new account.
	userID := uuid.NewV4().String()
	query = "INSERT INTO users (id, username, steam_id, create_time, update_time) VALUES ($1, $2, $3, now(), now())"
	result, err := db.Exec(query, userID, username, steamID)
	if err != nil {
		if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
			if strings.Contains(e.Message, "users_username_key") {
				// Username is already in use by a different account.
				return "", "", false, status.Error(codes.AlreadyExists, "Username is already in use.")
			} else if strings.Contains(e.Message, "users_steam_id_key") {
				// A concurrent write has inserted this Steam ID.
				logger.Debug("Did not insert new user as Steam ID already exists.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
				return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
			}
		}
		logger.Error("Cannot find or create user with Steam ID.", zap.Error(err), zap.String("steamID", steamID), zap.String("username", username), zap.Bool("create", create))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
		logger.Error("Did not insert new user.", zap.Int64("rows_affected", rowsAffectedCount))
		return "", "", false, status.Error(codes.Internal, "Error finding or creating user account.")
	}

	return userID, username, true, nil
}

func importFacebookFriends(logger *zap.Logger, db *sql.DB, client *social.Client, userID uuid.UUID, username, token string, reset bool) error {
	facebookProfiles, err := client.GetFacebookFriends(token)
	if err != nil {
		logger.Debug("Could not import Facebook friends.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
	}

	if len(facebookProfiles) == 0 && !reset {
		// No Facebook friends to import, and friend reset not requested - no work to do.
		return nil
	}

	position := time.Now().UTC().Unix()
	friendUserIDs := make([]uuid.UUID, 0)

	err = Transact(logger, db, func(tx *sql.Tx) error {
		if reset {
			// Reset all friends for the current user, replacing them entirely with their Facebook friends.
			// Note: will NOT remove blocked users.
			query := "DELETE FROM user_edge WHERE source_id = $1 AND state != 3"
			result, err := tx.Exec(query, userID)
			if err != nil {
				return err
			}
			if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 0 {
				// Update edge count to reflect removed friends.
				query = "UPDATE user SET edge_count = edge_count - $2 WHERE id = $1"
				result, err := tx.Exec(query, userID, rowsAffectedCount)
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
			rows, err := tx.Query(query, userID)
			if err != nil {
				return err
			}
			defer rows.Close()
			var id string
			query = "UPDATE user SET edge_count = edge_count - 1 WHERE id = $1"
			for rows.Next() {
				// Update edge count to reflect each removed friend.
				err = rows.Scan(&id)
				if err != nil {
					return err
				}
				result, err := tx.Exec(query, id)
				if err != nil {
					return err
				}
				if rowsAffectedCount, _ := result.RowsAffected(); rowsAffectedCount != 1 {
					return errors.New("error updating edge count after friend reset")
				}
			}
		}

		statements := make([]string, 0, len(facebookProfiles))
		params := make([]interface{}, 0, len(facebookProfiles))
		count := 1
		for _, facebookProfile := range facebookProfiles {
			statements = append(statements, "$"+strconv.Itoa(count))
			params = append(params, facebookProfile.ID)
			count++
		}

		query := "SELECT id FROM users WHERE facebook_id IN (" + strings.Join(statements, ", ") + ")"

		rows, err := tx.Query(query, params...)
		if err != nil {
			if err == sql.ErrNoRows {
				// None of the friend profiles exist.
				return nil
			}
			return err
		}

		var id string
		for rows.Next() {
			err = rows.Scan(&id)
			if err != nil {
				// Error scanning the ID, try to skip this user and move on.
				continue
			}
			friendID := uuid.FromStringOrNil(id)

			_, err = tx.Query("SELECT state FROM user_edge WHERE source_id = $1 AND destination_id = $2 AND state = 3", userID, friendID)
			if err == nil {
				// User has previously blocked this friend, skip it.
				continue
			} else if err != sql.ErrNoRows {
				logger.Error("Error checking block status in Facebook friend import.", zap.Error(err))
				continue
			}

			// Attempt to mark as accepted any previous invite between these users, in any direction.
			res, err := tx.Exec(`
UPDATE user_edge SET state = 0, update_time = now()
WHERE (source_id = $1 AND destination_id = $2 AND (state = 1 OR state = 2))
OR (source_id = $2 AND destination_id = $1 AND (state = 1 OR state = 2))
`, friendID, userID)
			if err != nil {
				logger.Error("Error accepting invite in Facebook friend import.", zap.Error(err))
				continue
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
				// Success, move on.
				friendUserIDs = append(friendUserIDs, friendID)
				continue
			}

			_, err = tx.Exec(`
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
				logger.Error("Error adding new edges in Facebook friend import.", zap.Error(err))
				continue
			}

			res, err = tx.Exec(`
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
				logger.Error("Error updating edge count in Facebook friend import.", zap.Error(err))
				continue
			}
			if rowsAffected, _ := res.RowsAffected(); rowsAffected == 2 {
				// Success, move on.
				friendUserIDs = append(friendUserIDs, friendID)
			}
		}

		return nil
	})
	if err != nil {
		logger.Error("Error importing Facebook friends.", zap.Error(err))
		return status.Error(codes.Internal, "Error importing Facebook friends.")
	}

	if len(friendUserIDs) != 0 {
		notifications := make(map[uuid.UUID][]*api.Notification, len(friendUserIDs))
		content, _ := json.Marshal(map[string]interface{}{"username": username})
		subject := "Your friend has just joined the game"
		for _, friendUserID := range friendUserIDs {
			notifications[friendUserID] = []*api.Notification{&api.Notification{
				Id:         uuid.NewV4().String(),
				Subject:    subject,
				Content:    string(content),
				SenderId:   userID.String(),
				Code:       NOTIFICATION_FRIEND_JOIN_GAME,
				Persistent: true,
				CreateTime: &timestamp.Timestamp{Seconds: position},
			}}
		}
	}

	return nil
}
