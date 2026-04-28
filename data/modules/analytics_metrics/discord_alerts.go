// Package main — Discord alerting for Nakama RPC observability.
//
// Why it exists:
//   IVX has Discord alerts for backend AI endpoints (see
//   Intelliverse-X-AI/src/_lib/interceptors/discord-endpoint-alert.interceptor.ts).
//   This file mirrors that pattern for Nakama: every 6 hours we post a single
//   summary embed to the same Discord channel covering the RPCs that matter
//   most to Quizverse — call counts, success/error split, TP50/TP90/TP99
//   latency, top offenders, and basic server health.
//
// How it works:
//   • Nakama already exposes a Prometheus endpoint on :9100 (see
//     docker-compose.yml: --metrics.prometheus_port 9100). Scraping our own
//     process is the cheapest way to get per-RPC counters and latency
//     histograms without touching every JS module.
//   • Every 6 hours a goroutine pulls /metrics, diffs counters against the
//     previous snapshot, recomputes percentiles from the latency-histogram
//     bucket deltas, classifies each RPC into a Quizverse-relevant family
//     (quiz, hiro, lasttolive, friends/social, daily/quests, leaderboards,
//     match/multiplayer, analytics, IAP, push), and POSTs a Discord embed.
//   • Optionally the same payload is sent to the IVX LLM endpoint
//     (`/api/ai/ai-prompt/interrogate/custom/response`) for a one-paragraph
//     improvement suggestion that gets appended to the embed. This is
//     opt-in via env var so a network blip can never block the report.
//   • Robustness: if scraping fails we still post a "scrape failed" alert so
//     the channel never goes silent. Discord HTTP is best-effort with a 10s
//     timeout — alert failures are logged but never crash the plugin.
//
// Tuning knobs (all optional environment variables):
//   IVX_NAKAMA_DISCORD_WEBHOOK_URL  Discord webhook (defaults to the IVX
//                                   ai-endpoint channel for parity).
//   IVX_NAKAMA_METRICS_URL          Prometheus endpoint to scrape
//                                   (default http://127.0.0.1:9100/).
//   IVX_NAKAMA_ALERT_INTERVAL       Override the 6h cadence (Go duration).
//   IVX_NAKAMA_LLM_ENABLED          "1"/"true" to enable LLM suggestions.
//   IVX_NAKAMA_LLM_URL              IVX LLM endpoint URL.
//   IVX_NAKAMA_LLM_TOKEN            Bearer token for the LLM endpoint.
//   IVX_NAKAMA_INSTANCE_LABEL       Free-form label shown in the embed
//                                   footer (e.g. "prod-aws-1"). Defaults to
//                                   the OS hostname.

package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	nkruntime "github.com/heroiclabs/nakama-common/runtime"
)

// ─── Constants ────────────────────────────────────────────

const (
	// Defaults align with the Discord channel the IVX NestJS interceptor uses
	// so all backend + Nakama alerts land in one place. Override with
	// IVX_NAKAMA_DISCORD_WEBHOOK_URL.
	defaultDiscordWebhookURL = "https://discord.com/api/webhooks/1491181055711903998/ba24RnQwb_6A5H1UpBvt3AgriWzy-kZYAt9NpIdrUwMPefOf6ZQdPSIvurokBjZjwhIP"

	// Same Prometheus port the Dockerfile/compose stack opens; scraping
	// localhost is in-process so no network hop / DNS / auth concerns.
	defaultMetricsURL = "http://127.0.0.1:9100/"

	defaultAlertInterval = 6 * time.Hour

	// Nakama embed colour: gold (matches the existing IVX summary look so
	// Discord visually groups all "summary" alerts together).
	embedColor = 0xF1C40F

	// Discord hard limits — we cap every section well below these to leave
	// room for the LLM suggestion paragraph.
	discordMaxEmbedChars  = 5800
	discordMaxFieldChars  = 1000
	discordMaxFieldsCount = 25

	// HTTP timeouts — keep both well below the 6h interval so a stuck scrape
	// or stuck Discord call never overlaps with the next tick.
	scrapeTimeout  = 8 * time.Second
	discordTimeout = 10 * time.Second
	llmTimeout     = 25 * time.Second
)

// quizverseRpcFamilies classifies every Nakama RPC into a Quizverse-relevant
// bucket. The label is what shows up in the Discord embed; the prefixes are
// matched against the metric's "name"/"function"/"rpc"/"api_id" label using
// HasPrefix (case-insensitive). Order matters: the FIRST match wins, so put
// more-specific prefixes (e.g. "quizverse_streak") above bare prefixes
// (e.g. "quizverse_").
//
// This list was derived by scanning data/modules for `registerRpc("xxx", …)`
// and the Quizverse Unity client's `RpcAsync(...)` calls. Every prefix below
// corresponds to RPCs that the Quizverse game flow actually invokes.
var quizverseRpcFamilies = []struct {
	Label    string
	Emoji    string
	Prefixes []string
}{
	{
		Label: "Quizverse Depth",
		Emoji: "🧠",
		Prefixes: []string{
			"quizverse_",
		},
	},
	{
		Label: "Quiz Results & Daily",
		Emoji: "📝",
		Prefixes: []string{
			"quiz_results_",
			"quiz_daily_",
			"daily_quiz_",
			"compatibility_quiz_",
		},
	},
	{
		Label: "Hiro Live-Ops",
		Emoji: "🎯",
		Prefixes: []string{
			"hiro_",
			"satori_",
		},
	},
	{
		Label: "Friends & Social",
		Emoji: "👥",
		Prefixes: []string{
			"friends_",
			"friend_streaks_",
			"friend_quests_",
			"social_",
			"groups_",
			"chat_",
		},
	},
	{
		Label: "Daily Missions & Rewards",
		Emoji: "🗓️",
		Prefixes: []string{
			"daily_missions_",
			"daily_rewards_",
			"player_gifts_",
			"achievements_",
			"badges_",
		},
	},
	{
		Label: "Quests & Economy",
		Emoji: "💰",
		Prefixes: []string{
			"quests_",
			"wallet_",
			"economy_",
			"progression_",
			"personalization_",
		},
	},
	{
		Label: "Leaderboards & Tournaments",
		Emoji: "🏆",
		Prefixes: []string{
			"leaderboard",
			"tournament",
			"leagues_",
		},
	},
	{
		Label: "Multiplayer / Matchmaking",
		Emoji: "🎮",
		Prefixes: []string{
			"create_lobby",
			"join_lobby",
			"leave_lobby",
			"list_lobbies",
			"start_matchmaking",
			"cancel_matchmaking",
			"match_",
			"multigame_",
			"p2prelayer_",
		},
	},
	{
		Label: "Cross-Game / Identity",
		Emoji: "🆔",
		Prefixes: []string{
			"cross_game_",
			"identity_",
			"player_",
			"characters_",
			"ai_player_",
			"copilot_",
		},
	},
	{
		Label: "Last-To-Live (live ops)",
		Emoji: "⚡",
		Prefixes: []string{
			"lasttolive_",
		},
	},
	{
		Label: "Fortune Wheel & Engagement",
		Emoji: "🎡",
		Prefixes: []string{
			"fortune_wheel_",
			"rewarded_ads_",
			"smart_review_",
		},
	},
	{
		Label: "Analytics & Telemetry",
		Emoji: "📊",
		Prefixes: []string{
			"analytics_",
			"event_pipeline_",
			"external_",
			"game_metrics_",
			"retention_",
		},
	},
	{
		Label: "IAP & Notifications",
		Emoji: "🔔",
		Prefixes: []string{
			"iap_",
			"notifications_",
			"push_notifications_",
			"onboarding_",
		},
	},
}

// ─── State ────────────────────────────────────────────────

// snapshotKey identifies a single counter / histogram bucket in the previous
// snapshot. We key by (metric_name, sorted-label-string) which is unique
// across the entire Prometheus exposition.
type snapshotKey struct {
	Metric string
	Labels string
}

// snapshotState holds the previous tick's raw values so we can compute deltas.
//
// `lastReport` is the most recently published report from THIS pod's
// perspective. The Auto-Insight panel diffs the new report against it to
// produce volume / family / latency callouts. It's intentionally local
// (not Postgres-backed): a leader handoff just means the new leader's
// first post has no Δ row, which is acceptable.
type snapshotState struct {
	mu         sync.Mutex
	counters   map[snapshotKey]float64
	buckets    map[snapshotKey]float64
	histSums   map[snapshotKey]float64
	histCount  map[snapshotKey]float64
	taken      time.Time
	lastReport *alertReport
}

func newSnapshotState() *snapshotState {
	return &snapshotState{
		counters:  map[snapshotKey]float64{},
		buckets:   map[snapshotKey]float64{},
		histSums:  map[snapshotKey]float64{},
		histCount: map[snapshotKey]float64{},
	}
}

// alertConfig is resolved once at startup so we don't re-read the env on
// every tick. Mutating env at runtime is unsupported.
//
// `DB` is the Nakama-owned Postgres handle (passed in from InitModule).
// We use it ONLY to take a `pg_try_advisory_lock` keyed on the current
// 6h window timestamp so multi-replica deployments emit exactly one
// Discord post per window instead of N. If `DB` is nil (e.g. tests), the
// scheduler fails open and posts unconditionally — preferring duplicates
// over silence.
type alertConfig struct {
	WebhookURL    string
	MetricsURL    string
	Interval      time.Duration
	LLMEnabled    bool
	LLMURL        string
	LLMToken      string
	InstanceLabel string
	DB            *sql.DB
}

func loadAlertConfig() alertConfig {
	cfg := alertConfig{
		WebhookURL:    envOr("IVX_NAKAMA_DISCORD_WEBHOOK_URL", defaultDiscordWebhookURL),
		MetricsURL:    envOr("IVX_NAKAMA_METRICS_URL", defaultMetricsURL),
		Interval:      defaultAlertInterval,
		LLMEnabled:    boolEnv("IVX_NAKAMA_LLM_ENABLED"),
		LLMURL:        envOr("IVX_NAKAMA_LLM_URL", ""),
		LLMToken:      envOr("IVX_NAKAMA_LLM_TOKEN", ""),
		InstanceLabel: envOr("IVX_NAKAMA_INSTANCE_LABEL", hostnameOr("nakama")),
	}
	if v := os.Getenv("IVX_NAKAMA_ALERT_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d >= time.Minute {
			cfg.Interval = d
		}
	}
	return cfg
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func boolEnv(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func hostnameOr(fallback string) string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return fallback
}

// ─── Scheduler entrypoint ────────────────────────────────

// startDiscordAlertScheduler is invoked from InitModule. It returns
// immediately and runs the alert loop in a single background goroutine for
// the lifetime of the plugin (Nakama process). `db` is the same handle
// Nakama passes into InitModule — used for cross-pod leader election.
func startDiscordAlertScheduler(ctx context.Context, logger nkruntime.Logger, db *sql.DB) {
	cfg := loadAlertConfig()
	cfg.DB = db
	if cfg.WebhookURL == "" {
		logger.Warn("[discord_alerts] disabled — no webhook URL configured")
		return
	}

	logger.Info("[discord_alerts] starting — interval=%s metrics=%s llm_enabled=%t leader_election=%t",
		cfg.Interval.String(), cfg.MetricsURL, cfg.LLMEnabled, db != nil)

	state := newSnapshotState()

	// Take an immediate baseline snapshot so the first tick can compute a
	// real delta instead of "everything looks like it just started".
	if scraped, err := scrapeMetrics(ctx, cfg.MetricsURL); err == nil {
		applySnapshot(state, scraped, time.Now())
	} else {
		logger.Warn("[discord_alerts] baseline scrape failed: %v", err)
	}

	go func() {
		// Recover defensively — a panic here must NEVER take down Nakama.
		defer func() {
			if r := recover(); r != nil {
				logger.Error("[discord_alerts] scheduler panic: %v\n%s", r, debug.Stack())
			}
		}()

		ticker := time.NewTicker(cfg.Interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				logger.Info("[discord_alerts] scheduler stopping (context cancelled)")
				return
			case <-ticker.C:
				runAlertCycle(ctx, logger, cfg, state)
			}
		}
	}()
}

// runAlertCycle is the per-tick worker:
//
//	scrape → build report → log → leader-claim → severity gate → POST
//
// Every replica scrapes + computes + logs locally so /metrics deltas
// stay in sync across pods. Only the pod that wins the per-window
// Postgres advisory lock posts to Discord; the rest just refresh their
// local baseline. This eliminates the N-replica fan-out that produced
// 5 identical posts per 6h window before this change was introduced.
func runAlertCycle(ctx context.Context, logger nkruntime.Logger, cfg alertConfig, state *snapshotState) {
	defer func() {
		if r := recover(); r != nil {
			logger.Error("[discord_alerts] alert cycle panic: %v\n%s", r, debug.Stack())
		}
	}()

	now := time.Now()

	scraped, err := scrapeMetrics(ctx, cfg.MetricsURL)
	if err != nil {
		logger.Error("[discord_alerts] scrape failed: %v", err)
		// Only the leader posts the scrape-failure alert; otherwise a
		// scrape outage that affects all pods would post N duplicates.
		windowKey := windowLockKey(now, cfg.Interval)
		isLeader, release := claimAlertLeader(ctx, cfg.DB, windowKey)
		if isLeader {
			defer release()
			_ = postDiscord(ctx, cfg.WebhookURL, scrapeFailureEmbed(cfg, err))
		}
		return
	}

	report := buildReport(state, scraped, now, cfg)

	// Server-side log: emit one structured line per RPC family on every
	// pod (errors first for grep-ability) so Nakama logs themselves are
	// searchable independent of Discord delivery / leader status.
	logReportToServer(logger, report)

	// Always refresh the local snapshot baseline so the NEXT tick on this
	// pod (whether or not it becomes leader) computes a correct delta.
	defer applySnapshot(state, scraped, now)

	// ── Leader election ────────────────────────────────────────────
	// All pods scrape + log; exactly one pod posts to Discord. Lock key
	// is the window-start unix timestamp so every pod within the same
	// window tries the same key. Lock auto-releases on conn close at
	// end of cycle (release() below).
	windowKey := windowLockKey(now, cfg.Interval)
	isLeader, release := claimAlertLeader(ctx, cfg.DB, windowKey)
	if !isLeader {
		logger.Info("[discord_alerts] follower — another replica is posting window=%d total_calls=%d errors=%d",
			windowKey, report.TotalCalls, report.TotalErrors)
		return
	}
	defer release()

	// ── Severity gate / dead-window suppression ────────────────────
	// If the window has zero traffic AND zero errors AND the prior
	// window also had zero traffic, skip posting entirely — no signal
	// worth alerting on. We still log + advance the snapshot above.
	state.mu.Lock()
	prior := state.lastReport
	state.mu.Unlock()
	if report.TotalCalls == 0 && report.TotalErrors == 0 && prior != nil && prior.TotalCalls == 0 {
		logger.Info("[discord_alerts] dead-window suppressed — 0 calls + 0 errors + prior was also 0")
		return
	}

	// ── Auto-insight (deterministic, no LLM) ───────────────────────
	// Compute volume Δ, family hot/cold, latency regression, top-RPC
	// churn, error/quiet callouts from prior report (if any). This
	// runs even when the optional LLM suggestion is enabled, so the
	// embed always carries actionable signal even if the LLM is
	// unreachable.
	insight := buildAutoInsight(prior, report)
	report.AutoInsight = insight.Lines
	report.Severity = insight.Severity

	// Optional LLM-driven improvement suggestion. Best effort — never
	// blocks the Discord post if the LLM is slow or unreachable.
	if cfg.LLMEnabled && cfg.LLMURL != "" {
		if suggestion, lerr := requestLLMSuggestion(ctx, cfg, report); lerr != nil {
			logger.Warn("[discord_alerts] LLM suggestion failed: %v", lerr)
		} else {
			report.LLMSuggestion = suggestion
		}
	}

	embed := buildSummaryEmbed(cfg, report)
	if err := postDiscord(ctx, cfg.WebhookURL, embed); err != nil {
		logger.Error("[discord_alerts] discord post failed: %v", err)
		return
	}

	// Cache this report so the next leader-tick (could be us, could be
	// another pod) has a prior to diff against. Stored only on the
	// publishing pod; on leader handoff the new leader will skip the Δ
	// row for one tick — acceptable trade-off for keeping the design
	// fully local.
	state.mu.Lock()
	cp := report
	state.lastReport = &cp
	state.mu.Unlock()
}

// ─── Leader election (cross-pod single-poster) ───────────────

// windowLockKey returns the lock key all replicas should use for the
// 6h window enclosing `now`. Truncating to the cron interval guarantees
// every pod in the same window converges on the same int64 — exactly
// one of them will succeed at pg_try_advisory_lock(key).
func windowLockKey(now time.Time, interval time.Duration) int64 {
	if interval <= 0 {
		return now.Unix()
	}
	// XOR a fixed prefix so we don't collide with locks taken by the
	// rest of Nakama / migrations / app code on plain unix timestamps.
	const advisoryPrefix int64 = 0x71764E616B616D61 // "qvNakama" in hex
	return advisoryPrefix ^ now.Truncate(interval).Unix()
}

// claimAlertLeader tries to acquire a session-scoped Postgres advisory
// lock on `lockKey`. Returns (true, release) if acquired and (false,
// nil) if another pod already holds the lock for this window. The
// release closure unlocks AND returns the dedicated connection to the
// pool — both must run for clean teardown.
//
// Fail-open: if `db` is nil OR Postgres is unreachable, we return true
// with a no-op release so the alert still posts. Better to risk
// duplicates than silence the channel during a DB outage.
func claimAlertLeader(ctx context.Context, db *sql.DB, lockKey int64) (bool, func()) {
	if db == nil {
		return true, func() {}
	}
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	conn, err := db.Conn(cctx)
	if err != nil {
		// DB unreachable — fail open.
		return true, func() {}
	}
	var ok bool
	if err := conn.QueryRowContext(cctx, "SELECT pg_try_advisory_lock($1)", lockKey).Scan(&ok); err != nil {
		_ = conn.Close()
		return true, func() {}
	}
	if !ok {
		_ = conn.Close()
		return false, nil
	}
	// Caller MUST invoke release() so the lock is freed and the conn
	// returns to the pool. Use a fresh background context so the
	// release survives even if the parent ctx was cancelled.
	return true, func() {
		bg, bgCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer bgCancel()
		_, _ = conn.ExecContext(bg, "SELECT pg_advisory_unlock($1)", lockKey)
		_ = conn.Close()
	}
}

// ─── Prometheus scraping & parsing ───────────────────────

// scrapedSample is one (metric, labels, value) line from the exposition.
type scrapedSample struct {
	Metric string
	Labels map[string]string
	Value  float64
}

// scrapeMetrics fetches the Prometheus endpoint and returns parsed samples.
// We parse the text format manually instead of pulling in
// prometheus/common/expfmt: the format is line-oriented and the parser is
// small (~50 LoC), and avoiding the new dep keeps the plugin's dependency
// surface minimal — important for a plugin that ships as a .so coupled to
// Nakama's ABI.
func scrapeMetrics(ctx context.Context, url string) ([]scrapedSample, error) {
	cctx, cancel := context.WithTimeout(ctx, scrapeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "text/plain; version=0.0.4")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return parsePromText(string(body)), nil
}

// parsePromText parses Prometheus text-format. It is tolerant: malformed
// lines are skipped silently so a single bad sample never kills the whole
// scrape.
func parsePromText(s string) []scrapedSample {
	out := make([]scrapedSample, 0, 1024)
	for _, raw := range strings.Split(s, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Split metric{labels} value [timestamp]
		// Find the position of the first space OUTSIDE braces.
		braceDepth := 0
		valueStart := -1
		for i := 0; i < len(line); i++ {
			c := line[i]
			if c == '{' {
				braceDepth++
			} else if c == '}' {
				if braceDepth > 0 {
					braceDepth--
				}
			} else if c == ' ' && braceDepth == 0 {
				valueStart = i
				break
			}
		}
		if valueStart <= 0 {
			continue
		}
		head := line[:valueStart]
		tail := strings.TrimSpace(line[valueStart:])
		// tail may have an optional timestamp after the value — keep only the first token.
		if sp := strings.IndexByte(tail, ' '); sp > 0 {
			tail = tail[:sp]
		}
		val, err := strconv.ParseFloat(tail, 64)
		if err != nil {
			continue
		}
		// Special Prometheus values we don't want to feed into stats.
		if math.IsNaN(val) || math.IsInf(val, 0) {
			continue
		}

		metric := head
		labels := map[string]string{}
		if i := strings.IndexByte(head, '{'); i >= 0 && strings.HasSuffix(head, "}") {
			metric = head[:i]
			labelsRaw := head[i+1 : len(head)-1]
			labels = parsePromLabels(labelsRaw)
		}
		out = append(out, scrapedSample{Metric: metric, Labels: labels, Value: val})
	}
	return out
}

// parsePromLabels parses a comma-separated label list like
//
//	name="foo",resp_code="200",le="50"
//
// handling quoted values with escaped quotes / backslashes per the Prometheus
// text spec. Tolerant of trailing commas and odd whitespace.
func parsePromLabels(s string) map[string]string {
	out := map[string]string{}
	i := 0
	for i < len(s) {
		// Skip leading whitespace / commas.
		for i < len(s) && (s[i] == ' ' || s[i] == ',') {
			i++
		}
		if i >= len(s) {
			break
		}
		// Parse name=
		nameStart := i
		for i < len(s) && s[i] != '=' {
			i++
		}
		if i >= len(s) {
			break
		}
		name := strings.TrimSpace(s[nameStart:i])
		i++ // skip '='
		if i >= len(s) || s[i] != '"' {
			break
		}
		i++ // skip opening quote
		var b strings.Builder
		for i < len(s) {
			c := s[i]
			if c == '\\' && i+1 < len(s) {
				next := s[i+1]
				switch next {
				case 'n':
					b.WriteByte('\n')
				case '\\':
					b.WriteByte('\\')
				case '"':
					b.WriteByte('"')
				default:
					b.WriteByte(next)
				}
				i += 2
				continue
			}
			if c == '"' {
				i++
				break
			}
			b.WriteByte(c)
			i++
		}
		if name != "" {
			out[name] = b.String()
		}
	}
	return out
}

// applySnapshot replaces the previous baseline with current absolute values.
// Called AFTER a successful Discord post so a failed publish doesn't lose the
// delta window.
func applySnapshot(state *snapshotState, samples []scrapedSample, taken time.Time) {
	state.mu.Lock()
	defer state.mu.Unlock()

	state.counters = map[snapshotKey]float64{}
	state.buckets = map[snapshotKey]float64{}
	state.histSums = map[snapshotKey]float64{}
	state.histCount = map[snapshotKey]float64{}
	state.taken = taken

	for _, s := range samples {
		switch {
		case strings.HasSuffix(s.Metric, "_bucket"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
			state.buckets[key] = s.Value
		case strings.HasSuffix(s.Metric, "_sum"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(removeLabel(s.Labels, "le"))}
			state.histSums[key] = s.Value
		case strings.HasSuffix(s.Metric, "_count"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(removeLabel(s.Labels, "le"))}
			state.histCount[key] = s.Value
		case strings.HasSuffix(s.Metric, "_total"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
			state.counters[key] = s.Value
		}
	}
}

func serializeLabels(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(labels[k])
	}
	return b.String()
}

func removeLabel(labels map[string]string, key string) map[string]string {
	if _, ok := labels[key]; !ok {
		return labels
	}
	out := make(map[string]string, len(labels))
	for k, v := range labels {
		if k == key {
			continue
		}
		out[k] = v
	}
	return out
}

// ─── Report construction ─────────────────────────────────

// rpcStat is per-RPC aggregate over the alert window.
type rpcStat struct {
	Name        string
	Family      string
	FamilyEmoji string
	Calls       int64
	Errors      int64
	SumLatency  float64 // milliseconds, may be approximate
	P50         float64
	P90         float64
	P99         float64
	HasLatency  bool
	LastError   string
}

// alertReport bundles everything the embed builder needs.
//
// `AutoInsight` and `Severity` are populated by buildAutoInsight()
// after a successful scrape + leader claim. `Severity` drives the
// embed colour + title prefix (green / yellow / red) so the channel
// is no longer a wall of identical yellow banners.
type alertReport struct {
	WindowStart   time.Time
	WindowEnd     time.Time
	WindowLabel   string
	TotalCalls    int64
	TotalErrors   int64
	OverallP50    float64
	OverallP90    float64
	OverallP99    float64
	HasOverallLat bool
	Families      []familyAggregate
	TopErrors     []rpcStat
	TopSlowest    []rpcStat
	TopVolume     []rpcStat
	Health        serverHealth
	ScrapeOK      bool
	ScrapeErr     string
	LLMSuggestion string
	AutoInsight   []string
	Severity      reportSeverity
}

// reportSeverity is the priority of the report — drives both the embed
// colour and whether anyone gets paged. Determined by buildAutoInsight
// from current vs prior window stats.
type reportSeverity int

const (
	severityHealthy reportSeverity = iota // 🟢 — no errors + within ±50% volume
	severityWatch                         // 🟡 — anomalies present, no errors
	severityIssues                        // 🔴 — errors present OR latency regression
)

type familyAggregate struct {
	Label  string
	Emoji  string
	Calls  int64
	Errors int64
	P50    float64
	P90    float64
	P99    float64
	HasLat bool
}

type serverHealth struct {
	Goroutines      int
	HeapAllocMB     float64
	SysMemMB        float64
	OpenFDs         float64
	ResidentMemMB   float64
	CPUSecondsRate  float64 // CPU seconds / window duration
	HasCPU          bool
	DBOpenConns     float64
	DBInUse         float64
	HasDB           bool
	NakamaUptimeSec float64
	HasUptime       bool
}

// buildReport diffs `samples` against the prior snapshot and produces the
// fully-aggregated report.
func buildReport(state *snapshotState, samples []scrapedSample, now time.Time, cfg alertConfig) alertReport {
	state.mu.Lock()
	prevCounters := copyMap(state.counters)
	prevBuckets := copyMap(state.buckets)
	prevHistCounts := copyMap(state.histCount)
	windowStart := state.taken
	state.mu.Unlock()

	if windowStart.IsZero() {
		windowStart = now.Add(-cfg.Interval)
	}

	// Group samples by metric family for processing.
	currCounters := map[snapshotKey]float64{}
	currBuckets := map[snapshotKey]float64{}
	currHistCounts := map[snapshotKey]float64{}
	currHistSums := map[snapshotKey]float64{}

	for _, s := range samples {
		switch {
		case strings.HasSuffix(s.Metric, "_bucket"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
			currBuckets[key] = s.Value
		case strings.HasSuffix(s.Metric, "_sum"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(removeLabel(s.Labels, "le"))}
			currHistSums[key] = s.Value
		case strings.HasSuffix(s.Metric, "_count"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(removeLabel(s.Labels, "le"))}
			currHistCounts[key] = s.Value
		case strings.HasSuffix(s.Metric, "_total"):
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
			currCounters[key] = s.Value
		}
	}

	// Aggregate per-RPC counts. We look at counters whose family name plausibly
	// represents an RPC/API call (contains "rpc", "api", "function", "runtime",
	// "request") AND that have a label naming the function.
	rpcCalls := map[string]int64{}
	rpcErrors := map[string]int64{}
	rpcLastError := map[string]string{}

	for _, s := range samples {
		if !strings.HasSuffix(s.Metric, "_total") && !strings.HasSuffix(s.Metric, "_count") {
			continue
		}
		if !looksLikeRpcMetric(s.Metric) {
			continue
		}
		name := pickRpcName(s.Labels)
		if name == "" {
			continue
		}
		// Compute delta vs prior snapshot for this exact (metric, labels) tuple.
		var key snapshotKey
		if strings.HasSuffix(s.Metric, "_total") {
			key = snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
		} else {
			key = snapshotKey{Metric: s.Metric, Labels: serializeLabels(removeLabel(s.Labels, "le"))}
		}
		var prev float64
		if strings.HasSuffix(s.Metric, "_total") {
			prev = prevCounters[key]
		} else {
			prev = prevHistCounts[key]
		}
		delta := s.Value - prev
		if delta < 0 {
			// Counter reset (process restart between scrapes); treat as fresh.
			delta = s.Value
		}
		if delta <= 0 {
			continue
		}
		di := int64(delta + 0.5)
		rpcCalls[name] += di

		if isErrorSample(s.Labels) {
			rpcErrors[name] += di
			if msg := s.Labels["error"]; msg != "" && rpcLastError[name] == "" {
				rpcLastError[name] = msg
			}
		}
	}

	// Per-RPC latency percentiles from histogram bucket deltas.
	rpcLatency := computeRpcLatencyPercentiles(samples, prevBuckets, currBuckets)

	// Build per-RPC stat objects, classified into families.
	stats := make([]rpcStat, 0, len(rpcCalls))
	familyMap := make(map[string]*familyAggregate)
	for name, calls := range rpcCalls {
		family, emoji := classifyRpc(name)
		// Skip RPCs that don't fit any Quizverse-relevant family — keeps the
		// embed focused on what the user asked for.
		if family == "" {
			continue
		}
		st := rpcStat{
			Name:        name,
			Family:      family,
			FamilyEmoji: emoji,
			Calls:       calls,
			Errors:      rpcErrors[name],
			LastError:   rpcLastError[name],
		}
		if lat, ok := rpcLatency[name]; ok {
			st.HasLatency = true
			st.P50 = lat.P50
			st.P90 = lat.P90
			st.P99 = lat.P99
			st.SumLatency = lat.Sum
		}
		stats = append(stats, st)

		fa, ok := familyMap[family]
		if !ok {
			fa = &familyAggregate{Label: family, Emoji: emoji}
			familyMap[family] = fa
		}
		fa.Calls += calls
		fa.Errors += st.Errors
	}

	// Recompute family-level percentiles by re-aggregating bucket deltas
	// across all RPCs in that family. Cheaper than tracking per-bucket-per-RPC.
	familyPerc := computeFamilyLatencyPercentiles(samples, prevBuckets)
	for fname, fa := range familyMap {
		if p, ok := familyPerc[fname]; ok {
			fa.P50 = p.P50
			fa.P90 = p.P90
			fa.P99 = p.P99
			fa.HasLat = true
		}
	}

	// Total / overall percentiles across every family bucket combined.
	overall := computeOverallLatencyPercentiles(samples, prevBuckets)

	// Sort families by call count descending for the embed.
	familyList := make([]familyAggregate, 0, len(familyMap))
	for _, fa := range familyMap {
		familyList = append(familyList, *fa)
	}
	sort.Slice(familyList, func(i, j int) bool { return familyList[i].Calls > familyList[j].Calls })

	// Top-N selections.
	topVolume := topRpcsBy(stats, func(a, b rpcStat) bool { return a.Calls > b.Calls }, 10)
	topErrors := topRpcsBy(filterRpcs(stats, func(s rpcStat) bool { return s.Errors > 0 }),
		func(a, b rpcStat) bool {
			if a.Errors != b.Errors {
				return a.Errors > b.Errors
			}
			return a.Calls > b.Calls
		}, 8)
	topSlowest := topRpcsBy(filterRpcs(stats, func(s rpcStat) bool { return s.HasLatency && s.P99 > 0 }),
		func(a, b rpcStat) bool { return a.P99 > b.P99 }, 8)

	var totalCalls int64
	var totalErrors int64
	for _, fa := range familyMap {
		totalCalls += fa.Calls
		totalErrors += fa.Errors
	}

	report := alertReport{
		WindowStart:   windowStart,
		WindowEnd:     now,
		WindowLabel:   formatWindowLabel(now.Sub(windowStart)),
		TotalCalls:    totalCalls,
		TotalErrors:   totalErrors,
		OverallP50:    overall.P50,
		OverallP90:    overall.P90,
		OverallP99:    overall.P99,
		HasOverallLat: overall.Count > 0,
		Families:      familyList,
		TopErrors:     topErrors,
		TopSlowest:    topSlowest,
		TopVolume:     topVolume,
		Health:        computeServerHealth(samples, prevCounters, currCounters, now.Sub(windowStart)),
		ScrapeOK:      true,
	}
	return report
}

// ─── RPC classification helpers ──────────────────────────

// looksLikeRpcMetric returns true for metric families that plausibly carry
// per-RPC counters. We're deliberately permissive: Nakama metric names vary
// across versions ("api_overall_count_total", "nakama_runtime_count_total",
// "nakama_overall_count_total", etc.), so we match the obvious roots.
func looksLikeRpcMetric(metric string) bool {
	m := strings.ToLower(metric)
	hits := []string{
		"rpc", "_api_", "function", "runtime_count", "overall_count",
		"request", "endpoint",
	}
	for _, h := range hits {
		if strings.Contains(m, h) {
			return true
		}
	}
	return false
}

// pickRpcName extracts the most likely "RPC name" label across the variety
// of conventions Nakama (and our plugin) uses.
func pickRpcName(labels map[string]string) string {
	for _, k := range []string{"rpc_id", "rpc", "function", "name", "api_id", "endpoint", "method"} {
		if v := strings.TrimSpace(labels[k]); v != "" {
			return v
		}
	}
	return ""
}

// isErrorSample returns true if a sample's labels indicate it tracks errors.
func isErrorSample(labels map[string]string) bool {
	for _, k := range []string{"status", "result", "outcome"} {
		v := strings.ToLower(labels[k])
		if v == "error" || v == "err" || v == "failure" || v == "fail" || v == "exception" {
			return true
		}
	}
	if c := labels["resp_code"]; c != "" {
		// gRPC: 0=OK; HTTP: 2xx OK; treat anything else as error.
		if n, err := strconv.Atoi(c); err == nil {
			if n != 0 && (n < 200 || n >= 300) {
				return true
			}
		}
	}
	if c := labels["http_status"]; c != "" {
		if n, err := strconv.Atoi(c); err == nil && (n < 200 || n >= 300) {
			return true
		}
	}
	return false
}

// classifyRpc returns the family label + emoji for an RPC name.
// Returns ("", "") if the name doesn't fit any Quizverse-relevant family.
func classifyRpc(name string) (string, string) {
	lname := strings.ToLower(name)
	for _, fam := range quizverseRpcFamilies {
		for _, p := range fam.Prefixes {
			if strings.HasPrefix(lname, strings.ToLower(p)) {
				return fam.Label, fam.Emoji
			}
		}
	}
	return "", ""
}

// ─── Percentiles from histograms ─────────────────────────

type latencyP struct {
	P50   float64
	P90   float64
	P99   float64
	Sum   float64
	Count float64
}

// computeRpcLatencyPercentiles groups histogram buckets by RPC name and
// computes p50/p90/p99 from bucket deltas.
func computeRpcLatencyPercentiles(samples []scrapedSample, prevBuckets, currBuckets map[snapshotKey]float64) map[string]latencyP {
	type histKey struct {
		Metric string
		Name   string
	}
	bucketsByHist := map[histKey]map[float64]float64{}

	for _, s := range samples {
		if !strings.HasSuffix(s.Metric, "_bucket") || !looksLikeRpcLatencyMetric(s.Metric) {
			continue
		}
		name := pickRpcName(s.Labels)
		if name == "" {
			continue
		}
		leStr := s.Labels["le"]
		if leStr == "" {
			continue
		}
		le, err := strconv.ParseFloat(leStr, 64)
		if err != nil {
			continue
		}
		key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
		delta := s.Value - prevBuckets[key]
		if delta < 0 {
			delta = s.Value
		}
		hk := histKey{Metric: s.Metric, Name: name}
		if bucketsByHist[hk] == nil {
			bucketsByHist[hk] = map[float64]float64{}
		}
		bucketsByHist[hk][le] += delta
	}

	// Merge across distinct latency-metric families (count vs duration_seconds,
	// etc.) — just keep the one with the most observations.
	out := map[string]latencyP{}
	for hk, bkts := range bucketsByHist {
		p := percentilesFromBuckets(bkts)
		// Convert seconds → ms heuristically: if metric name ends in
		// "duration_seconds_bucket", scale by 1000.
		if strings.Contains(hk.Metric, "_seconds_") {
			p.P50 *= 1000
			p.P90 *= 1000
			p.P99 *= 1000
		}
		existing, ok := out[hk.Name]
		if !ok || p.Count > existing.Count {
			out[hk.Name] = p
		}
	}
	return out
}

func computeFamilyLatencyPercentiles(samples []scrapedSample, prevBuckets map[snapshotKey]float64) map[string]latencyP {
	bucketsByFamily := map[string]map[float64]float64{}
	metricByFamily := map[string]string{}
	for _, s := range samples {
		if !strings.HasSuffix(s.Metric, "_bucket") || !looksLikeRpcLatencyMetric(s.Metric) {
			continue
		}
		name := pickRpcName(s.Labels)
		if name == "" {
			continue
		}
		family, _ := classifyRpc(name)
		if family == "" {
			continue
		}
		leStr := s.Labels["le"]
		if leStr == "" {
			continue
		}
		le, err := strconv.ParseFloat(leStr, 64)
		if err != nil {
			continue
		}
		key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
		delta := s.Value - prevBuckets[key]
		if delta < 0 {
			delta = s.Value
		}
		if bucketsByFamily[family] == nil {
			bucketsByFamily[family] = map[float64]float64{}
			metricByFamily[family] = s.Metric
		}
		bucketsByFamily[family][le] += delta
	}
	out := map[string]latencyP{}
	for fam, bkts := range bucketsByFamily {
		p := percentilesFromBuckets(bkts)
		if strings.Contains(metricByFamily[fam], "_seconds_") {
			p.P50 *= 1000
			p.P90 *= 1000
			p.P99 *= 1000
		}
		out[fam] = p
	}
	return out
}

func computeOverallLatencyPercentiles(samples []scrapedSample, prevBuckets map[snapshotKey]float64) latencyP {
	merged := map[float64]float64{}
	scaleSeconds := false
	for _, s := range samples {
		if !strings.HasSuffix(s.Metric, "_bucket") || !looksLikeRpcLatencyMetric(s.Metric) {
			continue
		}
		if pickRpcName(s.Labels) == "" {
			continue
		}
		leStr := s.Labels["le"]
		if leStr == "" {
			continue
		}
		le, err := strconv.ParseFloat(leStr, 64)
		if err != nil {
			continue
		}
		key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
		delta := s.Value - prevBuckets[key]
		if delta < 0 {
			delta = s.Value
		}
		if strings.Contains(s.Metric, "_seconds_") {
			scaleSeconds = true
		}
		merged[le] += delta
	}
	p := percentilesFromBuckets(merged)
	if scaleSeconds {
		p.P50 *= 1000
		p.P90 *= 1000
		p.P99 *= 1000
	}
	return p
}

func looksLikeRpcLatencyMetric(metric string) bool {
	m := strings.ToLower(metric)
	return (strings.Contains(m, "latency") || strings.Contains(m, "duration") || strings.Contains(m, "ms")) &&
		looksLikeRpcMetric(m)
}

// percentilesFromBuckets uses the standard Prometheus histogram_quantile
// algorithm: cumulative counts up to each bucket boundary, linear
// interpolation within the matching bucket.
func percentilesFromBuckets(buckets map[float64]float64) latencyP {
	if len(buckets) == 0 {
		return latencyP{}
	}
	bounds := make([]float64, 0, len(buckets))
	for k := range buckets {
		bounds = append(bounds, k)
	}
	sort.Float64s(bounds)

	// Bucket counts in Prometheus are cumulative: bucket "le=N" includes all
	// observations with value <= N. The largest bucket (le=+Inf) is the total
	// count.
	total := buckets[bounds[len(bounds)-1]]
	for _, b := range bounds {
		if buckets[b] > total {
			total = buckets[b]
		}
	}
	if total <= 0 {
		return latencyP{}
	}

	pickQuantile := func(q float64) float64 {
		target := q * total
		var prevBound float64
		var prevCount float64
		for _, b := range bounds {
			cnt := buckets[b]
			if cnt < target {
				prevBound = b
				prevCount = cnt
				continue
			}
			// Linear interpolation within [prevBound, b].
			if math.IsInf(b, 1) {
				return prevBound
			}
			if cnt-prevCount <= 0 {
				return b
			}
			frac := (target - prevCount) / (cnt - prevCount)
			return prevBound + frac*(b-prevBound)
		}
		return bounds[len(bounds)-1]
	}

	return latencyP{
		P50:   pickQuantile(0.50),
		P90:   pickQuantile(0.90),
		P99:   pickQuantile(0.99),
		Count: total,
	}
}

// ─── Server health ───────────────────────────────────────

func computeServerHealth(samples []scrapedSample, prevCounters, currCounters map[snapshotKey]float64, window time.Duration) serverHealth {
	h := serverHealth{
		Goroutines:  runtime.NumGoroutine(),
		HeapAllocMB: float64(memStatsAlloc()) / (1024 * 1024),
	}
	for _, s := range samples {
		switch s.Metric {
		case "go_goroutines":
			h.Goroutines = int(s.Value)
		case "go_memstats_alloc_bytes":
			h.HeapAllocMB = s.Value / (1024 * 1024)
		case "go_memstats_sys_bytes":
			h.SysMemMB = s.Value / (1024 * 1024)
		case "process_open_fds":
			h.OpenFDs = s.Value
		case "process_resident_memory_bytes":
			h.ResidentMemMB = s.Value / (1024 * 1024)
		case "process_cpu_seconds_total":
			key := snapshotKey{Metric: s.Metric, Labels: serializeLabels(s.Labels)}
			delta := s.Value - prevCounters[key]
			if delta < 0 {
				delta = 0
			}
			if window.Seconds() > 0 {
				h.CPUSecondsRate = delta / window.Seconds()
				h.HasCPU = true
			}
		case "process_start_time_seconds":
			if s.Value > 0 {
				h.NakamaUptimeSec = float64(time.Now().Unix()) - s.Value
				h.HasUptime = true
			}
		}
		// DB stats (Nakama uses go-sql-stats names that may differ — match common ones).
		if strings.Contains(s.Metric, "db_") || strings.Contains(s.Metric, "database_") {
			lname := strings.ToLower(s.Metric)
			if strings.Contains(lname, "open_connections") || strings.Contains(lname, "connections_open") {
				h.DBOpenConns = s.Value
				h.HasDB = true
			}
			if strings.Contains(lname, "in_use") || strings.Contains(lname, "inuse") {
				h.DBInUse = s.Value
				h.HasDB = true
			}
		}
	}
	return h
}

func memStatsAlloc() uint64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.Alloc
}

// ─── Embed builders ──────────────────────────────────────

// Discord webhook payload structures.
type discordPayload struct {
	Username  string         `json:"username,omitempty"`
	AvatarURL string         `json:"avatar_url,omitempty"`
	Embeds    []discordEmbed `json:"embeds,omitempty"`
}

type discordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	Color       int                 `json:"color,omitempty"`
	Fields      []discordEmbedField `json:"fields,omitempty"`
	Footer      *discordEmbedFooter `json:"footer,omitempty"`
	Timestamp   string              `json:"timestamp,omitempty"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordEmbedFooter struct {
	Text string `json:"text,omitempty"`
}

// ─── Auto-insight (deterministic local analyzer) ─────────

// autoInsightResult is what buildAutoInsight returns: a small slice of
// human-readable bullet points + the derived severity. No LLM, no
// external calls — this runs every cycle so the channel always carries
// a "what changed" signal even when the optional LLM enrichment is
// disabled or unreachable.
type autoInsightResult struct {
	Lines    []string
	Severity reportSeverity
}

// buildAutoInsight diffs `cur` against `prev` (prior window from the
// same pod) and produces actionable bullets:
//
//   - volume change > ±25%
//   - error spike (any errors at all bumps to severityIssues)
//   - latency regression on any RPC (TP99 +50% w/ n>=20)
//   - top-RPC churn (entered or fell out of top-3)
//   - family hot/cold (largest absolute call-count Δ)
//   - quiet-window callout (>70% drop in total calls)
//
// `prev` may be nil (first cycle, leader handoff). In that case we still
// emit a minimum-viable insight ("first window, no comparison yet").
func buildAutoInsight(prev *alertReport, cur alertReport) autoInsightResult {
	out := autoInsightResult{Severity: severityHealthy}

	// Errors are the strongest signal — always elevate to "issues".
	if cur.TotalErrors > 0 {
		out.Severity = severityIssues
		errPct := 0.0
		if cur.TotalCalls > 0 {
			errPct = float64(cur.TotalErrors) / float64(cur.TotalCalls) * 100
		}
		out.Lines = append(out.Lines, fmt.Sprintf(
			"❌ **%d errors** across %d calls (%.2f%% err-rate) — see Top Errors below",
			cur.TotalErrors, cur.TotalCalls, errPct,
		))
	}

	if prev == nil {
		if len(out.Lines) == 0 {
			out.Lines = append(out.Lines, "🆕 First observed window since pod start — no prior baseline to diff against.")
		}
		return out
	}

	// Volume change.
	if prev.TotalCalls > 0 {
		deltaPct := float64(cur.TotalCalls-prev.TotalCalls) / float64(prev.TotalCalls) * 100
		switch {
		case deltaPct >= 25:
			arrow := "📈"
			if deltaPct >= 100 {
				arrow = "🚀"
			}
			out.Lines = append(out.Lines, fmt.Sprintf(
				"%s Total volume **%+.0f%%** vs prior window (%d → %d calls)",
				arrow, deltaPct, prev.TotalCalls, cur.TotalCalls,
			))
			if out.Severity == severityHealthy {
				out.Severity = severityWatch
			}
		case deltaPct <= -25:
			out.Lines = append(out.Lines, fmt.Sprintf(
				"📉 Total volume **%.0f%%** vs prior window (%d → %d calls)",
				deltaPct, prev.TotalCalls, cur.TotalCalls,
			))
			if deltaPct <= -70 {
				out.Lines = append(out.Lines, "💤 Quiet window — likely off-hours or regional traffic dip. Monitor next cycle.")
			}
			if out.Severity == severityHealthy {
				out.Severity = severityWatch
			}
		}
	}

	// Family hot/cold — biggest mover (by absolute Δ in calls).
	if hot, cold := topFamilyMovers(prev.Families, cur.Families); hot != "" || cold != "" {
		if hot != "" {
			out.Lines = append(out.Lines, "🔥 Hottest family: "+hot)
		}
		if cold != "" {
			out.Lines = append(out.Lines, "🧊 Coldest family: "+cold)
		}
	}

	// Top-RPC churn — what's new in the top, what fell out.
	if newcomer, vanished := topRpcChurn(prev.TopVolume, cur.TopVolume); newcomer != "" || vanished != "" {
		if newcomer != "" {
			out.Lines = append(out.Lines, "🆕 Entered top RPCs: "+newcomer)
		}
		if vanished != "" {
			out.Lines = append(out.Lines, "🫥 Dropped out of top RPCs: "+vanished)
		}
	}

	// Latency regression — any RPC whose TP99 jumped >=50% with n>=20.
	if reg := latencyRegressions(prev.TopSlowest, cur.TopSlowest); reg != "" {
		out.Lines = append(out.Lines, "⚠️ Latency regression: "+reg)
		out.Severity = severityIssues
	}

	if len(out.Lines) == 0 {
		out.Lines = append(out.Lines, "✅ Window healthy — volumes within ±25% of prior, no errors, no latency regressions.")
	}
	return out
}

// topFamilyMovers returns ("Family X +N% (a→b)", "Family Y −M% (c→d)")
// for the largest positive and negative absolute-call-count Δ across
// families that had non-trivial volume in either window.
func topFamilyMovers(prev, cur []familyAggregate) (string, string) {
	prevByLabel := map[string]familyAggregate{}
	for _, f := range prev {
		prevByLabel[f.Label] = f
	}
	type mover struct {
		Label    string
		Emoji    string
		Prev     int64
		Cur      int64
		AbsDelta int64
	}
	movers := make([]mover, 0, len(cur))
	for _, c := range cur {
		p := prevByLabel[c.Label]
		// Skip nano-traffic families to avoid noisy "X went from 1 to 3 calls (+200%)" callouts.
		if c.Calls < 20 && p.Calls < 20 {
			continue
		}
		d := c.Calls - p.Calls
		ad := d
		if ad < 0 {
			ad = -ad
		}
		movers = append(movers, mover{Label: c.Label, Emoji: c.Emoji, Prev: p.Calls, Cur: c.Calls, AbsDelta: ad})
	}
	sort.Slice(movers, func(i, j int) bool { return movers[i].AbsDelta > movers[j].AbsDelta })

	hot := ""
	cold := ""
	for _, m := range movers {
		if m.Cur < m.Prev && cold == "" && m.Prev > 0 {
			deltaPct := float64(m.Cur-m.Prev) / float64(m.Prev) * 100
			cold = fmt.Sprintf("%s %s **%.0f%%** (%d → %d)", m.Emoji, m.Label, deltaPct, m.Prev, m.Cur)
		}
		if m.Cur > m.Prev && hot == "" {
			deltaPct := 0.0
			if m.Prev > 0 {
				deltaPct = float64(m.Cur-m.Prev) / float64(m.Prev) * 100
			} else {
				deltaPct = 100.0
			}
			hot = fmt.Sprintf("%s %s **+%.0f%%** (%d → %d)", m.Emoji, m.Label, deltaPct, m.Prev, m.Cur)
		}
		if hot != "" && cold != "" {
			break
		}
	}
	return hot, cold
}

// topRpcChurn returns one comma-joined string of RPCs newly in the top-3
// of `cur` (not present in prior top-10) and one of RPCs that fell from
// prior top-3 out of the current top-10.
func topRpcChurn(prev, cur []rpcStat) (string, string) {
	prevSet := map[string]int{}
	for i, r := range prev {
		prevSet[r.Name] = i + 1 // rank, 1-indexed
	}
	curSet := map[string]int{}
	for i, r := range cur {
		curSet[r.Name] = i + 1
	}
	var newcomers, vanished []string
	for i, r := range cur {
		if i >= 3 {
			break
		}
		if _, was := prevSet[r.Name]; !was {
			newcomers = append(newcomers, fmt.Sprintf("`%s` (#%d, %d calls)", r.Name, i+1, r.Calls))
		}
	}
	for i, r := range prev {
		if i >= 3 {
			break
		}
		if _, still := curSet[r.Name]; !still {
			vanished = append(vanished, fmt.Sprintf("`%s` (was #%d w/ %d calls)", r.Name, i+1, r.Calls))
		}
	}
	return strings.Join(newcomers, ", "), strings.Join(vanished, ", ")
}

// latencyRegressions returns a short summary of any RPC whose TP99
// increased by >=50% AND was called at least 20 times in the new window.
func latencyRegressions(prev, cur []rpcStat) string {
	prevByName := map[string]rpcStat{}
	for _, r := range prev {
		prevByName[r.Name] = r
	}
	type reg struct {
		Name   string
		Was    float64
		Now    float64
		Pct    float64
		Calls  int64
		Family string
	}
	var regs []reg
	for _, r := range cur {
		if !r.HasLatency || r.Calls < 20 {
			continue
		}
		p, ok := prevByName[r.Name]
		if !ok || !p.HasLatency || p.P99 <= 0 {
			continue
		}
		pct := (r.P99 - p.P99) / p.P99 * 100
		if pct < 50 {
			continue
		}
		regs = append(regs, reg{Name: r.Name, Was: p.P99, Now: r.P99, Pct: pct, Calls: r.Calls, Family: r.Family})
	}
	if len(regs) == 0 {
		return ""
	}
	sort.Slice(regs, func(i, j int) bool { return regs[i].Pct > regs[j].Pct })
	if len(regs) > 3 {
		regs = regs[:3]
	}
	parts := make([]string, 0, len(regs))
	for _, r := range regs {
		parts = append(parts, fmt.Sprintf("`%s` TP99 **%+.0f%%** (%s → %s, n=%d)",
			r.Name, r.Pct, formatMs(r.Was), formatMs(r.Now), r.Calls))
	}
	return strings.Join(parts, " · ")
}

func buildSummaryEmbed(cfg alertConfig, r alertReport) discordPayload {
	successRate := 100.0
	if r.TotalCalls > 0 {
		successRate = float64(r.TotalCalls-r.TotalErrors) / float64(r.TotalCalls) * 100
	}

	// Severity → emoji + color. Default to "watch/yellow" so old reports
	// (severity zero-value=healthy) don't accidentally green-wash a bad
	// report; the explicit healthy path below overrides this.
	titleEmoji := "🟡"
	titleSeverity := "Watch"
	color := embedColor // gold/yellow
	switch r.Severity {
	case severityHealthy:
		titleEmoji = "🟢"
		titleSeverity = "Healthy"
		color = 0x2ECC71 // green
	case severityIssues:
		titleEmoji = "🔴"
		titleSeverity = "Issues"
		color = 0xE74C3C // red
	}

	desc := fmt.Sprintf(
		"Window: **%s** (%s → %s UTC) · severity **%s**\nQuizverse-relevant Nakama RPC activity from `%s`.",
		r.WindowLabel,
		r.WindowStart.UTC().Format("2006-01-02 15:04"),
		r.WindowEnd.UTC().Format("2006-01-02 15:04"),
		titleSeverity,
		cfg.InstanceLabel,
	)

	embed := discordEmbed{
		Title:       fmt.Sprintf("%s Nakama %s Summary — Quizverse RPCs", titleEmoji, r.WindowLabel),
		Description: desc,
		Color:       color,
		Timestamp:   r.WindowEnd.UTC().Format(time.RFC3339),
		Footer: &discordEmbedFooter{
			Text: fmt.Sprintf("nakama-analytics-metrics • %s • Go %s · single-leader posted via pg_advisory_lock",
				cfg.InstanceLabel, runtime.Version()),
		},
	}

	// Field 1: Headline numbers.
	headline := fmt.Sprintf(
		"📞 Total Calls: **%d**\n✅ Success: **%d** (`%.2f%%`)\n❌ Errors: **%d**",
		r.TotalCalls, r.TotalCalls-r.TotalErrors, successRate, r.TotalErrors,
	)
	embed.Fields = append(embed.Fields, discordEmbedField{
		Name:   "📊 Overview",
		Value:  truncateField(headline),
		Inline: false,
	})

	// Field 1.5: Auto-Insight — what changed vs prior window. Sits right
	// after Overview so the eye lands on actionable signal first, before
	// the detailed family/RPC tables. Always present (buildAutoInsight
	// always returns at least one line).
	if len(r.AutoInsight) > 0 {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "🤖 Auto-Insight (vs prior window)",
			Value:  truncateField("• " + strings.Join(r.AutoInsight, "\n• ")),
			Inline: false,
		})
	}

	// Field 2: Overall latency.
	if r.HasOverallLat {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name: "⏱️ Latency (overall)",
			Value: truncateField(fmt.Sprintf(
				"TP50: **%s**\nTP90: **%s**\nTP99: **%s**",
				formatMs(r.OverallP50), formatMs(r.OverallP90), formatMs(r.OverallP99),
			)),
			Inline: true,
		})
	}

	// Field 3: Server health.
	embed.Fields = append(embed.Fields, discordEmbedField{
		Name:   "🩺 Server Health",
		Value:  truncateField(formatHealth(r.Health)),
		Inline: true,
	})

	// Field 4: Per-family breakdown.
	if len(r.Families) > 0 {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "🗂️ By Family",
			Value:  truncateField(formatFamilyTable(r.Families)),
			Inline: false,
		})
	}

	// Field 5: Top volume.
	if len(r.TopVolume) > 0 {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "🔥 Top RPCs by Volume",
			Value:  truncateField(formatRpcList(r.TopVolume, "calls")),
			Inline: false,
		})
	}

	// Field 6: Top errors.
	if len(r.TopErrors) > 0 {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "🚨 Top Errors",
			Value:  truncateField(formatRpcErrorsList(r.TopErrors)),
			Inline: false,
		})
	}

	// Field 7: Slowest.
	if len(r.TopSlowest) > 0 {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "🐢 Slowest RPCs (TP99)",
			Value:  truncateField(formatRpcSlowestList(r.TopSlowest)),
			Inline: false,
		})
	}

	// Field 8: LLM suggestion (optional).
	if r.LLMSuggestion != "" {
		embed.Fields = append(embed.Fields, discordEmbedField{
			Name:   "🤖 LLM Improvement Suggestions",
			Value:  truncateField(r.LLMSuggestion),
			Inline: false,
		})
	}

	// Trim to fit Discord limits (per-embed total ≤ 6000 chars; ≤ 25 fields).
	embed = enforceEmbedLimits(embed)

	return discordPayload{
		Username: "Nakama Watchdog",
		Embeds:   []discordEmbed{embed},
	}
}

func scrapeFailureEmbed(cfg alertConfig, err error) discordPayload {
	return discordPayload{
		Username: "Nakama Watchdog",
		Embeds: []discordEmbed{{
			Title:       "🟥 Nakama metrics scrape FAILED",
			Description: fmt.Sprintf("Could not scrape `%s` for the 6h Quizverse RPC summary.\n\n```%s```", cfg.MetricsURL, truncate(err.Error(), 800)),
			Color:       0xE74C3C,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
			Footer: &discordEmbedFooter{
				Text: fmt.Sprintf("nakama-analytics-metrics • %s • Go %s", cfg.InstanceLabel, runtime.Version()),
			},
		}},
	}
}

func formatHealth(h serverHealth) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Goroutines: **%d**\n", h.Goroutines)
	if h.ResidentMemMB > 0 {
		fmt.Fprintf(&b, "RSS: **%.0f MB**\n", h.ResidentMemMB)
	}
	if h.HeapAllocMB > 0 {
		fmt.Fprintf(&b, "Heap: **%.0f MB**\n", h.HeapAllocMB)
	}
	if h.OpenFDs > 0 {
		fmt.Fprintf(&b, "Open FDs: **%.0f**\n", h.OpenFDs)
	}
	if h.HasCPU {
		fmt.Fprintf(&b, "CPU avg: **%.2f cores**\n", h.CPUSecondsRate)
	}
	if h.HasDB {
		fmt.Fprintf(&b, "DB conns: **%.0f open / %.0f in-use**\n", h.DBOpenConns, h.DBInUse)
	}
	if h.HasUptime {
		fmt.Fprintf(&b, "Uptime: **%s**\n", formatDuration(time.Duration(h.NakamaUptimeSec*float64(time.Second))))
	}
	return strings.TrimRight(b.String(), "\n")
}

func formatFamilyTable(fams []familyAggregate) string {
	if len(fams) == 0 {
		return "_no Quizverse RPC traffic in this window_"
	}
	var b strings.Builder
	b.WriteString("```")
	for _, f := range fams {
		errPct := 0.0
		if f.Calls > 0 {
			errPct = float64(f.Errors) / float64(f.Calls) * 100
		}
		// Build line with optional latency.
		latPart := ""
		if f.HasLat {
			latPart = fmt.Sprintf(" p50/90/99=%s/%s/%s",
				formatMs(f.P50), formatMs(f.P90), formatMs(f.P99))
		}
		fmt.Fprintf(&b, "%s %-32s calls=%-6d err=%-4d (%.1f%%)%s\n",
			f.Emoji, truncate(f.Label, 32), f.Calls, f.Errors, errPct, latPart)
	}
	b.WriteString("```")
	return b.String()
}

func formatRpcList(rpcs []rpcStat, _ string) string {
	if len(rpcs) == 0 {
		return "_none_"
	}
	var b strings.Builder
	b.WriteString("```")
	for _, r := range rpcs {
		latPart := ""
		if r.HasLatency {
			latPart = fmt.Sprintf(" p99=%s", formatMs(r.P99))
		}
		fmt.Fprintf(&b, "%-38s %6d calls%s\n", truncate(r.Name, 38), r.Calls, latPart)
	}
	b.WriteString("```")
	return b.String()
}

func formatRpcErrorsList(rpcs []rpcStat) string {
	if len(rpcs) == 0 {
		return "_no errors in this window_"
	}
	var b strings.Builder
	b.WriteString("```")
	for _, r := range rpcs {
		errPct := 0.0
		if r.Calls > 0 {
			errPct = float64(r.Errors) / float64(r.Calls) * 100
		}
		fmt.Fprintf(&b, "%-32s err=%-4d / calls=%-6d (%.1f%%)\n",
			truncate(r.Name, 32), r.Errors, r.Calls, errPct)
		if r.LastError != "" {
			fmt.Fprintf(&b, "  last: %s\n", truncate(r.LastError, 60))
		}
	}
	b.WriteString("```")
	return b.String()
}

func formatRpcSlowestList(rpcs []rpcStat) string {
	if len(rpcs) == 0 {
		return "_none_"
	}
	var b strings.Builder
	b.WriteString("```")
	for _, r := range rpcs {
		fmt.Fprintf(&b, "%-32s p50/90/99=%s/%s/%s  n=%d\n",
			truncate(r.Name, 32), formatMs(r.P50), formatMs(r.P90), formatMs(r.P99), r.Calls)
	}
	b.WriteString("```")
	return b.String()
}

// enforceEmbedLimits drops fields from the bottom of the embed (which we
// ordered with the lowest-priority — LLM, slowest, errors — last) until the
// total fits Discord's 6000-char + 25-field caps.
func enforceEmbedLimits(e discordEmbed) discordEmbed {
	for embedSize(e) > discordMaxEmbedChars && len(e.Fields) > 0 {
		e.Fields = e.Fields[:len(e.Fields)-1]
	}
	if len(e.Fields) > discordMaxFieldsCount {
		e.Fields = e.Fields[:discordMaxFieldsCount]
	}
	return e
}

func embedSize(e discordEmbed) int {
	n := len(e.Title) + len(e.Description)
	if e.Footer != nil {
		n += len(e.Footer.Text)
	}
	for _, f := range e.Fields {
		n += len(f.Name) + len(f.Value)
	}
	return n
}

// ─── Server-side log emission ────────────────────────────

// logReportToServer writes the same key data to Nakama's logger so ops can
// grep `discord_alerts.summary` even if Discord is down.
func logReportToServer(logger nkruntime.Logger, r alertReport) {
	logger.Info("[discord_alerts.summary] window=%s total_calls=%d total_errors=%d p50=%.0fms p90=%.0fms p99=%.0fms families=%d top_errors=%d top_slowest=%d",
		r.WindowLabel, r.TotalCalls, r.TotalErrors, r.OverallP50, r.OverallP90, r.OverallP99,
		len(r.Families), len(r.TopErrors), len(r.TopSlowest))

	// Errors first so they're prominent in the log stream.
	for _, e := range r.TopErrors {
		logger.Warn("[discord_alerts.error_rpc] family=%q rpc=%q calls=%d errors=%d last=%q",
			e.Family, e.Name, e.Calls, e.Errors, truncate(e.LastError, 200))
	}
	for _, s := range r.TopSlowest {
		logger.Info("[discord_alerts.slow_rpc] family=%q rpc=%q p50=%.0fms p90=%.0fms p99=%.0fms calls=%d",
			s.Family, s.Name, s.P50, s.P90, s.P99, s.Calls)
	}
	for _, f := range r.Families {
		logger.Info("[discord_alerts.family] label=%q calls=%d errors=%d p50=%.0fms p90=%.0fms p99=%.0fms",
			f.Label, f.Calls, f.Errors, f.P50, f.P90, f.P99)
	}
}

// ─── Discord post ────────────────────────────────────────

func postDiscord(ctx context.Context, webhookURL string, payload discordPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	cctx, cancel := context.WithTimeout(ctx, discordTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("discord status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

// ─── LLM improvement suggestion (optional) ───────────────

// requestLLMSuggestion POSTs the report digest to the IVX LLM endpoint and
// returns a one-paragraph improvement suggestion. The endpoint is expected
// to be the IVX backend's
// `POST /api/ai/ai-prompt/interrogate/custom/response` (or any equivalent
// chat-completion endpoint). Failure is non-fatal.
func requestLLMSuggestion(ctx context.Context, cfg alertConfig, r alertReport) (string, error) {
	digest := buildLLMDigest(r)
	body := map[string]any{
		"prompt": "You are an SRE assistant for an IVX-powered Nakama backend. Given the following 6-hour RPC analytics summary, suggest 3 specific, actionable improvements. Keep total response under 700 characters. Reply in plain text only.\n\n" + digest,
		"systemMessage": "You are a senior SRE analysing Nakama RPC telemetry for a quiz game. " +
			"Focus on: (a) error reduction, (b) latency improvements (TP99 hot spots), " +
			"(c) capacity/scaling concerns. Be concrete. No markdown.",
		"language":  "en",
		"maxTokens": 300,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	cctx, cancel := context.WithTimeout(ctx, llmTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, cfg.LLMURL, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.LLMToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.LLMToken)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("llm status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return "", err
	}
	// Best-effort extraction: try common shapes (string, {response: ...},
	// {data: {response: ...}}, etc.). Fall back to raw body.
	return extractLLMText(raw), nil
}

func buildLLMDigest(r alertReport) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Window: %s (UTC %s → %s)\n", r.WindowLabel,
		r.WindowStart.UTC().Format(time.RFC3339), r.WindowEnd.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "Total: %d calls, %d errors, p50=%.0fms p90=%.0fms p99=%.0fms\n",
		r.TotalCalls, r.TotalErrors, r.OverallP50, r.OverallP90, r.OverallP99)
	fmt.Fprintf(&b, "Health: goroutines=%d rss_mb=%.0f cpu_cores=%.2f db_open=%.0f db_in_use=%.0f\n",
		r.Health.Goroutines, r.Health.ResidentMemMB, r.Health.CPUSecondsRate, r.Health.DBOpenConns, r.Health.DBInUse)
	b.WriteString("Families:\n")
	for _, f := range r.Families {
		fmt.Fprintf(&b, "- %s: calls=%d err=%d p50=%.0f p90=%.0f p99=%.0f\n",
			f.Label, f.Calls, f.Errors, f.P50, f.P90, f.P99)
	}
	if len(r.TopErrors) > 0 {
		b.WriteString("Top errors:\n")
		for _, e := range r.TopErrors {
			fmt.Fprintf(&b, "- %s err=%d/%d last=%q\n",
				e.Name, e.Errors, e.Calls, truncate(e.LastError, 120))
		}
	}
	if len(r.TopSlowest) > 0 {
		b.WriteString("Slowest:\n")
		for _, s := range r.TopSlowest {
			fmt.Fprintf(&b, "- %s p99=%.0fms calls=%d\n", s.Name, s.P99, s.Calls)
		}
	}
	return truncate(b.String(), 4000)
}

func extractLLMText(raw []byte) string {
	// Try JSON first.
	var asMap map[string]any
	if json.Unmarshal(raw, &asMap) == nil {
		for _, key := range []string{"response", "text", "content", "message", "answer", "result"} {
			if v, ok := asMap[key].(string); ok && v != "" {
				return strings.TrimSpace(v)
			}
		}
		// Nested {data: {response: "..."}}.
		if data, ok := asMap["data"].(map[string]any); ok {
			for _, key := range []string{"response", "text", "content", "message", "answer", "result"} {
				if v, ok := data[key].(string); ok && v != "" {
					return strings.TrimSpace(v)
				}
			}
		}
	}
	s := strings.TrimSpace(string(raw))
	if len(s) > 1500 {
		s = s[:1500] + "…"
	}
	return s
}

// ─── Misc helpers ────────────────────────────────────────

func copyMap(m map[snapshotKey]float64) map[snapshotKey]float64 {
	out := make(map[snapshotKey]float64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func filterRpcs(in []rpcStat, pred func(rpcStat) bool) []rpcStat {
	out := make([]rpcStat, 0, len(in))
	for _, r := range in {
		if pred(r) {
			out = append(out, r)
		}
	}
	return out
}

func topRpcsBy(in []rpcStat, less func(a, b rpcStat) bool, n int) []rpcStat {
	if len(in) == 0 {
		return nil
	}
	cp := make([]rpcStat, len(in))
	copy(cp, in)
	sort.SliceStable(cp, func(i, j int) bool { return less(cp[i], cp[j]) })
	if len(cp) > n {
		cp = cp[:n]
	}
	return cp
}

func formatMs(ms float64) string {
	if ms <= 0 {
		return "—"
	}
	if ms < 1 {
		return "<1ms"
	}
	if ms < 1000 {
		return fmt.Sprintf("%.0fms", ms)
	}
	return fmt.Sprintf("%.2fs", ms/1000)
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm%ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh%dm", int(d.Hours()), int(d.Minutes())%60)
	}
	return fmt.Sprintf("%dd%dh", int(d.Hours())/24, int(d.Hours())%24)
}

func formatWindowLabel(d time.Duration) string {
	hours := int(d.Hours() + 0.5)
	if hours <= 0 {
		hours = int(defaultAlertInterval.Hours())
	}
	return fmt.Sprintf("%dh", hours)
}

func truncate(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	if max <= 1 {
		return s[:max]
	}
	return s[:max-1] + "…"
}

func truncateField(s string) string {
	return truncate(s, discordMaxFieldChars)
}
