// analytics_tracking_plan.js — Phase 2: Schema v2 contract + data quality RPCs
//
// Provides two public helpers used by analytics.js (bundled at global scope by postbuild.js):
//   tpValidateV2(rawEvent, eventName, eventData) → { warnings: string[] }
//   tpGetPrivacyTier(eventName)                  → 0 | 1 | 2
//
// Registers two admin-gated RPCs:
//   analytics_tracking_plan  — returns the full schema v2 contract.
//   analytics_data_quality   — coverage gaps + v2 warning summary.
//
// ─── Schema v2 contract ────────────────────────────────────────────────────
//
// Every v2 event payload must include at the TOP LEVEL (not inside eventData):
//   schema_version  : 2              (integer)
//   client_event_id : "<uuid>"       (client-generated UUID for idempotent dedup)
//   event_time      : ISO-8601 | unix-seconds  (client wall-clock time)
//
// Additionally RECOMMENDED on every v2 event:
//   session_id      : "<uuid>"       (must match the enclosing session_start)
//
// For quiz-related events, also recommended:
//   quiz_session_id : "<uuid>"       (unique per play-through, NOT the lobby session)
//   screen_id       : "<string>"     (which screen originated the event)
//
// Validation is ALWAYS warning-mode: v2 events are NEVER rejected for schema
// violations.  Warnings surface in the RPC response and daily metrics counters.

var TP_SCHEMA_VERSION = 2;

// Required top-level fields on every schema_version=2 payload.
// (schema_version itself is implied; these are the extra required fields.)
var TP_V2_REQUIRED = ["client_event_id", "event_time"];

// Recommended (soft warning) on every v2 event.
var TP_V2_RECOMMENDED = ["session_id"];

// Per-event additional recommended fields in v2 (beyond TP_V2_RECOMMENDED).
var TP_V2_PER_EVENT = {
    quiz_start:       ["quiz_session_id", "screen_id"],
    quiz_complete:    ["quiz_session_id", "screen_id"],
    quiz_abandoned:   ["quiz_session_id", "screen_id"],
    question_viewed:  ["quiz_session_id", "screen_id"],
    question_result:  ["quiz_session_id"],
    answer_submitted: ["quiz_session_id"],
    answer_selected:  ["quiz_session_id"],
    hint_used:        ["quiz_session_id"],
    time_expired:     ["quiz_session_id"],
    screen_viewed:    ["screen_id"],
    screen_left:      ["screen_id"],
    button_clicked:   ["screen_id"],
    modal_shown:      ["screen_id"],
    modal_closed:     ["screen_id"],
    loading_started:  ["screen_id"],
    loading_completed:["screen_id"]
};

// Privacy tier per event name.
//   0 = unclassified (internal / technical — no PII, no external forwarding needed)
//   1 = non_pii     (safe for Satori and any external analytics sink)
//   2 = pii_risk    (may contain free-text / user-generated content — scrub before 3rd-party)
var TP_PRIVACY_TIER = {
    // ── lifecycle / session ──
    session_start:       1,
    session_end:         1,
    session_heartbeat:   0,
    app_launched:        1,
    app_open:            1,
    app_backgrounded:    0,
    app_crashed:         2,
    // ── auth ──
    login_started:       1,
    login_success:       1,
    identity_linked:     1,
    onboarded:           1,
    registration_complete: 1,
    // ── navigation ──
    screen_viewed:       1,
    screen_left:         1,
    button_clicked:      1,
    modal_shown:         1,
    modal_closed:        1,
    loading_started:     0,
    loading_completed:   0,
    // ── quiz gameplay ──
    mode_selected:       1,
    topic_selected:      1,
    quiz_start:          1,
    quiz_complete:       1,
    quiz_abandoned:      1,
    question_viewed:     1,
    question_result:     1,
    answer_submitted:    1,
    answer_selected:     1,
    answer_changed:      1,
    hint_used:           1,
    time_expired:        1,
    // ── monetisation ──
    iap_clicked:         1,
    iap_purchased:       1,
    iap_failed:          1,
    paywall_shown:       1,
    purchase_intent:     1,
    purchase_failed:     1,
    // ── ads ──
    ad_requested:        1,
    ad_shown:            1,
    ad_completed:        1,
    ad_skipped:          1,
    ad_revenue:          1,
    ad_load_failed:      1,
    ad_impression:       1,
    ad_clicked:          1,
    // ── offers / Satori ──
    offer_eligible:      1,
    offer_assigned:      1,
    offer_viewed:        1,
    offer_clicked:       1,
    offer_purchased:     1,
    offer_dismissed:     1,
    offer_cooldown_blocked: 1,
    flag_exposed:        1,
    experiment_exposed:  1,
    satori_flags_loaded: 1,
    remote_config_applied: 0,
    // ── rewards ──
    reward_claimed:      1,
    // ── retention ──
    retention_d1:        1,
    retention_d7:        1,
    retention_d30:       1,
    // ── errors / diagnostics ──
    error_logged:        2,
    api_failure:         2,
    auth_failure:        2,
    nakama_rpc_error:    2,
    timeout_event:       2,
    crash_safe_log:      2,
    ai_host_used:        0
};

// ─── Public helpers ────────────────────────────────────────────────────────

/**
 * Validate a v2 event.  ONLY called when schema_version === 2.
 * Never throws.  Returns { warnings: string[] } — empty array means clean.
 *
 * Warning codes follow the pattern:
 *   v2_required_missing:<field>        — a TP_V2_REQUIRED field is absent
 *   v2_client_event_id_too_short       — client_event_id looks malformed
 *   v2_event_time_invalid              — event_time cannot be parsed
 *   v2_event_time_out_of_range         — unix timestamp outside sane range
 *   v2_recommended_missing:<field>     — a recommended field is absent
 *
 * @param {object} rawEvent   Top-level inbound JSON object.
 * @param {string} eventName  Canonical (post-alias) event name.
 * @param {object} eventData  Resolved eventData object.
 * @returns {{ warnings: string[] }}
 */
function tpValidateV2(rawEvent, eventName, eventData) {
    var warnings = [];
    var raw = rawEvent || {};
    var ed  = eventData  || {};

    // Required top-level v2 fields.
    // Accept them either at top-level or inside eventData (some clients wrap all fields).
    for (var ri = 0; ri < TP_V2_REQUIRED.length; ri++) {
        var rf  = TP_V2_REQUIRED[ri];
        var val = raw[rf];
        if (val === undefined || val === null || val === "") val = ed[rf];
        if (val === undefined || val === null || val === "") {
            warnings.push("v2_required_missing:" + rf);
        }
    }

    // client_event_id sanity: should be at least 8 chars (UUID is 36).
    var ceid = raw.client_event_id || ed.client_event_id;
    if (ceid !== undefined && ceid !== null && ceid !== "" &&
        (typeof ceid !== "string" || ceid.length < 8)) {
        warnings.push("v2_client_event_id_too_short");
    }

    // event_time must be parseable as unix-seconds or ISO-8601.
    var et = raw.event_time || ed.event_time;
    if (et !== undefined && et !== null && et !== "") {
        if (typeof et === "number") {
            // Unix seconds: sane range is 2001-01-01 … 2100-01-01.
            if (et < 978307200 || et > 4102444800) {
                warnings.push("v2_event_time_out_of_range");
            }
        } else if (typeof et === "string") {
            var ts = parseFloat(et);
            if (!isNaN(ts)) {
                if (ts < 978307200 || ts > 4102444800) warnings.push("v2_event_time_out_of_range");
            } else {
                var d = new Date(et);
                if (isNaN(d.getTime())) warnings.push("v2_event_time_invalid");
            }
        } else {
            warnings.push("v2_event_time_invalid");
        }
    }

    // Recommended: session_id (soft warning).
    var sid = raw.session_id || ed.session_id;
    if (!sid) warnings.push("v2_recommended_missing:session_id");

    // Per-event recommended fields.
    var perEvent = TP_V2_PER_EVENT[eventName];
    if (perEvent) {
        for (var pi = 0; pi < perEvent.length; pi++) {
            var pf = perEvent[pi];
            var pv = raw[pf];
            if (pv === undefined || pv === null || pv === "") pv = ed[pf];
            if (pv === undefined || pv === null || pv === "") {
                warnings.push("v2_recommended_missing:" + pf);
            }
        }
    }

    return { warnings: warnings };
}

/**
 * Returns the privacy tier for an event name (0, 1, or 2).
 * Defaults to 1 (non-PII) for unknown event names — safe default for external sinks.
 */
function tpGetPrivacyTier(eventName) {
    if (!eventName) return 1;
    var t = TP_PRIVACY_TIER[eventName];
    return (t !== undefined && t !== null) ? t : 1;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

var TP_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var TP_ADMIN_USERS = "admin_users";

function tpParse(payload) { try { return JSON.parse(payload || "{}"); } catch (e) { return {}; } }
function tpOk(data) {
    var o = { success: true };
    if (data) { for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) o[k] = data[k]; } }
    return JSON.stringify(o);
}
function tpErr(msg, code) { return JSON.stringify({ success: false, error: msg || "error", code: code || 400 }); }
function tpEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null) return String(ctx.env[key]);
    return "";
}

function tpIsAdmin(ctx, nk, data) {
    var secret = tpEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return true;
    if (!ctx || !ctx.userId) return false;
    if (!ctx.username || ctx.username.indexOf("admin:") !== 0) return false;
    try {
        var recs = nk.storageRead([{ collection: TP_ADMIN_USERS, key: "profile", userId: ctx.userId }]);
        if (!recs || recs.length === 0) return false;
        var rec = recs[0].value || {};
        if (!rec.isAdmin) return false;
        if (rec.expiresAt && rec.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

// ─── RPC: analytics_tracking_plan ─────────────────────────────────────────

/**
 * Returns the full schema v2 contract: required/recommended fields, per-event
 * recommendations, and privacy tier map.
 *
 * Payload: {} or { dashboard_secret: "..." }
 */
function rpcAnalyticsTrackingPlan(ctx, logger, nk, payload) {
    var data = tpParse(payload);
    if (!tpIsAdmin(ctx, nk, data)) return tpErr("admin authentication required", 401);

    return tpOk({
        schema_version_current: TP_SCHEMA_VERSION,
        v2_required_top_level:  ["schema_version"].concat(TP_V2_REQUIRED),
        v2_recommended:         TP_V2_RECOMMENDED,
        v2_per_event_recommended: TP_V2_PER_EVENT,
        privacy_tiers: {
            "0": "unclassified — internal/technical, no forwarding requirement",
            "1": "non_pii — safe for Satori and any external analytics sink",
            "2": "pii_risk — may contain free-text/PII; scrub before 3rd-party forwarding"
        },
        privacy_tier_map: TP_PRIVACY_TIER,
        notes: [
            "schema_version absent or =1 means legacy v1 event — no v2 validation applied.",
            "schema_version=2 events run warning-mode validation; NEVER rejected.",
            "client_event_id: client-generated UUID per event, used for server-side dedup.",
            "event_time: client wall-clock ISO-8601 or unix-seconds. Server always adds unixTimestamp.",
            "quiz_session_id: one UUID per play-through, distinct from the lobby session_id.",
            "screen_id: which screen originated the event (e.g. 'quiz_lobby', 'quiz_result').",
            "privacy_tier=2 events are stored raw server-side but must NOT be forwarded to Satori."
        ]
    });
}

// ─── RPC: analytics_data_quality ──────────────────────────────────────────

/**
 * Returns a data-quality snapshot:
 *   - Today's schema v2 event / warning counts (from metrics counters).
 *   - Top coverage gaps from game_coverage_gap_log (EventEnricher writes these).
 *   - Top v2 warning types seen on recent stored events.
 *
 * Payload: { days?: 1-7, limit?: 1-200, dashboard_secret?: "..." }
 */
function rpcAnalyticsDataQuality(ctx, logger, nk, payload) {
    var data = tpParse(payload);
    if (!tpIsAdmin(ctx, nk, data)) return tpErr("admin authentication required", 401);

    var days  = Math.min(7,   parseInt(data.days,  10) || 1);
    var limit = Math.min(200, parseInt(data.limit, 10) || 100);

    // ── Today's metrics counter ───────────────────────────────────────────
    var today = new Date().toISOString().slice(0, 10);
    var todayC = null;
    try {
        var cr = nk.storageRead([{
            collection: "analytics_metrics_counters",
            key: "counter_" + today,
            userId: TP_SYSTEM_USER
        }]);
        if (cr && cr.length > 0) todayC = cr[0].value;
    } catch (e) { /* ignore */ }

    // ── Coverage gap log (written by EventEnricher.recordCoverageGap) ─────
    var gapsByField = {};
    var gapsByEvent = {};
    var gapTotal    = 0;
    try {
        var gapRes = nk.storageList(TP_SYSTEM_USER, "game_coverage_gap_log", limit, null);
        if (gapRes && gapRes.objects) {
            for (var gi = 0; gi < gapRes.objects.length; gi++) {
                var gobj = gapRes.objects[gi];
                var gv   = gobj && gobj.value;
                if (!gv) continue;
                gapTotal++;
                var geName = gv.eventName || "__unknown__";
                gapsByEvent[geName] = (gapsByEvent[geName] || 0) + 1;
                var gaps = gv.gaps || [];
                for (var gfi = 0; gfi < gaps.length; gfi++) {
                    var gf = gaps[gfi];
                    if (typeof gf === "string") gapsByField[gf] = (gapsByField[gf] || 0) + 1;
                }
            }
        }
    } catch (e) { /* collection may not exist yet on fresh deploys */ }

    // ── Recent v2 warnings from dash_* events ────────────────────────────
    var v2WarnTypes    = {};
    var v2EventsTotal  = 0;
    var v2WarnTotal    = 0;
    var cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    try {
        var evRes = nk.storageList(TP_SYSTEM_USER, "analytics_events",
                                   Math.min(limit, 200), null);
        if (evRes && evRes.objects) {
            for (var ei = 0; ei < evRes.objects.length; ei++) {
                var eo = evRes.objects[ei];
                var ev = eo && eo.value;
                if (!ev || !eo.key || eo.key.indexOf("dash_") !== 0) continue;
                if (ev.unixTimestamp && ev.unixTimestamp < cutoff) continue;
                if (ev.schemaVersion !== 2) continue;
                v2EventsTotal++;
                var warns = ev.v2Warnings || [];
                v2WarnTotal += warns.length;
                for (var wi = 0; wi < warns.length; wi++) {
                    var wt = warns[wi];
                    if (typeof wt === "string") v2WarnTypes[wt] = (v2WarnTypes[wt] || 0) + 1;
                }
            }
        }
    } catch (e) { /* ignore */ }

    function topPairs(map, n) {
        var arr = [];
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) arr.push({ name: k, count: map[k] });
        }
        arr.sort(function (a, b) { return b.count - a.count; });
        return arr.slice(0, n || 20);
    }

    var warnRate = v2EventsTotal > 0
        ? Math.round((v2WarnTotal / v2EventsTotal) * 100) / 100
        : 0;

    return tpOk({
        checkedAt:                 new Date().toISOString(),
        days_window:               days,
        schema_v2_events_today:    (todayC && todayC.schema_v2_events)    || 0,
        schema_v2_warnings_today:  (todayC && todayC.schema_v2_warnings)  || 0,
        events_accepted_today:     (todayC && todayC.events_accepted)     || 0,
        events_rejected_today:     (todayC && todayC.events_rejected)     || 0,
        alias_normalized_today:    (todayC && todayC.alias_normalized)    || 0,
        satori_success_today:      (todayC && todayC.satori_publish_success)  || 0,
        satori_failure_today:      (todayC && todayC.satori_publish_failure)  || 0,
        coverage_gap_log_entries:  gapTotal,
        top_coverage_gap_fields:   topPairs(gapsByField, 20),
        top_coverage_gap_events:   topPairs(gapsByEvent, 20),
        v2_events_sampled:         v2EventsTotal,
        v2_warnings_total:         v2WarnTotal,
        v2_warnings_per_event_avg: warnRate,
        top_v2_warning_types:      topPairs(v2WarnTypes, 20),
        schema_contract: {
            version:        TP_SCHEMA_VERSION,
            v2_required:    ["schema_version"].concat(TP_V2_REQUIRED),
            v2_recommended: TP_V2_RECOMMENDED
        }
    });
}

// ─── Module registration ───────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_tracking_plan", rpcAnalyticsTrackingPlan);
    initializer.registerRpc("analytics_data_quality",  rpcAnalyticsDataQuality);
    logger.info("[analytics_tracking_plan] Module registered: analytics_tracking_plan, analytics_data_quality");
}
