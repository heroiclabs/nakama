// analytics_hardening.js — Phase 8 (2026-05) Enforcement + Hardening.
//
// Goal: move from warning mode to production enforcement, add observable
// health signals, and give operators a single RPC to check the full
// analytics pipeline in one call.
//
// ─── What this module does ───────────────────────────────────────────────────
//
//   The enforcement logic itself lives in analytics.js (eventNameSafety,
//   schema enforcement env toggle, PII scrubbing). This module provides
//   three OBSERVABILITY RPCs that tell operators whether enforcement is
//   working, how fresh the data is, and whether the end-to-end pipeline
//   is healthy.
//
// ─── Registered RPCs (all admin-gated) ───────────────────────────────────────
//
//   analytics_freshness_check
//     Reports time-since-last for each pipeline stage:
//       · Last event ingested (from analytics_events scan)
//       · Last nightly rollup run (from analytics_rollup_meta)
//       · Last Satori identity sync (from analytics_satori_id_state)
//       · Last external poll (from external_analytics_last_poll)
//       · Last firecrawl run (from firecrawl_meta)
//       · Last data quality check (from analytics_data_quality meta)
//     Returns a "status" for each: fresh / stale / missing.
//     Thresholds:  rollup > 26 h = stale,  events > 2 h = stale,
//                  Satori sync > 48 h = stale.
//
//   analytics_health
//     End-to-end health check:
//       · Write a synthetic test event (event_name="health_check") via
//         rpcAnalyticsLogEvent (if available), measure round-trip ms.
//       · Read rollup_meta doc to confirm rollup is not stale.
//       · Probe Satori connectivity via sdSelfCheck (if available).
//       · Verify the tracking plan module is loaded (tpValidateV2 present).
//       · Verify enforcement flag state.
//     Returns overall status: "healthy" / "degraded" / "critical" with
//     per-check results and latency measurements.
//
//   analytics_enforcement_status
//     Shows the current enforcement configuration and recent violation counts:
//       · ANALYTICS_ENFORCE_SCHEMA on/off
//       · ANALYTICS_STRICT_EVENTS on/off (future — shows warning if enabled)
//       · Today's rejected event count from metrics counter
//       · Today's v2 warning count from metrics counter
//       · Sample recent warnings (from analytics_metrics)
//     Designed to be called before switching from warning to enforcement mode.
//
// ─── Environment variables read ──────────────────────────────────────────────
//
//   ANALYTICS_ENFORCE_SCHEMA   "true"/"false"  — enforcement mode (Phase 8)
//   DASHBOARD_SECRET           admin auth fallback
//
// ─── Staleness thresholds ─────────────────────────────────────────────────────
//
//   Pipeline stage        Stale after    Critical after
//   ─────────────────     ──────────     ──────────────
//   event_ingest          2 h            6 h
//   daily_rollup          26 h           50 h
//   satori_identity_sync  48 h           96 h
//   external_poll         26 h           50 h
//   firecrawl             never (optional)

var AH_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AH_ADMIN_COLLECTION       = "admin_users";
var AH_EVENTS_COLLECTION      = "analytics_events";
var AH_ROLLUP_META_COLLECTION = "analytics_rollup_meta";
var AH_METRICS_COLLECTION     = "analytics_metrics_counters"; // Fix #1: was missing trailing 's'
var AH_SATORI_ID_COLLECTION   = "analytics_satori_id_state";
var AH_EXT_POLL_COLLECTION    = "external_analytics_last_poll";
var AH_FC_META_COLLECTION     = "firecrawl_meta";
var AH_SEG_META_COLLECTION    = "analytics_segments_meta";

var AH_THRESHOLDS = {
    event_ingest:         { stale: 7200,   critical: 21600  }, // 2h / 6h
    daily_rollup:         { stale: 93600,  critical: 180000 }, // 26h / 50h
    satori_identity_sync: { stale: 172800, critical: 345600 }, // 48h / 96h
    external_poll:        { stale: 93600,  critical: 180000 }, // 26h / 50h
    satori_segments:      { stale: 93600,  critical: 180000 }  // 26h / 50h
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ahParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function ahOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
    return JSON.stringify(out);
}

function ahErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function ahEnv(ctx, key) {
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
    }
    try {
        if (ctx && ctx.env && ctx.env[key]) {
            var v = String(ctx.env[key]).trim();
            if (v.length > 0) return v;
        }
    } catch (e) { /* */ }
    return "";
}

function ahIsAdmin(ctx, nk) {
    if (!ctx.userId) return false;
    if (ctx.userId === AH_SYSTEM_USER) return true;
    if (!ctx.username || ctx.username.indexOf("admin:") !== 0) return false;
    try {
        var recs = nk.storageRead([{ collection: AH_ADMIN_COLLECTION, key: "profile", userId: ctx.userId }]);
        if (!recs || recs.length === 0) return false;
        var r = recs[0].value || {};
        if (!r.isAdmin) return false;
        if (r.expiresAt && r.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function ahRequireAdmin(ctx, nk, data) {
    var secret = ahEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (ahIsAdmin(ctx, nk)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function ahReadOne(nk, collection, key, userId) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: userId || AH_SYSTEM_USER }]);
        return (r && r.length > 0) ? (r[0].value || null) : null;
    } catch (e) { return null; }
}

function ahNowSec() { return Math.floor(Date.now() / 1000); }
function ahIsoNow() { return new Date().toISOString(); }

function ahIsoToSec(iso) {
    if (!iso) return null;
    try { var d = new Date(iso); return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000); }
    catch (e) { return null; }
}

// Convert age in seconds to a human-readable string ("3h 12m", "27d", etc.)
function ahAge(ageSeconds) {
    if (ageSeconds === null || ageSeconds === undefined) return null;
    if (ageSeconds < 0)    return "0s";
    if (ageSeconds < 60)   return ageSeconds + "s";
    if (ageSeconds < 3600) return Math.floor(ageSeconds / 60) + "m";
    if (ageSeconds < 86400) {
        var h = Math.floor(ageSeconds / 3600);
        var m = Math.floor((ageSeconds % 3600) / 60);
        return h + "h " + m + "m";
    }
    return Math.floor(ageSeconds / 86400) + "d " + Math.floor((ageSeconds % 86400) / 3600) + "h";
}

// Classify a stage's freshness using AH_THRESHOLDS.
function ahFreshnessStatus(stage, lastSec) {
    var nowSec = ahNowSec();
    if (!lastSec) return { status: "missing", age_sec: null, age_human: null };
    var age = nowSec - lastSec;
    var t   = AH_THRESHOLDS[stage];
    var status;
    if (!t)               status = "fresh";
    else if (age > t.critical) status = "critical";
    else if (age > t.stale)    status = "stale";
    else                       status = "fresh";
    return { status: status, age_sec: age, age_human: ahAge(age), last_at: new Date(lastSec * 1000).toISOString() };
}

// ─── RPC: analytics_freshness_check ──────────────────────────────────────────

/**
 * Reports pipeline freshness for each stage.
 * Payload: { game_id? } — optional game_id for rollup-specific check.
 */
function rpcAnalyticsFreshnessCheck(ctx, logger, nk, payload) {
    var data = ahParse(payload);
    var gate = ahRequireAdmin(ctx, nk, data);
    if (!gate.ok) return ahErr(gate.reason, 401);

    var gameId = data.game_id || data.gameId || "all";
    var stages = {};

    // ── 1. Event ingest — last event ingested today (any game). ─────────
    // We use analytics_live_daily/live_all_<today>.last_event_at as the
    // truth source because it's the same counter liveCountersUpdate() ticks
    // on every accepted event. The previous implementation scanned
    // analytics_events under SYSTEM_USER, but the dash_* docs are owned by
    // the firing player, so the scan returned ~nothing and the panel
    // displayed a 1970-01-01 epoch timestamp.
    var lastEventSec = null;
    try {
        var liveAllKey = "live_all_" + new Date().toISOString().slice(0, 10);
        var liveAllDoc = ahReadOne(nk, "analytics_live_daily", liveAllKey, AH_SYSTEM_USER);
        if (liveAllDoc && liveAllDoc.last_event_at) {
            lastEventSec = parseInt(liveAllDoc.last_event_at, 10) || null;
        }
    } catch (e) { /* */ }
    stages.event_ingest = ahFreshnessStatus("event_ingest", lastEventSec);

    // ── 1b. Live counters (analytics_live_daily for today) ─────────────
    // A missing or stale live_counters stage means liveCountersUpdate() in
    // analytics.js is failing or events aren't flowing yet today.
    var todayLiveKey = "live_" + (gameId === "all" ? "all" : gameId) + "_" + new Date().toISOString().slice(0, 10);
    var liveCounterDoc = ahReadOne(nk, "analytics_live_daily", todayLiveKey, AH_SYSTEM_USER);
    var lastLiveSec = liveCounterDoc ? (liveCounterDoc.last_event_at || null) : null;
    stages.live_counters = {
        status:         liveCounterDoc ? "fresh" : "missing",
        total_events:   liveCounterDoc ? (liveCounterDoc.total || 0) : 0,
        last_event_at:  lastLiveSec ? new Date(lastLiveSec * 1000).toISOString() : null,
        age_human:      lastLiveSec ? ahAge(ahNowSec() - lastLiveSec) : null,
        note:           liveCounterDoc
            ? "Live counters flowing (" + (liveCounterDoc.total || 0) + " events today)"
            : "No live counter doc yet today — fire any event to populate"
    };

    // ── 2. Daily rollup ─────────────────────────────────────────────────
    var rollupMeta = ahReadOne(nk, AH_ROLLUP_META_COLLECTION, "last_success", AH_SYSTEM_USER);
    var lastRollupSec = rollupMeta ? ahIsoToSec(rollupMeta.timestamp) : null;
    stages.daily_rollup = ahFreshnessStatus("daily_rollup", lastRollupSec);
    if (rollupMeta) {
        stages.daily_rollup.last_date      = rollupMeta.date          || null;
        stages.daily_rollup.events_scanned = rollupMeta.eventsScanned || null;
    }

    // ── 3. Satori identity sync ─────────────────────────────────────────
    // Check the most recent sync state doc (scan up to 1 entry).
    var lastSatoriSyncSec = null;
    try {
        var siResult = nk.storageList(AH_SYSTEM_USER, AH_SATORI_ID_COLLECTION, 1, "");
        if (siResult && siResult.objects && siResult.objects.length > 0) {
            var siDoc = siResult.objects[0].value || {};
            lastSatoriSyncSec = siDoc.synced_at || null;
        }
    } catch (e) { /* */ }
    stages.satori_identity_sync = ahFreshnessStatus("satori_identity_sync", lastSatoriSyncSec);

    // ── 4. External polls ───────────────────────────────────────────────
    var extPollMeta = ahReadOne(nk, AH_EXT_POLL_COLLECTION, "appodeal", AH_SYSTEM_USER);
    var lastExtSec  = extPollMeta ? ahIsoToSec(extPollMeta.last_polled_at || extPollMeta.timestamp) : null;
    stages.external_poll = ahFreshnessStatus("external_poll", lastExtSec);

    // ── 5. Satori segments ──────────────────────────────────────────────
    var segMeta = ahReadOne(nk, AH_SEG_META_COLLECTION, "last_run", AH_SYSTEM_USER);
    var lastSegSec = segMeta ? (segMeta.completed_at_utc || null) : null;
    stages.satori_segments = ahFreshnessStatus("satori_segments", lastSegSec);

    // ── 6. Firecrawl (optional — no threshold, just status) ─────────────
    var fcMeta = ahReadOne(nk, AH_FC_META_COLLECTION, "last_status", AH_SYSTEM_USER);
    stages.firecrawl = {
        status:    fcMeta ? "present" : "never_run",
        last_run_at: fcMeta ? fcMeta.last_run_at : null,
        run_count:   fcMeta ? (fcMeta.run_count || 0) : 0
    };

    // ── Overall pipeline status ─────────────────────────────────────────
    var overallStatus = "healthy";
    for (var sk in stages) {
        if (!Object.prototype.hasOwnProperty.call(stages, sk)) continue;
        var s = stages[sk].status;
        if (s === "critical")  { overallStatus = "critical"; break; }
        if (s === "stale" && overallStatus !== "critical") overallStatus = "degraded";
    }

    return ahOk({
        overall:    overallStatus,
        game_id:    gameId,
        stages:     stages,
        checked_at: ahIsoNow()
    });
}

// ─── RPC: analytics_health ────────────────────────────────────────────────────

/**
 * End-to-end health check with latency measurements.
 * Probes: ingest round-trip, rollup freshness, Satori connectivity,
 * tracking-plan module loaded, enforcement flag.
 *
 * Does NOT write permanent data — the synthetic health_check event is
 * written only when skip_ingest_test is false (default: true to avoid
 * polluting analytics_events in production dashboards).
 *
 * Payload: { skip_ingest_test?: bool (default true), skip_satori_test?: bool (default false) }
 */
function rpcAnalyticsHealth(ctx, logger, nk, payload) {
    var data = ahParse(payload);
    var gate = ahRequireAdmin(ctx, nk, data);
    if (!gate.ok) return ahErr(gate.reason, 401);

    var skipIngest = (data.skip_ingest_test !== false); // default: skip
    var skipSatori = (data.skip_satori_test === true);

    var checks = [];
    var nowSec = ahNowSec();

    // ── 1. Ingest round-trip ─────────────────────────────────────────────
    if (!skipIngest) {
        var ingestStart = Date.now();
        var ingestOk = false;
        var ingestMs  = null;
        var ingestErr = null;
        try {
            if (typeof rpcAnalyticsLogEvent === "function") {
                var syntheticPayload = JSON.stringify({
                    gameId:    "00000000-0000-0000-0000-000000000001",
                    eventName: "health_check",
                    eventData: { source: "analytics_health", ts: nowSec }
                });
                var result = JSON.parse(rpcAnalyticsLogEvent(ctx, logger, nk, syntheticPayload) || "{}");
                ingestOk = (result.success === true);
                ingestMs = Date.now() - ingestStart;
                if (!ingestOk) ingestErr = result.errors ? result.errors[0] : "rejected";
            } else {
                ingestErr = "rpcAnalyticsLogEvent not available";
            }
        } catch (e) {
            ingestErr = e.message;
            ingestMs  = Date.now() - ingestStart;
        }
        checks.push({
            name:   "ingest_round_trip",
            ok:     ingestOk,
            ms:     ingestMs,
            error:  ingestErr
        });
    } else {
        checks.push({ name: "ingest_round_trip", ok: true, skipped: true });
    }

    // ── 2. Rollup freshness ──────────────────────────────────────────────
    var rollupMeta = ahReadOne(nk, AH_ROLLUP_META_COLLECTION, "last_success", AH_SYSTEM_USER);
    var rollupAgeH = null;
    var rollupOk   = false;
    if (rollupMeta && rollupMeta.timestamp) {
        var rollupSec = ahIsoToSec(rollupMeta.timestamp);
        rollupAgeH    = Math.round((nowSec - rollupSec) / 3600 * 10) / 10;
        rollupOk      = rollupAgeH < 26;
    }
    checks.push({
        name:       "rollup_freshness",
        ok:         rollupOk,
        age_hours:  rollupAgeH,
        last_date:  rollupMeta ? rollupMeta.date : null,
        error:      rollupOk ? null : (rollupMeta ? ("last rollup " + rollupAgeH + "h ago") : "no rollup doc found")
    });

    // ── 3. Tracking plan module loaded ───────────────────────────────────
    var tpLoaded = (typeof tpValidateV2 === "function" && typeof tpGetPrivacyTier === "function");
    checks.push({
        name:    "tracking_plan_loaded",
        ok:      tpLoaded,
        error:   tpLoaded ? null : "tpValidateV2 or tpGetPrivacyTier not in global scope"
    });

    // ── 4. Schema enforcement flag ───────────────────────────────────────
    var enforceVal = ahEnv(ctx, "ANALYTICS_ENFORCE_SCHEMA");
    var enforcing  = (enforceVal === "true" || enforceVal === "1");
    checks.push({
        name:      "schema_enforcement",
        ok:        true, // always ok — just reporting state
        enforcing: enforcing,
        env_value: enforceVal || "(not set — defaults to warning-only)",
        note:      enforcing
            ? "ENFORCEMENT MODE: v2 events missing required fields are REJECTED."
            : "WARNING MODE: v2 schema violations are logged but events are accepted."
    });

    // ── 5. PII scrubbing active ──────────────────────────────────────────
    var piiScrubActive = (typeof AN_PII_FIELDS === "object" && AN_PII_FIELDS !== null);
    checks.push({
        name:         "pii_scrubbing",
        ok:           piiScrubActive,
        fields_count: piiScrubActive ? Object.keys(AN_PII_FIELDS).length : 0,
        error:        piiScrubActive ? null : "AN_PII_FIELDS not loaded (check analytics.js bundle)"
    });

    // ── 6. Satori connectivity ───────────────────────────────────────────
    if (!skipSatori) {
        var satoriOk  = false;
        var satoriMs  = null;
        var satoriErr = null;
        var satoriStart = Date.now();
        try {
            if (typeof sdSelfCheck === "function") {
                var satResp = sdSelfCheck(ctx, nk, logger);
                satoriOk = !!(satResp && satResp.ok);
                satoriMs = Date.now() - satoriStart;
                if (!satoriOk) satoriErr = satResp ? ("HTTP " + satResp.code) : "no response";
            } else {
                satoriErr = "sdSelfCheck not available";
            }
        } catch (e) {
            satoriErr = e.message;
            satoriMs  = Date.now() - satoriStart;
        }
        checks.push({ name: "satori_connectivity", ok: satoriOk, ms: satoriMs, error: satoriErr });
    } else {
        checks.push({ name: "satori_connectivity", ok: true, skipped: true });
    }

    // ── Overall status ───────────────────────────────────────────────────
    var allOk     = true;
    var anyFailed = false;
    for (var ci = 0; ci < checks.length; ci++) {
        if (!checks[ci].ok && !checks[ci].skipped) {
            allOk     = false;
            anyFailed = true;
        }
    }
    var overall = allOk ? "healthy" : (anyFailed ? "degraded" : "healthy");

    return ahOk({
        overall:    overall,
        checks:     checks,
        checked_at: ahIsoNow()
    });
}

// ─── RPC: analytics_enforcement_status ──────────────────────────────────────

/**
 * Shows the current enforcement configuration, schema warning counts,
 * and event rejection counts so operators can make an informed decision
 * before switching from warning to enforcement mode.
 *
 * Returns:
 *   enforce_schema      bool — current value of ANALYTICS_ENFORCE_SCHEMA
 *   today_rejected      int  — events rejected today (from metrics counter)
 *   today_v2_warnings   int  — v2 schema warnings today
 *   today_accepted      int  — events accepted today
 *   pii_scrub_fields    string[] — fields scrubbed from tier-2 events
 *   event_name_rules    object — safety rules applied to event names
 *   recommendation      string — "safe to enable enforcement" | "fix warnings first"
 */
function rpcAnalyticsEnforcementStatus(ctx, logger, nk, payload) {
    var data = ahParse(payload);
    var gate = ahRequireAdmin(ctx, nk, data);
    if (!gate.ok) return ahErr(gate.reason, 401);

    var enforceVal = ahEnv(ctx, "ANALYTICS_ENFORCE_SCHEMA");
    var enforcing  = (enforceVal === "true" || enforceVal === "1");

    // Read today's metrics counter (same shape used by analytics_metrics RPC).
    var today   = new Date().toISOString().slice(0, 10);
    // bumpMetricsCounter (analytics.js) writes under key "counter_<YYYY-MM-DD>"
    // with fields events_accepted / events_rejected (not the old accepted /
    // rejected names). Read both so we never regress when either writer ships.
    var counter = ahReadOne(nk, AH_METRICS_COLLECTION, "counter_" + today, AH_SYSTEM_USER) || {};

    var accepted    = counter.events_accepted || counter.accepted || 0;
    var rejected    = counter.events_rejected || counter.rejected || 0;
    var v2Warnings  = counter.schema_v2_warnings || 0;
    var v2Events    = counter.schema_v2_events   || 0;
    var aliasNorm   = counter.alias_normalized   || 0;

    // Rejection rate and warning density help operators assess risk.
    var totalEvents     = accepted + rejected;
    var rejectionRatePct = totalEvents > 0 ? Math.round((rejected / totalEvents) * 1000) / 10 : 0;
    var warningDensityPct = v2Events > 0 ? Math.round((v2Warnings / v2Events) * 1000) / 10 : 0;

    // PII fields list.
    var piiFields = [];
    if (typeof AN_PII_FIELDS === "object" && AN_PII_FIELDS !== null) {
        for (var pf in AN_PII_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(AN_PII_FIELDS, pf)) piiFields.push(pf);
        }
    }

    // Recommendation logic.
    var recommendation;
    if (enforcing) {
        recommendation = "Enforcement is ACTIVE. Monitor rejected counts to catch client regressions.";
    } else if (v2Warnings === 0 && v2Events > 0) {
        recommendation = "No v2 warnings today and " + v2Events + " v2 events received. " +
                         "Safe to set ANALYTICS_ENFORCE_SCHEMA=true.";
    } else if (v2Warnings > 0) {
        recommendation = "Found " + v2Warnings + " v2 schema warnings today " +
                         "(" + warningDensityPct + "% of v2 events). Fix client-side before enabling enforcement. " +
                         "Most common cause: missing client_event_id or event_time in schema_version=2 events.";
    } else {
        recommendation = "No v2 events seen today — make sure Unity clients send schema_version=2 first.";
    }

    return ahOk({
        date:              today,
        enforce_schema:    enforcing,
        env_value:         enforceVal || "(not set)",
        today_accepted:    accepted,
        today_rejected:    rejected,
        today_v2_events:   v2Events,
        today_v2_warnings: v2Warnings,
        today_alias_normalized: aliasNorm,
        rejection_rate_pct:    rejectionRatePct,
        warning_density_pct:   warningDensityPct,
        pii_scrub_active:  piiFields.length > 0,
        pii_scrub_fields:  piiFields,
        event_name_rules: {
            max_length:    128,
            allowed_chars: "a-z A-Z 0-9 _ -",
            injection_check: true,
            strict_events:   false
        },
        recommendation: recommendation,
        checked_at:     ahIsoNow()
    });
}

// ─── RPC: analytics_failed_events_recent ─────────────────────────────────────
//
// Lists the most recent rejected events (written by recordFailedEvent in
// analytics.js). Powers the dashboard's "Failed Events" panel under the
// Pipeline tab so operators can see exactly why ingestion is rejecting events
// without trawling through Nakama logs.
//
// Payload: { dashboard_secret?, limit?: 100, reason_contains?, event_name? }
// Response: {
//   success, total, returned, items:[{ key, reason, event_name, game_id,
//     user_id, client_event_id, schema_version, platform, raw_event_keys,
//     occurred_at_iso, occurred_at_unix }],
//   reason_breakdown: { "<reason>": N, ... },
//   by_event: { "<event_name>": N, ... }
// }
function rpcAnalyticsFailedEventsRecent(ctx, logger, nk, payload) {
    var data = ahParse(payload);
    var gate = ahRequireAdmin(ctx, nk, data);
    if (!gate.ok) return ahErr(gate.reason, 401);

    var limit = parseInt(data.limit, 10);
    if (!isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 500) limit = 500;

    var reasonContains = (data.reason_contains || "").toString().toLowerCase();
    var eventNameFilter = (data.event_name || "").toString();

    var items = [];
    var reasonBreak = {};
    var byEvent = {};
    var total = 0;
    var cursor = "";

    // Up to 5 pages of 100 (~500 rows scanned worst case) — we only return up
    // to `limit` filtered items to the caller.
    for (var page = 0; page < 5; page++) {
        var result = null;
        try {
            result = nk.storageList(AH_SYSTEM_USER, "analytics_failed_events", 100, cursor || "");
        } catch (e) {
            break;
        }
        if (!result || !result.objects || result.objects.length === 0) break;

        for (var i = 0; i < result.objects.length; i++) {
            var obj = result.objects[i];
            var v = obj.value || {};
            total++;

            var reason = String(v.reason || "unknown");
            reasonBreak[reason] = (reasonBreak[reason] || 0) + 1;
            var eName = v.event_name || "(none)";
            byEvent[eName] = (byEvent[eName] || 0) + 1;

            if (reasonContains && reason.toLowerCase().indexOf(reasonContains) === -1) continue;
            if (eventNameFilter && v.event_name !== eventNameFilter) continue;

            if (items.length < limit) {
                items.push({
                    key:               obj.key,
                    reason:            reason,
                    event_name:        v.event_name        || null,
                    game_id:           v.game_id           || null,
                    user_id:           v.user_id           || null,
                    client_event_id:   v.client_event_id   || null,
                    schema_version:    v.schema_version    || null,
                    platform:          v.platform          || null,
                    raw_event_keys:    Array.isArray(v.raw_event_keys) ? v.raw_event_keys : [],
                    occurred_at_iso:   v.occurred_at_iso   || null,
                    occurred_at_unix:  v.occurred_at_unix  || null
                });
            }
        }

        cursor = result.cursor || "";
        if (!cursor) break;
    }

    // Sort by occurred_at_unix DESC so newest failures surface first.
    items.sort(function (a, b) {
        return (b.occurred_at_unix || 0) - (a.occurred_at_unix || 0);
    });

    return ahOk({
        total:            total,
        returned:         items.length,
        items:            items,
        reason_breakdown: reasonBreak,
        by_event:         byEvent,
        checked_at:       ahIsoNow()
    });
}

// ─── Registration ─────────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_freshness_check",     rpcAnalyticsFreshnessCheck);
    initializer.registerRpc("analytics_health",              rpcAnalyticsHealth);
    initializer.registerRpc("analytics_enforcement_status",  rpcAnalyticsEnforcementStatus);
    initializer.registerRpc("analytics_failed_events_recent", rpcAnalyticsFailedEventsRecent);
    logger.info("[analytics_hardening] Registered: analytics_freshness_check, " +
                "analytics_health, analytics_enforcement_status, analytics_failed_events_recent. " +
                "Phase 8 hardening: event name safety + schema enforcement toggle + PII scrubbing + failed-event ring buffer active.");
}
