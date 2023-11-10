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
	"time"

	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
)

type luaLocalCacheData struct {
	data           lua.LValue
	expirationTime time.Time
}

type RuntimeLuaLocalCache struct {
	sync.RWMutex
	data map[string]luaLocalCacheData
}

func NewRuntimeLuaLocalCache() *RuntimeLuaLocalCache {
	return &RuntimeLuaLocalCache{
		data: make(map[string]luaLocalCacheData),
	}
}

func (lc *RuntimeLuaLocalCache) Get(key string) (lua.LValue, bool) {
	lc.RLock()
	value, found := lc.data[key]
	if value.expirationTime.Before(time.Now()) {
		delete(lc.data, key)
		lc.RUnlock()
		return nil, false
	}
	lc.RUnlock()
	return value.data, found
}

func (lc *RuntimeLuaLocalCache) Put(key string, value lua.LValue, ttl int64) {
	lc.Lock()
	lc.data[key] = luaLocalCacheData{data: value, expirationTime: time.Now().Add(time.Second * time.Duration(ttl))}
	lc.Unlock()
}

func (lc *RuntimeLuaLocalCache) Delete(key string) {
	lc.Lock()
	delete(lc.data, key)
	lc.Unlock()
}

func (lc *RuntimeLuaLocalCache) Clear() {
	lc.Lock()
	clear(lc.data)
	lc.Unlock()
}
