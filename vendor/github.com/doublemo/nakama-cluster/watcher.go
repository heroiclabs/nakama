package nakamacluster

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/doublemo/nakama-cluster/sd"
	"go.uber.org/zap"
)

type Watcher struct {
	ctx      context.Context
	cancelFn context.CancelFunc
	sdClient sd.Client
	onUpdate atomic.Value
	prefix   string
	logger   *zap.Logger
	once     sync.Once
}

func (s *Watcher) Stop() {
	s.once.Do(func() {
		if s.cancelFn != nil {
			s.cancelFn()
		}
	})
}

func (s *Watcher) OnUpdate(f func(meta []*Meta)) {
	s.onUpdate.Store(f)
}

func (s *Watcher) GetEntries() ([]*Meta, error) {
	values, err := s.sdClient.GetEntries(s.prefix)
	if err != nil {
		s.logger.Warn("Failed reading meta nodes from sd", zap.Error(err))
		return nil, errors.New("Failed reading meta nodes from sd")
	}

	metas := make([]*Meta, 0, len(values))
	for _, value := range values {
		meta := NewNodeMetaFromJSON([]byte(value))
		if meta == nil {
			s.logger.Warn("Failed parse meta nodes from sd", zap.String("value", value))
			continue
		}

		metas = append(metas, meta)
	}
	return metas, nil
}

func (s *Watcher) Update(meta *Meta) error {
	metaValue, err := meta.Marshal()
	if err != nil {
		s.logger.Fatal("Failed marshal meta", zap.Error(err))
	}

	var service sd.Service
	service.Key = fmt.Sprintf("%s/%s", s.prefix, meta.Id)
	service.Value = string(metaValue)
	service.TTL = sd.NewTTLOption(3*time.Second, 10*time.Second)

	return s.sdClient.Update(service)
}

func (s *Watcher) watch(meta *Meta) {
	metaValue, err := meta.Marshal()
	if err != nil {
		s.logger.Fatal("Failed marshal meta", zap.Error(err))
	}

	var service sd.Service
	service.Key = fmt.Sprintf("%s/%s", s.prefix, meta.Id)
	service.Value = string(metaValue)
	service.TTL = sd.NewTTLOption(3*time.Second, 10*time.Second)

	s.sdClient.Register(service)
	defer func() {
		s.sdClient.Deregister(service)
	}()

	watchCh := make(chan struct{}, 1)
	go s.sdClient.WatchPrefix(s.prefix, watchCh)

	for {
		select {
		case <-watchCh:
			s.update()
		case <-s.ctx.Done():
			return
		}
	}
}

func (s *Watcher) update() {
	handler, ok := s.onUpdate.Load().(func(meta []*Meta))
	if !ok || handler == nil {
		return
	}

	meta, err := s.GetEntries()
	if err != nil {
		return
	}

	handler(meta)
}

func NewWatcher(ctx context.Context, logger *zap.Logger, sdClient sd.Client, prefix string, meta *Meta) *Watcher {
	watcher := &Watcher{
		sdClient: sdClient,
		prefix:   prefix,
		logger:   logger,
	}
	watcher.ctx, watcher.cancelFn = context.WithCancel(ctx)
	go watcher.watch(meta)
	return watcher
}
