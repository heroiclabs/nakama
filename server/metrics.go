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
	"github.com/prometheus/client_golang/prometheus"
	ocprometheus "go.opencensus.io/exporter/prometheus"
	"go.opencensus.io/exporter/stackdriver"
	"go.opencensus.io/stats/view"
	"go.uber.org/zap"
)

type Metrics struct {
	prometheusHTTPServer *http.Server
}

func NewMetrics(logger *zap.Logger, config Config) *Metrics {
	m := &Metrics{}
	view.SetReportingPeriod(time.Duration(config.GetMetrics().ReportingFreqSec) * time.Second)
	if config.GetMetrics().StackdriverProjectID != "" {
		m.initStackdriver(logger, config)
	}

	if config.GetMetrics().PrometheusPort > 0 {
		m.initPrometheus(logger, config)
	}

	return m
}

func (m *Metrics) initStackdriver(logger *zap.Logger, config Config) {
	prefix := config.GetName()
	if config.GetMetrics().Namespace != "" {
		prefix += "-" + config.GetMetrics().Namespace
	}

	exporter, err := stackdriver.NewExporter(stackdriver.Options{
		MetricPrefix: prefix,
		ProjectID:    config.GetMetrics().StackdriverProjectID,
		OnError: func(err error) {
			logger.Error("Could not upload data to Stackdriver.", zap.Error(err))
		},
	})
	if err != nil {
		logger.Fatal("Could not setup Stackdriver exporter.", zap.Error(err))
	}
	view.RegisterExporter(exporter)
}

func (m *Metrics) initPrometheus(logger *zap.Logger, config Config) {
	prefix := config.GetName()
	if config.GetMetrics().Namespace != "" {
		prefix += "-" + config.GetMetrics().Namespace
	}

	registry := prometheus.NewRegistry()
	exporter, err := ocprometheus.NewExporter(ocprometheus.Options{
		Namespace: prefix,
		Registry:  registry,
		OnError: func(err error) {
			logger.Error("Could not upload data to Prometheus.", zap.Error(err))
		},
	})
	if err != nil {
		logger.Fatal("Could not setup Prometheus exporter.", zap.Error(err))
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

	logger.Info("Starting Prometheus server to server metrics requests", zap.Int("port", config.GetMetrics().PrometheusPort))
	go func() {
		if err := m.prometheusHTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Prometheus listener failed.", zap.Error(err))
		}
	}()
}

func (m *Metrics) Stop(logger *zap.Logger) {
	if m.prometheusHTTPServer != nil {
		if err := m.prometheusHTTPServer.Shutdown(context.Background()); err != nil {
			logger.Error("Prometheus listener shutdown failed.", zap.Error(err))
		}
	}
}
