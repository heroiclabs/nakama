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
	"github.com/uber-go/tally/v4"
	"github.com/uber-go/tally/v4/prometheus"
	"go.uber.org/atomic"
	"go.uber.org/zap"
)

type Metrics interface {
	Stop(logger *zap.Logger)

	SnapshotLatencyMs() float64
	SnapshotRateSec() float64
	SnapshotRecvKbSec() float64
	SnapshotSentKbSec() float64

	Api(name string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool)
	ApiRpc(id string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool)
	ApiBefore(name string, elapsed time.Duration, isErr bool)
	ApiAfter(name string, elapsed time.Duration, isErr bool)

	Message(recvBytes int64, isErr bool)
	MessageBytesSent(sentBytes int64)

	GaugeRuntimes(value float64)
	GaugeLuaRuntimes(value float64)
	GaugeJsRuntimes(value float64)
	GaugeAuthoritativeMatches(value float64)
	CountDroppedEvents(delta int64)
	CountWebsocketOpened(delta int64)
	CountWebsocketClosed(delta int64)
	CountUntaggedGrpcStatsCalls(delta int64)
	GaugeSessions(value float64)
	GaugePresences(value float64)
	GaugeStorageIndexEntries(indexName string, value float64)

	Matchmaker(tickets, activeTickets float64, processTime time.Duration)

	PresenceEvent(dequeueElapsed, processElapsed time.Duration)

	StorageWriteRejectCount(tags map[string]string, delta int64)

	CustomCounter(name string, tags map[string]string, delta int64)
	CustomGauge(name string, tags map[string]string, value float64)
	CustomTimer(name string, tags map[string]string, value time.Duration)
}

var _ Metrics = &LocalMetrics{}

type LocalMetrics struct {
	logger *zap.Logger
	config Config
	db     *sql.DB

	cancelFn context.CancelFunc

	snapshotLatencyMs *atomic.Float64
	snapshotRateSec   *atomic.Float64
	snapshotRecvKbSec *atomic.Float64
	snapshotSentKbSec *atomic.Float64

	currentReqCount  *atomic.Int64
	currentMsTotal   *atomic.Int64
	currentRecvBytes *atomic.Int64
	currentSentBytes *atomic.Int64

	PrometheusScope       tally.Scope
	prometheusCustomScope tally.Scope
	prometheusCloser      io.Closer
	prometheusHTTPServer  *http.Server
}

func NewLocalMetrics(logger, startupLogger *zap.Logger, db *sql.DB, config Config) *LocalMetrics {
	ctx, cancelFn := context.WithCancel(context.Background())

	m := &LocalMetrics{
		logger: logger,
		config: config,
		db:     db,

		cancelFn: cancelFn,

		snapshotLatencyMs: atomic.NewFloat64(0),
		snapshotRateSec:   atomic.NewFloat64(0),
		snapshotRecvKbSec: atomic.NewFloat64(0),
		snapshotSentKbSec: atomic.NewFloat64(0),

		currentMsTotal:   atomic.NewInt64(0),
		currentReqCount:  atomic.NewInt64(0),
		currentRecvBytes: atomic.NewInt64(0),
		currentSentBytes: atomic.NewInt64(0),
	}

	go func() {
		const snapshotFrequencySec = 5
		ticker := time.NewTicker(snapshotFrequencySec * time.Second)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				reqCount := float64(m.currentReqCount.Swap(0))
				totalMs := float64(m.currentMsTotal.Swap(0))
				recvBytes := float64(m.currentRecvBytes.Swap(0))
				sentBytes := float64(m.currentSentBytes.Swap(0))

				if reqCount > 0 {
					m.snapshotLatencyMs.Store(totalMs / reqCount)
				} else {
					m.snapshotLatencyMs.Store(0)
				}
				m.snapshotRateSec.Store(reqCount / snapshotFrequencySec)
				m.snapshotRecvKbSec.Store((recvBytes / 1024) / snapshotFrequencySec)
				m.snapshotSentKbSec.Store((sentBytes / 1024) / snapshotFrequencySec)
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
	m.PrometheusScope, m.prometheusCloser = tally.NewRootScope(tally.ScopeOptions{
		Prefix:          config.GetMetrics().Prefix,
		Tags:            tags,
		CachedReporter:  reporter,
		Separator:       prometheus.DefaultSeparator,
		SanitizeOptions: &prometheus.DefaultSanitizerOpts,
	}, time.Duration(config.GetMetrics().ReportingFreqSec)*time.Second)
	m.prometheusCustomScope = m.PrometheusScope.SubScope(config.GetMetrics().CustomPrefix)

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

func (m *LocalMetrics) refreshDBStats(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dbStats := m.db.Stats()

		m.PrometheusScope.Gauge("db_max_open_conns").Update(float64(dbStats.MaxOpenConnections))
		m.PrometheusScope.Gauge("db_total_open_conns").Update(float64(dbStats.OpenConnections))
		m.PrometheusScope.Gauge("db_in_use_conns").Update(float64(dbStats.InUse))
		m.PrometheusScope.Gauge("db_idle_conns").Update(float64(dbStats.Idle))
		m.PrometheusScope.Gauge("db_total_wait_count").Update(float64(dbStats.WaitCount))
		m.PrometheusScope.Gauge("db_total_wait_time_nanos").Update(float64(dbStats.WaitDuration))
		m.PrometheusScope.Gauge("db_total_max_idle_closed").Update(float64(dbStats.MaxIdleClosed))
		m.PrometheusScope.Gauge("db_total_max_idle_time_closed").Update(float64(dbStats.MaxIdleTimeClosed))
		m.PrometheusScope.Gauge("db_total_max_lifetime_closed").Update(float64(dbStats.MaxLifetimeClosed))

		next.ServeHTTP(w, r)
	})
}

func (m *LocalMetrics) Stop(logger *zap.Logger) {
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

func (m *LocalMetrics) SnapshotLatencyMs() float64 {
	return m.snapshotLatencyMs.Load()
}

func (m *LocalMetrics) SnapshotRateSec() float64 {
	return m.snapshotRateSec.Load()
}

func (m *LocalMetrics) SnapshotRecvKbSec() float64 {
	return m.snapshotRecvKbSec.Load()
}

func (m *LocalMetrics) SnapshotSentKbSec() float64 {
	return m.snapshotSentKbSec.Load()
}

func (m *LocalMetrics) Api(name string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool) {
	name = strings.TrimPrefix(name, API_PREFIX)

	// Increment ongoing statistics for current measurement window.
	m.currentMsTotal.Add(int64(elapsed / time.Millisecond))
	m.currentReqCount.Inc()
	m.currentRecvBytes.Add(recvBytes)
	m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.PrometheusScope.Counter("overall_count").Inc(1)
	m.PrometheusScope.Counter("overall_request_count").Inc(1)
	m.PrometheusScope.Counter("overall_recv_bytes").Inc(recvBytes)
	m.PrometheusScope.Counter("overall_request_recv_bytes").Inc(recvBytes)
	m.PrometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	m.PrometheusScope.Counter("overall_request_sent_bytes").Inc(sentBytes)
	m.PrometheusScope.Timer("overall_latency_ms").Record(elapsed)

	// Per-endpoint stats.
	m.PrometheusScope.Counter(name + "_count").Inc(1)
	m.PrometheusScope.Counter(name + "_recv_bytes").Inc(recvBytes)
	m.PrometheusScope.Counter(name + "_sent_bytes").Inc(sentBytes)
	m.PrometheusScope.Timer(name + "_latency_ms").Record(elapsed)

	// Error stats if applicable.
	if isErr {
		m.PrometheusScope.Counter("overall_errors").Inc(1)
		m.PrometheusScope.Counter("overall_request_errors").Inc(1)
		m.PrometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *LocalMetrics) ApiRpc(id string, elapsed time.Duration, recvBytes, sentBytes int64, isErr bool) {
	// Increment ongoing statistics for current measurement window.
	m.currentMsTotal.Add(int64(elapsed / time.Millisecond))
	m.currentReqCount.Inc()
	m.currentRecvBytes.Add(recvBytes)
	m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.PrometheusScope.Counter("overall_count").Inc(1)
	m.PrometheusScope.Counter("overall_request_count").Inc(1)
	m.PrometheusScope.Counter("overall_recv_bytes").Inc(recvBytes)
	m.PrometheusScope.Counter("overall_request_recv_bytes").Inc(recvBytes)
	m.PrometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	m.PrometheusScope.Counter("overall_request_sent_bytes").Inc(sentBytes)
	m.PrometheusScope.Timer("overall_latency_ms").Record(elapsed)

	// Per-endpoint stats.
	taggedScope := m.PrometheusScope.Tagged(map[string]string{"rpc_id": id})
	taggedScope.Counter("Rpc_count").Inc(1)
	taggedScope.Counter("Rpc_recv_bytes").Inc(recvBytes)
	taggedScope.Counter("Rpc_sent_bytes").Inc(sentBytes)
	taggedScope.Timer("Rpc_latency_ms").Record(elapsed)

	// Error stats if applicable.
	if isErr {
		m.PrometheusScope.Counter("overall_errors").Inc(1)
		m.PrometheusScope.Counter("overall_request_errors").Inc(1)
		taggedScope.Counter("Rpc_errors").Inc(1)
	}
}

func (m *LocalMetrics) ApiBefore(name string, elapsed time.Duration, isErr bool) {
	name = "before_" + strings.TrimPrefix(name, API_PREFIX)

	// Global stats.
	m.PrometheusScope.Counter("overall_before_count").Inc(1)
	m.PrometheusScope.Timer("overall_before_latency_ms").Record(elapsed)

	// Per-endpoint stats.
	m.PrometheusScope.Counter(name + "_count").Inc(1)
	m.PrometheusScope.Timer(name + "_latency_ms").Record(elapsed)

	// Error stats if applicable.
	if isErr {
		m.PrometheusScope.Counter("overall_before_errors").Inc(1)
		m.PrometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *LocalMetrics) ApiAfter(name string, elapsed time.Duration, isErr bool) {
	name = "after_" + strings.TrimPrefix(name, API_PREFIX)

	// Global stats.
	m.PrometheusScope.Counter("overall_after_count").Inc(1)
	m.PrometheusScope.Timer("overall_after_latency_ms").Record(elapsed)

	// Per-endpoint stats.
	m.PrometheusScope.Counter(name + "_count").Inc(1)
	m.PrometheusScope.Timer(name + "_latency_ms").Record(elapsed)

	// Error stats if applicable.
	if isErr {
		m.PrometheusScope.Counter("overall_after_errors").Inc(1)
		m.PrometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *LocalMetrics) Message(recvBytes int64, isErr bool) {
	//name = strings.TrimPrefix(name, API_PREFIX)

	// Increment ongoing statistics for current measurement window.
	//m.currentMsTotal.Add(int64(elapsed / time.Millisecond))
	m.currentReqCount.Inc()
	m.currentRecvBytes.Add(recvBytes)
	//m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.PrometheusScope.Counter("overall_count").Inc(1)
	m.PrometheusScope.Counter("overall_message_count").Inc(1)
	m.PrometheusScope.Counter("overall_recv_bytes").Inc(recvBytes)
	m.PrometheusScope.Counter("overall_message_recv_bytes").Inc(recvBytes)
	//m.PrometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	//m.PrometheusScope.Timer("overall_latency_ms").Record(elapsed)

	// Per-message stats.
	//m.PrometheusScope.Counter(name + "_count").Inc(1)
	//m.PrometheusScope.Counter(name + "_recv_bytes").Inc(recvBytes)
	//m.PrometheusScope.Counter(name + "_sent_bytes").Inc(sentBytes)
	//m.PrometheusScope.Timer(name + "_latency_ms").Record(elapsed)

	// Error stats if applicable.
	if isErr {
		m.PrometheusScope.Counter("overall_errors").Inc(1)
		m.PrometheusScope.Counter("overall_message_errors").Inc(1)
		//m.PrometheusScope.Counter(name + "_errors").Inc(1)
	}
}

func (m *LocalMetrics) MessageBytesSent(sentBytes int64) {
	// Increment ongoing statistics for current measurement window.
	m.currentSentBytes.Add(sentBytes)

	// Global stats.
	m.PrometheusScope.Counter("overall_sent_bytes").Inc(sentBytes)
	m.PrometheusScope.Counter("overall_message_sent_bytes").Inc(sentBytes)
}

// Set the absolute value of currently allocated Lua runtime VMs.
func (m *LocalMetrics) GaugeRuntimes(value float64) {
	m.PrometheusScope.Gauge("lua_runtimes").Update(value)
}

// Set the absolute value of currently allocated Lua runtime VMs.
func (m *LocalMetrics) GaugeLuaRuntimes(value float64) {
	m.PrometheusScope.Gauge("lua_runtimes").Update(value)
}

// Set the absolute value of currently allocated JavaScript runtime VMs.
func (m *LocalMetrics) GaugeJsRuntimes(value float64) {
	m.PrometheusScope.Gauge("javascript_runtimes").Update(value)
}

// Set the absolute value of currently running authoritative matches.
func (m *LocalMetrics) GaugeAuthoritativeMatches(value float64) {
	m.PrometheusScope.Gauge("authoritative_matches").Update(value)
}

// Increment the number of dropped events.
func (m *LocalMetrics) CountDroppedEvents(delta int64) {
	m.PrometheusScope.Counter("dropped_events").Inc(delta)
}

// Increment the number of opened WS connections.
func (m *LocalMetrics) CountWebsocketOpened(delta int64) {
	m.PrometheusScope.Counter("socket_ws_opened").Inc(delta)
}

// Increment the number of closed WS connections.
func (m *LocalMetrics) CountWebsocketClosed(delta int64) {
	m.PrometheusScope.Counter("socket_ws_closed").Inc(delta)
}

// Increment the number of untagged gRpc stats calls.
func (m *LocalMetrics) CountUntaggedGrpcStatsCalls(delta int64) {
	m.PrometheusScope.Counter("untagged_grpc_stats_calls").Inc(delta)
}

// Set the absolute value of currently active sessions.
func (m *LocalMetrics) GaugeSessions(value float64) {
	m.PrometheusScope.Gauge("sessions").Update(value)
}

// Set the absolute value of currently tracked presences.
func (m *LocalMetrics) GaugePresences(value float64) {
	m.PrometheusScope.Gauge("presences").Update(value)
}

func (m *LocalMetrics) GaugeStorageIndexEntries(indexName string, value float64) {
	m.PrometheusScope.Tagged(map[string]string{"index_name": indexName}).Gauge("storage_index_entry_count").Update(value)
}

// Record a set of matchmaker metrics.
func (m *LocalMetrics) Matchmaker(tickets, activeTickets float64, processTime time.Duration) {
	m.PrometheusScope.Gauge("matchmaker_tickets").Update(tickets)
	m.PrometheusScope.Gauge("matchmaker_active_tickets").Update(activeTickets)
	m.PrometheusScope.Timer("matchmaker_process_time").Record(processTime)
}

// Count presence events and time their processing.
func (m *LocalMetrics) PresenceEvent(dequeueElapsed, processElapsed time.Duration) {
	m.PrometheusScope.Counter("presence_event_count").Inc(1)
	m.PrometheusScope.Timer("presence_event_dequeue_latency_ms").Record(dequeueElapsed)
	m.PrometheusScope.Timer("presence_event_process_latency_ms").Record(processElapsed)
}

func (m *LocalMetrics) StorageWriteRejectCount(tags map[string]string, delta int64) {
	scope := m.PrometheusScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Counter("storage_write_reject_count").Inc(delta)
}

// CustomCounter adds the given delta to a counter with the specified name and tags.
func (m *LocalMetrics) CustomCounter(name string, tags map[string]string, delta int64) {
	scope := m.prometheusCustomScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Counter(name).Inc(delta)
}

// CustomGauge sets the given value to a gauge with the specified name and tags.
func (m *LocalMetrics) CustomGauge(name string, tags map[string]string, value float64) {
	scope := m.prometheusCustomScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Gauge(name).Update(value)
}

// CustomTimer records the given value to a timer with the specified name and tags.
func (m *LocalMetrics) CustomTimer(name string, tags map[string]string, value time.Duration) {
	scope := m.prometheusCustomScope
	if len(tags) != 0 {
		scope = scope.Tagged(tags)
	}
	scope.Timer(name).Record(value)
}
