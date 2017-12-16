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

	"bytes"
	"encoding/json"
	"github.com/gogo/protobuf/jsonpb"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/net/context"
	"io/ioutil"
	"sync"
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
	regHTTP   map[string]struct{}
	regRPC    map[string]struct{}
	regBefore map[string]struct{}
	regAfter  map[string]struct{}
	pool      *sync.Pool
}

func NewRuntimePool(logger *zap.Logger, multiLogger *zap.Logger, db *sql.DB, config *RuntimeConfig, tracker Tracker, notificationService *NotificationService) (*RuntimePool, error) {
	if err := os.MkdirAll(config.Path, os.ModePerm); err != nil {
		return nil, err
	}

	// override before Package library is invoked.
	lua.LuaLDir = config.Path
	lua.LuaPathDefault = lua.LuaLDir + "/?.lua;" + lua.LuaLDir + "/?/init.lua"
	os.Setenv(lua.LuaPath, lua.LuaPathDefault)

	stdLibs := map[string]lua.LGFunction{
		lua.LoadLibName:   lua.OpenPackage,
		lua.BaseLibName:   lua.OpenBase,
		lua.TabLibName:    lua.OpenTable,
		lua.OsLibName:     OpenOs,
		lua.StringLibName: lua.OpenString,
		lua.MathLibName:   lua.OpenMath,
	}

	logger.Info("Initialising modules", zap.String("path", lua.LuaLDir))
	modules := make([]*RuntimeModule, 0)
	err := filepath.Walk(lua.LuaLDir, func(path string, f os.FileInfo, err error) error {
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
				name = strings.Replace(name, "/", ".", -1) //make paths Lua friendly
				modules = append(modules, &RuntimeModule{
					name:    name,
					path:    path,
					content: content,
				})
			}
		}
		return nil
	})
	if err != nil {
		logger.Error("Failed to list modules", zap.Error(err))
		return nil, err
	}

	cbufferPool := NewCbufferPool()

	regHTTP := make(map[string]struct{})
	regRPC := make(map[string]struct{})
	regBefore := make(map[string]struct{})
	regAfter := make(map[string]struct{})

	// Initialize a one-off runtime to ensure startup code runs and modules are valid.
	vm := lua.NewState(lua.Options{
		CallStackSize:       1024,
		RegistrySize:        1024,
		SkipOpenLibs:        true,
		IncludeGoStackTrace: true,
	})
	for name, lib := range stdLibs {
		vm.Push(vm.NewFunction(lib))
		vm.Push(lua.LString(name))
		vm.Call(1, 0)
	}
	nakamaModule := NewNakamaModule(logger, db, vm, tracker, notificationService, cbufferPool,
		func(path string) {
			regHTTP[path] = struct{}{}
			logger.Info("Registered HTTP function invocation", zap.String("path", path))
		}, func(id string) {
			regRPC[id] = struct{}{}
			logger.Info("Registered RPC function invocation", zap.String("id", id))
		}, func(messageName string) {
			regBefore[messageName] = struct{}{}
			logger.Info("Registered Before function invocation", zap.String("message", messageName))
		}, func(messageName string) {
			regAfter[messageName] = struct{}{}
			logger.Info("Registered After function invocation", zap.String("message", messageName))
		})
	vm.PreloadModule("nakama", nakamaModule.Loader)
	r := &Runtime{
		logger: logger,
		vm:     vm,
		luaEnv: ConvertMap(vm, config.Environment),
	}
	moduleStrings := make([]string, len(modules))
	for i, module := range modules {
		moduleStrings[i] = module.path
	}
	multiLogger.Info("Evaluating modules", zap.Int("count", len(moduleStrings)), zap.Strings("modules", moduleStrings))
	if err = r.loadModules(modules); err != nil {
		return nil, err
	}
	multiLogger.Info("Modules loaded")
	r.Stop()

	return &RuntimePool{
		regHTTP:   regHTTP,
		regRPC:    regRPC,
		regBefore: regBefore,
		regAfter:  regAfter,
		pool: &sync.Pool{
			New: func() interface{} {
				vm := lua.NewState(lua.Options{
					CallStackSize:       1024,
					RegistrySize:        1024,
					SkipOpenLibs:        true,
					IncludeGoStackTrace: true,
				})

				for name, lib := range stdLibs {
					vm.Push(vm.NewFunction(lib))
					vm.Push(lua.LString(name))
					vm.Call(1, 0)
				}

				nakamaModule := NewNakamaModule(logger, db, vm, tracker, notificationService, cbufferPool, nil, nil, nil, nil)
				vm.PreloadModule("nakama", nakamaModule.Loader)

				r := &Runtime{
					logger: logger,
					vm:     vm,
					luaEnv: ConvertMap(vm, config.Environment),
				}

				if err = r.loadModules(modules); err != nil {
					multiLogger.Fatal("Failed initializing runtime modules", zap.Error(err))
				}
				return r

				// TODO find a way to run r.Stop() when the pool discards this runtime.
			},
		},
	}, nil
}

func (rp *RuntimePool) HasHTTP(path string) bool {
	_, ok := rp.regHTTP[path]
	return ok
}

func (rp *RuntimePool) HasRPC(id string) bool {
	_, ok := rp.regRPC[id]
	return ok
}

func (rp *RuntimePool) HasBefore(messageName string) bool {
	_, ok := rp.regBefore[messageName]
	return ok
}

func (rp *RuntimePool) HasAfter(messageName string) bool {
	_, ok := rp.regAfter[messageName]
	return ok
}

func (rp *RuntimePool) Get() *Runtime {
	return rp.pool.Get().(*Runtime)
}

func (rp *RuntimePool) Put(r *Runtime) {
	rp.pool.Put(r)
}

type BuiltinModule interface {
	Loader(l *lua.LState) int
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
	case HTTP:
		return cp.HTTP[key]
	case RPC:
		return cp.RPC[key]
	case BEFORE:
		return cp.Before[key]
	case AFTER:
		return cp.After[key]
	}

	return nil
}

func (r *Runtime) InvokeFunctionRPC(fn *lua.LFunction, uid string, handle string, sessionExpiry int64, payload string) (string, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, RPC, uid, handle, sessionExpiry)
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

	return "", errors.New("Runtime function returned invalid data. Only allowed one return value of type String/Byte")
}

func (r *Runtime) InvokeFunctionBefore(fn *lua.LFunction, uid string, handle string, sessionExpiry int64, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, envelope *Envelope) (*Envelope, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, BEFORE, uid, handle, sessionExpiry)
	var lv lua.LValue
	var err error
	if envelope != nil {
		strEnvelope, err := jsonpbMarshaler.MarshalToString(envelope)
		if err != nil {
			return nil, err
		}

		var jsonEnvelope map[string]interface{}
		if err = json.Unmarshal([]byte(strEnvelope), &jsonEnvelope); err != nil {
			return nil, err
		}

		lt := l.NewTable()
		for k, v := range jsonEnvelope {
			lt.RawSetString(k, convertValue(l, v))
		}
		lv = lt
	}

	retValue, err := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return nil, err
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, errors.New("Runtime before hook did not return the payload")
	} else if retValue.Type() == lua.LTTable {
		result := ConvertLuaTable(retValue.(*lua.LTable))

		bytesEnvelope, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}

		if err = jsonpbUnmarshaler.Unmarshal(bytes.NewReader(bytesEnvelope), envelope); err != nil {
			return nil, err
		}
		return envelope, nil
	}

	return nil, errors.New("Runtime function returned invalid data. Only allowed one return value of type Table")
}

func (r *Runtime) InvokeFunctionBeforeAuthentication(fn *lua.LFunction, uid string, handle string, sessionExpiry int64, payload map[string]interface{}) (map[string]interface{}, error) {
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
		return nil, errors.New("Runtime before hook did not return the payload")
	} else if retValue.Type() == lua.LTTable {
		return ConvertLuaTable(retValue.(*lua.LTable)), nil
	}

	return nil, errors.New("Runtime function returned invalid data. Only allowed one return value of type Table")
}

func (r *Runtime) InvokeFunctionAfter(fn *lua.LFunction, uid string, handle string, sessionExpiry int64, payload map[string]interface{}) error {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, AFTER, uid, handle, sessionExpiry)
	var lv lua.LValue
	if payload != nil {
		lv = ConvertMap(l, payload)
	}

	_, err := r.invokeFunction(l, fn, ctx, lv)
	return err
}

func (r *Runtime) InvokeFunctionHTTP(fn *lua.LFunction, uid string, handle string, sessionExpiry int64, payload map[string]interface{}) (map[string]interface{}, error) {
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
