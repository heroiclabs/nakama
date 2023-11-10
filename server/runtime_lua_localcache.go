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

	ctx context.Context

	data map[string]luaLocalCacheData
}

func NewRuntimeLuaLocalCache(ctx context.Context) *RuntimeLuaLocalCache {
	lc := &RuntimeLuaLocalCache{
		ctx: ctx,

		data: make(map[string]luaLocalCacheData),
	}

	go func() {
		ticker := time.NewTicker(time.Duration(5) * time.Minute)
		for {
			select {
			case <-lc.ctx.Done():
				ticker.Stop()
				return
			case t := <-ticker.C:
				lc.Lock()
				for key, value := range lc.data {
					if !value.expirationTime.IsZero() && value.expirationTime.Before(t) {
						delete(lc.data, key)
					}
				}
				lc.Unlock()
			}
		}
	}()

	return lc
}

func (lc *RuntimeLuaLocalCache) Get(key string) (lua.LValue, bool) {
	t := time.Now()

	lc.RLock()
	value, found := lc.data[key]
	if found && (value.expirationTime.IsZero() || value.expirationTime.After(t)) {
		// A non-expired value is available. This is expected to be the most common case.
		lc.RUnlock()
		return value.data, found
	}
	lc.RUnlock()

	if found {
		// A stored value was found but it was expired. Take a write lock and delete it.
		lc.Lock()
		value, found := lc.data[key]
		if found && (value.expirationTime.IsZero() || value.expirationTime.After(t)) {
			// Value has changed between the lock above and here, it's no longer expired so just return it.
			lc.Unlock()
			return value.data, found
		}
		// Value is still expired, delete it.
		delete(lc.data, key)
		lc.Unlock()
	}

	return nil, false
}

func (lc *RuntimeLuaLocalCache) Put(key string, value lua.LValue, ttl int64) {
	data := luaLocalCacheData{data: value}
	if ttl > 0 {
		data.expirationTime = time.Now().Add(time.Second * time.Duration(ttl))
	}
	lc.Lock()
	lc.data[key] = data
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
