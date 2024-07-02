// Copyright 2024 The Nakama Authors
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
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestServer_HandleShutdown(t *testing.T) {
	ctx := context.Background()
	sessionRegistry := NewLocalSessionRegistry(metrics)
	tracker := &LocalTracker{sessionRegistry: sessionRegistry}
	router := &DummyMessageRouter{}

	// matchRegistry with no matches - .Stop() will return immediately.
	matchRegistry := NewLocalMatchRegistry(logger, logger, cfg, sessionRegistry, tracker, router, metrics, "nakama")

	t.Run("when no grace_period_sec is set the shutdown function is not executed", func(t *testing.T) {
		graceSeconds := 0

		shutdownFnCalled := atomic.Bool{}
		shutdownFn := func(ctx context.Context) {
			shutdownFnCalled.Store(true)
		}

		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, matchRegistry, graceSeconds, shutdownFn, c)
		elapsedSec := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsedSec), 0)
		assert.False(t, shutdownFnCalled.Load())
	})

	t.Run("when grace_period_sec is > 0 the shutdown function is executed", func(t *testing.T) {
		graceSeconds := 1

		shutdownFnCalled := atomic.Bool{}
		shutdownFn := func(ctx context.Context) {
			shutdownFnCalled.Store(true)
		}

		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, matchRegistry, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.True(t, shutdownFnCalled.Load())
	})

	t.Run("when matchRegistry.Stop() completes before grace_period_sec but shutdownFn takes longer than grace_period_sec it is not awaited", func(t *testing.T) {
		graceSeconds := 1

		shutdownFnDone := atomic.Bool{}
		shutdownFn := func(ctx context.Context) {
			time.Sleep(2 * time.Second)
			shutdownFnDone.Store(true)
		}

		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, matchRegistry, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.False(t, shutdownFnDone.Load())
	})

	t.Run("when matchRegistry.Stop() takes longer than grace_period_sec shutdownFn is not awaited", func(t *testing.T) {
		graceSeconds := 1

		shutdownFnDone := atomic.Bool{}
		shutdownFn := func(ctx context.Context) {
			time.Sleep(2 * time.Second)
			shutdownFnDone.Store(true)
		}

		mr := MockMatchRegistry{sleepTime: 2 * time.Second}
		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, mr, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.False(t, shutdownFnDone.Load())
	})

	t.Run("when matchRegistry.Stop() completes before grace period elapsed and before shutdownFn, shutdownFn is awaited until grace period elapses", func(t *testing.T) {
		graceSeconds := 2

		shutdownFnDone := atomic.Bool{}
		shutdownFn := func(ctx context.Context) {
			time.Sleep(1500 * time.Millisecond)
			shutdownFnDone.Store(true)
		}

		mr := MockMatchRegistry{sleepTime: 1 * time.Second}
		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, mr, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.True(t, shutdownFnDone.Load())
	})
}

type MockMatchRegistry struct {
	sleepTime time.Duration
	MatchRegistry
}

// Mock function that simulates matches taking `sleepTime` to stop.
func (m MockMatchRegistry) Stop(graceSeconds int) chan struct{} {
	c := make(chan struct{}, 2)
	if graceSeconds != 0 {
		go func() {
			time.Sleep(m.sleepTime)
			c <- struct{}{}
		}()
	} else {
		c <- struct{}{}
	}

	return c
}
