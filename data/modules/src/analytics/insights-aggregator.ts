// Phase 2A (qv-insights-loop) — Insights aggregator.
//
// Hourly rollup that turns the raw `analytics_rpc_samples` ZSet (and the
// per-event records persisted by analytics.js into `analytics_events`)
// into compact per-cohort bundles, then POSTs them to the AI svc
// `/insights/ingest` endpoint over HMAC-signed HTTP.
//
// Why hourly? Cheap enough to keep latency on the brief low (<= 1h
// freshness) without overwhelming the AI svc when it falls behind.
//
// Why per-cohort? The downstream RAG analyst (Phase 2B) wants pre-
// segmented signal — pushing raw rows means more tokens + more LLM cost
// for the same conclusion. We aggregate "whale_d30_returning_ai_host_lover
// on Android 14, weekly mythology card" once at the source.
//
// Failure modes handled:
//   - AI svc unreachable      → bundle persisted to game_pending_bundles
//   - HMAC misconfigured      → log WARN, skip post, persist to DLQ
//   - Sample list incomplete  → emit partial bundle with `partial=true`
//   - Bundle too large        → split per-cohort into smaller envelopes
//
// The aggregator is OPPORTUNISTIC: it runs from inside AnalyticsAlerts'
// scheduler tick (same leader-elected path as the 3h Discord summary),
// so we don't need a real cron facility. A separate manual RPC
// (`insights_aggregator_tick`) is exposed for ops debugging.

namespace InsightsAggregator {

  // analytics.js writes both analytics_events and analytics_rpc_samples under
  // SYSTEM_USER (Nakama's "00000000-..." sentinel). storageList must query the
  // same userId or it returns an empty result set.
  var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  export var EVENTS_COLLECTION = "analytics_events";
  export var SAMPLE_COLLECTION = "analytics_rpc_samples";
  export var STATE_KEY = "insights_aggregator_last_run";
  export var STATE_COLLECTION = "analytics_state";

  // Hourly bucket — keep small so a single missed run can be replayed
  // cheaply. Operators can dial via env IVX_INSIGHTS_BUCKET_MS.
  export var DEFAULT_BUCKET_MS = 60 * 60 * 1000;
  export var MAX_BUCKETS_PER_TICK = 6; // catch up at most 6h on each tick
  export var MIN_TICK_INTERVAL_MS = 10 * 60 * 1000;

  // Bound how many sample rows we scan per bucket — protects the host
  // RPC from a runaway storage scan if the buffer flush stalled.
  export var MAX_SAMPLES_PER_BUCKET = 5000;
  export var MAX_EVENTS_PER_BUCKET = 5000;

  // Per-bundle size cap. Each cohort gets its own envelope; if the
  // serialised bundle exceeds this, downstream insight quality suffers
  // because we've stuffed too many distinct user paths into one. Split.
  export var MAX_BUNDLE_BYTES = 64 * 1024;

  interface SampleRow {
    ts: number;
    rpc: string;
    durMs: number;
    ok: boolean;
    userIdHash?: string;
    cohortLabel?: string;
    quizMode?: string;
    quizCardType?: string;
    screen?: string;
    os?: string;
    appVersion?: string;
    country?: string;
    tier?: string;
    costUsd?: number;
    tokensIn?: number;
    tokensOut?: number;
  }

  interface CohortKey {
    gameId: string;
    cohortLabel: string;
    quizMode: string;
  }

  interface CohortAggregate {
    key: CohortKey;
    rpcCalls: number;
    rpcOk: number;
    rpcDurations: number[];
    topErrors: { [rpc: string]: number };
    eventCounts: { [evt: string]: number };
    cards: { [card: string]: number };
    osBreakdown: { [os: string]: number };
    appVersionBreakdown: { [v: string]: number };
    countryBreakdown: { [c: string]: number };
    tierBreakdown: { [t: string]: number };
    distinctUsers: { [hash: string]: boolean };
    distinctSessions: { [sid: string]: boolean };
    llmTokensIn: number;
    llmTokensOut: number;
    llmCostUsd: number;
    llmCalls: number;
    sampleCount: number;
    eventCount: number;
  }

  interface InsightBundle {
    schemaVersion: number;
    bucketStartMs: number;
    bucketEndMs: number;
    gameId: string;
    cohortLabel: string;
    quizMode: string;
    aggregate: {
      rpcCalls: number;
      rpcSuccessRate: number;
      rpcP50Ms: number;
      rpcP90Ms: number;
      rpcP99Ms: number;
      topErrors: Array<{ rpc: string; count: number }>;
      topEvents: Array<{ event: string; count: number }>;
      topCards: Array<{ card: string; count: number }>;
      osBreakdown: Array<{ key: string; count: number }>;
      appVersionBreakdown: Array<{ key: string; count: number }>;
      countryBreakdown: Array<{ key: string; count: number }>;
      tierBreakdown: Array<{ key: string; count: number }>;
      distinctUsers: number;
      distinctSessions: number;
      llmTokensIn: number;
      llmTokensOut: number;
      llmCostUsd: number;
      llmCalls: number;
      partial: boolean;
      // Phase 3 (qv-insights-loop): top crash patterns lifted from
      // game_crash_pattern_summary[gameId]. We only attach to the
      // _global cohort bundle (one per gameId per bucket) to keep
      // the per-cohort envelope size bounded.
      topCrashPatterns?: Array<{
        fingerprint: string;
        type: string;
        count: number;
        sampleMessage: string;
        firstSeenIso: string;
        lastSeenIso: string;
        topAppVersion?: string;
        topOs?: string;
      }>;
    };
    /** ISO8601 of bucketStartMs — analyst cites this in every claim. */
    bucketStartIso: string;
    bucketEndIso: string;
    /** Citation hint — the source storage collection key prefix. */
    sourceCitation: string;
    /** Stable bundle id so retries are idempotent on the AI svc side. */
    bundleId: string;
  }

  /**
   * Aggregator config — read once from env at module init and passed in
   * so the per-tick path is ctx-free (the wrapped scheduler tick path
   * doesn't have an nkruntime.Context).
   */
  export interface AggregatorConfig {
    aiSvcBaseUrl: string;
    insightsSecret: string;
    qvOpsWebhookUrl: string;
    bucketMs?: number;
  }

  var moduleConfig: AggregatorConfig = {
    aiSvcBaseUrl: "",
    insightsSecret: "",
    qvOpsWebhookUrl: "",
    bucketMs: DEFAULT_BUCKET_MS,
  };

  /** Init from env — call from AnalyticsAlerts.init / InitModule. */
  export function init(ctx: nkruntime.Context, logger: nkruntime.Logger): void {
    try {
      moduleConfig.aiSvcBaseUrl = (ctx.env && ctx.env["IVX_AI_SVC_BASE_URL"]) || "";
      moduleConfig.insightsSecret = (ctx.env && ctx.env["IVX_INSIGHTS_SHARED_SECRET"]) || "";
      moduleConfig.qvOpsWebhookUrl = (ctx.env && ctx.env["DISCORD_QV_OPS_WEBHOOK_URL"])
        || (ctx.env && ctx.env["DISCORD_NAKAMA_WEBHOOK_URL"]) || "";
      var raw = (ctx.env && ctx.env["IVX_INSIGHTS_BUCKET_MS"]) || "";
      var n = raw ? Number(raw) : 0;
      moduleConfig.bucketMs = (Number.isFinite(n) && n > 60_000) ? n : DEFAULT_BUCKET_MS;
      logger.info("[InsightsAggregator] init ai_svc=%s secret=%s bucket_ms=%s",
        moduleConfig.aiSvcBaseUrl ? "configured" : "MISSING (IVX_AI_SVC_BASE_URL)",
        moduleConfig.insightsSecret ? "configured" : "MISSING (IVX_INSIGHTS_SHARED_SECRET)",
        String(moduleConfig.bucketMs));
    } catch (e: any) {
      logger.warn("[InsightsAggregator] init failed: " +
        (e && e.message ? e.message : String(e)));
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Public entry point — called from AnalyticsAlerts scheduler tick.
  // ────────────────────────────────────────────────────────────────────
  export function maybeRun(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
  ): { ran: boolean; bucketsProcessed: number; bundlesEmitted: number; reason: string } {
    var bucketMs = moduleConfig.bucketMs || DEFAULT_BUCKET_MS;
    if (!moduleConfig.aiSvcBaseUrl) {
      return { ran: false, bucketsProcessed: 0, bundlesEmitted: 0, reason: "ai_svc_url_unset" };
    }
    var lastRun = readLastRun(nk);
    var now = Date.now();
    if (lastRun > 0 && now - lastRun < MIN_TICK_INTERVAL_MS) {
      return { ran: false, bucketsProcessed: 0, bundlesEmitted: 0, reason: "cooldown" };
    }
    var lastBucketStart = bucketAlign(lastRun || (now - bucketMs * 2), bucketMs);
    var nowAligned = bucketAlign(now, bucketMs);
    var bucketsProcessed = 0;
    var bundlesEmitted = 0;
    // Process every CLOSED bucket since lastRun (cap MAX_BUCKETS_PER_TICK).
    for (var b = lastBucketStart; b < nowAligned && bucketsProcessed < MAX_BUCKETS_PER_TICK; b += bucketMs) {
      try {
        var emitted = processBucket(nk, logger, b, b + bucketMs);
        bundlesEmitted += emitted;
        bucketsProcessed++;
      } catch (e: any) {
        logger.warn("[InsightsAggregator] bucket " + new Date(b).toISOString() +
          " failed: " + (e && e.message ? e.message : String(e)));
      }
    }
    // Opportunistic DLQ drain on every tick. This is what turns the
    // "AI svc rolling restart drops in-flight ingests" failure mode
    // (qv-ops 2026-04-28T19:37 alert) from a manual-replay incident
    // into a self-healing transient — the next aggregator tick replays
    // every bundle that was parked while the AI svc was down.
    //
    // Guarded by `typeof PendingBundles` so a missing/renamed module
    // doesn't break the aggregator path; failure is logged and the
    // tick still returns ok.
    var dlqDrained = 0;
    var dlqDeadLetters = 0;
    try {
      if (typeof PendingBundles !== "undefined" && PendingBundles
        && typeof PendingBundles.drain === "function") {
        var dr = PendingBundles.drain(nk, logger, function (bundle: any): boolean {
          return postBundle(nk, logger, bundle);
        });
        dlqDrained = (dr && dr.drained) || 0;
        dlqDeadLetters = (dr && dr.deadLetters) || 0;
        if (dlqDrained > 0 || dlqDeadLetters > 0) {
          logger.info("[InsightsAggregator] DLQ drain on tick: drained=" +
            dlqDrained + " deadLetters=" + dlqDeadLetters);
        }
      }
    } catch (e: any) {
      logger.warn("[InsightsAggregator] DLQ drain on tick failed: " +
        (e && e.message ? e.message : String(e)));
    }
    writeLastRun(nk, now);
    return { ran: true, bucketsProcessed: bucketsProcessed, bundlesEmitted: bundlesEmitted, reason: "ok" };
  }

  /** Expose the active poster so PendingBundles.drain can replay using
   * the same config (HMAC secret + base URL) without re-reading env. */
  export function postBundleNow(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    bundle: any,
  ): boolean {
    return postBundle(nk, logger, bundle);
  }

  function processBucket(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    bucketStart: number,
    bucketEnd: number,
  ): number {
    var aggregates: { [k: string]: CohortAggregate } = {};
    var partial = false;

    // Pull bounded slice of samples written into analytics_rpc_samples.
    var sampleRows: SampleRow[] = [];
    try {
      var listRes = nk.storageList(SYSTEM_USER, SAMPLE_COLLECTION, MAX_SAMPLES_PER_BUCKET);
      var objs = (listRes && (listRes as any).objects) || [];
      if (objs.length >= MAX_SAMPLES_PER_BUCKET) partial = true;
      for (var i = 0; i < objs.length; i++) {
        var v: any = objs[i].value;
        if (!v || !v.samples) continue;
        for (var s = 0; s < v.samples.length; s++) {
          var row = v.samples[s];
          if (!row || row.ts < bucketStart || row.ts >= bucketEnd) continue;
          sampleRows.push(row);
        }
      }
    } catch (e: any) {
      logger.warn("[InsightsAggregator] sample scan failed: " +
        (e && e.message ? e.message : String(e)));
      partial = true;
    }

    // Bucket events too — analytics.js writes one row per event under
    // `analytics_events` (system user, key contains gameId + day + event
    // name). We don't have a dense secondary index by ts so we sample
    // the last MAX_EVENTS_PER_BUCKET keys, intersected with the bucket
    // timestamp range. Aggregator's job is signal density, not exhaustive
    // counts — the dashboard already does that.
    var eventRows: any[] = [];
    try {
      var elRes = nk.storageList(SYSTEM_USER, EVENTS_COLLECTION, MAX_EVENTS_PER_BUCKET);
      var eObjs = (elRes && (elRes as any).objects) || [];
      if (eObjs.length >= MAX_EVENTS_PER_BUCKET) partial = true;
      for (var ei = 0; ei < eObjs.length; ei++) {
        var ev: any = eObjs[ei].value;
        if (!ev || !ev.unixTimestamp) continue;
        var tsMs = ev.unixTimestamp * 1000;
        if (tsMs < bucketStart || tsMs >= bucketEnd) continue;
        eventRows.push(ev);
      }
    } catch (e: any) {
      logger.warn("[InsightsAggregator] event scan failed: " +
        (e && e.message ? e.message : String(e)));
      partial = true;
    }

    // Aggregate samples by (gameId, cohortLabel, quizMode).
    for (var rIdx = 0; rIdx < sampleRows.length; rIdx++) {
      var sRow = sampleRows[rIdx];
      // Without a gameId on the sample row we can't bucket — fall back
      // to a synthetic group based on the rpc id prefix so we still
      // surface the calls in a generic envelope.
      var gid = inferGameIdFromRpc(sRow.rpc) || "unknown";
      var cl = sRow.cohortLabel || "pending";
      var qm = sRow.quizMode || "_none";
      var key = gid + "::" + cl + "::" + qm;
      var agg = aggregates[key] || newAggregate(gid, cl, qm);
      agg.rpcCalls++;
      if (sRow.ok) agg.rpcOk++;
      agg.rpcDurations.push(sRow.durMs);
      if (!sRow.ok) {
        agg.topErrors[sRow.rpc] = (agg.topErrors[sRow.rpc] || 0) + 1;
      }
      if (sRow.quizCardType) agg.cards[sRow.quizCardType] = (agg.cards[sRow.quizCardType] || 0) + 1;
      if (sRow.os) agg.osBreakdown[sRow.os] = (agg.osBreakdown[sRow.os] || 0) + 1;
      if (sRow.appVersion) agg.appVersionBreakdown[sRow.appVersion] = (agg.appVersionBreakdown[sRow.appVersion] || 0) + 1;
      if (sRow.country) agg.countryBreakdown[sRow.country] = (agg.countryBreakdown[sRow.country] || 0) + 1;
      if (sRow.tier) agg.tierBreakdown[sRow.tier] = (agg.tierBreakdown[sRow.tier] || 0) + 1;
      if (sRow.userIdHash) agg.distinctUsers[sRow.userIdHash] = true;
      if (typeof sRow.costUsd === "number") {
        agg.llmCalls++;
        agg.llmCostUsd += sRow.costUsd;
        agg.llmTokensIn += sRow.tokensIn || 0;
        agg.llmTokensOut += sRow.tokensOut || 0;
      }
      agg.sampleCount++;
      aggregates[key] = agg;
    }

    // Aggregate events into the same (game, cohort, mode) buckets.
    for (var ei2 = 0; ei2 < eventRows.length; ei2++) {
      var ev = eventRows[ei2];
      var gid2 = ev.gameId || "unknown";
      var cl2 = (ev.eventData && ev.eventData.cohort_label) || "pending";
      var qm2 = (ev.eventData && ev.eventData.quiz_mode) || "_none";
      var key2 = gid2 + "::" + cl2 + "::" + qm2;
      var agg2 = aggregates[key2] || newAggregate(gid2, cl2, qm2);
      agg2.eventCounts[ev.eventName] = (agg2.eventCounts[ev.eventName] || 0) + 1;
      if (ev.eventData && ev.eventData.quiz_card_type) {
        agg2.cards[ev.eventData.quiz_card_type] = (agg2.cards[ev.eventData.quiz_card_type] || 0) + 1;
      }
      if (ev.sessionId) agg2.distinctSessions[ev.sessionId] = true;
      if (ev.userId) {
        // We don't have userIdHash on the event row — use raw userId for
        // the distinct count then drop it before serialising.
        agg2.distinctUsers[ev.userId] = true;
      }
      agg2.eventCount++;
      aggregates[key2] = agg2;
    }

    // Emit one bundle per cohort. INSIGHT_MIN_COHORT_N suppression is
    // enforced AI-side (the analyst sees the row but knows not to make
    // confident claims about cohorts with <25 distinct users).
    // Phase 3 (qv-insights-loop): prefetch the per-game crash pattern
    // summary once per processBucket so the per-cohort serialisation
    // path can attach the top patterns to the (gameId, _global, _none)
    // bundle without re-reading storage for every cohort.
    var crashByGame: { [gid: string]: any[] } = {};
    if (typeof QvCrashHandler !== "undefined" && QvCrashHandler
      && typeof QvCrashHandler.readPatternSummary === "function") {
      var seenGids: { [g: string]: boolean } = {};
      for (var bgk in aggregates) {
        if (!aggregates.hasOwnProperty(bgk)) continue;
        var ggid = aggregates[bgk].key.gameId;
        if (seenGids[ggid]) continue;
        seenGids[ggid] = true;
        var sum = QvCrashHandler.readPatternSummary(nk, ggid);
        if (sum && sum.patterns) {
          crashByGame[ggid] = sum.patterns;
        }
      }
    }

    var emitted = 0;
    for (var bk in aggregates) {
      if (!aggregates.hasOwnProperty(bk)) continue;
      var aggForBundle = aggregates[bk];
      var bundle = serialiseAggregate(aggForBundle, bucketStart, bucketEnd, partial);
      // Attach crash patterns ONLY to the global/no-mode bundle per
      // game to avoid duplicating ~25 rows × N cohorts.
      if (aggForBundle.key.cohortLabel === "pending" && aggForBundle.key.quizMode === "_none") {
        var patterns = crashByGame[aggForBundle.key.gameId];
        if (patterns && patterns.length > 0) {
          bundle.aggregate.topCrashPatterns = patterns.slice(0, 8).map(function (p: any) {
            return {
              fingerprint: p.fingerprint,
              type: p.type,
              count: p.count,
              sampleMessage: (p.sampleMessage || "").slice(0, 240),
              firstSeenIso: new Date(p.firstSeenMs).toISOString(),
              lastSeenIso: new Date(p.lastSeenMs).toISOString(),
              topAppVersion: topKey(p.appVersions),
              topOs: topKey(p.osBreakdown),
            };
          });
        }
      }
      if (postBundle(nk, logger, bundle)) {
        emitted++;
      } else {
        // Persist to DLQ on failure — Phase 6 drains.
        if (typeof PendingBundles !== "undefined" && PendingBundles && typeof PendingBundles.enqueue === "function") {
          PendingBundles.enqueue(nk, logger, bundle);
        }
      }
    }
    return emitted;
  }

  function newAggregate(gameId: string, cohortLabel: string, quizMode: string): CohortAggregate {
    return {
      key: { gameId: gameId, cohortLabel: cohortLabel, quizMode: quizMode },
      rpcCalls: 0,
      rpcOk: 0,
      rpcDurations: [],
      topErrors: {},
      eventCounts: {},
      cards: {},
      osBreakdown: {},
      appVersionBreakdown: {},
      countryBreakdown: {},
      tierBreakdown: {},
      distinctUsers: {},
      distinctSessions: {},
      llmTokensIn: 0,
      llmTokensOut: 0,
      llmCostUsd: 0,
      llmCalls: 0,
      sampleCount: 0,
      eventCount: 0,
    };
  }

  function topNFromMap(m: { [k: string]: number }, n: number): Array<{ key: string; count: number }> {
    var rows: Array<{ key: string; count: number }> = [];
    for (var k in m) {
      if (m.hasOwnProperty(k)) rows.push({ key: k, count: m[k] });
    }
    rows.sort(function (a, b) { return b.count - a.count; });
    return rows.slice(0, n);
  }

  function serialiseAggregate(
    agg: CohortAggregate,
    bucketStart: number,
    bucketEnd: number,
    partial: boolean,
  ): InsightBundle {
    var sorted = agg.rpcDurations.slice().sort(function (a, b) { return a - b; });
    var p = function (frac: number): number {
      if (sorted.length === 0) return 0;
      var idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * frac)));
      return sorted[idx];
    };
    var bundleId = agg.key.gameId + "_" + agg.key.cohortLabel + "_" + agg.key.quizMode +
      "_" + bucketStart;
    return {
      schemaVersion: 1,
      bucketStartMs: bucketStart,
      bucketEndMs: bucketEnd,
      gameId: agg.key.gameId,
      cohortLabel: agg.key.cohortLabel,
      quizMode: agg.key.quizMode,
      bucketStartIso: new Date(bucketStart).toISOString(),
      bucketEndIso: new Date(bucketEnd).toISOString(),
      sourceCitation: "storage://" + SAMPLE_COLLECTION + "+" + EVENTS_COLLECTION,
      bundleId: bundleId,
      aggregate: {
        rpcCalls: agg.rpcCalls,
        rpcSuccessRate: agg.rpcCalls > 0 ? (agg.rpcOk / agg.rpcCalls) : 1,
        rpcP50Ms: p(0.5),
        rpcP90Ms: p(0.9),
        rpcP99Ms: p(0.99),
        topErrors: topNFromMap(agg.topErrors, 8).map(function (r) {
          return { rpc: r.key, count: r.count };
        }),
        topEvents: topNFromMap(agg.eventCounts, 12).map(function (r) {
          return { event: r.key, count: r.count };
        }),
        topCards: topNFromMap(agg.cards, 8).map(function (r) {
          return { card: r.key, count: r.count };
        }),
        osBreakdown: topNFromMap(agg.osBreakdown, 6),
        appVersionBreakdown: topNFromMap(agg.appVersionBreakdown, 6),
        countryBreakdown: topNFromMap(agg.countryBreakdown, 8),
        tierBreakdown: topNFromMap(agg.tierBreakdown, 6),
        distinctUsers: Object.keys(agg.distinctUsers).length,
        distinctSessions: Object.keys(agg.distinctSessions).length,
        llmTokensIn: agg.llmTokensIn,
        llmTokensOut: agg.llmTokensOut,
        llmCostUsd: agg.llmCostUsd,
        llmCalls: agg.llmCalls,
        partial: partial,
      },
    };
  }

  function postBundle(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    bundle: any,
  ): boolean {
    if (!moduleConfig.aiSvcBaseUrl) return false;
    var body = JSON.stringify(bundle);
    if (body.length > MAX_BUNDLE_BYTES) {
      // Hard cap — trim non-critical breakdown arrays in place.
      bundle.aggregate.topEvents = (bundle.aggregate.topEvents || []).slice(0, 6);
      bundle.aggregate.topCards = (bundle.aggregate.topCards || []).slice(0, 4);
      bundle.aggregate.countryBreakdown = (bundle.aggregate.countryBreakdown || []).slice(0, 4);
      body = JSON.stringify(bundle);
    }
    var url = moduleConfig.aiSvcBaseUrl.replace(/\/$/, "") + "/insights/ingest";
    var ts = String(Date.now());
    var sig = computeBundleHmac(nk, ts, "/insights/ingest", body, logger);
    if (!sig) {
      // No secret → can't authenticate; leave for DLQ.
      return false;
    }
    try {
      var resp: any = nk.httpRequest(url, "post", {
        "Content-Type": "application/json",
        "X-IVX-Service": "nakama",
        "X-IVX-Timestamp": ts,
        "X-IVX-Signature": sig,
      }, body, 8000);
      var code = (resp && resp.code) ? resp.code : 0;
      if (code >= 200 && code < 300) return true;
      logger.warn("[InsightsAggregator] /insights/ingest non-2xx: code=" + code +
        " body=" + ((resp && resp.body) ? String(resp.body).slice(0, 200) : ""));
      return false;
    } catch (e: any) {
      logger.warn("[InsightsAggregator] post failed: " +
        (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  function computeBundleHmac(
    nk: nkruntime.Nakama,
    ts: string,
    path: string,
    body: string,
    logger: nkruntime.Logger,
  ): string {
    var secret = moduleConfig.insightsSecret;
    if (!secret) {
      logger.warn("[InsightsAggregator] IVX_INSIGHTS_SHARED_SECRET unset; skipping post");
      return "";
    }
    try {
      var raw = nk.hmacSha256Hash(ts + ":" + path + ":" + body, secret);
      return nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      logger.warn("[InsightsAggregator] hmac failed: " +
        (e && e.message ? e.message : String(e)));
      return "";
    }
  }

  /** Expose the qv-ops webhook for ops alerts (e.g. DLQ dead-letters). */
  export function getQvOpsWebhookUrl(): string {
    return moduleConfig.qvOpsWebhookUrl;
  }

  function readLastRun(nk: nkruntime.Nakama): number {
    try {
      var rows = nk.storageRead([{ collection: STATE_COLLECTION, key: STATE_KEY, userId: "00000000-0000-0000-0000-000000000000" }]);
      if (rows && rows.length > 0 && rows[0].value && (rows[0].value as any).ts) {
        return (rows[0].value as any).ts as number;
      }
    } catch (_) {}
    return 0;
  }

  function writeLastRun(nk: nkruntime.Nakama, ts: number): void {
    try {
      nk.storageWrite([{
        collection: STATE_COLLECTION,
        key: STATE_KEY,
        userId: "00000000-0000-0000-0000-000000000000",
        value: { ts: ts },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) {}
  }

  function bucketAlign(t: number, bucketMs: number): number {
    return Math.floor(t / bucketMs) * bucketMs;
  }

  function topKey(m: { [k: string]: number } | undefined): string | undefined {
    if (!m) return undefined;
    var bestK: string | undefined;
    var bestV = -1;
    for (var k in m) {
      if (!m.hasOwnProperty(k)) continue;
      if (m[k] > bestV) { bestV = m[k]; bestK = k; }
    }
    return bestK;
  }

  /**
   * Best-effort game-id inference for samples that lack the optional
   * `cohortLabel` / metadata. Mirrors the slug aliases in analytics.js.
   * Returns null when the rpc id doesn't match a known prefix.
   */
  function inferGameIdFromRpc(rpc: string): string | null {
    if (!rpc) return null;
    if (rpc.indexOf("quizverse_") === 0) return "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    if (rpc.indexOf("lasttolive_") === 0) return "8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c";
    if (rpc.indexOf("cricket_") === 0) return "cricket";
    return null;
  }

  function rpcTick(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string,
  ): string {
    // Allow ops-triggered re-init in case env got refreshed via secret rotation.
    if (!moduleConfig.aiSvcBaseUrl || !moduleConfig.insightsSecret) {
      init(ctx, logger);
    }
    var res = maybeRun(nk, logger);
    return JSON.stringify({ success: true, data: res });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("insights_aggregator_tick", rpcTick);
  }
}
