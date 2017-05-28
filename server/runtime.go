// Copyright 2017 The Nakama Authors
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

	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/net/context"
)

const (
	__nakamaReturnValue = "__nakama_return_flag__"
)

type BuiltinModule interface {
	Loader(l *lua.LState) int
}

type Runtime struct {
	logger *zap.Logger
	vm     *lua.LState
	luaEnv *lua.LTable
}

func NewRuntime(logger *zap.Logger, multiLogger *zap.Logger, db *sql.DB, config *RuntimeConfig) (*Runtime, error) {
	if err := os.MkdirAll(config.Path, os.ModePerm); err != nil {
		return nil, err
	}

	// override before Package library is invoked.
	lua.LuaLDir = config.Path
	lua.LuaPathDefault = lua.LuaLDir + "/?.lua;" + lua.LuaLDir + "/?/init.lua"
	os.Setenv(lua.LuaPath, lua.LuaPathDefault)

	vm := lua.NewState(lua.Options{
		CallStackSize:       1024,
		RegistrySize:        1024,
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})

	stdLibs := map[string]lua.LGFunction{
		lua.LoadLibName:   lua.OpenPackage,
		lua.BaseLibName:   lua.OpenBase,
		lua.TabLibName:    lua.OpenTable,
		lua.OsLibName:     OpenOs,
		lua.StringLibName: lua.OpenString,
		lua.MathLibName:   lua.OpenMath,
	}
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}

	nakamaModule := NewNakamaModule(logger, db, vm)
	vm.PreloadModule("nakama", nakamaModule.Loader)
	nakamaxModule := NewNakamaxModule(logger)
	vm.PreloadModule("nakamax", nakamaxModule.Loader)

	r := &Runtime{
		logger: logger,
		vm:     vm,
		luaEnv: ConvertMap(vm, config.Environment),
	}

	logger.Info("Initialising modules", zap.String("path", lua.LuaLDir))
	modules := make([]string, 0)
	err := filepath.Walk(lua.LuaLDir, func(path string, f os.FileInfo, err error) error {
		if err != nil {
			logger.Error("Could not read module", zap.Error(err))
			return err
		} else if !f.IsDir() {
			if strings.ToLower(filepath.Ext(path)) == ".lua" {
				modules = append(modules, path)
			}
		}
		return nil
	})
	if err != nil {
		logger.Error("Failed to list modules", zap.Error(err))
		return nil, err
	}

	multiLogger.Info("Evaluating modules", zap.Int("count", len(modules)), zap.Strings("modules", modules))
	if err = r.loadModules(lua.LuaLDir, modules); err != nil {
		return nil, err
	}
	multiLogger.Info("Modules loaded")

	return r, nil
}

func (r *Runtime) loadModules(luaPath string, modules []string) error {
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
	for _, path := range modules {
		f, err := r.vm.LoadFile(path)
		if err != nil {
			r.logger.Error("Could not load module", zap.String("name", path), zap.Error(err))
			return err
		} else {
			relPath, _ := filepath.Rel(luaPath, path)
			moduleName := strings.TrimSuffix(relPath, filepath.Ext(relPath))
			moduleName = strings.Replace(moduleName, "/", ".", -1) //make paths Lua friendly
			r.vm.SetField(preload, moduleName, f)
			fns[moduleName] = f
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
	k := strings.ToLower(key)
	cp := r.vm.Context().Value(CALLBACKS).(*Callbacks)
	switch e {
	case HTTP:
		return cp.HTTP[k]
	case RPC:
		return cp.RPC[k]
	case BEFORE:
		return cp.Before[k]
	case AFTER:
		return cp.After[k]
	}

	return nil
}

func (r *Runtime) InvokeFunctionRPC(fn *lua.LFunction, uid uuid.UUID, handle string, sessionExpiry int64, payload []byte) ([]byte, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, RPC, uid, handle, sessionExpiry)
	var lv lua.LValue
	if payload != nil {
		lv = lua.LString(payload)
	}

	retValue, err := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return nil, err
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil
	} else if retValue.Type() == lua.LTString {
		return []byte(retValue.String()), nil
	}

	return nil, errors.New("Runtime function returned invalid data. Only allowed one return value of type String/Byte")
}

func (r *Runtime) InvokeFunctionBefore(fn *lua.LFunction, uid uuid.UUID, handle string, sessionExpiry int64, payload map[string]interface{}) (map[string]interface{}, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, BEFORE, uid, handle, sessionExpiry)
	var lv lua.LValue
	if payload != nil {
		lv = ConvertMap(l, payload)
	}

	retValue, err := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return nil, err
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil
	} else if retValue.Type() == lua.LTTable {
		return ConvertLuaTable(retValue.(*lua.LTable)), nil
	}

	return nil, errors.New("Runtime function returned invalid data. Only allowed one return value of type Table")
}

func (r *Runtime) InvokeFunctionAfter(fn *lua.LFunction, uid uuid.UUID, handle string, sessionExpiry int64, payload map[string]interface{}) error {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, BEFORE, uid, handle, sessionExpiry)
	var lv lua.LValue
	if payload != nil {
		lv = ConvertMap(l, payload)
	}

	_, err := r.invokeFunction(l, fn, ctx, lv)
	return err
}

func (r *Runtime) InvokeFunctionHTTP(fn *lua.LFunction, uid uuid.UUID, handle string, sessionExpiry int64, payload map[string]interface{}) (map[string]interface{}, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, HTTP, uid, handle, sessionExpiry)
	var lv lua.LValue
	if payload != nil {
		lv = ConvertMap(l, payload)
	}

	retValue, err := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return nil, err
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil
	} else if retValue.Type() == lua.LTTable {
		return ConvertLuaTable(retValue.(*lua.LTable)), nil
	}

	return nil, errors.New("Runtime function returned invalid data. Only allowed one return value of type Table")
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
	r.vm.Close()
}
