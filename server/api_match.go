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
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ApiServer) ListMatches(ctx context.Context, in *api.ListMatchesRequest) (*api.MatchList, error) {
	limit := 1
	if in.GetLimit() != nil {
		if in.GetLimit().Value < 1 || in.GetLimit().Value > 100 {
			return nil, status.Error(codes.InvalidArgument, "Invalid limit - limit must be between 1 and 100.")
		}
		limit = int(in.GetLimit().Value)
	}

	if in.Label != nil && (in.Authoritative != nil && !in.Authoritative.Value) {
		return nil, status.Error(codes.InvalidArgument, "Label filtering is not supported for non-authoritative matches.")
	}

	if in.MinSize != nil && in.MinSize.Value < 0 {
		return nil, status.Error(codes.InvalidArgument, "Minimum size must be 0 or above.")
	}
	if in.MaxSize != nil && in.MaxSize.Value < 0 {
		return nil, status.Error(codes.InvalidArgument, "Maximum size must be 0 or above.")
	}
	if in.MinSize != nil && in.MaxSize != nil && in.MinSize.Value > in.MaxSize.Value {
		return nil, status.Error(codes.InvalidArgument, "Maximum size must be greater than or equal to minimum size when both are specified.")
	}

	results := s.matchRegistry.ListMatches(limit, in.Authoritative, in.Label, in.MinSize, in.MaxSize)

	return &api.MatchList{Matches: results}, nil
}
