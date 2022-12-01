package nakamacluster

import (
	"context"
	"time"

	"github.com/doublemo/nakama-cluster/api"
	"github.com/gofrs/uuid"
)

type Message struct {
	id          uuid.UUID
	ctx         context.Context
	ctxCancelFn context.CancelFunc
	to          []string
	payload     *api.Envelope
	replyChan   chan *api.Envelope
	errChan     chan error
}

func (m *Message) ID() uuid.UUID {
	return m.id
}

func (m *Message) To() []string {
	return m.to
}

func (m *Message) Payload() *api.Envelope {
	return m.payload
}

func (m *Message) Wait() ([]*api.Envelope, error) {
	messageCounter := len(m.to)
	envelope := make([]*api.Envelope, messageCounter)
	i := 0
	for {
		if messageCounter <= 0 {
			break
		}

		select {
		case <-m.ctx.Done():
			return nil, m.ctx.Err()

		case err := <-m.errChan:
			return nil, err

		case m := <-m.replyChan:
			envelope[i] = m
			i++
			messageCounter--
		}
	}

	m.ctxCancelFn()
	close(m.replyChan)
	close(m.errChan)
	return envelope, nil
}

func (m *Message) Cancel() {
	if m.ctxCancelFn != nil {
		m.ctxCancelFn()
	}
}

func (m *Message) IsWaitReply() bool {
	return m.replyChan != nil
}

func (m *Message) Send(envelope *api.Envelope) error {
	select {
	case m.replyChan <- envelope:
	default:
		return ErrMessageQueueFull
	}

	return nil
}

func (m *Message) SendErr(err error) error {
	select {
	case m.errChan <- err:
	default:
		return ErrMessageQueueFull
	}

	return nil
}

func NewMessageWithReply(ctx context.Context, envelope *api.Envelope, to ...string) *Message {
	toLen := len(to)
	if toLen < 1 {
		return NewMessage(envelope)
	}

	tonodes := make([]string, 0, toLen)
	tonodeMap := make(map[string]bool)
	for _, node := range to {
		if tonodeMap[node] {
			continue
		}

		tonodes = append(tonodes, node)
		tonodeMap[node] = true
	}

	m := &Message{
		id:        uuid.Must(uuid.NewV4()),
		to:        tonodes,
		payload:   envelope,
		replyChan: make(chan *api.Envelope, 1),
		errChan:   make(chan error),
	}

	m.ctx, m.ctxCancelFn = context.WithTimeout(ctx, time.Second*30)
	return m
}

func NewMessage(envelope *api.Envelope, to ...string) *Message {
	m := &Message{
		id:        uuid.Must(uuid.NewV4()),
		to:        to,
		payload:   envelope,
		replyChan: nil,
	}

	return m
}
