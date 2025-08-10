// Copyright 2025 The Nakama Authors
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
	"errors"
	"go.uber.org/zap"
	"slices"

	"github.com/heroiclabs/nakama/v3/console"
	pgx "github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var (
	allowedSettings    = []string{"utc_toggle"}
	ErrSettingNotFound = status.Error(codes.NotFound, "Setting not found.")
	ErrSettingInvalid  = status.Error(codes.InvalidArgument, "Setting is invalid.")
)

func (s *ConsoleServer) GetSetting(ctx context.Context, in *console.SettingRequest) (*console.Setting, error) {
	if in == nil || in.Name == "" {
		return nil, ErrSettingInvalid
	}

	query := `SELECT name, value, update_time FROM setting WHERE name = $1`

	var name, value string
	var updateTime pgtype.Timestamptz

	if err := s.db.QueryRowContext(ctx, query, in.Name).Scan(&name, &value, &updateTime); err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, status.Error(codes.Canceled, "Request was canceled.")
		}

		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSettingNotFound
		}

		return nil, status.Error(codes.Internal, "An error occurred while trying to get the setting.")
	}

	setting := &console.Setting{
		Name:          name,
		Value:         value,
		UpdateTimeSec: updateTime.Time.Unix(),
	}

	return setting, nil
}

func (s *ConsoleServer) UpdateSetting(ctx context.Context, in *console.UpdateSettingRequest) (*console.Setting, error) {
	if !slices.Contains(allowedSettings, in.Name) {
		return nil, ErrSettingInvalid
	}

	var updateTime pgtype.Timestamptz

	query := "UPDATE setting SET value = $2, update_time = now() WHERE name = $1 RETURNING update_time"
	params := []any{in.Name, in.Value}

	if err := s.db.QueryRowContext(ctx, query, params...).Scan(&updateTime); err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, status.Error(codes.Canceled, "Request was canceled.")
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSettingNotFound
		}
		return nil, status.Error(codes.Internal, "An error occurred while trying to update the setting.")
	}

	res := &console.Setting{
		Name:          in.Name,
		Value:         in.Value,
		UpdateTimeSec: updateTime.Time.Unix(),
	}
	return res, nil
}

func (s *ConsoleServer) ListSettings(ctx context.Context, in *console.ListSettingsRequest) (*console.SettingList, error) {
	query := `SELECT name, value, update_time FROM setting`
	params := []any{}

	if len(in.Names) > 0 {
		query += " WHERE name = ANY($1::text[])"

		params = append(params, in.Names)
	}

	rows, err := s.db.QueryContext(ctx, query, params...)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, status.Error(codes.Canceled, "Request was canceled.")
		}
		s.logger.Error("Error listing settings.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to list settings.")
	}
	defer rows.Close()

	settings := make([]*console.Setting, 0, 1)

	for rows.Next() {
		var name, value string

		var updateTime pgtype.Timestamptz
		if err := rows.Scan(&name, &value, &updateTime); err != nil {
			return nil, status.Error(codes.Internal, "An error occurred while trying to read settings.")
		}

		settings = append(settings, &console.Setting{Name: name, Value: value, UpdateTimeSec: updateTime.Time.Unix()})
	}

	if err := rows.Err(); err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, status.Error(codes.Canceled, "Request was canceled.")
		}

		return nil, status.Error(codes.Internal, "An error occurred while trying to read settings.")
	}

	return &console.SettingList{Settings: settings}, nil
}
