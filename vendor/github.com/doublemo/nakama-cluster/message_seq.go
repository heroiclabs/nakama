package nakamacluster

import (
	"sync"
	"sync/atomic"
)

type MessageSeq struct {
	broadcastID uint64
	id          map[string]uint64
	sync.Mutex
}

func (s *MessageSeq) NextBroadcastID() uint64 {
	return atomic.AddUint64(&s.broadcastID, 1)
}

func (s *MessageSeq) NextID(key string) uint64 {
	s.Lock()
	defer s.Unlock()
	s.id[key]++
	return s.id[key]
}

func NewMessageSeq() *MessageSeq {
	return &MessageSeq{
		id: make(map[string]uint64),
	}
}
