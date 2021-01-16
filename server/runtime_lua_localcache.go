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
	"sync"

	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
)

type RuntimeLuaLocalCache struct {
	sync.RWMutex
	data map[string]lua.LValue
}

func NewRuntimeLuaLocalCache() *RuntimeLuaLocalCache {
	return &RuntimeLuaLocalCache{
		data: make(map[string]lua.LValue),
	}
}

func (lc *RuntimeLuaLocalCache) Get(key string) (lua.LValue, bool) {
	lc.RLock()
	value, found := lc.data[key]
	lc.RUnlock()
	return value, found
}

func (lc *RuntimeLuaLocalCache) Put(key string, value lua.LValue) {
	lc.Lock()
	lc.data[key] = value
	lc.Unlock()
}

func (lc *RuntimeLuaLocalCache) Delete(key string) {
	lc.Lock()
	delete(lc.data, key)
	lc.Unlock()
}
