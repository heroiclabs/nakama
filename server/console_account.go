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
	"github.com/heroiclabs/nakama/console"
)

func (s *ConsoleServer) DeleteAccount(ctx context.Context, in *console.AccountDeleteRequest) (*empty.Empty, error) {
	if in.RecordDeletion == nil || in.RecordDeletion.GetValue() {
		s.DeleteAccountRecorded(ctx, in)
	}

	// TODO complete account purge - refactor code above.
	return nil, nil
}

func (s *ConsoleServer) DeleteAccounts(context.Context, *empty.Empty) (*empty.Empty, error) {
	return nil, nil
}

func (s *ConsoleServer) GetAccount(ctx context.Context, in *console.AccountIdRequest) (*api.Account, error) {
	return nil, nil
}

func (s *ConsoleServer) ListAccounts(context.Context, *empty.Empty) (*console.AccountList, error) {
	return nil, nil
}
