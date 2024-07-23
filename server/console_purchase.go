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

	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama/v3/console"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) ListPurchases(ctx context.Context, in *console.ListPurchasesRequest) (*api.PurchaseList, error) {
	if in.UserId != "" {
		_, err := uuid.FromString(in.UserId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "expects a valid user ID filter")
		}
	}

	if in.Limit < 1 || in.Limit > 100 {
		return nil, status.Error(codes.InvalidArgument, "expects a limit value between 1 and 100")
	}

	purchases, err := ListPurchases(ctx, s.logger, s.db, in.UserId, int(in.Limit), in.Cursor)
	if err != nil {
		s.logger.Error("Failed to list purchases", zap.Error(err))
		return nil, status.Error(codes.Internal, "Error listing purchases.")
	}

	return purchases, nil
}

func (s *ConsoleServer) GetPurchase(ctx context.Context, in *console.GetPurchaseRequest) (*api.ValidatedPurchase, error) {
	if in.GetTransactionId() == "" {
		return nil, status.Error(codes.InvalidArgument, "transaction id is required")
	}

	purchase, err := GetPurchaseByTransactionId(ctx, s.logger, s.db, in.TransactionId)
	if err != nil || purchase == nil {
		return nil, status.Error(codes.NotFound, "Purchase not found")
	}

	return purchase, nil
}
