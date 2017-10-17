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
	"github.com/yuin/gopher-lua"
	"math/rand"
	"sync"
)

type Cbuffer struct {
	sync.Mutex
	items    []string
	uniques  map[string]struct{}
	size     int
	maxIdx   int
	writeIdx int
}

func NewCbuffer(maxSize int) *Cbuffer {
	return &Cbuffer{
		items:    make([]string, maxSize),
		uniques:  make(map[string]struct{}, maxSize),
		size:     0,
		maxIdx:   maxSize - 1,
		writeIdx: 0,
	}
}

func (c *Cbuffer) push(item string) {
	c.Lock()
	if _, ok := c.uniques[item]; ok {
		c.Unlock()
		return
	}

	oldItem := c.items[c.writeIdx]
	if oldItem != "" {
		delete(c.uniques, oldItem)
	} else {
		c.size += 1
	}
	c.items[c.writeIdx] = item
	c.uniques[item] = struct{}{}
	if c.writeIdx >= c.maxIdx {
		c.writeIdx = 0
	} else {
		c.writeIdx += 1
	}
	c.Unlock()
}

func (c *Cbuffer) peekRandom(count int) []string {
	c.Lock()

	if c.size <= count {
		items := make([]string, c.size)
		copy(items, c.items)
		c.Unlock()
		return items
	}

	limit := count * 2
	uniques := make(map[string]struct{})
	uniqueCount := 0
	for uniqueCount < count && limit >= 0 {
		item := c.items[rand.Intn(c.size)]
		if _, ok := uniques[item]; !ok {
			uniques[item] = struct{}{}
			uniqueCount += 1
		}
		limit -= 1
	}
	c.Unlock()

	itemsLen := len(uniques)
	if itemsLen > count {
		itemsLen = count
	}
	items := make([]string, itemsLen)
	itemsIdx := 0
	for i, _ := range uniques {
		items[itemsIdx] = i
		itemsIdx += 1
		if itemsIdx >= itemsLen {
			break
		}
	}
	return items
}

type CbufferPool struct {
	sync.Mutex
	buffers map[string]*Cbuffer
}

func NewCbufferPool() *CbufferPool {
	return &CbufferPool{
		buffers: make(map[string]*Cbuffer),
	}
}

func (c *CbufferPool) create(l *lua.LState) int {
	name := l.CheckString(1)
	if name == "" {
		l.ArgError(1, "expects name string")
		return 0
	}
	maxSize := l.CheckInt(2)
	if maxSize == 0 {
		l.ArgError(2, "expects max size integer")
		return 0
	}

	var found bool
	c.Lock()
	if _, found = c.buffers[name]; found {
		c.Unlock()
	} else {
		c.buffers[name] = NewCbuffer(maxSize)
		c.Unlock()
	}

	// Returns true if it's a brand new buffer.
	l.Push(lua.LBool(!found))
	return 1
}

func (c *CbufferPool) push(l *lua.LState) int {
	name := l.CheckString(1)
	if name == "" {
		l.ArgError(1, "expects name string")
		return 0
	}
	item := l.CheckString(2)
	if item == "" {
		l.ArgError(2, "expects item string")
		return 0
	}

	c.Lock()
	buffer := c.buffers[name]
	c.Unlock()

	// Pushing into buffers that don't exist is a no-op.
	if buffer != nil {
		buffer.push(item)
	}
	return 0
}

func (c *CbufferPool) peekRandom(l *lua.LState) int {
	name := l.CheckString(1)
	if name == "" {
		l.ArgError(1, "expects name string")
		return 0
	}
	count := l.CheckInt(2)
	if count == 0 {
		l.ArgError(2, "expects count integer")
		return 0
	}

	c.Lock()
	buffer := c.buffers[name]
	c.Unlock()

	// Peeking from buffers that don't exist returns no items.
	itemsTable := l.NewTable()
	if buffer != nil {
		items := buffer.peekRandom(count)
		for i, item := range items {
			itemsTable.RawSetInt(i+1, lua.LString(item))
		}
	}

	l.Push(itemsTable)
	return 1
}
