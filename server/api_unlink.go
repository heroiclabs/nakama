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
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) UnlinkCustom(ctx context.Context, in *api.AccountCustom) (*empty.Empty, error) {
	if in.GetId() == "" {
		return nil, status.Error(codes.InvalidArgument, "An ID must be supplied.")
	}

	query := `UPDATE users SET custom_id = NULL, update_time = now()
WHERE id = $1
AND custom_id = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(query, userID, in.Id)

	if err != nil {
		s.logger.Error("Could not unlink custom ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink custom ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkDevice(ctx context.Context, in *api.AccountDevice) (*empty.Empty, error) {
	if in.GetId() == "" {
		return nil, status.Error(codes.InvalidArgument, "A device ID must be supplied.")
	}

	tx, err := s.db.Begin()
	if err != nil {
		s.logger.Error("Could not begin database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not unlink Device ID.")
	}

	err = crdb.ExecuteInTx(ctx, tx, func() error {
		userID := ctx.Value(ctxUserIDKey{})

		query := `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (facebook_id IS NOT NULL
     OR google_id IS NOT NULL
     OR gamecenter_id IS NOT NULL
     OR steam_id IS NOT NULL
     OR email IS NOT NULL
     OR custom_id IS NOT NULL))
   OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2 LIMIT 1))`

		res, err := tx.Exec(query, userID, in.Id)
		if err != nil {
			s.logger.Debug("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
			return err
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return StatusError(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.", ErrRowsAffectedCount)
		}

		res, err = tx.Exec("UPDATE users SET update_time = now() WHERE id = $1", userID)
		if err != nil {
			s.logger.Debug("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
			return err
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return StatusError(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.", ErrRowsAffectedCount)
		}

		return nil
	})

	if err != nil {
		if e, ok := err.(*statusError); ok {
			return nil, e.Status()
		}
		s.logger.Error("Error in database transaction.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Could not unlink device ID.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkEmail(ctx context.Context, in *api.AccountEmail) (*empty.Empty, error) {
	if in.GetEmail() == "" || in.GetPassword() == "" {
		return nil, status.Error(codes.InvalidArgument, "Both email and password must be supplied.")
	}

	query := `UPDATE users SET email = NULL, password = NULL, update_time = now()
WHERE id = $1
AND email = $2
AND ((facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	userID := ctx.Value(ctxUserIDKey{})
	cleanEmail := strings.ToLower(in.Email)
	res, err := s.db.Exec(query, userID, cleanEmail)

	if err != nil {
		s.logger.Error("Could not unlink email.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink email.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkFacebook(ctx context.Context, in *api.AccountFacebook) (*empty.Empty, error) {
	if in.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Facebook access token is required.")
	}

	facebookProfile, err := s.socialClient.GetFacebookProfile(in.Token)
	if err != nil {
		s.logger.Info("Could not authenticate Facebook profile.", zap.Error(err))
		return nil, status.Error(codes.Unauthenticated, "Could not authenticate Facebook profile.")
	}

	query := `UPDATE users SET facebook_id = NULL, update_time = now()
WHERE id = $1
AND facebook_id = $2
AND ((custom_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(query, userID, facebookProfile.ID)

	if err != nil {
		s.logger.Error("Could not unlink Facebook ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Facebook ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkGameCenter(ctx context.Context, in *api.AccountGameCenter) (*empty.Empty, error) {
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

	query := `UPDATE users SET gamecenter_id = NULL, update_time = now()
WHERE id = $1
AND gamecenter_id = $2
AND ((custom_id IS NOT NULL
      OR google_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(query, userID, in.PlayerId)

	if err != nil {
		s.logger.Error("Could not unlink GameCenter ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink GameCenter ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkGoogle(ctx context.Context, in *api.AccountGoogle) (*empty.Empty, error) {
	if in.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "Google access token is required.")
	}

	googleProfile, err := s.socialClient.CheckGoogleToken(in.Token)
	if err != nil {
		s.logger.Info("Could not authenticate Google profile.", zap.Error(err))
		return nil, status.Error(codes.Unauthenticated, "Could not authenticate Google profile.")
	}

	query := `UPDATE users SET google_id = NULL, update_time = now()
WHERE id = $1
AND google_id = $2
AND ((custom_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(query, userID, googleProfile.Sub)

	if err != nil {
		s.logger.Error("Could not unlink Google ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Google ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkSteam(ctx context.Context, in *api.AccountSteam) (*empty.Empty, error) {
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

	query := `UPDATE users SET steam_id = NULL, update_time = now()
WHERE id = $1
AND steam_id = $2
AND ((custom_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	userID := ctx.Value(ctxUserIDKey{})
	res, err := s.db.Exec(query, userID, strconv.FormatUint(steamProfile.SteamID, 10))

	if err != nil {
		s.logger.Error("Could not unlink Steam ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Steam ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}
