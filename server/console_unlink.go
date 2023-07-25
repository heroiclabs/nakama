// Copyright 2019 The Nakama Authors
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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

func (s *ConsoleServer) UnlinkApple(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET apple_id = NULL, update_time = now()
WHERE id = $1
AND apple_id IS NOT NULL
AND ((custom_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink Apple ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Apple ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink Apple ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkCustom(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET custom_id = NULL, update_time = now()
WHERE id = $1
AND custom_id IS NOT NULL
AND ((apple_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink custom ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink custom ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink custom ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkDevice(ctx context.Context, in *console.UnlinkDeviceRequest) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}
	if in.DeviceId == "" {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid device ID.")
	}

	err = ExecuteInTx(ctx, s.db, func(tx *sql.Tx) error {
		query := `DELETE FROM user_device WHERE id = $2 AND user_id = $1
AND (EXISTS (SELECT id FROM users WHERE id = $1 AND
    (apple_id IS NOT NULL
     OR facebook_id IS NOT NULL
     OR facebook_instant_game_id IS NOT NULL
     OR google_id IS NOT NULL
     OR gamecenter_id IS NOT NULL
     OR steam_id IS NOT NULL
     OR email IS NOT NULL
     OR custom_id IS NOT NULL))
   OR EXISTS (SELECT id FROM user_device WHERE user_id = $1 AND id <> $2 LIMIT 1))`

		res, err := tx.ExecContext(ctx, query, userID, in.DeviceId)
		if err != nil {
			s.logger.Debug("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
			return err
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return StatusError(codes.PermissionDenied, "Cannot unlink device ID when there are no other identifiers.", ErrRowsAffectedCount)
		}

		res, err = tx.ExecContext(ctx, "UPDATE users SET update_time = now() WHERE id = $1", userID)
		if err != nil {
			s.logger.Debug("Could not unlink device ID.", zap.Error(err), zap.Any("input", in))
			return err
		}
		if count, _ := res.RowsAffected(); count == 0 {
			return StatusError(codes.PermissionDenied, "Cannot unlink device ID when there are no other identifiers.", ErrRowsAffectedCount)
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

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkEmail(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET email = NULL, password = NULL, update_time = now()
WHERE id = $1
AND email IS NOT NULL
AND ((apple_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR custom_id IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink email.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink email.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink email address when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkFacebook(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET facebook_id = NULL, update_time = now()
WHERE id = $1
AND facebook_id IS NOT NULL
AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink Facebook ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Facebook ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink Facebook ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkFacebookInstantGame(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET facebook_instant_game_id = NULL, update_time = now()
WHERE id = $1
AND facebook_instant_game_id IS NOT NULL
AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR google_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink Facebook ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Facebook ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink Facebook ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkGameCenter(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET gamecenter_id = NULL, update_time = now()
WHERE id = $1
AND gamecenter_id IS NOT NULL
AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR google_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink GameCenter ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink GameCenter ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink Game Center ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkGoogle(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET google_id = NULL, update_time = now()
WHERE id = $1
AND google_id IS NOT NULL
AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR steam_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink Google ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Google ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink Google ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}

func (s *ConsoleServer) UnlinkSteam(ctx context.Context, in *console.AccountId) (*emptypb.Empty, error) {
	userID, err := uuid.FromString(in.Id)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Requires a valid user ID.")
	}

	query := `UPDATE users SET steam_id = NULL, update_time = now()
WHERE id = $1
AND steam_id IS NOT NULL
AND ((apple_id IS NOT NULL
      OR custom_id IS NOT NULL
      OR gamecenter_id IS NOT NULL
      OR facebook_id IS NOT NULL
      OR facebook_instant_game_id IS NOT NULL
      OR google_id IS NOT NULL
      OR email IS NOT NULL)
     OR
     EXISTS (SELECT id FROM user_device WHERE user_id = $1 LIMIT 1))`

	res, err := s.db.ExecContext(ctx, query, userID)

	if err != nil {
		s.logger.Error("Could not unlink Steam ID.", zap.Error(err), zap.Any("input", in))
		return nil, status.Error(codes.Internal, "Error while trying to unlink Steam ID.")
	} else if count, _ := res.RowsAffected(); count == 0 {
		return nil, status.Error(codes.PermissionDenied, "Cannot unlink Steam ID when there are no other identifiers.")
	}

	return &emptypb.Empty{}, nil
}
