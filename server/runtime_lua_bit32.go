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
	"math"
	"math/bits"

	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
)

var (
	Bit32LibName   = "bit32"
	Bit32Default64 = int64(math.Pow(2, 32) - 1)
)

func OpenBit32(l *lua.LState) int {
	mod := l.RegisterModule(Bit32LibName, bit32Funcs)
	l.Push(mod)
	return 1
}

var bit32Funcs = map[string]lua.LGFunction{
	"arshift": bit32arshift,
	"band":    bit32band,
	"bnot":    bit32not,
	"bor":     bit32or,
	"btest":   bit32btest,
	"bxor":    bit32xor,
	"extract": bit32extract,
	"replace": bit32replace,
	"lrotate": bit32lrotate,
	"lshift":  bit32lshift,
	"rrotate": bit32rrotate,
	"rshift":  bit32rshift,
}

func bit32arshift(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	n := l.CheckInt(2)
	if n < 0 {
		l.Push(lua.LNumber(a << uint32(n*-1)))
	} else if a>>uint32(31) != 0 {
		l.Push(lua.LNumber((a >> uint32(n)) | (uint32(math.Pow(2, float64(n))-1) << uint32(32-n))))
	} else {
		l.Push(lua.LNumber(a >> uint32(n)))
	}
	return 1
}

func bit32band(l *lua.LState) int {
	a := uint32(l.OptInt64(1, Bit32Default64))
	next := 2
	for {
		val := l.Get(next)
		if val == lua.LNil {
			break
		}
		if val.Type() != lua.LTNumber {
			l.TypeError(next, lua.LTNumber)
			return 0
		}
		b := val.(lua.LNumber)
		a = a & uint32(b)
		next++
	}
	l.Push(lua.LNumber(a))
	return 1
}

func bit32not(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	l.Push(lua.LNumber(^a))
	return 1
}

func bit32or(l *lua.LState) int {
	a := uint32(l.OptInt64(1, 0))
	next := 2
	for {
		val := l.Get(next)
		if val == lua.LNil {
			break
		}
		if val.Type() != lua.LTNumber {
			l.TypeError(next, lua.LTNumber)
			return 0
		}
		b := val.(lua.LNumber)
		a = a | uint32(b)
		next++
	}
	l.Push(lua.LNumber(a))
	return 1
}

func bit32btest(l *lua.LState) int {
	a := uint32(l.OptInt64(1, Bit32Default64))
	next := 2
	for {
		val := l.Get(next)
		if val == lua.LNil {
			break
		}
		if val.Type() != lua.LTNumber {
			l.TypeError(next, lua.LTNumber)
			return 0
		}
		b := val.(lua.LNumber)
		a = a & uint32(b)
		next++
	}
	l.Push(lua.LBool(a != 0))
	return 1
}

func bit32xor(l *lua.LState) int {
	a := uint32(l.OptInt64(1, 0))
	next := 2
	for {
		val := l.Get(next)
		if val == lua.LNil {
			break
		}
		if val.Type() != lua.LTNumber {
			l.TypeError(next, lua.LTNumber)
			return 0
		}
		b := val.(lua.LNumber)
		a = a ^ uint32(b)
		next++
	}
	l.Push(lua.LNumber(a))
	return 1
}

func bit32extract(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	offset := l.CheckInt(2)
	width := l.OptInt(3, 1)
	if offset < 0 || offset > 31 || width < 1 || width > 32 || (offset+width) > 32 {
		l.RaiseError("trying to access non-existent bits")
		return 0
	}
	l.Push(lua.LNumber((a >> uint32(offset)) & (1<<uint32(width) - 1)))
	return 1
}

func bit32replace(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	v := uint32(l.CheckInt64(2))
	offset := l.CheckInt(3)
	width := l.OptInt(4, 1)
	if offset < 0 || offset > 31 || width < 1 || width > 32 || (offset+width) > 32 {
		l.RaiseError("trying to access non-existent bits")
		return 0
	}
	a = a ^ (((a >> uint32(offset)) & (1<<uint32(width) - 1)) << uint32(offset))
	v = ((v << uint32(32-width)) >> uint32(32-width)) << uint32(offset)
	l.Push(lua.LNumber(a | v))
	return 1
}

func bit32lrotate(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	n := l.CheckInt(2)
	l.Push(lua.LNumber(bits.RotateLeft32(a, n)))
	return 1
}

func bit32lshift(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	n := l.CheckInt(2)
	if n < 0 {
		l.Push(lua.LNumber(a >> uint32(n*-1)))
	} else {
		l.Push(lua.LNumber(a << uint32(n)))
	}
	return 1
}

func bit32rrotate(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	n := l.CheckInt(2)
	l.Push(lua.LNumber(bits.RotateLeft32(a, n*-1)))
	return 1
}

func bit32rshift(l *lua.LState) int {
	a := uint32(l.CheckInt64(1))
	n := l.CheckInt(2)
	if n < 0 {
		l.Push(lua.LNumber(a << uint32(n*-1)))
	} else {
		l.Push(lua.LNumber(a >> uint32(n)))
	}
	return 1
}
