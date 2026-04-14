// Copyright 2026 The Nakama Authors
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
	"testing"
	"time"

	"go.uber.org/zap"
)

func TestMetricsCounterAddNegativeDoesNotPanics(t *testing.T) {
	logger := zap.NewNop()
	cfg := NewConfig(logger)
	cfg.Metrics.ReportingFreqSec = 1
	reportingInterval := time.Duration(cfg.Metrics.ReportingFreqSec) * time.Second
	flushWait := reportingInterval + 200*time.Millisecond

	metrics := NewLocalMetrics(logger, logger, nil, cfg)
	defer metrics.Stop(logger)

	module := &RuntimeGoNakamaModule{metrics: metrics}
	module.MetricsCounterAdd("panic_counter", nil, 1)

	time.Sleep(flushWait)
	module.MetricsCounterAdd("panic_counter", nil, -1)

	time.Sleep(flushWait)
}
