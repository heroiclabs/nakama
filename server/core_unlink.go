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
	"strconv"
	"strings"

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func UnlinkApple(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, id uuid.UUID, token string) error {
	params := []any{id}
	query := `UPDATE users SET apple_id = NULL, update_time = now() WHERE id = $1`

	if token != "" {
		profile, err := socialClient.CheckAppleToken(ctx, config.GetSocial().Apple.BundleId, token)
		if err != nil {
			logger.Info("Could not authenticate Apple profile.", zap.Error(err))
			return status.Error(codes.Unauthenticated, "Could not authenticate Apple profile.")
		}
		params = append(params, profile.ID)
		query = query + ` AND apple_id = $2`
	}

	query = query +
		` AND ((custom_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink Apple ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to unlink Apple ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkCustom(ctx context.Context, logger *zap.Logger, db *sql.DB, id uuid.UUID, customID string) error {
	params := []any{id}
	query := `UPDATE users SET custom_id = NULL, update_time = now() WHERE id = $1`

	if customID != "" {
		params = append(params, customID)
		query = query + ` AND custom_id = $2`
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink custom ID.", zap.Error(err), zap.Any("input", customID))
		return status.Error(codes.Internal, "Error while trying to unlink custom ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkDevice(ctx context.Context, logger *zap.Logger, db *sql.DB, id uuid.UUID, deviceID string) error {
	if deviceID == "" {
		return status.Error(codes.InvalidArgument, "A device ID must be supplied.")
	}

	err := ExecuteInTx(ctx, db, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (apple_id IS NOT NULL
     OR facebook_id IS NOT NULL
     OR facebook_instant_game_id IS NOT NULL
     OR google_id IS NOT NULL
     OR gamecenter_id IS NOT NULL
     OR steam_id IS NOT NULL
     OR email IS NOT NULL
     OR custom_id IS NOT NULL))
   OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2 LIMIT 1))`, id, deviceID)
		if err != nil {
			logger.Debug("Could not unlink device ID.", zap.Error(err), zap.Any("input", deviceID))
			return err
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return StatusError(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.", ErrRowsAffectedCount)
		}

		res, err = tx.ExecContext(ctx, "UPDATE users SET update_time = now() WHERE id = $1", id)
		if err != nil {
			logger.Debug("Could not unlink device ID.", zap.Error(err), zap.Any("input", deviceID))
			return err
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return StatusError(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.", ErrRowsAffectedCount)
		}

		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return e.Status()
		}
		logger.Error("Error in database transaction.", zap.Error(err))
		return status.Error(codes.Internal, "Could not unlink device ID.")
	}
	return nil
}

func UnlinkEmail(ctx context.Context, logger *zap.Logger, db *sql.DB, id uuid.UUID, email string) error {
	params := []any{id}
	query := `UPDATE users SET email = NULL, password = NULL, update_time = now() WHERE id = $1`

	if email != "" {
		cleanEmail := strings.ToLower(email)
		params = append(params, cleanEmail)
		query = query + ` AND email = $2`
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink email.", zap.Error(err), zap.Any("input", email))
		return status.Error(codes.Internal, "Error while trying to unlink email.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkFacebook(ctx context.Context, logger *zap.Logger, db *sql.DB, socialClient *social.Client, appId string, id uuid.UUID, token string) error {
	params := []any{id}
	query := `UPDATE users SET facebook_id = NULL, update_time = now() WHERE id = $1`

	if token != "" {
		facebookProfile, err := socialClient.CheckFacebookLimitedLoginToken(ctx, appId, token)
		if err != nil {
			facebookProfile, err = socialClient.GetFacebookProfile(ctx, token)
			if err != nil {
				logger.Info("Could not authenticate Facebook profile.", zap.Error(err))
				return status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
			}
		}
		params = append(params, facebookProfile.ID)
		query = query + ` AND facebook_id = $2`
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink Facebook ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to unlink Facebook ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkFacebookInstantGame(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, id uuid.UUID, signedPlayerInfo string) error {
	params := []any{id}
	query := `UPDATE users SET facebook_instant_game_id = NULL, update_time = now() WHERE id = $1`

	if signedPlayerInfo != "" {
		facebookInstantGameID, err := socialClient.ExtractFacebookInstantGameID(signedPlayerInfo, config.GetSocial().FacebookInstantGame.AppSecret)
		if err != nil {
			logger.Info("Could not authenticate Facebook Instant Game profile.", zap.Error(err))
			return status.Error(codes.Unauthenticated, "Could not authenticate Facebook Instant Game profile.")
		}
		params = append(params, facebookInstantGameID)
		query = query + ` AND facebook_instant_game_id = $2`
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR google_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink Facebook Instant Game ID.", zap.Error(err), zap.Any("input", signedPlayerInfo))
		return status.Error(codes.Internal, "Error while trying to unlink Facebook Instant Game ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkGameCenter(ctx context.Context, logger *zap.Logger, db *sql.DB, socialClient *social.Client, id uuid.UUID, playerID string, bundleID string, timestamp int64, salt string, signature string, publicKeyURL string) error {
	params := []any{id}
	query := `UPDATE users SET gamecenter_id = NULL, update_time = now() WHERE id = $1`

	if bundleID != "" && playerID != "" && publicKeyURL != "" && salt != "" && signature != "" && timestamp != 0 {
		valid, err := socialClient.CheckGameCenterID(ctx, playerID, bundleID, timestamp, salt, signature, publicKeyURL)
		if !valid || err != nil {
			logger.Info("Could not authenticate GameCenter profile.", zap.Error(err), zap.Bool("valid", valid))
			return status.Error(codes.Unauthenticated, "Could not authenticate GameCenter profile.")
		}
		params = append(params, playerID)
		query = query + ` AND gamecenter_id = $2`
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR google_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink GameCenter ID.", zap.Error(err), zap.Any("input", playerID))
		return status.Error(codes.Internal, "Error while trying to unlink GameCenter ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkGoogle(ctx context.Context, logger *zap.Logger, db *sql.DB, socialClient *social.Client, id uuid.UUID, token string) error {

	params := []any{id}
	query := `UPDATE users SET google_id = NULL, update_time = now() WHERE id = $1`

	if token != "" {
		googleProfile, err := socialClient.CheckGoogleToken(ctx, token)
		if err != nil {
			logger.Info("Could not authenticate Google profile.", zap.Error(err))
			return status.Error(codes.Unauthenticated, "Could not authenticate Google profile.")
		}
		params = append(params, googleProfile.GetGoogleId())
		query = query + ` AND google_id = $2`

		err = RemapGoogleId(ctx, logger, db, googleProfile)
		if err != nil {
			logger.Error("Could not remap Google ID.", zap.Error(err), zap.String("googleId", googleProfile.GetGoogleId()),
				zap.String("originalGoogleId", googleProfile.GetOriginalGoogleId()), zap.Any("input", token))
			return status.Error(codes.Internal, "Error while trying to unlink Google ID.")
		}
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink Google ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to unlink Google ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}

func UnlinkSteam(ctx context.Context, logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, id uuid.UUID, token string) error {
	params := []any{id}
	query := `UPDATE users SET steam_id = NULL, update_time = now() WHERE id = $1`

	if token != "" {
		steamProfile, err := socialClient.GetSteamProfile(ctx, config.GetSocial().Steam.PublisherKey, config.GetSocial().Steam.AppID, token)
		if err != nil {
			logger.Info("Could not authenticate Steam profile.", zap.Error(err))
			return status.Error(codes.Unauthenticated, "Could not authenticate Steam profile.")
		}
		params = append(params, strconv.FormatUint(steamProfile.SteamID, 10))
		query = query + ` AND steam_id = $2`
	}

	query = query +
		` AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := db.ExecContext(ctx, query, params...)

	if err != nil {
		logger.Error("Could not unlink Steam ID.", zap.Error(err), zap.Any("input", token))
		return status.Error(codes.Internal, "Error while trying to unlink Steam ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}
	return nil
}
