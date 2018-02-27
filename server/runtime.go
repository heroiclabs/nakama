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
	"os"
	"path/filepath"

	"errors"

	"strings"

	"database/sql"

	"bytes"
	"io/ioutil"
	"sync"

	"context"

	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"github.com/heroiclabs/nakama/social"
)

const (
	__nakamaReturnValue = "__nakama_return_flag__"
)

type RuntimeModule struct {
	name    string
	path    string
	content []byte
}

type RuntimePool struct {
	once    *sync.Once // Used to govern once-per-server-start executions.
	regRPC  map[string]struct{}
	stdLibs map[string]lua.LGFunction
	modules *sync.Map
	pool    *sync.Pool
}

func NewRuntimePool(logger *zap.Logger, multiLogger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, registry *SessionRegistry, tracker Tracker, router MessageRouter) (*RuntimePool, error) {
	runtimeConfig := config.GetRuntime()
	if err := os.MkdirAll(runtimeConfig.Path, os.ModePerm); err != nil {
		return nil, err
	}

	rp := &RuntimePool{
		once:    &sync.Once{},
		regRPC:  make(map[string]struct{}),
		modules: new(sync.Map),
		stdLibs: map[string]lua.LGFunction{
			lua.LoadLibName:   lua.OpenPackage,
			lua.BaseLibName:   lua.OpenBase,
			lua.TabLibName:    lua.OpenTable,
			lua.OsLibName:     OpenOs,
			lua.StringLibName: lua.OpenString,
			lua.MathLibName:   lua.OpenMath,
		},
	}

	// Override before Package library is invoked.
	lua.LuaLDir = runtimeConfig.Path
	lua.LuaPathDefault = lua.LuaLDir + "/?.lua;" + lua.LuaLDir + "/?/init.lua"
	os.Setenv(lua.LuaPath, lua.LuaPathDefault)

	logger.Info("Initialising modules", zap.String("path", lua.LuaLDir))
	modulePaths := make([]string, 0)
	if err := filepath.Walk(lua.LuaLDir, func(path string, f os.FileInfo, err error) error {
		if err != nil {
			logger.Error("Could not read module", zap.Error(err))
			return err
		} else if !f.IsDir() {
			if strings.ToLower(filepath.Ext(path)) == ".lua" {
				var content []byte
				if content, err = ioutil.ReadFile(path); err != nil {
					logger.Error("Could not read module", zap.String("path", path), zap.Error(err))
					return err
				}
				relPath, _ := filepath.Rel(lua.LuaLDir, path)
				name := strings.TrimSuffix(relPath, filepath.Ext(relPath))
				// Make paths Lua friendly.
				name = strings.Replace(name, "/", ".", -1)
				rp.modules.Store(path, &RuntimeModule{
					name:    name,
					path:    path,
					content: content,
				})
				modulePaths = append(modulePaths, relPath)
			}
		}
		return nil
	}); err != nil {
		logger.Error("Failed to list modules", zap.Error(err))
		return nil, err
	}

	multiLogger.Info("Evaluating modules", zap.Int("count", len(modulePaths)), zap.Strings("modules", modulePaths))
	r, err := rp.newVM(logger, db, config, socialClient, registry, tracker, router, func(id string) {
		rp.regRPC[id] = struct{}{}
		logger.Info("Registered RPC function invocation", zap.String("id", id))
	})
	if err != nil {
		return nil, err
	}
	multiLogger.Info("Modules loaded")
	r.Stop()

	rp.pool = &sync.Pool{
		New: func() interface{} {
			r, err := rp.newVM(logger, db, config, socialClient, registry, tracker, router, nil)
			if err != nil {
				multiLogger.Fatal("Failed initializing runtime.", zap.Error(err))
			}
			// TODO find a way to run r.Stop() when the pool discards this runtime.
			return r
		},
	}

	return rp, nil
}

func (rp *RuntimePool) HasRPC(id string) bool {
	_, ok := rp.regRPC[id]
	return ok
}

func (rp *RuntimePool) Get() *Runtime {
	return rp.pool.Get().(*Runtime)
}

func (rp *RuntimePool) Put(r *Runtime) {
	rp.pool.Put(r)
}

func (rp *RuntimePool) newVM(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, registry *SessionRegistry, tracker Tracker, router MessageRouter, announceRPC func(string)) (*Runtime, error) {
	// Initialize a one-off runtime to ensure startup code runs and modules are valid.
	vm := lua.NewState(lua.Options{
		CallStackSize:       1024,
		RegistrySize:        1024,
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	for name, lib := range rp.stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}
	nakamaModule := NewNakamaModule(logger, db, config, socialClient, vm, registry, tracker, router, rp.once, announceRPC)
	vm.PreloadModule("nakama", nakamaModule.Loader)
	r := &Runtime{
		logger: logger,
		vm:     vm,
		luaEnv: ConvertMap(vm, config.GetRuntime().Environment),
	}

	modules := make([]*RuntimeModule, 0)
	rp.modules.Range(func(key interface{}, value interface{}) bool {
		modules = append(modules, value.(*RuntimeModule))
		return true
	})

	return r, r.loadModules(modules)
}

type Runtime struct {
	logger *zap.Logger
	vm     *lua.LState
	luaEnv *lua.LTable
}

func (r *Runtime) loadModules(modules []*RuntimeModule) error {
	// `DoFile(..)` only parses and evaluates modules. Calling it multiple times, will load and eval the file multiple times.
	// So to make sure that we only load and evaluate modules once, regardless of whether there is dependency between files, we load them all into `preload`.
	// This is to make sure that modules are only loaded and evaluated once as `doFile()` does not (always) update _LOADED table.
	// Bear in mind two separate thoughts around the script runtime design choice:
	//
	// 1) This is only a problem if one module is dependent on another module.
	// This means that the global functions are evaluated once at system startup and then later on when the module is required through `require`.
	// We circumvent this by checking the _LOADED table to check if `require` had evaluated the module and avoiding double-eval.
	//
	// 2) Second item is that modules must be pre-loaded into the state for callback-func eval to work properly (in case of HTTP/RPC/etc invokes)
	// So we need to always load the modules into the system via `preload` so that they are always available in the LState.
	// We can't rely on `require` to have seen the module in case there is no dependency between the modules.

	//for _, mod := range r.modules {
	//	relPath, _ := filepath.Rel(r.luaPath, mod)
	//	moduleName := strings.TrimSuffix(relPath, filepath.Ext(relPath))
	//
	//	// check to see if this module was loaded by `require` before executing it
	//	loaded := l.GetField(l.Get(lua.RegistryIndex), "_LOADED")
	//	lv := l.GetField(loaded, moduleName)
	//	if lua.LVAsBool(lv) {
	//		// Already evaluated module via `require(..)`
	//		continue
	//	}
	//
	//	if err = l.DoFile(mod); err != nil {
	//		failedModules++
	//		r.logger.Error("Failed to evaluate module - skipping", zap.String("path", mod), zap.Error(err))
	//	}
	//}

	preload := r.vm.GetField(r.vm.GetField(r.vm.Get(lua.EnvironIndex), "package"), "preload")
	fns := make(map[string]*lua.LFunction)
	for _, module := range modules {
		f, err := r.vm.Load(bytes.NewReader(module.content), module.path)
		if err != nil {
			r.logger.Error("Could not load module", zap.String("name", module.path), zap.Error(err))
			return err
		} else {
			r.vm.SetField(preload, module.name, f)
			fns[module.name] = f
		}
	}

	for name, fn := range fns {
		loaded := r.vm.GetField(r.vm.Get(lua.RegistryIndex), "_LOADED")
		lv := r.vm.GetField(loaded, name)
		if lua.LVAsBool(lv) {
			// Already evaluated module via `require(..)`
			continue
		}

		r.vm.Push(fn)
		fnErr := r.vm.PCall(0, -1, nil)
		if fnErr != nil {
			r.logger.Error("Could not complete runtime invocation", zap.Error(fnErr))
			return fnErr
		}
	}

	return nil
}

func (r *Runtime) NewStateThread() (*lua.LState, context.CancelFunc) {
	return r.vm.NewThread()
}

func (r *Runtime) GetRuntimeCallback(e ExecutionMode, key string) *lua.LFunction {
	cp := r.vm.Context().Value(CALLBACKS).(*Callbacks)
	switch e {
	case RPC:
		return cp.RPC[key]
	}

	return nil
}

func (r *Runtime) InvokeFunctionRPC(fn *lua.LFunction, uid string, username string, sessionExpiry int64, sid string, payload string) (string, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, RPC, uid, username, sessionExpiry, sid)
	var lv lua.LValue
	if payload != "" {
		lv = lua.LString(payload)
	}

	retValue, err := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return "", err
	}

	if retValue == nil || retValue == lua.LNil {
		return "", nil
	} else if retValue.Type() == lua.LTString {
		return retValue.String(), nil
	}

	return "", errors.New("runtime function returned invalid data - only allowed one return value of type String/Byte")
}

func (r *Runtime) invokeFunction(l *lua.LState, fn *lua.LFunction, ctx *lua.LTable, payload lua.LValue) (lua.LValue, error) {
	l.Push(lua.LString(__nakamaReturnValue))
	l.Push(fn)

	nargs := 1
	l.Push(ctx)

	if payload != nil {
		nargs = 2
		l.Push(payload)
	}

	err := l.PCall(nargs, lua.MultRet, nil)
	if err != nil {
		return nil, err
	}

	retValue := l.Get(-1)
	if retValue.Type() == lua.LTString && lua.LVAsString(retValue) == __nakamaReturnValue {
		return nil, nil
	}

	return retValue, nil
}

func (r *Runtime) Stop() {
	// Not necessarily required as it only does OS temp files cleanup, which we don't expose in the runtime.
	r.vm.Close()
}
