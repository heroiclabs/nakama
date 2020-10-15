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

	"github.com/golang/protobuf/ptypes/empty"

	"github.com/heroiclabs/nakama/v2/console"
)

func (s *ConsoleServer) AddUser(ctx context.Context, in *console.AddUserRequest) (*empty.Empty, error) {
	// TODO implement adding console user
	return &empty.Empty{}, nil
}

func (s *ConsoleServer) DeleteUser(ctx context.Context, in *console.UserId) (*empty.Empty, error) {
	// TODO implement deleting console user
	return &empty.Empty{}, nil
}

func (s *ConsoleServer) ListUsers(ctx context.Context, in *empty.Empty) (*console.UserList, error) {
	// TODO implement console user listing
	return &console.UserList{
		Users: make([]*console.UserList_User, 0),
	}, nil
}
