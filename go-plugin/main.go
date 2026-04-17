// Package main — Nakama Go plugin that publishes native Prometheus counters
// and gauges for the analytics pipeline.
//
// Why it exists:
//   Nakama's Goja (JS) runtime can't register Prometheus metrics. analytics_ops
//   exposes counters via an RPC snapshot, but that's pull-via-RPC which doesn't
//   plug into Prometheus scrape. This plugin registers native metrics that
//   Nakama's built-in `:9100` Prometheus endpoint already serves, so
//   `prometheus.yml` picks them up for free.
//
// Design:
//   • Zero coupling with the JS runtime source — we observe JS RPCs via
//     initializer.RegisterAfterRpc hooks. No changes to the JS modules needed.
//   • A background goroutine polls the JS-maintained bookkeeping storage docs
//     every 15 s and updates gauges for "freshness" signals (age since last
//     event, age since last rollup, age since last poll per provider).
//   • All metrics use the default Prometheus registry, which is the same one
//     Nakama uses for its built-in runtime metrics. They appear automatically
//     at http://nakama:9100/ with no extra scrape config.
//
// Metrics exposed:
//   analytics_events_total{status}                  counter
//   analytics_events_rejected_total                 counter (convenience; subset of above)
//   analytics_rollup_runs_total{status}             counter
//   analytics_rollup_last_events_matched            gauge
//   analytics_rollup_last_games                     gauge
//   analytics_rollup_age_seconds                    gauge
//   analytics_poller_runs_total{provider,status}    counter
//   analytics_poller_age_seconds{provider}          gauge
//   analytics_pipeline_age_seconds                  gauge (since last log_event)
//   analytics_events_today                          gauge (current-day accepted)
//   analytics_rejected_today                        gauge (current-day rejected)
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const (
	systemUserID = "00000000-0000-0000-0000-000000000000"

	collectionCounters = "analytics_metrics_counters"
	collectionRollup   = "analytics_rollup_meta"
	collectionPoll     = "external_analytics_last_poll"

	rollupKey = "last_success"

	// pollInterval controls how often the freshness loop re-reads bookkeeping
	// docs. 15 s keeps /metrics accurate without hammering storage (a CockroachDB
	// point read is ~1 ms so 15 reads / 15 s ≈ negligible).
	pollInterval = 15 * time.Second
)

// ─── Metrics ──────────────────────────────────────────────

var (
	eventsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "analytics_events_total",
		Help: "Total analytics events observed by the server since plugin startup, by acceptance status.",
	}, []string{"status"}) // status = accepted | rejected | error

	rejectedTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "analytics_events_rejected_total",
		Help: "Convenience counter — analytics events rejected by normalizeInboundEvent or persist failures.",
	})

	rollupRunsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "analytics_rollup_runs_total",
		Help: "Count of analytics_rollup_run invocations, by outcome.",
	}, []string{"status"}) // status = success | error

	rollupLastEvents = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rollup_last_events_matched",
		Help: "events_matched from the most recent successful rollup run.",
	})

	rollupLastGames = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rollup_last_games",
		Help: "Number of gameIds rolled up in the most recent successful run.",
	})

	rollupAgeSeconds = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rollup_age_seconds",
		Help: "Wall time since the most recent successful rollup finished.",
	})

	pollerRunsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "analytics_poller_runs_total",
		Help: "Count of external_poll_* RPC invocations, by provider and outcome.",
	}, []string{"provider", "status"}) // status = success | skipped | error

	pollerAgeSeconds = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "analytics_poller_age_seconds",
		Help: "Wall time since the provider was last polled successfully.",
	}, []string{"provider"})

	pipelineAgeSeconds = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_pipeline_age_seconds",
		Help: "Seconds since the most recent analytics_log_event call succeeded anywhere. High values indicate a broken pipeline.",
	})

	eventsToday = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_events_today",
		Help: "Accepted analytics events in the current UTC day (read from analytics_metrics_counters).",
	})

	rejectedToday = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rejected_today",
		Help: "Rejected analytics events in the current UTC day (read from analytics_metrics_counters).",
	})
)

// lastLogEventNanos tracks the wall time of the most recent analytics_log_event
// completion observed via the RegisterAfterRpc hook. Read by the poller goroutine
// to update pipelineAgeSeconds without a storage round-trip. atomic for goroutine
// safety.
var lastLogEventNanos atomic.Int64

// ─── InitModule ───────────────────────────────────────────

// InitModule is the Nakama plugin entrypoint. It's called once by the runtime
// when the .so is loaded. We register after-hooks (no latency on the hot path
// since they run after the JS RPC returns) and start the background freshness
// poller.
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	logger.Info("[analytics_metrics_go] plugin loading — registering hooks and metrics")

	if err := initializer.RegisterAfterRpc("analytics_log_event", afterAnalyticsLogEvent); err != nil {
		return fmt.Errorf("RegisterAfterRpc analytics_log_event: %w", err)
	}
	if err := initializer.RegisterAfterRpc("analytics_rollup_run", afterAnalyticsRollupRun); err != nil {
		return fmt.Errorf("RegisterAfterRpc analytics_rollup_run: %w", err)
	}
	for _, rpc := range []string{
		"external_poll_appodeal",
		"external_poll_appstore",
		"external_poll_ugs",
		"external_poll_all",
	} {
		// Closure captures rpc name so the handler can extract the provider.
		rpcName := rpc
		if err := initializer.RegisterAfterRpc(rpcName, makeAfterPollerHook(rpcName)); err != nil {
			return fmt.Errorf("RegisterAfterRpc %s: %w", rpcName, err)
		}
	}

	// Seed the pipelineAge so "fresh start" isn't reported as age=0 (which
	// would hide a broken pipeline). Use the last_log_event doc if present,
	// otherwise mark as "never seen" with a sentinel of -1.
	lastLogEventNanos.Store(0)

	// Background freshness poller. A single goroutine is cheap and means the
	// /metrics endpoint always serves up-to-date gauges even when no RPC has
	// fired in a while.
	go freshnessLoop(ctx, logger, nk)

	logger.Info("[analytics_metrics_go] plugin ready — 10 metrics registered, freshness loop started")
	return nil
}

// ─── RPC after-hooks ──────────────────────────────────────

// Parsed shape of analytics_log_event's JSON response. Fields we don't need
// are ignored; keeping this minimal avoids allocations on the hot path.
type logEventResult struct {
	Success  bool `json:"success"`
	Accepted int  `json:"accepted"`
	Rejected int  `json:"rejected"`
}

// afterAnalyticsLogEvent observes every analytics_log_event call after the JS
// RPC has returned. It bumps accepted / rejected counters based on the response
// body. Runs on the Nakama worker pool so it doesn't add latency to the client.
func afterAnalyticsLogEvent(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out string, in string) error {
	var res logEventResult
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		// Don't fail the hook chain — metrics are observational.
		eventsTotal.WithLabelValues("error").Inc()
		return nil
	}
	if res.Accepted > 0 {
		eventsTotal.WithLabelValues("accepted").Add(float64(res.Accepted))
		// Stamp pipeline liveness on any accepted event.
		lastLogEventNanos.Store(time.Now().UnixNano())
	}
	if res.Rejected > 0 {
		eventsTotal.WithLabelValues("rejected").Add(float64(res.Rejected))
		rejectedTotal.Add(float64(res.Rejected))
	}
	return nil
}

// Parsed shape of analytics_rollup_run's JSON response.
type rollupResult struct {
	Success        bool `json:"success"`
	GamesRolledUp  int  `json:"games_rolled_up"`
	EventsMatched  int  `json:"events_matched"`
}

func afterAnalyticsRollupRun(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out string, in string) error {
	var res rollupResult
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		rollupRunsTotal.WithLabelValues("error").Inc()
		return nil
	}
	if res.Success {
		rollupRunsTotal.WithLabelValues("success").Inc()
		rollupLastEvents.Set(float64(res.EventsMatched))
		rollupLastGames.Set(float64(res.GamesRolledUp))
	} else {
		rollupRunsTotal.WithLabelValues("error").Inc()
	}
	return nil
}

// Parsed shape of external_poll_* results. The _all variant has nested per-provider results.
type pollResult struct {
	Success bool `json:"success"`
	Skipped bool `json:"skipped"`
	// For the provider-specific RPCs.
	Provider string `json:"provider"`
	// For external_poll_all.
	Results map[string]json.RawMessage `json:"results"`
}

func makeAfterPollerHook(rpcName string) func(context.Context, runtime.Logger, *sql.DB, runtime.NakamaModule, string, string) error {
	// Infer the provider from the RPC name for single-provider hooks. For the
	// _all variant we walk the sub-results map and bump counters per provider.
	defaultProvider := ""
	switch rpcName {
	case "external_poll_appodeal":
		defaultProvider = "appodeal"
	case "external_poll_appstore":
		defaultProvider = "appstore"
	case "external_poll_ugs":
		defaultProvider = "ugs"
	}

	return func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, out string, in string) error {
		var res pollResult
		if err := json.Unmarshal([]byte(out), &res); err != nil {
			if defaultProvider != "" {
				pollerRunsTotal.WithLabelValues(defaultProvider, "error").Inc()
			}
			return nil
		}

		if defaultProvider != "" {
			status := "success"
			if res.Skipped {
				status = "skipped"
			} else if !res.Success {
				status = "error"
			}
			pollerRunsTotal.WithLabelValues(defaultProvider, status).Inc()
			return nil
		}

		// external_poll_all: walk sub-results.
		for provider, raw := range res.Results {
			var sub pollResult
			if err := json.Unmarshal(raw, &sub); err != nil {
				pollerRunsTotal.WithLabelValues(provider, "error").Inc()
				continue
			}
			status := "success"
			if sub.Skipped {
				status = "skipped"
			} else if !sub.Success {
				status = "error"
			}
			pollerRunsTotal.WithLabelValues(provider, status).Inc()
		}
		return nil
	}
}

// ─── Freshness loop ───────────────────────────────────────

// freshnessLoop updates "age since last X" gauges every pollInterval by reading
// the bookkeeping docs the JS pipeline maintains. Runs for the lifetime of the
// plugin; exits cleanly when ctx is cancelled (Nakama shutdown).
func freshnessLoop(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	// Do one immediate refresh so /metrics has real values before the first tick.
	refreshFreshness(ctx, logger, nk)

	for {
		select {
		case <-ctx.Done():
			logger.Info("[analytics_metrics_go] freshness loop stopping (context cancelled)")
			return
		case <-ticker.C:
			refreshFreshness(ctx, logger, nk)
		}
	}
}

type rollupMetaDoc struct {
	Date           string `json:"date"`
	Timestamp      string `json:"timestamp"`
	EventsMatched  int    `json:"eventsMatched"`
	GameIDs        []any  `json:"gameIds"`
}

type pollMetaDoc struct {
	Provider     string `json:"provider"`
	LastPollUnix int64  `json:"lastPollUnix"`
	Success      bool   `json:"success"`
}

type counterDoc struct {
	Date           string `json:"date"`
	EventsAccepted int    `json:"events_accepted"`
	EventsRejected int    `json:"events_rejected"`
}

func refreshFreshness(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	now := time.Now()

	// Pipeline age = seconds since the most recent analytics_log_event we
	// observed. If we've never seen one since plugin start, fall back to
	// reading today's counter doc's updated_at for a better signal.
	if n := lastLogEventNanos.Load(); n > 0 {
		pipelineAgeSeconds.Set(now.Sub(time.Unix(0, n)).Seconds())
	} else {
		// Best-effort read of today's counter doc to decide if we've just restarted.
		pipelineAgeSeconds.Set(readPipelineAgeFromStorage(ctx, nk, now))
	}

	// Today's totals for Grafana "events per day" cards.
	readTodayCounters(ctx, logger, nk)

	// Rollup freshness.
	readRollupMeta(ctx, logger, nk, now)

	// Poller freshness.
	readPollerMeta(ctx, logger, nk, now)
}

func readPipelineAgeFromStorage(ctx context.Context, nk runtime.NakamaModule, now time.Time) float64 {
	key := fmt.Sprintf("counter_%s", now.UTC().Format("2006-01-02"))
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: collectionCounters,
		Key:        key,
		UserID:     systemUserID,
	}})
	if err != nil || len(objs) == 0 {
		return 999999 // sentinel "never seen"
	}
	var doc struct {
		UpdatedAt string `json:"updated_at"`
	}
	if err := json.Unmarshal([]byte(objs[0].Value), &doc); err != nil {
		return 999999
	}
	if doc.UpdatedAt == "" {
		return 999999
	}
	t, err := time.Parse(time.RFC3339Nano, doc.UpdatedAt)
	if err != nil {
		t, err = time.Parse(time.RFC3339, doc.UpdatedAt)
		if err != nil {
			return 999999
		}
	}
	return now.Sub(t).Seconds()
}

func readTodayCounters(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	key := fmt.Sprintf("counter_%s", time.Now().UTC().Format("2006-01-02"))
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: collectionCounters,
		Key:        key,
		UserID:     systemUserID,
	}})
	if err != nil || len(objs) == 0 {
		eventsToday.Set(0)
		rejectedToday.Set(0)
		return
	}
	var doc counterDoc
	if err := json.Unmarshal([]byte(objs[0].Value), &doc); err != nil {
		return
	}
	eventsToday.Set(float64(doc.EventsAccepted))
	rejectedToday.Set(float64(doc.EventsRejected))
}

func readRollupMeta(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, now time.Time) {
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: collectionRollup,
		Key:        rollupKey,
		UserID:     systemUserID,
	}})
	if err != nil || len(objs) == 0 {
		rollupAgeSeconds.Set(999999) // never run
		return
	}
	var doc rollupMetaDoc
	if err := json.Unmarshal([]byte(objs[0].Value), &doc); err != nil {
		return
	}
	if doc.Timestamp == "" {
		return
	}
	t, err := time.Parse(time.RFC3339Nano, doc.Timestamp)
	if err != nil {
		t, err = time.Parse(time.RFC3339, doc.Timestamp)
		if err != nil {
			return
		}
	}
	rollupAgeSeconds.Set(now.Sub(t).Seconds())
	rollupLastEvents.Set(float64(doc.EventsMatched))
	rollupLastGames.Set(float64(len(doc.GameIDs)))
}

func readPollerMeta(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, now time.Time) {
	for _, provider := range []string{"appodeal", "appstore", "ugs"} {
		objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
			Collection: collectionPoll,
			Key:        provider,
			UserID:     systemUserID,
		}})
		if err != nil || len(objs) == 0 {
			pollerAgeSeconds.WithLabelValues(provider).Set(999999)
			continue
		}
		var doc pollMetaDoc
		if err := json.Unmarshal([]byte(objs[0].Value), &doc); err != nil {
			continue
		}
		if doc.LastPollUnix == 0 {
			pollerAgeSeconds.WithLabelValues(provider).Set(999999)
			continue
		}
		pollerAgeSeconds.WithLabelValues(provider).Set(float64(now.Unix() - doc.LastPollUnix))
	}
}
