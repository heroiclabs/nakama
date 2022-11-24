package nakamacluster

import (
	"sync"
)

// MessageCursor 信息游标
type MessageCursor struct {
	cursor           map[string]uint64
	cursorMap        map[string][]byte
	cursorMapMaxByte int
	cursorLoopId     uint64
	sync.RWMutex
}

func (c *MessageCursor) Fire(key string, value uint64) bool {
	c.RLock()
	lastId := c.cursor[key]
	loopId := c.cursorLoopId
	_, found := c.cursorMap[key]
	c.RUnlock()

	if !found {
		c.Reset(key)
		return true
	}

	if value == lastId {
		return false
	}

	mod := int(value % uint64(c.cursorMapMaxByte))
	if mod == 0 && loopId != value {
		c.Lock()
		c.cursorMap[key] = make([]byte, c.cursorMapMaxByte)
		c.cursorLoopId = value
		c.Unlock()
	}

	if value-lastId != 1 {
		c.Lock()
		ok := c.cursorMap[key][mod]
		c.Unlock()
		if ok == 0x1 {
			return false
		}
	}

	c.Lock()
	c.cursor[key] = value
	c.cursorMap[key][mod] = 0x1
	c.Unlock()
	return true
}

func (c *MessageCursor) Remove(key string) {
	c.Lock()
	delete(c.cursor, key)
	delete(c.cursorMap, key)
	c.Unlock()
}

func (c *MessageCursor) Reset(key string) {
	c.Lock()
	c.cursor[key] = 0
	c.cursorMap[key] = make([]byte, c.cursorMapMaxByte)
	c.cursorLoopId = 0
	c.Unlock()
}

func NewMessageCursor(maxByte int) *MessageCursor {
	return &MessageCursor{
		cursor:           make(map[string]uint64),
		cursorMap:        make(map[string][]byte),
		cursorMapMaxByte: maxByte,
		cursorLoopId:     0,
	}
}
