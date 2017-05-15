// Copyright 2017 The Nakama Authors
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
	"net"
	"runtime"

	"go.uber.org/zap"
)

// StatsService is responsible for gathering and reading stats information from metrics
type StatsService interface {
	GetStats() []map[string]interface{}
	GetHealthStatus() int
}

type statsService struct {
	logger    *zap.Logger
	version   string
	config    Config
	tracker   Tracker
	startedAt int64
}

// NewStatsService creates a new StatsService
func NewStatsService(logger *zap.Logger, config Config, version string, tracker Tracker, startedAt int64) StatsService {
	return &statsService{
		logger:    logger,
		version:   version,
		config:    config,
		tracker:   tracker,
		startedAt: startedAt,
	}
}

func (s *statsService) GetHealthStatus() int {
	return 0 //TODO - calculate extra information such as connectivity to DB etc
}

func (s *statsService) GetStats() []map[string]interface{} {
	memStats := &runtime.MemStats{}
	runtime.ReadMemStats(memStats)

	data := make(map[string]interface{})
	data["name"] = s.config.GetName()
	data["started_at"] = s.startedAt
	data["health_status"] = s.GetHealthStatus()
	data["version"] = s.version
	data["address"] = s.getLocalIP()
	data["process_count"] = runtime.NumGoroutine()
	data["presence_count"] = s.getPresenceCount()

	stats := make([]map[string]interface{}, 1)
	stats[0] = data

	return stats
}

// GetLocalIP returns the non loopback local IP of the host
func (s *statsService) getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		s.logger.Error("Could not get interface addresses", zap.Error(err))
		return "127.0.0.1"
	}
	for _, address := range addrs {
		// check the address type and if it is not a loopback the display it
		if ipnet, ok := address.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}

	s.logger.Warn("No non-loopback address was found")
	return "127.0.0.1"
}

func (s *statsService) getPresenceCount() int {
	return s.tracker.Count()
}
