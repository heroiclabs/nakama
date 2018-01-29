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
	"golang.org/x/net/context"
	"github.com/heroiclabs/nakama/api"
	"github.com/golang/protobuf/ptypes/empty"
)

func (s *ApiServer) AccountFetch(ctx context.Context, in *empty.Empty) (*api.Account, error) {
	return &api.Account{Email: "foo@bar.com"}, nil
}

func (s *ApiServer) AccountUpdateFunc(ctx context.Context, in *api.AccountUpdate) (*empty.Empty, error) {
	return nil, nil
}
