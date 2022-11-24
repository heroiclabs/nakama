package nakamacluster

import (
	"sync"

	"github.com/doublemo/nakama-cluster/api"
)

type MessageQueue struct {
	list []*api.Envelope
	size int
	mu   sync.Mutex
}

func (m *MessageQueue) Len() (count int) {
	m.mu.Lock()
	count = len(m.list)
	m.mu.Unlock()
	return
}

func (m *MessageQueue) Push(message *api.Envelope) (ok bool) {
	m.mu.Lock()
	if len(m.list) < cap(m.list) {
		m.list = append(m.list, message)
		ok = true
	}
	m.mu.Unlock()
	return
}

func (m *MessageQueue) Pop() (message *api.Envelope) {
	m.mu.Lock()
	if len(m.list) < 1 {
		m.mu.Unlock()
		return
	}

	message = m.list[0]
	m.mu.Unlock()
	return
}

func (m *MessageQueue) PopAll() (messages []*api.Envelope) {
	m.mu.Lock()
	messages = m.list
	m.list = make([]*api.Envelope, 0, m.size)
	m.mu.Unlock()
	return
}

func (m *MessageQueue) Reset() {
	m.mu.Lock()
	m.list = make([]*api.Envelope, 0, m.size)
	m.mu.Unlock()
}

func NewMessageQueue(size int) *MessageQueue {
	return &MessageQueue{list: make([]*api.Envelope, 0, size), size: size}
}
