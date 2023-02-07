// Copyright 2020 The Nakama Authors
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
	"errors"
	"strconv"
	"strings"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/social"

	"github.com/jackc/pgx/v5/pgconn"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func LinkApple(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, userID uuid.UUID, token string) error {
	if config.GetSocial().Apple.BundleId == "" {
		return status.Error(codes.FailedPrecondition, "Apple authentication is not configured.")
	}

	if token == "" {
		return status.Error(codes.InvalidArgument, "Apple ID token is required.")
	}

	profile, err := socialClient.CheckAppleToken(ctx, config.GetSocial().Apple.BundleId, token)
	if err != nil {
		logger.Info("Could not authenticate Apple profile.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Apple profile.")
	}

	res, err := db.ExecContext(ctx, `
UPDATE users AS u
SET apple_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE apple_id = $2 AND NOT id = $1))`,
		userID,
		profile.ID)

	if err != nil {
		logger.Error("Could not link Apple ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to link Apple ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Apple ID is already in use.")
	}

	// Import email address, if it exists.
	if profile.Email != "" {
		_, err = db.ExecContext(ctx, "UPDATE users SET email = $1 WHERE id = $2", profile.Email, userID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_email_key") {
				logger.Warn("Skipping apple account email import as it is already set in another user.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("user_id", userID.String()))
			} else {
				logger.Error("Failed to import apple account email.", zap.Error(err), zap.String("appleID", profile.ID), zap.String("user_id", userID.String()))
				return status.Error(codes.Internal, "Error importing apple account email.")
			}
		}
	}

	return nil
}

func LinkCustom(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, customID string) error {
	if customID == "" {
		return status.Error(codes.InvalidArgument, "Custom ID is required.")
	} else if invalidCharsRegex.MatchString(customID) {
		return status.Error(codes.InvalidArgument, "Invalid custom ID, no spaces or control characters allowed.")
	} else if len(customID) < 6 || len(customID) > 128 {
		return status.Error(codes.InvalidArgument, "Invalid custom ID, must be 6-128 bytes.")
	}

	res, err := db.ExecContext(ctx, `
UPDATE users
SET custom_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE custom_id = $2 AND NOT id = $1))`,
		userID,
		customID)

	if err != nil {
		logger.Error("Could not link custom ID.", zap.Error(err), zap.Any("input", customID))
		return status.Error(codes.Internal, "Error while trying to link Custom ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Custom ID is already in use.")
	}
	return nil
}

func LinkDevice(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, deviceID string) error {
	if deviceID == "" {
		return status.Error(codes.InvalidArgument, "Device ID is required.")
	} else if invalidCharsRegex.MatchString(deviceID) {
		return status.Error(codes.InvalidArgument, "Device ID invalid, no spaces or control characters allowed.")
	} else if len(deviceID) < 10 || len(deviceID) > 128 {
		return status.Error(codes.InvalidArgument, "Device ID invalid, must be 10-128 bytes.")
	}

	err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		var dbDeviceIDLinkedUser int64
		err := tx.QueryRowContext(ctx, "SELECT COUNT(id) FROM user_device WHERE id = $1 AND user_id = $2 LIMIT 1", deviceID, userID).Scan(&dbDeviceIDLinkedUser)
		if err != nil {
			logger.Debug("Cannot link device ID.", zap.Error(err), zap.Any("input", deviceID))
			return err
		}

		if dbDeviceIDLinkedUser == 0 {
			_, err = tx.ExecContext(ctx, "INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, userID)
			if err != nil {
				var pgErr *pgconn.PgError
				if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation {
					return StatusError(codes.AlreadyExists, "Device ID already in use.", err)
				}
				logger.Debug("Cannot link device ID.", zap.Error(err), zap.Any("input", deviceID))
				return err
			}
		}

		_, err = tx.ExecContext(ctx, "UPDATE users SET update_time = now() WHERE id = $1", userID)
		if err != nil {
			logger.Debug("Cannot update users table while linking.", zap.Error(err), zap.Any("input", deviceID))
			return err
		}
		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return e.Status()
		}
		logger.Error("Error in database transaction.", zap.Error(err))
		return status.Error(codes.Internal, "Error linking Device ID.")
	}
	return nil
}

func LinkEmail(ctx context.Context, logger *zap.Logger, db *sql.DB, userID uuid.UUID, email, password string) error {
	if email == "" || password == "" {
		return status.Error(codes.InvalidArgument, "Email address and password is required.")
	} else if invalidCharsRegex.MatchString(email) {
		return status.Error(codes.InvalidArgument, "Invalid email address, no spaces or control characters allowed.")
	} else if len(password) < 8 {
		return status.Error(codes.InvalidArgument, "Password must be at least 8 characters long.")
	} else if !emailRegex.MatchString(email) {
		return status.Error(codes.InvalidArgument, "Invalid email address format.")
	} else if len(email) < 10 || len(email) > 255 {
		return status.Error(codes.InvalidArgument, "Invalid email address, must be 10-255 bytes.")
	}

	cleanEmail := strings.ToLower(email)
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)

	res, err := db.ExecContext(ctx, `
UPDATE users
SET email = $2, password = $3, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE email = $2 AND NOT id = $1))`,
		userID,
		cleanEmail,
		hashedPassword)

	if err != nil {
		logger.Error("Could not link email.", zap.Error(err), zap.Any("input", email))
		return status.Error(codes.Internal, "Error while trying to link email.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Email is already in use.")
	}
	return nil
}

func LinkFacebook(ctx context.Context, logger *zap.Logger, db *sql.DB, socialClient *social.Client, tracker Tracker, router MessageRouter, userID uuid.UUID, username, appId, token string, sync bool) error {
	if token == "" {
		return status.Error(codes.InvalidArgument, "Facebook access token is required.")
	}

	var facebookProfile *social.FacebookProfile
	var err error
	var importFriendsPossible bool

	facebookProfile, err = socialClient.CheckFacebookLimitedLoginToken(ctx, appId, token)
	if err != nil {
		facebookProfile, err = socialClient.GetFacebookProfile(ctx, token)
		if err != nil {
			logger.Info("Could not authenticate Facebook profile.", zap.Error(err))
			return status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
		}
		importFriendsPossible = true
	}

	res, err := db.ExecContext(ctx, `
UPDATE users AS u
SET facebook_id = $2, display_name = COALESCE(NULLIF(u.display_name, ''), $3), avatar_url = COALESCE(NULLIF(u.avatar_url, ''), $4), update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE facebook_id = $2 AND NOT id = $1))`,
		userID,
		facebookProfile.ID, facebookProfile.Name, facebookProfile.Picture.Data.Url)

	if err != nil {
		logger.Error("Could not link Facebook ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to link Facebook ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Facebook ID is already in use.")
	}

	// Import email address, if it exists.
	if facebookProfile.Email != "" {
		_, err = db.ExecContext(ctx, "UPDATE users SET email = $1 WHERE id = $2", facebookProfile.Email, userID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_email_key") {
				logger.Warn("Skipping facebook account email import as it is already set in another user.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.String("user_id", userID.String()))
			} else {
				logger.Error("Failed to import facebook account email.", zap.Error(err), zap.String("facebookID", facebookProfile.ID), zap.String("username", username), zap.String("user_id", userID.String()))
				return status.Error(codes.Internal, "Error importing facebook account email.")
			}
		}
	}

	// Import friends if requested.
	if sync && importFriendsPossible {
		_ = importFacebookFriends(ctx, logger, db, tracker, router, socialClient, userID, username, token, false)
	}

	return nil
}

func LinkFacebookInstantGame(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, userID uuid.UUID, signedPlayerInfo string) error {
	if signedPlayerInfo == "" {
		return status.Error(codes.InvalidArgument, "Signed Player Info for a Facebook Instant Game is required.")
	}

	facebookInstantGameID, err := socialClient.ExtractFacebookInstantGameID(signedPlayerInfo, config.GetSocial().FacebookInstantGame.AppSecret)
	if err != nil {
		logger.Info("Could not authenticate Facebook Instant Game profile.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Facebook Instant Game profile.")
	}

	res, err := db.ExecContext(ctx, `
UPDATE users
SET facebook_instant_game_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE facebook_instant_game_id = $2 AND NOT id = $1))`,
		userID,
		facebookInstantGameID)

	if err != nil {
		logger.Error("Could not link Facebook Instant Game ID.", zap.Error(err), zap.Any("input", signedPlayerInfo))
		return status.Error(codes.Internal, "Error while trying to link Facebook Instant Game ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Facebook Instant Game ID is already in use.")
	}
	return nil
}

func LinkGameCenter(ctx context.Context, logger *zap.Logger, db *sql.DB, socialClient *social.Client, userID uuid.UUID, playerID string, bundleID string, timestamp int64, salt string, signature string, publicKeyURL string) error {
	if bundleID == "" {
		return status.Error(codes.InvalidArgument, "GameCenter bundle ID is required.")
	} else if playerID == "" {
		return status.Error(codes.InvalidArgument, "GameCenter player ID is required.")
	} else if publicKeyURL == "" {
		return status.Error(codes.InvalidArgument, "GameCenter public key URL is required.")
	} else if salt == "" {
		return status.Error(codes.InvalidArgument, "GameCenter salt is required.")
	} else if signature == "" {
		return status.Error(codes.InvalidArgument, "GameCenter signature is required.")
	} else if timestamp == 0 {
		return status.Error(codes.InvalidArgument, "GameCenter timestamp is required.")
	}

	valid, err := socialClient.CheckGameCenterID(ctx, playerID, bundleID, timestamp, salt, signature, publicKeyURL)
	if !valid || err != nil {
		logger.Info("Could not authenticate GameCenter profile.", zap.Error(err), zap.Bool("valid", valid))
		return status.Error(codes.Unauthenticated, "Could not authenticate GameCenter profile.")
	}

	res, err := db.ExecContext(ctx, `
UPDATE users
SET gamecenter_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE gamecenter_id = $2 AND NOT id = $1))`,
		userID,
		playerID)

	if err != nil {
		logger.Error("Could not link GameCenter ID.", zap.Error(err), zap.Any("input", playerID))
		return status.Error(codes.Internal, "Error while trying to link GameCenter ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "GameCenter ID is already in use.")
	}
	return nil
}

func LinkGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, socialClient *social.Client, userID uuid.UUID, idToken string) error {
	if idToken == "" {
		return status.Error(codes.InvalidArgument, "Google access token is required.")
	}

	googleProfile, err := socialClient.CheckGoogleToken(ctx, idToken)
	if err != nil {
		logger.Info("Could not authenticate Google profile.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Google profile.")
	}

	displayName := googleProfile.GetDisplayName()
	if len(displayName) > 255 {
		// Ignore the name in case it is longer than db can store
		logger.Warn("Skipping updating display_name: value received from Google longer than max length of 255 chars.", zap.String("display_name", displayName))
		displayName = ""
	}

	avatarURL := googleProfile.GetAvatarImageUrl()
	if len(avatarURL) > 512 {
		// Ignore the url in case it is longer than db can store
		logger.Warn("Skipping updating avatar_url: value received from Google longer than max length of 512 chars.", zap.String("avatar_url", avatarURL))
		avatarURL = ""
	}

	err = RemapGoogleId(ctx, logger, db, googleProfile)
	if err != nil {
		logger.Error("Could not remap Google ID.", zap.Error(err), zap.String("googleId", googleProfile.GetGoogleId()),
			zap.String("originalGoogleId", googleProfile.GetOriginalGoogleId()), zap.Any("input", idToken))
		return status.Error(codes.Internal, "Error while trying to link Google ID.")
	}

	res, err := db.ExecContext(ctx, `
UPDATE users AS u
SET google_id = $2, display_name = COALESCE(NULLIF(u.display_name, ''), $3), avatar_url = COALESCE(NULLIF(u.avatar_url, ''), $4), update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE google_id = $2 AND NOT id = $1))`,
		userID,
		googleProfile.GetGoogleId(), displayName, avatarURL)

	if err != nil {
		logger.Error("Could not link Google ID.", zap.Error(err), zap.Any("input", idToken))
		return status.Error(codes.Internal, "Error while trying to link Google ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Google ID is already in use.")
	}

	// Import email address, if it exists.
	if googleProfile.GetEmail() != "" {
		_, err = db.ExecContext(ctx, "UPDATE users SET email = $1 WHERE id = $2", googleProfile.GetEmail(), userID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == dbErrorUniqueViolation && strings.Contains(pgErr.Message, "users_email_key") {
				logger.Warn("Skipping google account email import as it is already set in another user.", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("created_user_id", userID.String()))
			} else {
				logger.Error("Failed to import google account email.", zap.Error(err), zap.String("googleID", googleProfile.GetGoogleId()), zap.String("created_user_id", userID.String()))
				return status.Error(codes.Internal, "Error importing google account email.")
			}
		}
	}

	return nil
}

func LinkSteam(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, tracker Tracker, router MessageRouter, userID uuid.UUID, username, token string, sync bool) error {
	if config.GetSocial().Steam.PublisherKey == "" || config.GetSocial().Steam.AppID == 0 {
		return status.Error(codes.FailedPrecondition, "Steam authentication is not configured.")
	}

	if token == "" {
		return status.Error(codes.InvalidArgument, "Steam access token is required.")
	}

	steamProfile, err := socialClient.GetSteamProfile(ctx, config.GetSocial().Steam.PublisherKey, config.GetSocial().Steam.AppID, token)
	if err != nil {
		logger.Info("Could not authenticate Steam profile.", zap.Error(err))
		return status.Error(codes.Unauthenticated, "Could not authenticate Steam profile.")
	}

	res, err := db.ExecContext(ctx, `
UPDATE users
SET steam_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE steam_id = $2 AND NOT id = $1))`,
		userID,
		strconv.FormatUint(steamProfile.SteamID, 10))

	if err != nil {
		logger.Error("Could not link Steam ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to link Steam ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.AlreadyExists, "Steam ID is already in use.")
	}

	// Import friends if requested.
	if sync {
		steamID := strconv.FormatUint(steamProfile.SteamID, 10)
		_ = importSteamFriends(ctx, logger, db, tracker, router, socialClient, userID, username, config.GetSocial().Steam.PublisherKey, steamID, false)
	}

	return nil
}
