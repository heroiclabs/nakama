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
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/handlers"
	"github.com/uber-go/tally"
	"github.com/uber-go/tally/prometheus"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type Metrics struct {
	logger *zap.Logger
	config Config
	db     *sql.DB

	cancelFn context.CancelFunc

	SnapshotLatencyMs *atomic.Float64
	SnapshotRateSec   *atomic.Float64
	SnapshotRecvKbSec *atomic.Float64
	SnapshotSentKbSec *atomic.Float64

	currentReqCount  *atomic.Int64
	currentMsTotal   *atomic.Int64
	currentRecvBytes *atomic.Int64
	currentSentBytes *atomic.Int64

	prometheusScope       tally.Scope
	prometheusCustomScope tally.Scope
	prometheusCloser      io.Closer
	prometheusHTTPServer  *http.Server
}

func NewMetrics(logger, startupLogger *zap.Logger, db *sql.DB, config Config) *Metrics {
	ctx, cancelFn := context.WithCancel(context.Background())

	m := &Metrics{
		logger: logger,
		config: config,
		db:     db,

		cancelFn: cancelFn,

		SnapshotLatencyMs: atomic.NewFloat64(0),
		SnapshotRateSec:   atomic.NewFloat64(0),
		SnapshotRecvKbSec: atomic.NewFloat64(0),
		SnapshotSentKbSec: atomic.NewFloat64(0),

		currentMsTotal:   atomic.NewInt64(0),
		currentReqCount:  atomic.NewInt64(0),
		currentRecvBytes: atomic.NewInt64(0),
		currentSentBytes: atomic.NewInt64(0),
	}

	go func() {
		const snapshotFrequencySec = 5
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(snapshotFrequencySec * time.Second):
				reqCount := float64(m.currentReqCount.Swap(0))
				totalMs := float64(m.currentMsTotal.Swap(0))
				recvBytes := float64(m.currentRecvBytes.Swap(0))
				sentBytes := float64(m.currentSentBytes.Swap(0))

				if reqCount > 0 {
					m.SnapshotLatencyMs.Store(totalMs / reqCount)
				} else {
					m.SnapshotLatencyMs.Store(0)
				}
				m.SnapshotRateSec.Store(reqCount / snapshotFrequencySec)
				m.SnapshotRecvKbSec.Store((recvBytes / 1024) / snapshotFrequencySec)
				m.SnapshotSentKbSec.Store((sentBytes / 1024) / snapshotFrequencySec)
			}
		}
	}()

	// Create Prometheus reporter and root scope.
	reporter := prometheus.NewReporter(prometheus.Options{
		OnRegisterError: func(err error) {
			logger.Error("Error registering Prometheus metric", zap.Error(err))
		},
	})
	tags := map[string]string{"node_name": config.GetName()}
	if namespace := config.GetMetrics().Namespace; namespace != "" {
		tags["namespace"] = namespace
	}
	m.prometheusScope, m.prometheusCloser = tally.NewRootScope(tally.ScopeOptions{
		Prefix:          config.GetMetrics().Prefix,
		Tags:            tags,
		CachedReporter:  reporter,
		Separator:       prometheus.DefaultSeparator,
		SanitizeOptions: &prometheus.DefaultSanitizerOpts,
	}, time.Duration(config.GetMetrics().ReportingFreqSec)*time.Second)
	m.prometheusCustomScope = m.prometheusScope.SubScope(config.GetMetrics().CustomPrefix)

	// Check if exposing Prometheus metrics directly is enabled.
	if config.GetMetrics().PrometheusPort > 0 {
		// Create a HTTP server to expose Prometheus metrics through.
		CORSHeaders := handlers.AllowedHeaders([]string{"Content-Type", "User-Agent"})
		CORSOrigins := handlers.AllowedOrigins([]string{"*"})
		CORSMethods := handlers.AllowedMethods([]string{"GET", "HEAD"})
		handlerWithCORS := handlers.CORS(CORSHeaders, CORSOrigins, CORSMethods)(m.refreshDBStats(reporter.HTTPHandler()))
		m.prometheusHTTPServer = &http.Server{
			Addr:         fmt.Sprintf(":%d", config.GetMetrics().PrometheusPort),
			ReadTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().ReadTimeoutMs)),
			WriteTimeout: time.Millisecond * time.Duration(int64(config.GetSocket().WriteTimeoutMs)),
			IdleTimeout:  time.Millisecond * time.Duration(int64(config.GetSocket().IdleTimeoutMs)),
			Handler:      handlerWithCORS,
		}

		// Start Prometheus metrics server.
		startupLogger.Info("Starting Prometheus server for metrics requests", zap.Int("port", config.GetMetrics().PrometheusPort))
		go func() {
			if err := m.prometheusHTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				startupLogger.Fatal("Prometheus listener failed", zap.Error(err))
			}
		}()
	}

	return m
}

func (m *Metrics) refreshDBStats(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dbStats := m.db.Stats()

		m.prometheusScope.Gauge("db_max_open_conns").Update(float64(dbStats.MaxOpenConnections))
		m.prometheusScope.Gauge("db_total_open_conns").Update(float64(dbStats.OpenConnections))
		m.prometheusScope.Gauge("db_in_use_conns").Update(float64(dbStats.InUse))
		m.prometheusScope.Gauge("db_idle_conns").Update(float64(dbStats.Idle))
		m.prometheusScope.Gauge("db_total_wait_count").Update(float64(dbStats.WaitCount))
		m.prometheusScope.Gauge("db_total_wait_time_nanos").Update(float64(dbStats.WaitDuration))
		m.prometheusScope.Gauge("db_total_max_idle_closed").Update(float64(dbStats.MaxIdleClosed))
		m.prometheusScope.Gauge("db_total_max_idle_time_closed").Update(float64(dbStats.MaxIdleTimeClosed))
		m.prometheusScope.Gauge("db_total_max_lifetime_closed").Update(float64(dbStats.MaxLifetimeClosed))

		next.ServeHTTP(w, r)
	})
}

func (m *Metrics) Stop(logger *zap.Logger) {
	if m.prometheusHTTPServer != nil {
		// Stop Prometheus server if one is running.
		if err := m.prometheusHTTPServer.Shutdown(context.Background()); err != nil {
			logger.Error("Prometheus listener shutdown failed", zap.Error(err))
		}
	}

	// Close the Prometheus root scope if it's open.
	if err := m.prometheusCloser.Close(); err != nil {
		logger.Error("Prometheus stats closer failed", zap.Error(err))
	}
	m.cancelFn()
}

func (m *Metrics) Api(name string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool) {
	name = strings.TrimPrefix(name, API_PREFIX)

	// Increment ongoing statistics for current measurement window.
	m.currentMsTotal.Add(int64(elapsed / time.Millisecond))
	m.currentReqCount.Inc()
	m.currentRecvBytes.Add(recvBytes)
	m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.prometheusScope.Counter("overall_count").Inc(1)
	m.prometheusScope.Counter("overall_request_count").Inc(1)
	m.prometheusScope.Counter("overall_recv_bytes").Inc(recvBytes)
	m.prometheusScope.Counter("overall_request_recv_bytes").Inc(recvBytes)
	m.prometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	m.prometheusScope.Counter("overall_request_sent_bytes").Inc(sentBytes)
	m.prometheusScope.Timer("overall_latency_ms").Record(elapsed / time.Millisecond)

	// Per-endpoint stats.
	m.prometheusScope.Counter(name + "_count").Inc(1)
	m.prometheusScope.Counter(name + "_recv_bytes").Inc(recvBytes)
	m.prometheusScope.Counter(name + "_sent_bytes").Inc(sentBytes)
	m.prometheusScope.Timer(name + "_latency_ms").Record(elapsed / time.Millisecond)

	// Error stats if applicable.
	if isErr {
		m.prometheusScope.Counter("overall_errors").Inc(1)
		m.prometheusScope.Counter("overall_request_errors").Inc(1)
		m.prometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *Metrics) ApiBefore(name string, elapsed time.Duration, isErr bool) {
	name = "before_" + strings.TrimPrefix(name, API_PREFIX)

	// Global stats.
	m.prometheusScope.Counter("overall_before_count").Inc(1)
	m.prometheusScope.Timer("overall_before_latency_ms").Record(elapsed / time.Millisecond)

	// Per-endpoint stats.
	m.prometheusScope.Counter(name + "_count").Inc(1)
	m.prometheusScope.Timer(name + "_latency_ms").Record(elapsed / time.Millisecond)

	// Error stats if applicable.
	if isErr {
		m.prometheusScope.Counter("overall_before_errors").Inc(1)
		m.prometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *Metrics) ApiAfter(name string, elapsed time.Duration, isErr bool) {
	name = "after_" + strings.TrimPrefix(name, API_PREFIX)

	// Global stats.
	m.prometheusScope.Counter("overall_after_count").Inc(1)
	m.prometheusScope.Timer("overall_after_latency_ms").Record(elapsed / time.Millisecond)

	// Per-endpoint stats.
	m.prometheusScope.Counter(name + "_count").Inc(1)
	m.prometheusScope.Timer(name + "_latency_ms").Record(elapsed / time.Millisecond)

	// Error stats if applicable.
	if isErr {
		m.prometheusScope.Counter("overall_after_errors").Inc(1)
		m.prometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *Metrics) Message(recvBytes int64, isErr bool) {
	//name = strings.TrimPrefix(name, API_PREFIX)

	// Increment ongoing statistics for current measurement window.
	//m.currentMsTotal.Add(int64(elapsed / time.Millisecond))
	m.currentReqCount.Inc()
	m.currentRecvBytes.Add(recvBytes)
	//m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.prometheusScope.Counter("overall_count").Inc(1)
	m.prometheusScope.Counter("overall_message_count").Inc(1)
	m.prometheusScope.Counter("overall_recv_bytes").Inc(recvBytes)
	m.prometheusScope.Counter("overall_message_recv_bytes").Inc(recvBytes)
	//m.prometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	//m.prometheusScope.Timer("overall_latency_ms").Record(elapsed / time.Millisecond)

	// Per-message stats.
	//m.prometheusScope.Counter(name + "_count").Inc(1)
	//m.prometheusScope.Counter(name + "_recv_bytes").Inc(recvBytes)
	//m.prometheusScope.Counter(name + "_sent_bytes").Inc(sentBytes)
	//m.prometheusScope.Timer(name + "_latency_ms").Record(elapsed / time.Millisecond)

	// Error stats if applicable.
	if isErr {
		m.prometheusScope.Counter("overall_errors").Inc(1)
		m.prometheusScope.Counter("overall_message_errors").Inc(1)
		//m.prometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *Metrics) MessageBytesSent(sentBytes int64) {
	// Increment ongoing statistics for current measurement window.
	m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.prometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	m.prometheusScope.Counter("overall_message_sent_bytes").Inc(sentBytes)
}

// Set the absolute value of currently allocated Lua runtime VMs.
func (m *Metrics) GaugeRuntimes(value float64) {
	m.prometheusScope.Gauge("lua_runtimes").Update(value)
}

// Set the absolute value of currently allocated Lua runtime VMs.
func (m *Metrics) GaugeLuaRuntimes(value float64) {
	m.prometheusScope.Gauge("lua_runtimes").Update(value)
}

// Set the absolute value of currently allocated JavaScript runtime VMs.
func (m *Metrics) GaugeJsRuntimes(value float64) {
	m.prometheusScope.Gauge("javascript_runtimes").Update(value)
}

// Set the absolute value of currently running authoritative matches.
func (m *Metrics) GaugeAuthoritativeMatches(value float64) {
	m.prometheusScope.Gauge("authoritative_matches").Update(value)
}

// Increment the number of dropped events.
func (m *Metrics) CountDroppedEvents(delta int64) {
	m.prometheusScope.Counter("dropped_events").Inc(delta)
}

// Increment the number of opened WS connections.
func (m *Metrics) CountWebsocketOpened(delta int64) {
	m.prometheusScope.Counter("socket_ws_opened").Inc(delta)
}

// Increment the number of closed WS connections.
func (m *Metrics) CountWebsocketClosed(delta int64) {
	m.prometheusScope.Counter("socket_ws_closed").Inc(delta)
}

// Set the absolute value of currently active sessions.
func (m *Metrics) GaugeSessions(value float64) {
	m.prometheusScope.Gauge("sessions").Update(value)
}

// Set the absolute value of currently tracked presences.
func (m *Metrics) GaugePresences(value float64) {
	m.prometheusScope.Gauge("presences").Update(value)
}

// CustomCounter adds the given delta to a counter with the specified name and tags.
func (m *Metrics) CustomCounter(name string, tags map[string]string, delta int64) {
	scope := m.prometheusCustomScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Counter(name).Inc(delta)
}

// CustomGauge sets the given value to a gauge with the specified name and tags.
func (m *Metrics) CustomGauge(name string, tags map[string]string, value float64) {
	scope := m.prometheusCustomScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Gauge(name).Update(value)
}

// CustomTimer records the given value to a timer with the specified name and tags.
func (m *Metrics) CustomTimer(name string, tags map[string]string, value time.Duration) {
	scope := m.prometheusCustomScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Timer(name).Record(value)
}
