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

	"bytes"
	"sync"

	"context"

	"github.com/heroiclabs/nakama/social"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
)

const LTSentinel = lua.LValueType(-1)

type LSentinelType struct {
	lua.LNilType
}

func (s *LSentinelType) String() string       { return "" }
func (s *LSentinelType) Type() lua.LValueType { return LTSentinel }

var LSentinel = lua.LValue(&LSentinelType{})

type RuntimeModule struct {
	Name    string
	Path    string
	Content []byte
}

type RuntimePool struct {
	regCallbacks *RegCallbacks
	modules      *sync.Map
	pool         *sync.Pool
}

func NewRuntimePool(logger, multiLogger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, modules *sync.Map, regCallbacks *RegCallbacks, once *sync.Once) *RuntimePool {
	return &RuntimePool{
		regCallbacks: regCallbacks,
		modules:      modules,
		pool: &sync.Pool{
			New: func() interface{} {
				r, err := newVM(logger, db, config, socialClient, leaderboardCache, sessionRegistry, matchRegistry, tracker, router, stdLibs, modules, once, nil)
				if err != nil {
					multiLogger.Fatal("Failed initializing runtime.", zap.Error(err))
				}
				// TODO find a way to run r.Stop() when the pool discards this runtime.
				return r
			},
		},
	}
}

func (rp *RuntimePool) HasCallback(mode ExecutionMode, id string) bool {
	ok := false
	switch mode {
	case ExecutionModeRPC:
		_, ok = rp.regCallbacks.RPC[id]
	case ExecutionModeBefore:
		_, ok = rp.regCallbacks.Before[id]
	case ExecutionModeAfter:
		_, ok = rp.regCallbacks.After[id]
	case ExecutionModeMatchmaker:
		ok = rp.regCallbacks.Matchmaker != nil
	}

	return ok
}

func (rp *RuntimePool) Get() *Runtime {
	return rp.pool.Get().(*Runtime)
}

func (rp *RuntimePool) Put(r *Runtime) {
	rp.pool.Put(r)
}

func newVM(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, stdLibs map[string]lua.LGFunction, modules *sync.Map, once *sync.Once, announceCallback func(ExecutionMode, string)) (*Runtime, error) {
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
	nakamaModule := NewNakamaModule(logger, db, config, socialClient, leaderboardCache, vm, sessionRegistry, matchRegistry, tracker, router, once, announceCallback)
	vm.PreloadModule("nakama", nakamaModule.Loader)
	r := &Runtime{
		logger: logger,
		vm:     vm,
		luaEnv: ConvertMap(vm, config.GetRuntime().Environment),
	}

	mods := make([]*RuntimeModule, 0)
	modules.Range(func(key interface{}, value interface{}) bool {
		mods = append(mods, value.(*RuntimeModule))
		return true
	})

	return r, r.loadModules(mods)
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
		f, err := r.vm.Load(bytes.NewReader(module.Content), module.Path)
		if err != nil {
			r.logger.Error("Could not load module", zap.String("name", module.Path), zap.Error(err))
			return err
		} else {
			r.vm.SetField(preload, module.Name, f)
			fns[module.Name] = f
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

func (r *Runtime) GetCallback(e ExecutionMode, key string) *lua.LFunction {
	cp := r.vm.Context().Value(CALLBACKS).(*Callbacks)
	switch e {
	case ExecutionModeRPC:
		return cp.RPC[key]
	case ExecutionModeBefore:
		return cp.Before[key]
	case ExecutionModeAfter:
		return cp.After[key]
	case ExecutionModeMatchmaker:
		return cp.Matchmaker
	}

	return nil
}

func (r *Runtime) InvokeFunction(execMode ExecutionMode, fn *lua.LFunction, uid string, username string, sessionExpiry int64, sid string, payload interface{}) (interface{}, error, codes.Code) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, execMode, uid, username, sessionExpiry, sid)
	var lv lua.LValue
	if payload != nil {
		lv = ConvertValue(l, payload)
	}

	retValue, err, code := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return nil, err, code
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil, 0
	}

	return ConvertLuaValue(retValue), nil, 0
}

func (r *Runtime) invokeFunction(l *lua.LState, fn *lua.LFunction, ctx *lua.LTable, payload lua.LValue) (lua.LValue, error, codes.Code) {
	l.Push(LSentinel)
	l.Push(fn)

	nargs := 1
	l.Push(ctx)

	if payload != nil {
		nargs = 2
		l.Push(payload)
	}

	err := l.PCall(nargs, lua.MultRet, nil)
	if err != nil {
		// Unwind the stack up to and including our sentinel value, effectively discarding any other returned parameters.
		for {
			v := l.Get(-1)
			l.Pop(1)
			if v.Type() == LTSentinel {
				break
			}
		}

		if apiError, ok := err.(*lua.ApiError); ok && apiError.Object.Type() == lua.LTTable {
			t := apiError.Object.(*lua.LTable)
			switch t.Len() {
			case 0:
				return nil, err, codes.Internal
			case 1:
				apiError.Object = t.RawGetInt(1)
				return nil, err, codes.Internal
			default:
				// Ignore everything beyond the first 2 params, if there are more.
				apiError.Object = t.RawGetInt(1)
				code := codes.Internal
				if c := t.RawGetInt(2); c.Type() == lua.LTNumber {
					code = codes.Code(c.(lua.LNumber))
				}
				return nil, err, code
			}
		}

		return nil, err, codes.Internal
	}

	retValue := l.Get(-1)
	l.Pop(1)
	if retValue.Type() == LTSentinel {
		return nil, nil, 0
	}

	// Unwind the stack up to and including our sentinel value, effectively discarding any other returned parameters.
	for {
		v := l.Get(-1)
		l.Pop(1)
		if v.Type() == LTSentinel {
			break
		}
	}

	return retValue, nil, 0
}

func (r *Runtime) Stop() {
	// Not necessarily required as it only does OS temp files cleanup, which we don't expose in the runtime.
	r.vm.Close()
}
