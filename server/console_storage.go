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
	"github.com/heroiclabs/nakama/console"
)

func (s *ConsoleServer) DeleteStorageObject(ctx context.Context, in *console.DeleteStorageObjectRequest) (*empty.Empty, error) {
	return nil, nil
}

func (s *ConsoleServer) DeleteStorageObjects(context.Context, *empty.Empty) (*empty.Empty, error) {
	return nil, nil
}

func (s *ConsoleServer) GetStorage(ctx context.Context, in *console.GetStorageObjectRequest) (*console.StorageObject, error) {
	return nil, nil
}

func (s *ConsoleServer) ListStorageCollections(context.Context, *empty.Empty) (*console.StorageCollectionList, error) {
	return nil, nil
}

func (s *ConsoleServer) ListStorageObjects(ctx context.Context, in *console.ListStorageObjectRequest) (*console.StorageObjectList, error) {
	return nil, nil
}

func (s *ConsoleServer) WriteStorageObject(ctx context.Context, in *console.WriteStorageObjectRequest) (*empty.Empty, error) {
	return nil, nil
}
