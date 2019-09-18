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
	"github.com/heroiclabs/nakama/v2/console"
	"go.uber.org/zap"
	"runtime"
)

type StatusHandler interface {
	GetStatus(ctx context.Context) ([]*console.StatusList_Status, error)
}

type LocalStatusHandler struct {
	logger          *zap.Logger
	sessionRegistry SessionRegistry
	matchRegistry   MatchRegistry
	tracker         Tracker
	metricsExporter *MetricsExporter
	node            string
}

func NewLocalStatusHandler(logger *zap.Logger, sessionRegistry SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, metricsExporter *MetricsExporter, node string) StatusHandler {
	return &LocalStatusHandler{
		logger:          logger,
		sessionRegistry: sessionRegistry,
		matchRegistry:   matchRegistry,
		tracker:         tracker,
		metricsExporter: metricsExporter,
		node:            node,
	}
}

func (s *LocalStatusHandler) GetStatus(ctx context.Context) ([]*console.StatusList_Status, error) {
	return []*console.StatusList_Status{
		{
			Name:           s.node,
			Health:         0,
			SessionCount:   int32(s.sessionRegistry.Count()),
			PresenceCount:  int32(s.tracker.Count()),
			MatchCount:     int32(s.matchRegistry.Count()),
			GoroutineCount: int32(runtime.NumGoroutine()),
			AvgLatencyMs:   s.metricsExporter.Latency.Load(),
			AvgRateSec:     s.metricsExporter.Rate.Load(),
			AvgInputKbs:    s.metricsExporter.Input.Load(),
			AvgOutputKbs:   s.metricsExporter.Output.Load(),
		},
	}, nil
}
