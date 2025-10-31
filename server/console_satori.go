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

	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) SatoriListTemplates(ctx context.Context, in *console.Template_ListRequest) (*console.Template_ListResponse, error) {
	if s.satori == nil {
		return nil, status.Error(codes.FailedPrecondition, "Satori server key not configured.")
	}

	res, err := s.satori.ConsoleMessageTemplatesList(ctx, in)
	if err != nil {
		s.logger.Error("Failed to list message templates from satori", zap.Error(err))
		return nil, err
	}

	return res, nil
}

func (s *ConsoleServer) SatoriSendDirectMessage(ctx context.Context, in *console.SendDirectMessageRequest) (*console.SendDirectMessageResponse, error) {
	if s.satori == nil {
		return nil, status.Error(codes.FailedPrecondition, "Satori server key not configured.")
	}

	res, err := s.satori.ConsoleDirectMessageSend(ctx, in)
	if err != nil {
		s.logger.Error("Failed to send satori direct message", zap.Error(err))
		return nil, err
	}

	return res, nil
}
