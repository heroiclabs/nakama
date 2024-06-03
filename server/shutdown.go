package server

import (
	"context"
	"go.uber.org/zap"
	"os"
	"time"
)

func HandleShutdown(ctx context.Context, logger *zap.Logger, matchRegistry MatchRegistry, graceSeconds int, shutdownFn RuntimeShutdownFunction, c chan os.Signal) {
	// If a shutdown grace period is allowed, prepare a timer.
	var timer *time.Timer
	timerCh := make(<-chan time.Time, 1)
	runtimeShutdownFnDone := make(chan struct{}, 1)

	if graceSeconds != 0 {
		timer = time.NewTimer(time.Duration(graceSeconds) * time.Second)
		timerCh = timer.C

		if shutdownFn != nil {
			go func() {
				shutdownFn(ctx)
				close(runtimeShutdownFnDone)
			}()
		} else {
			close(runtimeShutdownFnDone)
		}

		logger.Info("Shutdown started - use CTRL^C to force stop server", zap.Int("grace_period_sec", graceSeconds))
	} else {
		// No grace period.
		logger.Info("Shutdown started")
	}

	timerExpired := false
	// Stop any running authoritative matches and do not accept any new ones.
	select {
	case <-matchRegistry.Stop(graceSeconds):
		// Graceful shutdown has completed.
		logger.Info("All authoritative matches stopped")
	case <-timerCh:
		// Timer has expired, terminate matches immediately.
		logger.Info("Shutdown grace period expired")
		<-matchRegistry.Stop(0)
		timerExpired = true
	case <-c:
		// A second interrupt has been received.
		logger.Info("Skipping graceful shutdown")
		<-matchRegistry.Stop(0)
		timerExpired = true // Ensure shutdown function is not awaited.
	}

	// Wait for shutdown function to complete if grace period is set and hasn't expired.
	if graceSeconds != 0 && shutdownFn != nil && !timerExpired {
		select {
		case <-timerCh:
			logger.Info("Shutdown function grace period expired")
		case <-runtimeShutdownFnDone:
			logger.Debug("Awaiting for Shutdown function to complete")
		case <-c:
			logger.Info("Skipping graceful shutdown")
		}
	}

	if timer != nil {
		timer.Stop()
	}
}
