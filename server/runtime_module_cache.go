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
	"database/sql"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/heroiclabs/nakama/social"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"sort"
)

type ModuleCache struct {
	Names   []string
	Modules map[string]*RuntimeModule
}

func (mc *ModuleCache) Add(m *RuntimeModule) {
	mc.Names = append(mc.Names, m.Name)
	mc.Modules[m.Name] = m

	// Ensure modules will be listed in ascending order of names.
	sort.Strings(mc.Names)
}

type RegCallbacks struct {
	RPC        map[string]interface{}
	Before     map[string]interface{}
	After      map[string]interface{}
	Matchmaker interface{}
}

func LoadRuntimeModules(startupLogger *zap.Logger, config Config) (map[string]lua.LGFunction, *ModuleCache, error) {
	runtimeConfig := config.GetRuntime()
	if err := os.MkdirAll(runtimeConfig.Path, os.ModePerm); err != nil {
		return nil, nil, err
	}

	moduleCache := &ModuleCache{
		Names:   make([]string, 0),
		Modules: make(map[string]*RuntimeModule, 0),
	}

	// Override before Package library is invoked.
	lua.LuaLDir = runtimeConfig.Path
	lua.LuaPathDefault = lua.LuaLDir + string(os.PathSeparator) + "?.lua;" + lua.LuaLDir + string(os.PathSeparator) + "?" + string(os.PathSeparator) + "init.lua"
	os.Setenv(lua.LuaPath, lua.LuaPathDefault)

	startupLogger.Info("Initialising runtime", zap.String("path", lua.LuaLDir))
	modulePaths := make([]string, 0)
	if err := filepath.Walk(lua.LuaLDir, func(path string, f os.FileInfo, err error) error {
		if err != nil {
			startupLogger.Error("Could not read module", zap.Error(err))
			return err
		} else if !f.IsDir() {
			if strings.ToLower(filepath.Ext(path)) == ".lua" {
				var content []byte
				if content, err = ioutil.ReadFile(path); err != nil {
					startupLogger.Error("Could not read module", zap.String("path", path), zap.Error(err))
					return err
				}
				relPath, _ := filepath.Rel(lua.LuaLDir, path)
				name := strings.TrimSuffix(relPath, filepath.Ext(relPath))
				// Make paths Lua friendly.
				name = strings.Replace(name, string(os.PathSeparator), ".", -1)
				moduleCache.Add(&RuntimeModule{
					Name:    name,
					Path:    path,
					Content: content,
				})
				modulePaths = append(modulePaths, relPath)
			}
		}
		return nil
	}); err != nil {
		startupLogger.Error("Failed to list modules", zap.Error(err))
		return nil, nil, err
	}

	stdLibs := map[string]lua.LGFunction{
		lua.LoadLibName:   OpenPackage(moduleCache),
		lua.BaseLibName:   lua.OpenBase,
		lua.TabLibName:    lua.OpenTable,
		lua.OsLibName:     OpenOs,
		lua.StringLibName: lua.OpenString,
		lua.MathLibName:   lua.OpenMath,
		Bit32LibName:      OpenBit32,
	}

	startupLogger.Info("Found runtime modules", zap.Int("count", len(modulePaths)), zap.Strings("modules", modulePaths))

	return stdLibs, moduleCache, nil
}

func ValidateRuntimeModules(logger, startupLogger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, moduleCache *ModuleCache, once *sync.Once) (*RegCallbacks, error) {
	regCallbacks := &RegCallbacks{
		RPC:    make(map[string]interface{}),
		Before: make(map[string]interface{}),
		After:  make(map[string]interface{}),
	}

	startupLogger.Info("Evaluating runtime modules")
	r, err := newVM(logger, db, config, socialClient, leaderboardCache, sessionRegistry, matchRegistry, tracker, router, stdLibs, moduleCache, once, func(execMode ExecutionMode, id string) {
		switch execMode {
		case ExecutionModeRPC:
			regCallbacks.RPC[id] = struct{}{}
			logger.Info("Registered RPC function invocation", zap.String("id", id))
		case ExecutionModeBefore:
			regCallbacks.Before[id] = struct{}{}
			logger.Info("Registered Before function invocation", zap.String("id", strings.TrimLeft(strings.TrimLeft(id, API_PREFIX), RTAPI_PREFIX)))
		case ExecutionModeAfter:
			regCallbacks.After[id] = struct{}{}
			logger.Info("Registered After function invocation", zap.String("id", strings.TrimLeft(strings.TrimLeft(id, API_PREFIX), RTAPI_PREFIX)))
		case ExecutionModeMatchmaker:
			regCallbacks.Matchmaker = struct{}{}
			logger.Info("Registered Matchmaker Matched function invocation")
		}
	})
	if err != nil {
		return nil, err
	}
	startupLogger.Info("Runtime modules loaded")
	r.Stop()

	return regCallbacks, nil
}
