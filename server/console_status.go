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
	"time"

	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *ConsoleServer) GetStatus(ctx context.Context, in *emptypb.Empty) (*console.StatusList, error) {
	nodes, err := s.statusHandler.GetStatus(ctx)
	if err != nil {
		s.logger.Error("Error getting status.", zap.Error(err))
		return nil, status.Error(codes.Internal, "An error occurred while getting status.")
	}

	return &console.StatusList{
		Nodes:     nodes,
		Timestamp: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
	}, nil
}
