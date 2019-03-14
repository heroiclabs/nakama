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

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const ObfuscationString = "********"

func (s *ConsoleServer) GetConfig(ctx context.Context, in *empty.Empty) (*console.Config, error) {
	cfg, err := s.config.Clone()
	if err != nil {
		s.logger.Error("Error cloning config.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error processing config.")
	}

	cfg.GetConsole().Password = ObfuscationString
	for i, address := range cfg.GetDatabase().Addresses {
		rawUrl := fmt.Sprintf("postgresql://%s", address)
		parsedUrl, err := url.Parse(rawUrl)
		if err != nil {
			s.logger.Error("Error parsing database address in config.", zap.Error(err))
			return nil, status.Error(codes.Internal, "Error processing config.")
		}
		if parsedUrl.User != nil {
			if password, isSet := parsedUrl.User.Password(); isSet {
				cfg.GetDatabase().Addresses[i] = strings.ReplaceAll(address, parsedUrl.User.Username()+":"+password, parsedUrl.User.Username()+":"+ObfuscationString)
			}
		}
	}

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
