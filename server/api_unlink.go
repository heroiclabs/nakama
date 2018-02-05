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
	"go.uber.org/zap"
	"time"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"database/sql"
	"strings"
)

func (s *ApiServer) UnlinkCustomFunc(ctx context.Context, in *api.AccountCustom) (*empty.Empty, error) {
	query := `UPDATE users SET custom_id = NULL, updated_at = $3
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
	ts := time.Now().UTC().Unix()
	res, err := s.db.Exec(query, userID, in.Id, ts)

	if err != nil {
		s.logger.Warn("Could not unlink custom ID.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error while trying to unlink custom ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkDeviceFunc(ctx context.Context, in *api.AccountDevice) (*empty.Empty, error) {
	fnErr := Transact(s.logger, s.db, func (tx *sql.Tx) error {
		userID := ctx.Value(ctxUserIDKey{})
		ts := time.Now().UTC().Unix()

		query := `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (facebook_id IS NOT NULL
     OR google_id IS NOT NULL
     OR gamecenter_id IS NOT NULL
     OR steam_id IS NOT NULL
     OR email IS NOT NULL
     OR custom_id IS NOT NULL))
   OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2))`

    res, err := tx.Exec(query, userID, in.Id)
		if err != nil {
			s.logger.Warn("Could not unlink device ID.", zap.Error(err))
			return status.Error(codes.Internal, "Could not unlink Device ID.")
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
		}

		res, err = tx.Exec("UPDATE users SET updated_at = $2 WHERE id = $1", userID, ts)
		if err != nil {
			s.logger.Warn("Could not unlink device ID.", zap.Error(err))
			return status.Error(codes.Internal, "Could not unlink Device ID.")
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
		}

		return nil
	})

	if fnErr != nil {
		return nil, fnErr
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkEmailFunc(ctx context.Context, in *api.AccountEmail) (*empty.Empty, error) {
	query := `UPDATE users SET email = NULL, password = NULL, updated_at = $3
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
	ts := time.Now().UTC().Unix()
	cleanEmail := strings.ToLower(in.Email)
	res, err := s.db.Exec(query, userID, cleanEmail, ts)

	if err != nil {
		s.logger.Warn("Could not unlink email.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error while trying to unlink email.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink last account identifier. Check profile exists and is not last link.")
	}

	return &empty.Empty{}, nil
}

func (s *ApiServer) UnlinkFacebookFunc(ctx context.Context, in *api.AccountFacebook) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkGameCenterFunc(ctx context.Context, in *api.AccountGameCenter) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkGoogleFunc(ctx context.Context, in *api.AccountGoogle) (*empty.Empty, error) {
	return nil, nil
}

func (s *ApiServer) UnlinkSteamFunc(ctx context.Context, in *api.AccountSteam) (*empty.Empty, error) {
	return nil, nil
}
