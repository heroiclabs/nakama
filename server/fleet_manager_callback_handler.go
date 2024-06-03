// Copyright 2023 The Nakama Authors
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
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/runtime"
	"net"
	"sync"
)

type LocalFmCallbackHandler struct {
	callbackRegistry sync.Map
	idGenerator      uuid.Generator

	nodeHash [6]byte
}

func NewLocalFmCallbackHandler(config Config) runtime.FmCallbackHandler {
	hash := NodeToHash(config.GetName())
	callbackIdGen := uuid.NewGenWithHWAF(func() (net.HardwareAddr, error) {
		return hash[:], nil
	})

	return &LocalFmCallbackHandler{
		callbackRegistry: sync.Map{},
		idGenerator:      callbackIdGen,

		nodeHash: hash,
	}
}

func (fch *LocalFmCallbackHandler) GenerateCallbackId() string {
	return uuid.Must(fch.idGenerator.NewV1()).String()
}

func (fch *LocalFmCallbackHandler) SetCallback(callbackId string, fn runtime.FmCreateCallbackFn) {
	fch.callbackRegistry.Store(callbackId, fn)
}

func (fch *LocalFmCallbackHandler) InvokeCallback(callbackId string, status runtime.FmCreateStatus, instanceInfo *runtime.InstanceInfo, sessionInfo []*runtime.SessionInfo, metadata map[string]any, err error) {
	callback, ok := fch.callbackRegistry.LoadAndDelete(callbackId)
	if !ok || callback == nil {
		return
	}

	fn := callback.(runtime.FmCreateCallbackFn)
	fn(status, instanceInfo, sessionInfo, metadata, err)
}
