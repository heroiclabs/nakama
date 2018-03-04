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
	"github.com/golang/protobuf/ptypes/empty"
	"github.com/heroiclabs/nakama/api"
	"golang.org/x/net/context"
)

func (s *ApiServer) ListStorageObjects(ctx context.Context, in *api.ListStorageObjectsRequest) (*api.StorageObjectList, error) {
	return nil, nil
}

func (s *ApiServer) ReadStorageObjects(ctx context.Context, in *api.ReadStorageObjectsRequest) (*api.StorageObjects, error) {
	return nil, nil
}

func (s *ApiServer) WriteStorageObjects(ctx context.Context, in *api.WriteStorageObjectsRequest) (*api.StorageObjectAcks, error) {
	return nil, nil
}

func (s *ApiServer) DeleteStorageObjects(ctx context.Context, in *api.DeleteStorageObjectsRequest) (*empty.Empty, error) {
	return &empty.Empty{}, nil
}
