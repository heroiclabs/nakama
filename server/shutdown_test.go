package server

import (
	"context"
	"github.com/stretchr/testify/assert"
	"os"
	"testing"
	"time"
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

		shutdownFnCalled := false
		shutdownFn := func(ctx context.Context) {
			shutdownFnCalled = true
		}

		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, matchRegistry, graceSeconds, shutdownFn, c)
		elapsedSec := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsedSec), 0)
		assert.False(t, shutdownFnCalled)
	})

	t.Run("when grace_period_sec is > 0 the shutdown function is executed", func(t *testing.T) {
		graceSeconds := 1

		shutdownFnCalled := false
		shutdownFn := func(ctx context.Context) {
			shutdownFnCalled = true
		}

		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, matchRegistry, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.True(t, shutdownFnCalled)
	})

	t.Run("when matchRegistry.Stop() completes before grace_period_sec but shutdownFn takes longer than grace_period_sec it is not awaited", func(t *testing.T) {
		graceSeconds := 1

		shutdownFnDone := false
		shutdownFn := func(ctx context.Context) {
			time.Sleep(2 * time.Second)
			shutdownFnDone = true
		}

		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, matchRegistry, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.False(t, shutdownFnDone)
	})

	t.Run("when matchRegistry.Stop() takes longer than grace_period_sec shutdownFn is not awaited", func(t *testing.T) {
		graceSeconds := 1

		shutdownFnDone := false
		shutdownFn := func(ctx context.Context) {
			time.Sleep(2 * time.Second)
			shutdownFnDone = true
		}

		mr := MockMatchRegistry{sleepTime: 2 * time.Second}
		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, mr, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.False(t, shutdownFnDone)
	})

	t.Run("when matchRegistry.Stop() completes before grace period elapsed and before shutdownFn, shutdownFn is awaited until grace period elapses", func(t *testing.T) {
		graceSeconds := 2

		shutdownFnDone := false
		shutdownFn := func(ctx context.Context) {
			time.Sleep(1500 * time.Millisecond)
			shutdownFnDone = true
		}

		mr := MockMatchRegistry{sleepTime: 1 * time.Second}
		c := make(chan os.Signal, 2)

		now := time.Now()
		HandleShutdown(ctx, logger, mr, graceSeconds, shutdownFn, c)
		elapsed := time.Since(now).Truncate(time.Second).Seconds()

		assert.LessOrEqual(t, int(elapsed), graceSeconds)
		assert.True(t, shutdownFnDone)
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
