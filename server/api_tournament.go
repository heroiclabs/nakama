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
	"context"

	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
)

func (s *ApiServer) JoinTournament(ctx context.Context, in *api.JoinTournamentRequest) (*empty.Empty, error) {
	return &empty.Empty{}, nil
}

func (s *ApiServer) ListTournamentRecords(ctx context.Context, in *api.ListTournamentRecordsRequest) (*api.TournamentRecordList, error) {
	return nil, nil
}

func (s *ApiServer) ListTournaments(ctx context.Context, in *api.ListTournamentsRequest) (*api.TournamentList, error) {
	return nil, nil
}

func (s *ApiServer) WriteTournamentRecord(ctx context.Context, in *api.WriteTournamentRecordRequest) (*api.LeaderboardRecord, error) {
	return nil, nil
}
