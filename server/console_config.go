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
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) GetConfig(ctx context.Context, in *empty.Empty) (*console.Config, error) {
	config, err := json.Marshal(s.config)
	if err != nil {
		s.logger.Error("Error encoding config.", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error encoding config.")
	}

	configWarnings := make([]*console.Config_Warning, 0, len(s.configWarnings))
	for key, message := range s.configWarnings {
		configWarnings = append(configWarnings, &console.Config_Warning{
			Field:   key,
			Message: message,
		})
	}

	return &console.Config{
		Config:   string(config),
		Warnings: configWarnings,
	}, nil
}
