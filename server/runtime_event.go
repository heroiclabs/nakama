// Copyright 2019 The Nakama Authors
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
	"context"

	"go.uber.org/zap"
)

type RuntimeEventQueue struct {
	logger  *zap.Logger
	metrics Metrics

	ch chan func()

	ctx         context.Context
	ctxCancelFn context.CancelFunc
}

func NewRuntimeEventQueue(logger *zap.Logger, config Config, metrics Metrics) *RuntimeEventQueue {
	b := &RuntimeEventQueue{
		logger:  logger,
		metrics: metrics,

		ch: make(chan func(), config.GetRuntime().EventQueueSize),
	}
	b.ctx, b.ctxCancelFn = context.WithCancel(context.Background())

	// Start a fixed number of workers.
	for i := 0; i < config.GetRuntime().EventQueueWorkers; i++ {
		go func() {
			for {
				select {
				case <-b.ctx.Done():
					return
				case fn := <-b.ch:
					fn()
				}
			}
		}()
	}

	return b
}

func (b *RuntimeEventQueue) Queue(fn func()) {
	select {
	case b.ch <- fn:
		// Event queued successfully.
	default:
		// Event queue is full, drop it to avoid blocking the caller.
		b.metrics.CountDroppedEvents(1)
		b.logger.Warn("Runtime event queue full, events may be lost")
	}
}

func (b *RuntimeEventQueue) Stop() {
	b.ctxCancelFn()
}
