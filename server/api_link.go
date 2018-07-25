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
	"strconv"
	"strings"

	"github.com/cockroachdb/cockroach-go/crdb"
	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"github.com/lib/pq"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) LinkCustom(ctx context.Context, in *api.AccountCustom) (*empty.Empty, error) {
	customID := in.Id
	if customID == "" {
		return nil, status.Error(codes.InvalidArgument, "Custom ID is required.")
	} else if invalidCharsRegex.MatchString(customID) {
		return nil, status.Error(codes.InvalidArgument, "Invalid custom ID, no spaces or control characters allowed.")
	} else if len(customID) < 6 || len(customID) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Invalid custom ID, must be 6-128 bytes.")
	}

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(`
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
		s.logger.Error("Could not link custom ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to link Custom ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Custom ID is already in use.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkDevice(ctx context.Context, in *api.AccountDevice) (*empty.Empty, error) {
	deviceID := in.Id
	if deviceID == "" {
		return nil, status.Error(codes.InvalidArgument, "Device ID is required.")
	} else if invalidCharsRegex.MatchString(deviceID) {
		return nil, status.Error(codes.InvalidArgument, "Device ID invalid, no spaces or control characters allowed.")
	} else if len(deviceID) < 10 || len(deviceID) > 128 {
		return nil, status.Error(codes.InvalidArgument, "Device ID invalid, must be 10-128 bytes.")
	}

	tx, err := s.db.Begin()
	if err != nil {
		s.logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error linking Device ID.")
	}

	err = crdb.ExecuteInTx(ctx, tx, func() error {
		userID := ctx.Value(ctxUserIDKey{})

		var dbDeviceIdLinkedUser int64
		err := tx.QueryRow("SELECT COUNT(id) FROM user_device WHERE id = $1 AND user_id = $2 LIMIT 1", deviceID, userID).Scan(&dbDeviceIdLinkedUser)
		if err != nil {
			s.logger.Debug("Cannot link device ID.", zap.Error(err), zap.Any("input", in))
			return err
		}

		if dbDeviceIdLinkedUser == 0 {
			_, err = tx.Exec("INSERT INTO user_device (id, user_id) VALUES ($1, $2)", deviceID, userID)
			if err != nil {
				if e, ok := err.(*pq.Error); ok && e.Code == dbErrorUniqueViolation {
					return StatusError(codes.AlreadyExists, "Device ID already in use.", err)
				}
				s.logger.Debug("Cannot link device ID.", zap.Error(err), zap.Any("input", in))
				return err
			}
		}

		_, err = tx.Exec("UPDATE users SET update_time = now() WHERE id = $1", userID)
		if err != nil {
			s.logger.Debug("Cannot update users table while linking.", zap.Error(err), zap.Any("input", in))
			return err
		}
		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, e.Status()
		}
		s.logger.Error("Error in database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error linking Device ID.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkEmail(ctx context.Context, in *api.AccountEmail) (*empty.Empty, error) {
	if in.Email == "" || in.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "Email address and password is required.")
	} else if invalidCharsRegex.MatchString(in.Email) {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address, no spaces or control characters allowed.")
	} else if len(in.Password) < 8 {
		return nil, status.Error(codes.InvalidArgument, "Password must be longer than 8 characters.")
	} else if !emailRegex.MatchString(in.Email) {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address format.")
	} else if len(in.Email) < 10 || len(in.Email) > 255 {
		return nil, status.Error(codes.InvalidArgument, "Invalid email address, must be 10-255 bytes.")
	}

	cleanEmail := strings.ToLower(in.Email)
	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(`
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
		s.logger.Error("Could not link email.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to link email.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Email is already in use.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkFacebook(ctx context.Context, in *api.LinkFacebookRequest) (*empty.Empty, error) {
	if in.Account == nil || in.Account.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Facebook access token is required.")
	}

	facebookProfile, err := s.socialClient.GetFacebookProfile(in.Account.Token)
	if err != nil {
		s.logger.Info("Could not authenticate Facebook profile.", zap.Error(err))
		return nil, status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
	}

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(`
UPDATE users
SET facebook_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE facebook_id = $2 AND NOT id = $1))`,
		userID,
		facebookProfile.ID)

	if err != nil {
		s.logger.Error("Could not link Facebook ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to link Facebook ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Facebook ID is already in use.")
	}

	// Import friends if requested.
	if in.Import == nil || in.Import.Value {
		importFacebookFriends(s.logger, s.db, s.router, s.socialClient, userID.(uuid.UUID), ctx.Value(ctxUsernameKey{}).(string), in.Account.Token, false)
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkGameCenter(ctx context.Context, in *api.AccountGameCenter) (*empty.Empty, error) {
	if in.BundleId == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter bundle ID is required.")
	} else if in.PlayerId == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter player ID is required.")
	} else if in.PublicKeyUrl == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter public key URL is required.")
	} else if in.Salt == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter salt is required.")
	} else if in.Signature == "" {
		return nil, status.Error(codes.InvalidArgument, "GameCenter signature is required.")
	} else if in.TimestampSeconds == 0 {
		return nil, status.Error(codes.InvalidArgument, "GameCenter timestamp is required.")
	}

	valid, err := s.socialClient.CheckGameCenterID(in.PlayerId, in.BundleId, in.TimestampSeconds, in.Salt, in.Signature, in.PublicKeyUrl)
	if !valid || err != nil {
		s.logger.Info("Could not authenticate GameCenter profile.", zap.Error(err), zap.Bool("valid", valid))
		return nil, status.Error(codes.Unauthenticated, "Could not authenticate GameCenter profile.")
	}

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(`
UPDATE users
SET gamecenter_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE gamecenter_id = $2 AND NOT id = $1))`,
		userID,
		in.PlayerId)

	if err != nil {
		s.logger.Error("Could not link GameCenter ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to link GameCenter ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "GameCenter ID is already in use.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkGoogle(ctx context.Context, in *api.AccountGoogle) (*empty.Empty, error) {
	if in.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Google access token is required.")
	}

	googleProfile, err := s.socialClient.CheckGoogleToken(in.Token)
	if err != nil {
		s.logger.Info("Could not authenticate Google profile.", zap.Error(err))
		return nil, status.Error(codes.Unauthenticated, "Could not authenticate Google profile.")
	}

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(`
UPDATE users
SET google_id = $2, update_time = now()
WHERE (id = $1)
AND (NOT EXISTS
    (SELECT id
     FROM users
     WHERE google_id = $2 AND NOT id = $1))`,
		userID,
		googleProfile.Sub)

	if err != nil {
		s.logger.Error("Could not link Google ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to link Google ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Google ID is already in use.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) LinkSteam(ctx context.Context, in *api.AccountSteam) (*empty.Empty, error) {
	if s.config.GetSocial().Steam.PublisherKey == "" || s.config.GetSocial().Steam.AppID == 0 {
		return nil, status.Error(codes.FailedPrecondition, "Steam authentication is not configured.")
	}

	if in.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Steam access token is required.")
	}

	steamProfile, err := s.socialClient.GetSteamProfile(s.config.GetSocial().Steam.PublisherKey, s.config.GetSocial().Steam.AppID, in.Token)
	if err != nil {
		s.logger.Info("Could not authenticate Steam profile.", zap.Error(err))
		return nil, status.Error(codes.Unauthenticated, "Could not authenticate Steam profile.")
	}

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(`
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
		s.logger.Error("Could not link Steam ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to link Steam ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.AlreadyExists, "Steam ID is already in use.")
	}

	return &empty.Empty{}, nil
}
