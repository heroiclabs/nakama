// The MIT License (MIT)
//
// Copyright (c) 2015 Yusuke Inuzuka
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package server

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
)

const emptyLString lua.LString = lua.LString("")

func loGetPath(env string, defpath string) string {
	path := os.Getenv(env)
	if len(path) == 0 {
		path = defpath
	}
	path = strings.Replace(path, ";;", ";"+defpath+";", -1)
	if os.PathSeparator != '/' {
		dir, err := filepath.Abs(filepath.Dir(os.Args[0]))
		if err != nil {
			panic(err)
		}
		path = strings.Replace(path, "!", dir, -1)
	}
	return path
}

func OpenPackage(moduleCache *RuntimeLuaModuleCache) func(L *lua.LState) int {
	return func(L *lua.LState) int {
		loLoaderCache := func(L *lua.LState) int {
			name := L.CheckString(1)
			module, ok := moduleCache.Modules[name]
			if !ok {
				L.Push(lua.LString(fmt.Sprintf("no cached module '%s'", name)))
				return 1
			}
			fn, err := L.Load(bytes.NewReader(module.Content), module.Path)
			if err != nil {
				L.RaiseError(err.Error())
			}
			L.Push(fn)
			return 1
		}

		packagemod := L.RegisterModule(lua.LoadLibName, loFuncs)

		L.SetField(packagemod, "preload", L.NewTable())

		loaders := L.CreateTable(2, 0)
		L.RawSetInt(loaders, 1, L.NewFunction(loLoaderPreload))
		L.RawSetInt(loaders, 2, L.NewFunction(loLoaderCache))
		L.SetField(packagemod, "loaders", loaders)
		L.SetField(L.Get(lua.RegistryIndex), "_LOADERS", loaders)

		loaded := L.NewTable()
		L.SetField(packagemod, "loaded", loaded)
		L.SetField(L.Get(lua.RegistryIndex), "_LOADED", loaded)

		L.SetField(packagemod, "path", lua.LString(loGetPath(lua.LuaPath, lua.LuaPathDefault)))
		L.SetField(packagemod, "cpath", emptyLString)

		L.Push(packagemod)
		return 1
	}
}

var loFuncs = map[string]lua.LGFunction{
	"loadlib": loLoadLib,
	"seeall":  loSeeAll,
}

func loLoaderPreload(L *lua.LState) int {
	name := L.CheckString(1)
	preload := L.GetField(L.GetField(L.Get(lua.EnvironIndex), "package"), "preload")
	if _, ok := preload.(*lua.LTable); !ok {
		L.RaiseError("package.preload must be a table")
	}
	lv := L.GetField(preload, name)
	if lv == lua.LNil {
		L.Push(lua.LString(fmt.Sprintf("no field package.preload['%s']", name)))
		return 1
	}
	L.Push(lv)
	return 1
}

func loLoadLib(L *lua.LState) int {
	L.RaiseError("loadlib is not supported")
	return 0
}

func loSeeAll(L *lua.LState) int {
	mod := L.CheckTable(1)
	mt := L.GetMetatable(mod)
	if mt == lua.LNil {
		mt = L.CreateTable(0, 1)
		L.SetMetatable(mod, mt)
	}
	L.SetField(mt, "__index", L.Get(lua.GlobalsIndex))
	return 0
}
