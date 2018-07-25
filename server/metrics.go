// Copyright 2018 The Nakama Authors
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
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
	ocprometheus "go.opencensus.io/exporter/prometheus"
	"go.opencensus.io/exporter/stackdriver"
	"go.opencensus.io/plugin/ocgrpc"
	"go.opencensus.io/stats"
	"go.opencensus.io/stats/view"
	"go.opencensus.io/tag"
	"go.uber.org/zap"
	"strings"
)

var (
	// Metrics stats measurements.
	MetricsRuntimeCount          = stats.Int64("nakama/runtime/count", "Number of pooled runtime instances", stats.UnitNone)
	MetricsSocketWsTimeSpentMsec = stats.Float64("nakama.socket/ws/server_elapsed_time", "Elapsed time in msecs spent in WebSocket connections", stats.UnitMilliseconds)
	MetricsSocketWsOpenCount     = stats.Int64("nakama.socket/ws/open_count", "Number of opened WebSocket connections", stats.UnitNone)
	MetricsSocketWsCloseCount    = stats.Int64("nakama.socket/ws/close_count", "Number of closed WebSocket connections", stats.UnitNone)
	MetricsApiTimeSpentMsec      = stats.Float64("nakama.api/server/server_elapsed_time", "Elapsed time in msecs spent in API functions", stats.UnitMilliseconds)
	MetricsApiCount              = stats.Int64("nakama.api/server/request_count", "Number of calls to API functions", stats.UnitNone)
	MetricsRtapiTimeSpentMsec    = stats.Float64("nakama.rtapi/server/server_elapsed_time", "Elapsed time in msecs spent in realtime socket functions", stats.UnitMilliseconds)
	MetricsRtapiCount            = stats.Int64("nakama.rtapi/server/request_count", "Number of calls to realtime socket functions", stats.UnitNone)

	// Metrics stats tag keys.
	MetricsFunction, _ = tag.NewKey("function")
)

type Metrics struct {
	prometheusHTTPServer *http.Server
}

func NewMetrics(logger, startupLogger *zap.Logger, config Config) *Metrics {
	m := &Metrics{}

	if err := view.Register(&view.View{
		Name:        "nakama/runtime/count",
		Description: "Number of pooled runtime instances",
		TagKeys:     []tag.Key{},
		Measure:     MetricsRuntimeCount,
		Aggregation: view.Count(),
	}); err != nil {
		startupLogger.Fatal("Error subscribing runtime count metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.socket/ws/server_elapsed_time",
		Description: "Elapsed time in msecs spent in WebSocket connections",
		TagKeys:     []tag.Key{},
		Measure:     MetricsSocketWsTimeSpentMsec,
		Aggregation: ocgrpc.DefaultMillisecondsDistribution,
	}); err != nil {
		startupLogger.Fatal("Error subscribing socket ws elapsed time metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.socket/ws/open_count",
		Description: "Number of opened WebSocket connections",
		TagKeys:     []tag.Key{},
		Measure:     MetricsSocketWsOpenCount,
		Aggregation: view.Count(),
	}); err != nil {
		startupLogger.Fatal("Error subscribing socket ws opened count metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.socket/ws/close_count",
		Description: "Number of closed WebSocket connections",
		TagKeys:     []tag.Key{},
		Measure:     MetricsSocketWsCloseCount,
		Aggregation: view.Count(),
	}); err != nil {
		startupLogger.Fatal("Error subscribing socket ws count metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.api/server/server_elapsed_time",
		Description: "Elapsed time in msecs spent in API functions",
		TagKeys:     []tag.Key{MetricsFunction},
		Measure:     MetricsApiTimeSpentMsec,
		Aggregation: ocgrpc.DefaultMillisecondsDistribution,
	}); err != nil {
		startupLogger.Fatal("Error subscribing api elapsed time metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.api/server/request_count",
		Description: "Number of calls to API functions",
		TagKeys:     []tag.Key{MetricsFunction},
		Measure:     MetricsApiCount,
		Aggregation: view.Count(),
	}); err != nil {
		startupLogger.Fatal("Error subscribing api request count metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.rtapi/server/server_elapsed_time",
		Description: "Elapsed time in msecs spent in realtime socket functions",
		TagKeys:     []tag.Key{MetricsFunction},
		Measure:     MetricsRtapiTimeSpentMsec,
		Aggregation: ocgrpc.DefaultMillisecondsDistribution,
	}); err != nil {
		startupLogger.Fatal("Error subscribing rtapi elapsed time metrics view", zap.Error(err))
	}
	if err := view.Register(&view.View{
		Name:        "nakama.rtapi/server/request_count",
		Description: "Number of calls to realtime socket functions",
		TagKeys:     []tag.Key{MetricsFunction},
		Measure:     MetricsRtapiCount,
		Aggregation: view.Count(),
	}); err != nil {
		startupLogger.Fatal("Error subscribing rtapi request count metrics view", zap.Error(err))
	}

	view.SetReportingPeriod(time.Duration(config.GetMetrics().ReportingFreqSec) * time.Second)

	if config.GetMetrics().StackdriverProjectID != "" {
		m.initStackdriver(logger, startupLogger, config)
	}

	if config.GetMetrics().PrometheusPort > 0 {
		m.initPrometheus(logger, startupLogger, config)
	}

	return m
}

func (m *Metrics) initStackdriver(logger, startupLogger *zap.Logger, config Config) {
	prefix := config.GetName()
	if config.GetMetrics().Namespace != "" {
		prefix += "-" + config.GetMetrics().Namespace
	}

	exporter, err := stackdriver.NewExporter(stackdriver.Options{
		MetricPrefix: prefix,
		ProjectID:    config.GetMetrics().StackdriverProjectID,
		OnError: func(err error) {
			logger.Error("Could not upload data to Stackdriver", zap.Error(err))
		},
	})
	if err != nil {
		startupLogger.Fatal("Could not setup Stackdriver exporter", zap.Error(err))
	}
	view.RegisterExporter(exporter)
}

func (m *Metrics) initPrometheus(logger, startupLogger *zap.Logger, config Config) {
	prefix := strings.Replace(config.GetName(), "-", "_", -1)
	if config.GetMetrics().Namespace != "" {
		prefix += "_" + strings.Replace(config.GetMetrics().Namespace, "-", "_", -1)
	}

	exporter, err := ocprometheus.NewExporter(ocprometheus.Options{
		Namespace: prefix,
		OnError: func(err error) {
			logger.Error("Could not upload data to Prometheus", zap.Error(err))
		},
	})
	if err != nil {
		startupLogger.Fatal("Could not setup Prometheus exporter", zap.Error(err))
	}

	view.RegisterExporter(exporter)

	router := mux.NewRouter()
	router.Handle("/", exporter).Methods("GET")
	CORSHeaders := handlers.AllowedHeaders([]string{"Content-Type", "User-Agent"})
	CORSOrigins := handlers.AllowedOrigins([]string{"*"})
	CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD"})
	handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(router)

	m.prometheusHTTPServer = &http.Server{
		Addr:         fmt.Sprintf(":%d", config.GetMetrics().PrometheusPort),
		ReadTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().ReadTimeoutMs)),
		WriteTimeout: time.Millisecond * time.Duration(int64(config.GetSocket().WriteTimeoutMs)),
		IdleTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().IdleTimeoutMs)),
		Handler:      handlerWithCORS,
	}

	startupLogger.Info("Starting Prometheus server for metrics requests", zap.Int("port", config.GetMetrics().PrometheusPort))
	go func() {
		if err := m.prometheusHTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			startupLogger.Fatal("Prometheus listener failed", zap.Error(err))
		}
	}()
}

func (m *Metrics) Stop(logger *zap.Logger) {
	if m.prometheusHTTPServer != nil {
		if err := m.prometheusHTTPServer.Shutdown(context.Background()); err != nil {
			logger.Error("Prometheus listener shutdown failed", zap.Error(err))
		}
	}
}
