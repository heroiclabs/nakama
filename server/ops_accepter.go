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
	"encoding/json"
	"fmt"
	"net/http"

	"nakama/build/generated/dashboard"
	"os"
	"runtime"

	"github.com/elazarl/go-bindata-assetfs"
	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	"go.uber.org/zap"
)

// opsService is responsible for serving the dashboard and all of its required resources
type opsService struct {
	logger              *zap.Logger
	version             string
	config              Config
	statsService        StatsService
	mux                 *mux.Router
	dashboardFilesystem http.FileSystem
}

// NewOpsService creates a new opsService
func NewOpsService(logger *zap.Logger, multiLogger *zap.Logger, version string, config Config, statsService StatsService) *opsService {
	service := &opsService{
		logger:       logger,
		version:      version,
		config:       config,
		statsService: statsService,
		mux:          mux.NewRouter(),
		dashboardFilesystem: &assetfs.AssetFS{
			Asset:     dashboard.Asset,
			AssetDir:  dashboard.AssetDir,
			AssetInfo: dashboard.AssetInfo,
		},
	}

	service.mux.HandleFunc("/v0/health", service.healthHandler).Methods("GET")
	service.mux.HandleFunc("/v0/cluster/stats", service.statusHandler).Methods("GET")
	service.mux.HandleFunc("/v0/config", service.configHandler).Methods("GET")
	service.mux.HandleFunc("/v0/info", service.infoHandler).Methods("GET")
	service.mux.PathPrefix("/").Handler(http.FileServer(service.dashboardFilesystem)).Methods("GET") //needs to be last

	go func() {
		bindAddr := fmt.Sprintf(":%d", config.GetOpsPort())
		handlerWithCORS := handlers.CORS(handlers.AllowedOrigins([]string{"*"}))(service.mux)
		err := http.ListenAndServe(bindAddr, handlerWithCORS)
		if err != nil {
			multiLogger.Fatal("Ops listener failed", zap.Error(err))
		}
	}()
	multiLogger.Info("Ops", zap.Int("port", config.GetOpsPort()))
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "127.0.0.1"
	}
	multiLogger.Info("Dashboard", zap.String("url", fmt.Sprintf("http://%s:%d", hostname, config.GetOpsPort())))

	return service
}

func (s *opsService) Stop() {}

func (s *opsService) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	healthScore := s.statsService.GetHealthStatus()
	health := make(map[string]int)
	health["status"] = healthScore
	healthJSON, _ := json.Marshal(health)

	if healthScore > 0 {
		w.WriteHeader(500)
	}

	w.Write(healthJSON)
}

func (s *opsService) statusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	stats := s.statsService.GetStats()
	statsJSON, _ := json.Marshal(stats)
	w.Write(statsJSON)
}

func (s *opsService) configHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	config, _ := json.Marshal(s.config)
	w.Write(config)
}

func (s *opsService) infoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	info := map[string]interface{}{
		"version": s.version,
		"go":      runtime.Version(),
		"arch":    runtime.GOARCH,
		"os":      runtime.GOOS,
		"cpus":    runtime.NumCPU(),
	}

	infoBytes, _ := json.Marshal(info)
	w.Write(infoBytes)
}
