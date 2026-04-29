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
//   • Zero coupling with the JS runtime source — we observe pipeline state by
//     polling the JS-maintained bookkeeping storage docs every pollInterval.
//     No RPC hooks, no changes to the JS modules needed.
//   • nakama-common's Initializer interface does NOT expose a RegisterAfterRpc
//     hook for custom RPCs (only RegisterRpc, RegisterBefore/AfterRt for
//     realtime, and Register{Before,After}{BuiltinApi} for Nakama's built-in
//     gRPC endpoints). Previous versions of this file attempted to use
//     RegisterAfterRpc; that call simply does not compile. We work off
//     storage state instead.
//   • Monotonic counters are bumped in the freshness loop by diffing the
//     stored totals against the previous tick's values. Day boundary is
//     handled by detecting when the date string in the stored doc changes
//     (or when the observed total drops below our cached value).
//   • All metrics use the default Prometheus registry, which is the same one
//     Nakama uses for its built-in runtime metrics. They appear automatically
//     at http://nakama:9100/ with no extra scrape config.
//
// Metrics exposed:
//   analytics_events_total{status}                  counter
//   analytics_events_rejected_total                 counter (convenience; subset of above)
//   analytics_rollup_runs_total                     counter
//   analytics_rollup_last_events_matched            gauge
//   analytics_rollup_last_games                     gauge
//   analytics_rollup_age_seconds                    gauge
//   analytics_poller_runs_total{provider}           counter
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
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/prometheus/client_golang/prometheus"
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
//
// We construct the metrics with `prometheus.NewXxx` and register them in
// init() via the default registry instead of using promauto. This keeps the
// plugin's dependency surface limited to packages already vendored by the
// parent nakama module (so building under data/modules/<name>/ with
// `-mod=vendor` succeeds and — critically — produces a .so whose every
// shared package is the EXACT same version the server was built against).
// Using promauto would pull in a version of client_golang outside the
// vendored set, which causes "plugin was built with a different version of
// package …" CrashLoopBackOff at startup.

var (
	eventsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "analytics_events_total",
		Help: "Total analytics events observed by the server since plugin startup, by acceptance status.",
	}, []string{"status"}) // status = accepted | rejected

	rejectedTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "analytics_events_rejected_total",
		Help: "Convenience counter — analytics events rejected by normalizeInboundEvent or persist failures.",
	})

	rollupRunsTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "analytics_rollup_runs_total",
		Help: "Count of analytics_rollup_run successful invocations observed since plugin startup.",
	})

	rollupLastEvents = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rollup_last_events_matched",
		Help: "events_matched from the most recent successful rollup run.",
	})

	rollupLastGames = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rollup_last_games",
		Help: "Number of gameIds rolled up in the most recent successful run.",
	})

	rollupAgeSeconds = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rollup_age_seconds",
		Help: "Wall time since the most recent successful rollup finished.",
	})

	pollerRunsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "analytics_poller_runs_total",
		Help: "Count of external_poll_* successful invocations observed since plugin startup, by provider.",
	}, []string{"provider"})

	pollerAgeSeconds = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "analytics_poller_age_seconds",
		Help: "Wall time since the provider was last polled successfully.",
	}, []string{"provider"})

	pipelineAgeSeconds = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_pipeline_age_seconds",
		Help: "Seconds since the most recent analytics_log_event call succeeded anywhere. High values indicate a broken pipeline.",
	})

	eventsToday = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_events_today",
		Help: "Accepted analytics events in the current UTC day (read from analytics_metrics_counters).",
	})

	rejectedToday = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "analytics_rejected_today",
		Help: "Rejected analytics events in the current UTC day (read from analytics_metrics_counters).",
	})
)

func init() {
	// Register every collector exactly once with the default registry. This
	// runs at plugin load (.so dlopen) time, before InitModule, so the
	// metrics are visible on /metrics from the very first scrape.
	prometheus.MustRegister(
		eventsTotal,
		rejectedTotal,
		rollupRunsTotal,
		rollupLastEvents,
		rollupLastGames,
		rollupAgeSeconds,
		pollerRunsTotal,
		pollerAgeSeconds,
		pipelineAgeSeconds,
		eventsToday,
		rejectedToday,
	)
}

// Delta-tracking state for converting JS-side daily counters into Prometheus
// monotonic counters. Guarded by stateMu because refreshFreshness is always
// called from a single goroutine, but the lock keeps us honest if that ever
// changes.
var (
	stateMu        sync.Mutex
	lastCounterDay string
	lastAccepted   int64
	lastRejected   int64

	lastRollupTimestamp string

	lastPollUnix = map[string]int64{}
)

// ─── InitModule ───────────────────────────────────────────

// InitModule is the Nakama plugin entrypoint. It's called once by the runtime
// when the .so is loaded. We do NOT register any RPC hooks here (see package
// doc comment). We just register metrics (done at package init() above with
// the default Prometheus registry) and start the background freshness poller.
//
// The initializer arg is unused but required by the Nakama plugin contract.
// The db handle is threaded into the Discord alert scheduler so it can take
// a Postgres advisory lock for cross-pod leader election (otherwise every
// replica posts its own copy of the 6h summary — see discord_alerts.go).
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, _ runtime.Initializer) error {
	logger.Info("[analytics_metrics_go] plugin loading — starting freshness loop")

	// Background freshness poller. A single goroutine is cheap and means the
	// /metrics endpoint always serves up-to-date gauges AND monotonic counters
	// derived from storage-side state.
	go freshnessLoop(ctx, logger, nk)

	// Discord alert scheduler — periodic (default 6h) Quizverse RPC analytics
	// summary posted to the same Discord channel the IVX backend uses. Lives
	// in discord_alerts.go and is fully self-contained: it scrapes our own
	// :9100/metrics, diffs against the prior snapshot, and posts an embed.
	// Best-effort: any failure is logged but never affects request handling.
	// `db` is used for Postgres advisory-lock leader election so multi-pod
	// deployments don't fan-out duplicate posts.
	startDiscordAlertScheduler(ctx, logger, db)

	logger.Info("[analytics_metrics_go] plugin ready — metrics registered, freshness loop started, discord alerts scheduled")
	return nil
}

// ─── Freshness loop ───────────────────────────────────────

// freshnessLoop updates gauges and bumps counters every pollInterval by reading
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
	Date          string `json:"date"`
	Timestamp     string `json:"timestamp"`
	EventsMatched int    `json:"eventsMatched"`
	GameIDs       []any  `json:"gameIds"`
}

type pollMetaDoc struct {
	Provider     string `json:"provider"`
	LastPollUnix int64  `json:"lastPollUnix"`
	Success      bool   `json:"success"`
}

type counterDoc struct {
	Date           string `json:"date"`
	EventsAccepted int64  `json:"events_accepted"`
	EventsRejected int64  `json:"events_rejected"`
	UpdatedAt      string `json:"updated_at"`
}

func refreshFreshness(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule) {
	now := time.Now()

	// Today's counters: drive eventsToday/rejectedToday gauges, bump monotonic
	// eventsTotal / rejectedTotal counters by the delta, and derive
	// pipelineAgeSeconds from the doc's updated_at timestamp.
	readTodayCounters(ctx, logger, nk, now)

	// Rollup freshness + runs counter.
	readRollupMeta(ctx, logger, nk, now)

	// Poller freshness + runs counter per provider.
	readPollerMeta(ctx, logger, nk, now)
}

// readTodayCounters is the single source of truth for three metrics:
//   - analytics_events_today / analytics_rejected_today (gauges)
//   - analytics_events_total{accepted|rejected} (monotonic counters, bumped by delta)
//   - analytics_pipeline_age_seconds (gauge, derived from updated_at)
//
// When the UTC day rolls over, the JS side writes a new `counter_<date>` doc
// that starts at 0. We detect this by comparing the date string in the doc
// against lastCounterDay; on day change we reset our delta baselines to 0
// so the first tick of the new day correctly re-bumps the accepted/rejected
// counters from zero.
func readTodayCounters(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, now time.Time) {
	today := now.UTC().Format("2006-01-02")
	key := fmt.Sprintf("counter_%s", today)
	objs, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: collectionCounters,
		Key:        key,
		UserID:     systemUserID,
	}})
	if err != nil || len(objs) == 0 {
		// No events yet today — reset gauges, leave pipeline age as "never seen".
		eventsToday.Set(0)
		rejectedToday.Set(0)
		pipelineAgeSeconds.Set(999999)
		stateMu.Lock()
		if lastCounterDay != today {
			lastCounterDay = today
			lastAccepted = 0
			lastRejected = 0
		}
		stateMu.Unlock()
		return
	}

	var doc counterDoc
	if err := json.Unmarshal([]byte(objs[0].Value), &doc); err != nil {
		if logger != nil {
			logger.Warn("[analytics_metrics_go] counter doc parse error: %v", err)
		}
		return
	}

	eventsToday.Set(float64(doc.EventsAccepted))
	rejectedToday.Set(float64(doc.EventsRejected))

	stateMu.Lock()
	// Day roll: reset baselines and skip delta for this tick (the raw values
	// are already the "new" counts for today, but emitting them as delta would
	// double-count what's already reflected in past eventsTotal increments).
	if lastCounterDay != today {
		lastCounterDay = today
		lastAccepted = doc.EventsAccepted
		lastRejected = doc.EventsRejected
		stateMu.Unlock()
	} else {
		dAcc := doc.EventsAccepted - lastAccepted
		dRej := doc.EventsRejected - lastRejected
		if dAcc > 0 {
			eventsTotal.WithLabelValues("accepted").Add(float64(dAcc))
			lastAccepted = doc.EventsAccepted
		}
		if dRej > 0 {
			eventsTotal.WithLabelValues("rejected").Add(float64(dRej))
			rejectedTotal.Add(float64(dRej))
			lastRejected = doc.EventsRejected
		}
		stateMu.Unlock()
	}

	// Pipeline age from doc.updated_at.
	if doc.UpdatedAt != "" {
		t, perr := time.Parse(time.RFC3339Nano, doc.UpdatedAt)
		if perr != nil {
			t, perr = time.Parse(time.RFC3339, doc.UpdatedAt)
		}
		if perr == nil {
			pipelineAgeSeconds.Set(now.Sub(t).Seconds())
			return
		}
	}
	pipelineAgeSeconds.Set(999999)
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

	// Bump runs counter only when the timestamp advances. On first observation
	// we just record the baseline without incrementing (so a plugin restart
	// doesn't spike the counter).
	stateMu.Lock()
	if lastRollupTimestamp != "" && doc.Timestamp != lastRollupTimestamp {
		rollupRunsTotal.Inc()
	}
	lastRollupTimestamp = doc.Timestamp
	stateMu.Unlock()
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

		// Bump runs counter when the poll timestamp advances.
		stateMu.Lock()
		prev, seen := lastPollUnix[provider]
		if seen && doc.LastPollUnix > prev {
			pollerRunsTotal.WithLabelValues(provider).Inc()
		}
		lastPollUnix[provider] = doc.LastPollUnix
		stateMu.Unlock()
	}
}
