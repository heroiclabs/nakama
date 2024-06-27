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
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
	"go.uber.org/zap"
)

func HandleShutdown(ctx context.Context, logger *zap.Logger, matchRegistry MatchRegistry, graceSeconds int, shutdownFn RuntimeShutdownFunction, c chan os.Signal) {
	// If a shutdown grace period is allowed, prepare a timer.
	var timer *time.Timer
	timerCh := make(<-chan time.Time, 1)
	runtimeShutdownFnDone := make(chan struct{}, 1)

	if graceSeconds != 0 {
		graceDuration := time.Duration(graceSeconds) * time.Second
		if shutdownFn != nil {
			go func() {
				shCtx, _ := context.WithTimeoutCause(context.WithoutCancel(ctx), graceDuration, runtime.ErrGracePeriodExpired)
				shutdownFn(shCtx)
				close(runtimeShutdownFnDone)
			}()
		} else {
			close(runtimeShutdownFnDone)
		}

		timer = time.NewTimer(graceDuration)
		timerCh = timer.C

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
