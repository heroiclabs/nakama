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
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

const ObfuscationString = "REDACTED"

func (s *ConsoleServer) GetConfig(ctx context.Context, in *emptypb.Empty) (*console.Config, error) {
	cfg, err := s.config.Clone()
	if err != nil {
		s.logger.Error("Error cloning config.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error processing config.")
	}

	cfg.GetConsole().Password = ObfuscationString
	for i, address := range cfg.GetDatabase().Addresses {
		rawURL := fmt.Sprintf("postgresql://%s", address)
		parsedURL, err := url.Parse(rawURL)
		if err != nil {
			s.logger.Error("Error parsing database address in config.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error processing config.")
		}
		if parsedURL.User != nil {
			if password, isSet := parsedURL.User.Password(); isSet {
				cfg.GetDatabase().Addresses[i] = strings.ReplaceAll(address, parsedURL.User.Username()+":"+password, parsedURL.User.Username()+":"+ObfuscationString)
			}
		}
	}

	cfg.GetGoogleAuth().CredentialsJSON = ObfuscationString
	cfg.GetGoogleAuth().OAuthConfig = nil

	cfg.GetIAP().Google.PrivateKey = ObfuscationString
	cfg.GetIAP().Apple.SharedPassword = ObfuscationString
	cfg.GetIAP().Huawei.ClientSecret = ObfuscationString

	cfg.GetSocial().FacebookInstantGame.AppSecret = ObfuscationString
	cfg.GetIAP().FacebookInstant.AppSecret = ObfuscationString

	cfgBytes, err := json.Marshal(cfg)
	if err != nil {
		s.logger.Error("Error encoding config.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error processing config.")
	}

	configWarnings := make([]*console.Config_Warning, 0, len(s.configWarnings))
	for key, message := range s.configWarnings {
		configWarnings = append(configWarnings, &console.Config_Warning{
			Field:   key,
			Message: message,
		})
	}

	return &console.Config{
		Config:        string(cfgBytes),
		Warnings:      configWarnings,
		ServerVersion: s.serverVersion,
	}, nil
}

func (s *ConsoleServer) DeleteAllData(ctx context.Context, in *emptypb.Empty) (*emptypb.Empty, error) {
	query := `TRUNCATE TABLE users, user_edge, user_device, user_tombstone, wallet_ledger, storage, purchase,
			subscription, notification, message, leaderboard, leaderboard_record, groups, group_edge`
	if _, err := s.db.ExecContext(ctx, query); err != nil {
		s.logger.Debug("Could not cleanup data.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to truncate tables.")
	}
	// Setup System user
	query = `INSERT INTO users (id, username)
    VALUES ('00000000-0000-0000-0000-000000000000', '')
    ON CONFLICT(id) DO NOTHING`
	if _, err := s.db.ExecContext(ctx, query); err != nil {
		s.logger.Debug("Error creating system user.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while trying to setup the system user.")
	}
	s.logger.Info("All data cleaned up.")
	return &emptypb.Empty{}, nil
}
