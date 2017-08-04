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

func NewRuntime(logger *zap.Logger, multiLogger *zap.Logger, db *sql.DB, config *RuntimeConfig, notificationService *NotificationService) (*Runtime, error) {
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

	nakamaModule := NewNakamaModule(logger, db, vm, notificationService)
	vm.PreloadModule("nakama", nakamaModule.Loader)

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

func (r *Runtime) InvokeFunctionBefore(fn *lua.LFunction, uid uuid.UUID, handle string, sessionExpiry int64, jsonpbMarshaler *jsonpb.Marshaler, jsonpbUnmarshaler *jsonpb.Unmarshaler, envelope *Envelope) (*Envelope, error) {
	l, _ := r.NewStateThread()
	defer l.Close()

	ctx := NewLuaContext(l, r.luaEnv, BEFORE, uid, handle, sessionExpiry)
	var lv lua.LValue
	var err error
	if envelope != nil {
		lv, err = ConvertEnvelopeToLTable(l, jsonpbMarshaler, envelope)
		if err != nil {
			return nil, err
		}
	}

	retValue, err := r.invokeFunction(l, fn, ctx, lv)
	if err != nil {
		return nil, err
	}

	if retValue == nil || retValue == lua.LNil {
		return nil, nil
	} else if retValue.Type() == lua.LTTable {
		return ConvertLTableToEnvelope(l, jsonpbUnmarshaler, retValue.(*lua.LTable), envelope)
	}

	return nil, errors.New("Runtime function returned invalid data. Only allowed one return value of type Table")
}

func (r *Runtime) InvokeFunctionBeforeAuthentication(fn *lua.LFunction, uid uuid.UUID, handle string, sessionExpiry int64, payload map[string]interface{}) (map[string]interface{}, error) {
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

	ctx := NewLuaContext(l, r.luaEnv, AFTER, uid, handle, sessionExpiry)
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

func ConvertEnvelopeToLTable(l *lua.LState, jsonpbMarshaler *jsonpb.Marshaler, envelope *Envelope) (lua.LValue, error) {
	lt := l.NewTable()

	switch envelope.Payload.(type) {
	case *Envelope_GroupsRemove:
		ids := l.NewTable()
		for i, l := range envelope.GetGroupsRemove().GroupIds {
			gid, err := uuid.FromBytes(l)
			if err != nil {
				return nil, errors.New("Invalid Group ID in GroupsRemove conversion to script runtime")
			}
			ids.RawSetInt(i+1, lua.LString(gid.String()))
		}
		groupIDs := l.NewTable()
		groupIDs.RawSetString("GroupIds", ids)
		lt.RawSetString("GroupsRemove", groupIDs)
	case *Envelope_GroupsJoin:
		ids := l.NewTable()
		for i, l := range envelope.GetGroupsJoin().GroupIds {
			gid, err := uuid.FromBytes(l)
			if err != nil {
				return nil, errors.New("Invalid Group ID in GroupsJoin conversion to script runtime")
			}
			ids.RawSetInt(i+1, lua.LString(gid.String()))
		}
		groupIDs := l.NewTable()
		groupIDs.RawSetString("GroupIds", ids)
		lt.RawSetString("GroupsJoin", groupIDs)
	case *Envelope_GroupsLeave:
		ids := l.NewTable()
		for i, l := range envelope.GetGroupsLeave().GroupIds {
			gid, err := uuid.FromBytes(l)
			if err != nil {
				return nil, errors.New("Invalid Group ID in GroupsLeave conversion to script runtime")
			}
			ids.RawSetInt(i+1, lua.LString(gid.String()))
		}
		groupIDs := l.NewTable()
		groupIDs.RawSetString("GroupIds", ids)
		lt.RawSetString("GroupsLeave", groupIDs)
	case *Envelope_GroupUsersKick:
		pairs := l.NewTable()
		for i, p := range envelope.GetGroupUsersKick().GroupUsers {
			gid, err := uuid.FromBytes(p.GroupId)
			if err != nil {
				return nil, errors.New("Invalid Group ID in GroupUsersKick conversion to script runtime")
			}
			uid, err := uuid.FromBytes(p.UserId)
			if err != nil {
				return nil, errors.New("Invalid User ID in GroupUsersKick conversion to script runtime")
			}
			pair := l.NewTable()
			pair.RawSetString("GroupId", lua.LString(gid.String()))
			pair.RawSetString("UserId", lua.LString(uid.String()))
			pairs.RawSetInt(i+1, pair)
		}
		kicks := l.NewTable()
		kicks.RawSetString("GroupUsers", pairs)
		lt.RawSetString("GroupUsersKick", kicks)
	case *Envelope_GroupUsersPromote:
		pairs := l.NewTable()
		for i, p := range envelope.GetGroupUsersPromote().GroupUsers {
			gid, err := uuid.FromBytes(p.GroupId)
			if err != nil {
				return nil, errors.New("Invalid Group ID in GroupUsersPromote conversion to script runtime")
			}
			uid, err := uuid.FromBytes(p.UserId)
			if err != nil {
				return nil, errors.New("Invalid User ID in GroupUsersPromote conversion to script runtime")
			}
			pair := l.NewTable()
			pair.RawSetString("GroupId", lua.LString(gid.String()))
			pair.RawSetString("UserId", lua.LString(uid.String()))
			pairs.RawSetInt(i+1, pair)
		}
		kicks := l.NewTable()
		kicks.RawSetString("GroupUsers", pairs)
		lt.RawSetString("GroupUsersPromote", kicks)
	default:
		strEnvelope, err := jsonpbMarshaler.MarshalToString(envelope)
		if err != nil {
			return nil, err
		}

		var jsonEnvelope map[string]interface{}
		if err = json.Unmarshal([]byte(strEnvelope), &jsonEnvelope); err != nil {
			return nil, err
		}

		for k, v := range jsonEnvelope {
			lt.RawSetString(k, convertValue(l, v))
		}
	}

	return lt, nil
}

func ConvertLTableToEnvelope(l *lua.LState, jsonpbUnmarshaler *jsonpb.Unmarshaler, lt *lua.LTable, envelope *Envelope) (*Envelope, error) {
	switch envelope.Payload.(type) {
	case *Envelope_GroupsRemove:
		groupsRemove := lt.RawGetString("GroupsRemove")
		if groupsRemove.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupsRemove conversion from script runtime")
		}
		groupIds := lt.RawGetString("GroupIds")
		if groupIds.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupsRemove conversion from script runtime")
		}
		ids := make([][]byte, 0)
		var err error
		groupIds.(*lua.LTable).ForEach(func(k lua.LValue, v lua.LValue) {
			if v.Type() != lua.LTString {
				err = errors.New("Invalid Group ID in GroupsRemove conversion from script runtime")
				return
			}
			gid, e := uuid.FromString(v.String())
			if e != nil {
				err = errors.New("Invalid Group ID in GroupsRemove conversion from script runtime")
				return
			}
			ids = append(ids, gid.Bytes())
		})
		if err != nil {
			return nil, err
		}
		envelope.GetGroupsRemove().GroupIds = ids
	case *Envelope_GroupsJoin:
		groupsJoin := lt.RawGetString("GroupsJoin")
		if groupsJoin.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupsJoin conversion from script runtime")
		}
		groupIds := lt.RawGetString("GroupIds")
		if groupIds.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupsJoin conversion from script runtime")
		}
		ids := make([][]byte, 0)
		var err error
		groupIds.(*lua.LTable).ForEach(func(k lua.LValue, v lua.LValue) {
			if v.Type() != lua.LTString {
				err = errors.New("Invalid Group ID in GroupsJoin conversion from script runtime")
				return
			}
			gid, e := uuid.FromString(v.String())
			if e != nil {
				err = errors.New("Invalid Group ID in GroupsJoin conversion from script runtime")
				return
			}
			ids = append(ids, gid.Bytes())
		})
		if err != nil {
			return nil, err
		}
		envelope.GetGroupsJoin().GroupIds = ids
	case *Envelope_GroupsLeave:
		groupsLeave := lt.RawGetString("GroupsLeave")
		if groupsLeave.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupsLeave conversion from script runtime")
		}
		groupIds := lt.RawGetString("GroupIds")
		if groupIds.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupsLeave conversion from script runtime")
		}
		ids := make([][]byte, 0)
		var err error
		groupIds.(*lua.LTable).ForEach(func(k lua.LValue, v lua.LValue) {
			if v.Type() != lua.LTString {
				err = errors.New("Invalid Group ID in GroupsLeave conversion from script runtime")
				return
			}
			gid, e := uuid.FromString(v.String())
			if e != nil {
				err = errors.New("Invalid Group ID in GroupsLeave conversion from script runtime")
				return
			}
			ids = append(ids, gid.Bytes())
		})
		if err != nil {
			return nil, err
		}
		envelope.GetGroupsLeave().GroupIds = ids
	case *Envelope_GroupUsersKick:
		groupUsersKick := lt.RawGetString("GroupUsersKick")
		if groupUsersKick.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupUsersKick conversion from script runtime")
		}
		groupUsers := lt.RawGetString("GroupUsers")
		if groupUsers.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupUsersKick conversion from script runtime")
		}
		gu := make([]*TGroupUsersKick_GroupUserKick, 0)
		var err error
		groupUsers.(*lua.LTable).ForEach(func(k lua.LValue, v lua.LValue) {
			if v.Type() != lua.LTTable {
				err = errors.New("Invalid Group User pair in GroupUsersKick conversion from script runtime")
				return
			}
			vt := v.(*lua.LTable)
			g := vt.RawGetString("GroupId")
			if g.Type() != lua.LTString {
				err = errors.New("Invalid Group ID in GroupUsersKick conversion from script runtime")
				return
			}
			gid, e := uuid.FromString(g.String())
			if e != nil {
				err = errors.New("Invalid Group ID in GroupUsersKick conversion from script runtime")
				return
			}
			u := vt.RawGetString("UserId")
			if u.Type() != lua.LTString {
				err = errors.New("Invalid User ID in GroupUsersKick conversion from script runtime")
				return
			}
			uid, e := uuid.FromString(u.String())
			if e != nil {
				err = errors.New("Invalid User ID in GroupUsersKick conversion from script runtime")
				return
			}
			gu = append(gu, &TGroupUsersKick_GroupUserKick{GroupId: gid.Bytes(), UserId: uid.Bytes()})
		})
		if err != nil {
			return nil, err
		}
		envelope.GetGroupUsersKick().GroupUsers = gu
	case *Envelope_GroupUsersPromote:
		groupUsersPromote := lt.RawGetString("GroupUsersPromote")
		if groupUsersPromote.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupUsersPromote conversion from script runtime")
		}
		groupUsers := lt.RawGetString("GroupUsers")
		if groupUsers.Type() != lua.LTTable {
			return nil, errors.New("Invalid payload in GroupUsersPromote conversion from script runtime")
		}
		gu := make([]*TGroupUsersPromote_GroupUserPromote, 0)
		var err error
		groupUsers.(*lua.LTable).ForEach(func(k lua.LValue, v lua.LValue) {
			if v.Type() != lua.LTTable {
				err = errors.New("Invalid Group User pair in GroupUsersPromote conversion from script runtime")
				return
			}
			vt := v.(*lua.LTable)
			g := vt.RawGetString("GroupId")
			if g.Type() != lua.LTString {
				err = errors.New("Invalid Group ID in GroupUsersPromote conversion from script runtime")
				return
			}
			gid, e := uuid.FromString(g.String())
			if e != nil {
				err = errors.New("Invalid Group ID in GroupUsersPromote conversion from script runtime")
				return
			}
			u := vt.RawGetString("UserId")
			if u.Type() != lua.LTString {
				err = errors.New("Invalid User ID in GroupUsersPromote conversion from script runtime")
				return
			}
			uid, e := uuid.FromString(u.String())
			if e != nil {
				err = errors.New("Invalid User ID in GroupUsersPromote conversion from script runtime")
				return
			}
			gu = append(gu, &TGroupUsersPromote_GroupUserPromote{GroupId: gid.Bytes(), UserId: uid.Bytes()})
		})
		if err != nil {
			return nil, err
		}
		envelope.GetGroupUsersPromote().GroupUsers = gu
	default:
		result := ConvertLuaTable(lt)

		bytesEnvelope, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}

		if err = jsonpbUnmarshaler.Unmarshal(bytes.NewReader(bytesEnvelope), envelope); err != nil {
			return nil, err
		}
	}

	return envelope, nil
}
