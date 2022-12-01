package nakamacluster

import "sync"

type MessageCursor struct {
	cursor     map[string]uint64
	cursorMap  map[string][]byte
	cursorLoop map[string]uint64
	size       uint64
	sync.Mutex
}

func (s *MessageCursor) Fire(k string, v uint64) bool {
	s.Lock()
	lastID := s.cursor[k]
	loopID := s.cursorLoop[k]
	_, found := s.cursorMap[k]
	s.Unlock()

	if v == lastID {
		return false
	}

	if !found {
		s.Lock()
		s.cursorMap[k] = make([]byte, s.size)
		s.Unlock()
	}

	mod := int(v % s.size)
	if mod == 0 && loopID != v {
		s.Lock()
		s.cursorMap[k] = make([]byte, s.size)
		s.cursorLoop[k] = v
		s.Unlock()
	}

	if v-lastID != 1 {
		s.Lock()
		if s.cursorMap[k][mod] == 0x1 {
			s.Unlock()
			return false
		}
		s.Unlock()
	}

	s.Lock()
	s.cursor[k] = v
	s.cursorMap[k][mod] = 0x1
	s.Unlock()
	return true
}

func (s *MessageCursor) Remove(k string) {
	s.Lock()
	delete(s.cursor, k)
	delete(s.cursorMap, k)
	delete(s.cursorLoop, k)
	s.Unlock()
}

func (s *MessageCursor) Reset(k string) {
	s.Lock()
	s.cursor[k] = 0
	s.cursorMap[k] = make([]byte, s.size)
	s.cursorLoop[k] = 0
	s.Unlock()
}

func NewMessageCursor(size int) *MessageCursor {
	return &MessageCursor{
		cursor:     make(map[string]uint64),
		cursorMap:  make(map[string][]byte),
		cursorLoop: make(map[string]uint64),
		size:       uint64(size),
	}
}
