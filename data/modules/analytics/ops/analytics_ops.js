// analytics_ops.js — Phase 2.4 data-quality + ops tooling for analytics.
//
// Registered RPCs (all admin-gated):
//   analytics_schema_check     { days?: number, sample?: number }
//     → scans the newest events and reports field coverage per event name
//       so operators can see which parameters are being lost / mistyped.
//
//   analytics_backfill_events  { from, to, fix?: boolean, limit?: number }
//     → re-normalizes legacy-shape events in analytics_events, optionally
//       rewriting them in place so the rollup can consume them.
//
//   analytics_feature_flags    {}
//     → inspects docker-compose feature flags as seen by the Goja runtime.
//
// Auth: DASHBOARD_SECRET or admin session (same contract as other Phase-2 RPCs).

var AO_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AO_ADMIN_USERS_COLLECTION = "admin_users";
var AO_EVENTS_COLLECTION = "analytics_events";

// Canonical required fields per event shape (kept in sync with the Unity
// IVXAnalyticsEvents taxonomy). Missing fields are reported, not failures.
var AO_EXPECTED_FIELDS = {
    __any__:              ["gameId", "eventName", "eventData"],
    app_launched:         ["session_id", "platform"],
    app_open:             ["session_id", "platform"],
    app_backgrounded:     ["session_id"],
    app_crashed:          ["error_category", "error_message"],
    session_start:        ["session_id", "platform"],
    session_heartbeat:    ["session_id"],
    session_end:          ["session_id", "duration_seconds"],
    login_started:        ["provider"],
    login_success:        ["provider"],
    identity_linked:      ["provider"],
    screen_view:          ["screen_name"],
    screen_viewed:        ["screen_id"],
    screen_left:          ["screen_id"],
    button_clicked:       ["screen_id", "button_id"],
    modal_shown:          ["modal_id"],
    modal_closed:         ["modal_id"],
    loading_started:      ["screen_id"],
    loading_completed:    ["screen_id", "duration_ms"],
    mode_selected:        ["mode"],
    topic_selected:       ["topic_id"],
    quiz_start:           ["quiz_mode", "quiz_id"],
    question_viewed:      ["question_id", "question_index"],
    answer_selected:      ["question_id", "answer_id"],
    answer_changed:       ["question_id"],
    answer_submitted:     ["question_id", "is_correct", "time_to_answer"],
    question_result:      ["question_id", "is_correct"],
    hint_used:            ["question_id", "hint_count"],
    time_expired:         ["question_id"],
    quiz_abandoned:       ["quiz_mode", "quiz_session_id"],
    quiz_complete:        ["quiz_mode", "quiz_id", "score", "correct_count", "total_questions"],
    purchase_intent:      ["product_id"],
    iap_purchased:        ["product_id", "price_usd", "currency"],
    purchase_failed:      ["product_id", "error_code"],
    ad_impression:        ["ad_placement", "ad_network"],
    ad_clicked:           ["ad_placement", "ad_network"],
    reward_claimed:       ["reward_type", "reward_amount"],
    offer_eligible:       ["offer_id"],
    offer_assigned:       ["offer_id", "variant_id"],
    offer_viewed:         ["offer_id"],
    offer_clicked:        ["offer_id"],
    offer_purchased:      ["offer_id", "price_usd"],
    offer_dismissed:      ["offer_id"],
    offer_cooldown_blocked:["offer_id"],
    satori_flags_loaded:  ["flag_count"],
    flag_exposed:         ["flag_key", "variant"],
    experiment_exposed:   ["experiment_id", "variant"],
    remote_config_applied:["config_version"],
    ai_host_used:         ["prompt_tokens", "response_tokens"],
    error_logged:         ["error_category", "error_message"],

    // ── 2026-04 Unity analytics-hardening additions ──
    // Canonical AD_* taxonomy emitted by MonetizationAnalytics + AdsAnalyticsBridge.
    // ad_type values: "interstitial" | "rewarded" | "banner".
    ad_requested:         ["ad_type", "ad_placement"],
    ad_shown:             ["ad_type", "ad_placement", "ad_network"],
    ad_completed:         ["ad_type", "ad_placement", "ad_network", "reward_type", "reward_amount"],
    ad_skipped:           ["ad_type", "ad_placement", "ad_network"],
    ad_load_failed:       ["ad_type", "ad_placement", "ad_network", "error_code"],
    ad_revenue:           ["ad_type", "ad_placement", "ad_network", "revenue_usd", "currency"],

    // Retention milestone events fired once per install by RetentionAnalytics.
    retention_d1:         ["days_since_install"],
    retention_d7:         ["days_since_install"],
    retention_d30:        ["days_since_install"],

    // Dedicated error-class events (replace the generic "error_logged" catch-all).
    api_failure:          ["endpoint", "status_code"],
    auth_failure:         ["provider", "error_code"],
    nakama_rpc_error:     ["rpc_id", "error_code"],
    timeout_event:        ["operation", "timeout_ms"],
    crash_safe_log:       ["error_category", "error_message"],

    // ── 2026-05 Phase 6–7 Popup events ──
    streak_wager_shown:             ["current_streak"],
    streak_wager_placed:            ["wager_amount"],
    streak_wager_cancelled:         ["streak_days"],
    streak_wager_result:            ["won", "wager_amount", "streak_days"],
    streak_repair_shown:            ["broken_streak_days"],
    streak_repair_outcome:          ["action", "broken_streak_days"],
    badge_popup_shown:              ["badge_id", "badge_name", "badge_category"],
    badge_popup_claimed:            ["badge_id"],
    guest_conversion_shown:         ["feature_name"],
    guest_conversion_outcome:       ["action", "feature_name"],
    friend_quest_popup_viewed:      ["active_quest_count", "completed_quest_count"],
    friend_quest_claimed:           ["quest_id", "quest_type"],
    learning_game_popup_shown:      ["question_count"],
    learning_game_type_selected:    ["game_type", "question_count"],
    fortune_wheel_v2_shown:         [],
    fortune_wheel_v2_spin:          ["source", "reward_type", "reward_amount"],
    audiobook_creation_started:     ["source_type", "using_free_token"],
    audiobook_creation_success:     ["source_type", "used_free_token"],
    not_enough_converted:           ["action"],
    revive_shown:                   [],
    revive_outcome:                 ["action"],
    lucky_wheel_spin:               ["source", "reward_type", "reward_amount"],
    energy_popup_action:            ["action"],
    paywall_shown:                  ["paywall_id", "entry_point"],
    store_opened:                   ["entry_point"],
    starter_pack_outcome:           ["action"],

    // ── 2026-05 Arcade events (ArcadeSection scene) ──
    arcade_hub_viewed:              ["source"],
    arcade_hub_exited:              ["arcade_streak"],
    arcade_game_launched:           ["game_id", "source"],
    arcade_2048_home_viewed:        ["arcade_game", "best_score"],
    arcade_2048_game_started:       ["arcade_game", "best_score"],
    arcade_2048_game_resumed:       ["arcade_game", "saved_score"],
    arcade_2048_game_completed:     ["arcade_game", "score", "is_win"],
    arcade_2048_exited:             ["arcade_game"],
    arcade_2048_undo_used:          ["arcade_game", "score", "moves"],
    arcade_2048_score_milestone:    ["arcade_game", "milestone", "score", "moves"],
    arcade_hex_home_viewed:         ["arcade_game", "best_score"],
    arcade_hex_game_started:        ["arcade_game", "best_score"],
    arcade_hex_game_resumed:        ["arcade_game", "saved_score"],
    arcade_hex_game_completed:      ["arcade_game", "score", "is_win"],
    arcade_hex_exited:              ["arcade_game"],
    arcade_hex_undo_used:           ["arcade_game", "score", "moves"],
    arcade_hex_merge_combo:         ["arcade_game", "chain_length", "merged_value", "score"],
    arcade_chess_home_viewed:       ["arcade_game"],
    arcade_chess_puzzle_started:    ["puzzle_id", "puzzle_rating"],
    arcade_chess_puzzle_resumed:    ["puzzle_id", "moves_made"],
    arcade_chess_next_puzzle:       [],
    arcade_chess_hint_used:         ["puzzle_id", "hint_level", "hints_remaining"],
    arcade_chess_solution_viewed:   ["puzzle_id", "moves_made"],
    arcade_chess_move_correct:      ["puzzle_id", "move_number"],
    arcade_chess_move_wrong:        ["puzzle_id", "wrong_count"],
    arcade_chess_puzzle_solved:     ["puzzle_id", "moves_made", "wrong_moves", "hints_used"],
    arcade_chess_puzzle_failed:     ["puzzle_id", "moves_made", "wrong_moves", "hints_used"],
    arcade_chess_exited:            ["had_unsaved"]
};

// ─── Helpers ──────────────────────────────────────────────

function aoParse(payload) { try { return JSON.parse(payload || "{}"); } catch (e) { return {}; } }
function aoOk(data) { var out = { success: true }; if (data) for (var k in data) if (data.hasOwnProperty(k)) out[k] = data[k]; return JSON.stringify(out); }
function aoErr(msg, code) { return JSON.stringify({ success: false, error: msg || "error", code: code || 400 }); }
function aoEnv(ctx, key) { if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null) return String(ctx.env[key]); return ""; }

// Mirrors analytics_admin: UUID owns the admin_users/profile doc, while
// ctx.username carries the "admin:<name>" custom_id we gate on.
function aoIsAdminUser(nk, userId, username) {
    if (!userId) return false;
    if (!username || username.indexOf("admin:") !== 0) return false;
    try {
        var records = nk.storageRead([{ collection: AO_ADMIN_USERS_COLLECTION, key: "profile", userId: userId }]);
        if (!records || records.length === 0) return false;
        var rec = records[0].value || {};
        if (!rec.isAdmin) return false;
        if (rec.expiresAt && rec.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function aoRequireAdmin(ctx, nk, data) {
    var secret = aoEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (ctx.userId && aoIsAdminUser(nk, ctx.userId, ctx.username)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function aoIsoToday() { return new Date().toISOString().slice(0, 10); }

// ─── RPC: analytics_schema_check ──────────────────────────

/**
 * Walks the newest N events under SYSTEM_USER (the dashboard-fanout copies
 * written by analytics.js::persistNormalizedEvent — key prefix "dash_"),
 * bins them by eventName, and reports which canonical fields are missing.
 *
 * Payload: { sample?: number (default 500), days?: number (default 7) }
 */
function rpcAnalyticsSchemaCheck(ctx, logger, nk, payload) {
    var data = aoParse(payload);
    var gate = aoRequireAdmin(ctx, nk, data);
    if (!gate.ok) return aoErr(gate.reason, 401);

    var sampleLimit = Math.min(2000, parseInt(data.sample, 10) || 500);
    var days = Math.min(30, parseInt(data.days, 10) || 7);
    var cutoffUnix = Math.floor(Date.now() / 1000) - days * 86400;

    var eventNames = {};
    var missingGameId = 0;
    var legacyShape = 0;
    var canonicalizedEvents = 0;
    var eventsWithoutContract = {};
    var aliasPairs = {};
    var schemaVersionDist = {};   // Phase 2: schema version distribution
    var totalScanned = 0;
    var totalMatched = 0;
    var cursor = null;

    for (var page = 0; page < 40 && totalMatched < sampleLimit; page++) {
        var res;
        try { res = nk.storageList(AO_SYSTEM_USER, AO_EVENTS_COLLECTION, 200, cursor); }
        catch (e) { logger.warn("[analytics_ops] schema list: " + e.message); break; }
        if (!res || !res.objects || res.objects.length === 0) break;

        for (var i = 0; i < res.objects.length; i++) {
            totalScanned++;
            var o = res.objects[i];
            if (!o || !o.value) continue;
            if (!o.key || o.key.indexOf("dash_") !== 0) continue;
            var ev = o.value;
            var unix = ev.unixTimestamp || 0;
            if (unix > 0 && unix < cutoffUnix) continue;

            totalMatched++;
            var name = ev.eventName || "__unknown__";
            if (!eventNames[name]) eventNames[name] = { count: 0, missing: {}, extra_keys: {} };
            eventNames[name].count++;

            if (!ev.gameId) missingGameId++;
            if (ev.gameID || ev.event || ev.properties) legacyShape++;
            if (ev.canonicalized) {
                canonicalizedEvents++;
                var fromName = ev.originalEventName || "__unknown__";
                var aliasKey = fromName + " -> " + name;
                aliasPairs[aliasKey] = (aliasPairs[aliasKey] || 0) + 1;
            }
            if (!AO_EXPECTED_FIELDS[name]) {
                eventsWithoutContract[name] = (eventsWithoutContract[name] || 0) + 1;
            }
            // Phase 2: track schema_version distribution.
            var sv = String(ev.schemaVersion || 1);
            schemaVersionDist[sv] = (schemaVersionDist[sv] || 0) + 1;

            var required = AO_EXPECTED_FIELDS[name] || [];
            var all = (AO_EXPECTED_FIELDS.__any__ || []).concat(required);
            var body = ev.eventData || {};
            for (var fi = 0; fi < all.length; fi++) {
                var f = all[fi];
                var present = (f === "gameId" || f === "eventName" || f === "eventData")
                    ? !!ev[f]
                    : body[f] !== undefined && body[f] !== null && body[f] !== "";
                if (!present) {
                    eventNames[name].missing[f] = (eventNames[name].missing[f] || 0) + 1;
                }
            }
            // Opportunistic extra-key census: first 20 data keys only, to keep response small.
            var extraKeys = Object.keys(body).slice(0, 20);
            for (var xi = 0; xi < extraKeys.length; xi++) {
                var ek = extraKeys[xi];
                eventNames[name].extra_keys[ek] = (eventNames[name].extra_keys[ek] || 0) + 1;
            }
            if (totalMatched >= sampleLimit) break;
        }

        if (!res.cursor) break;
        cursor = res.cursor;
    }

    var byEvent = [];
    for (var en in eventNames) {
        var rec = eventNames[en];
        var missingList = [];
        for (var mk in rec.missing) missingList.push({ field: mk, missing_pct: Math.round((rec.missing[mk] / rec.count) * 100), missing_count: rec.missing[mk] });
        missingList.sort(function (a, b) { return b.missing_pct - a.missing_pct; });
        byEvent.push({ event_name: en, count: rec.count, missing_fields: missingList.slice(0, 10) });
    }
    byEvent.sort(function (a, b) { return b.count - a.count; });

    function topMap(map, limit) {
        var out = [];
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) out.push({ name: k, count: map[k] });
        }
        out.sort(function (a, b) { return b.count - a.count; });
        return out.slice(0, limit || 20);
    }

    return aoOk({
        sampled: totalMatched,
        scanned: totalScanned,
        days: days,
        missing_gameid: missingGameId,
        legacy_shape_events: legacyShape,
        canonicalized_events: canonicalizedEvents,
        alias_pairs: topMap(aliasPairs, 20),
        events_without_field_contract: topMap(eventsWithoutContract, 25),
        schema_version_distribution: schemaVersionDist,
        event_count: byEvent.length,
        by_event: byEvent.slice(0, 50),
        hint: legacyShape > 0
            ? "Found legacy-shape events (gameID / event / properties). Run analytics_backfill_events to normalize."
            : (topMap(eventsWithoutContract, 1).length > 0
                ? "Some event names have no field contract yet. Add them to AO_EXPECTED_FIELDS or migrate callers to canonical events."
                : "All sampled events match the canonical shape and known field contracts.")
    });
}

// ─── RPC: analytics_backfill_events ───────────────────────

/**
 * Re-normalizes events written under legacy keys/casings:
 *   - ev.event → ev.eventName
 *   - ev.properties → ev.eventData
 *   - ev.gameID → ev.gameId
 * Without { fix: true } this is a DRY RUN and only reports what would change.
 *
 * Payload: { limit?: number (default 500, max 5000), fix?: boolean, days?: number (default 30) }
 */
function rpcAnalyticsBackfillEvents(ctx, logger, nk, payload) {
    var data = aoParse(payload);
    var gate = aoRequireAdmin(ctx, nk, data);
    if (!gate.ok) return aoErr(gate.reason, 401);

    var limit = Math.min(5000, parseInt(data.limit, 10) || 500);
    var days = Math.min(90, parseInt(data.days, 10) || 30);
    var fix = !!data.fix;
    var cutoffUnix = Math.floor(Date.now() / 1000) - days * 86400;

    var scanned = 0;
    var wouldFix = 0;
    var fixed = 0;
    var fixErrors = 0;
    var cursor = null;
    var samples = [];

    for (var page = 0; page < 50 && scanned < limit; page++) {
        var res;
        try { res = nk.storageList(AO_SYSTEM_USER, AO_EVENTS_COLLECTION, 200, cursor); }
        catch (e) { logger.warn("[analytics_ops] backfill list: " + e.message); break; }
        if (!res || !res.objects || res.objects.length === 0) break;

        for (var i = 0; i < res.objects.length; i++) {
            if (scanned >= limit) break;
            scanned++;
            var o = res.objects[i];
            if (!o || !o.value || !o.key || o.key.indexOf("dash_") !== 0) continue;
            var ev = o.value;
            var unix = ev.unixTimestamp || 0;
            if (unix > 0 && unix < cutoffUnix) continue;

            var changed = false;
            if (!ev.eventName && ev.event) { ev.eventName = ev.event; delete ev.event; changed = true; }
            if (!ev.eventData && ev.properties) { ev.eventData = ev.properties; delete ev.properties; changed = true; }
            if (!ev.gameId && ev.gameID) { ev.gameId = ev.gameID; delete ev.gameID; changed = true; }

            if (!changed) continue;
            wouldFix++;
            if (samples.length < 5) samples.push({ key: o.key, eventName: ev.eventName, gameId: ev.gameId });

            if (fix) {
                try {
                    nk.storageWrite([{
                        collection: AO_EVENTS_COLLECTION,
                        key: o.key,
                        userId: AO_SYSTEM_USER,
                        value: ev,
                        permissionRead: 2,
                        permissionWrite: 0
                    }]);
                    fixed++;
                } catch (e) {
                    fixErrors++;
                    logger.warn("[analytics_ops] backfill write failed " + o.key + ": " + e.message);
                }
            }
        }
        if (!res.cursor) break;
        cursor = res.cursor;
    }

    return aoOk({
        dry_run: !fix,
        scanned: scanned,
        would_fix: wouldFix,
        fixed: fixed,
        fix_errors: fixErrors,
        samples: samples,
        hint: fix
            ? ("Rewrote " + fixed + " events. Re-run analytics_rollup_backfill to regenerate affected dates.")
            : ("Dry run. Pass { fix: true } to rewrite " + wouldFix + " events in-place.")
    });
}

// ─── RPC: analytics_feature_flags ─────────────────────────

function rpcAnalyticsFeatureFlags(ctx, logger, nk, payload) {
    var data = aoParse(payload);
    var gate = aoRequireAdmin(ctx, nk, data);
    if (!gate.ok) return aoErr(gate.reason, 401);

    function flag(key, defaultOn) {
        var v = aoEnv(ctx, key);
        if (v === "") return { value: defaultOn ? "true (default)" : "false (default)", enabled: !!defaultOn };
        var truthy = (v === "true" || v === "1");
        return { value: v, enabled: truthy };
    }

    return aoOk({
        checkedAt: new Date().toISOString(),
        flags: {
            ROLLUP_ENABLED:           flag("ROLLUP_ENABLED", true),
            EXTERNAL_POLLERS_ENABLED: flag("EXTERNAL_POLLERS_ENABLED", true),
            DASHBOARD_PREFER_ROLLUPS: flag("DASHBOARD_PREFER_ROLLUPS", true)
        }
    });
}

// ─── RPC: analytics_metrics ───────────────────────────────
//
// Returns a compact, Prometheus-scrape-friendly snapshot of the analytics
// pipeline's internal state. Nakama's Goja runtime can't register Prometheus
// counters directly, so we expose this RPC for blackbox-exporter / curl-cron
// scraping. Admin-gated (DASHBOARD_SECRET works for service-to-service).
//
// Payload: {} (no params)
// Returns: {
//   events_today_accepted, events_today_rejected,
//   last_rollup_date, last_rollup_unix, rollup_events_matched,
//   poll_last_unix: { appodeal, appstore, ugs },
//   analytics_events_sample, analytics_dau_sample
// }

function rpcAnalyticsMetrics(ctx, logger, nk, payload) {
    var data = aoParse(payload);
    var gate = aoRequireAdmin(ctx, nk, data);
    if (!gate.ok) return aoErr(gate.reason, 401);

    var today = new Date().toISOString().slice(0, 10);
    var todayCounter = null;
    try {
        var objs = nk.storageRead([{ collection: "analytics_metrics_counters", key: "counter_" + today, userId: AO_SYSTEM_USER }]);
        if (objs && objs.length > 0) todayCounter = objs[0].value;
    } catch (e) { /* ignore */ }

    var rollupMeta = null;
    try {
        var rObjs = nk.storageRead([{ collection: "analytics_rollup_meta", key: "last_success", userId: AO_SYSTEM_USER }]);
        if (rObjs && rObjs.length > 0) rollupMeta = rObjs[0].value;
    } catch (e) { /* ignore */ }

    var pollerMeta = {};
    var providers = ["appodeal", "appstore", "ugs"];
    for (var pi = 0; pi < providers.length; pi++) {
        try {
            var p = providers[pi];
            var pObjs = nk.storageRead([{ collection: "external_analytics_last_poll", key: p, userId: AO_SYSTEM_USER }]);
            if (pObjs && pObjs.length > 0) pollerMeta[p] = pObjs[0].value;
            else pollerMeta[p] = null;
        } catch (e) { /* ignore */ }
    }

    var analyticsEventsSample = 0;
    var analyticsDauSample = 0;
    try {
        var l1 = nk.storageList(AO_SYSTEM_USER, "analytics_events", 5, null);
        analyticsEventsSample = (l1 && l1.objects) ? l1.objects.length : 0;
    } catch (e) { /* ignore */ }
    try {
        var l2 = nk.storageList(AO_SYSTEM_USER, "analytics_dau", 5, null);
        analyticsDauSample = (l2 && l2.objects) ? l2.objects.length : 0;
    } catch (e) { /* ignore */ }

    return aoOk({
        checkedAt: new Date().toISOString(),
        events_today_accepted: (todayCounter && todayCounter.events_accepted) || 0,
        events_today_rejected: (todayCounter && todayCounter.events_rejected) || 0,
        alias_normalized_today: (todayCounter && todayCounter.alias_normalized) || 0,
        schema_v2_events_today:   (todayCounter && todayCounter.schema_v2_events)   || 0,
        schema_v2_warnings_today: (todayCounter && todayCounter.schema_v2_warnings) || 0,
        log_calls_today: (todayCounter && todayCounter.log_calls) || 0,
        satori_publish_success_today: (todayCounter && todayCounter.satori_publish_success) || 0,
        satori_publish_failure_today: (todayCounter && todayCounter.satori_publish_failure) || 0,
        satori_publish_filtered_today: (todayCounter && todayCounter.satori_publish_filtered) || 0,
        satori_publish_dropped_today: (todayCounter && todayCounter.satori_publish_dropped) || 0,
        last_rollup_date: rollupMeta ? rollupMeta.date : null,
        last_rollup_unix: rollupMeta && rollupMeta.timestamp
            ? Math.floor(new Date(rollupMeta.timestamp).getTime() / 1000)
            : 0,
        rollup_events_matched: rollupMeta ? rollupMeta.eventsMatched : 0,
        rollup_games_count: rollupMeta && rollupMeta.gameIds ? rollupMeta.gameIds.length : 0,
        poll_last_unix: {
            appodeal: pollerMeta.appodeal ? pollerMeta.appodeal.lastPollUnix : 0,
            appstore: pollerMeta.appstore ? pollerMeta.appstore.lastPollUnix : 0,
            ugs:      pollerMeta.ugs ? pollerMeta.ugs.lastPollUnix : 0
        },
        poll_last_success: {
            appodeal: !!(pollerMeta.appodeal && pollerMeta.appodeal.success),
            appstore: !!(pollerMeta.appstore && pollerMeta.appstore.success),
            ugs:      !!(pollerMeta.ugs && pollerMeta.ugs.success)
        },
        analytics_events_sample: analyticsEventsSample,
        analytics_dau_sample: analyticsDauSample,
        bypass: gate.bypass
    });
}

// ─── DAU Alert (drop >20% triggers Slack webhook) ─────────────────────────────
//
// analytics_dau_alert_check  {}
//   Reads today's and yesterday's DAU from analytics_live_daily storage.
//   If today DAU < yesterday DAU * 0.80, sends a Slack webhook alert.
//   Register as a Nakama CRON (every 2h) or call manually from ops dashboards.
//   Slack webhook URL comes from ctx.env['SLACK_OPS_WEBHOOK_URL'].

var AO_DAU_THRESHOLD_PCT = 0.80;   // alert when DAU drops below 80% of yesterday
var AO_DAU_ALERT_COOLDOWN_HOURS = 6; // suppress repeated alerts for 6h

function getDateKey(daysOffset) {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() + (daysOffset || 0));
    return d.toISOString().slice(0, 10);
}

function aoResolveGameId(gameId) {
    if (!gameId) return gameId;
    try { if (typeof resolveGameIdAlias === 'function') return resolveGameIdAlias(gameId); } catch (e) {}
    return gameId;
}

function rpcAnalyticsDauAlertCheck(ctx, logger, nk, payload) {
    var data = aoParse(payload);
    var gate = aoRequireAdmin(ctx, nk, data);
    if (!gate.ok) return aoErr(gate.reason, 401);

    // DAU is stored in analytics_dau, not analytics_live_daily.
    // Keys: dau_{gameId}_{YYYY-MM-DD}  (per-game)  or  dau_platform_{YYYY-MM-DD}  (all)
    // analytics_live_daily keys are live_{gameId}_{date} — different collection/key.
    var gameId = aoResolveGameId(data.game_id || data.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b");
    var todayDate     = getDateKey(0);
    var yesterdayDate = getDateKey(-1);
    var todayDauKey     = "dau_" + gameId + "_" + todayDate;
    var yesterdayDauKey = "dau_" + gameId + "_" + yesterdayDate;

    var todayDau = 0, yesterdayDau = 0;
    try {
        var t = nk.storageRead([{ collection: "analytics_dau", key: todayDauKey, userId: AO_SYSTEM_USER }]);
        if (t && t.length > 0 && t[0].value) todayDau = t[0].value.unique_users || t[0].value.count || 0;
    } catch (e) { logger.warn("[dau_alert] Failed to read today DAU: " + e.message); }

    try {
        var y = nk.storageRead([{ collection: "analytics_dau", key: yesterdayDauKey, userId: AO_SYSTEM_USER }]);
        if (y && y.length > 0 && y[0].value) yesterdayDau = y[0].value.unique_users || y[0].value.count || 0;
    } catch (e) { logger.warn("[dau_alert] Failed to read yesterday DAU: " + e.message); }

    var dropPct = yesterdayDau > 0 ? (1 - todayDau / yesterdayDau) * 100 : 0;
    var alertNeeded = yesterdayDau > 0 && todayDau < yesterdayDau * AO_DAU_THRESHOLD_PCT;

    logger.info("[dau_alert] today=" + todayDau + " yesterday=" + yesterdayDau +
                " drop=" + dropPct.toFixed(1) + "% alert=" + alertNeeded);

    if (!alertNeeded) {
        return aoOk({ alerted: false, todayDau: todayDau, yesterdayDau: yesterdayDau, dropPct: dropPct });
    }

    // Check cooldown — suppress if already alerted in the last AO_DAU_ALERT_COOLDOWN_HOURS
    var cooldownKey = "dau_alert_cooldown_" + todayKey;
    try {
        var cool = nk.storageRead([{ collection: "analytics_ops_state", key: cooldownKey, userId: AO_SYSTEM_USER }]);
        if (cool && cool.length > 0 && cool[0].value) {
            var lastAlertTs = cool[0].value.alertedAt || 0;
            var hoursSince = (Date.now() - lastAlertTs) / 3600000;
            if (hoursSince < AO_DAU_ALERT_COOLDOWN_HOURS) {
                logger.info("[dau_alert] Cooldown active (" + hoursSince.toFixed(1) + "h < " + AO_DAU_ALERT_COOLDOWN_HOURS + "h). Skipping.");
                return aoOk({ alerted: false, cooldown: true, todayDau: todayDau, yesterdayDau: yesterdayDau, dropPct: dropPct });
            }
        }
    } catch (e) { /* no cooldown record → proceed */ }

    // Record cooldown
    try {
        nk.storageWrite([{
            collection: "analytics_ops_state", key: cooldownKey, userId: AO_SYSTEM_USER,
            value: { alertedAt: Date.now(), todayDau: todayDau, yesterdayDau: yesterdayDau, dropPct: dropPct },
            permissionRead: 0, permissionWrite: 0
        }]);
    } catch (e) { /* non-fatal */ }

    // Send Slack webhook
    var webhookUrl = ctx.env && ctx.env["SLACK_OPS_WEBHOOK_URL"];
    if (!webhookUrl) {
        logger.warn("[dau_alert] SLACK_OPS_WEBHOOK_URL not set — alert suppressed. Set it in RUNTIME_ENV_KEYS.");
        return aoOk({ alerted: false, reason: "no_webhook_url", todayDau: todayDau, yesterdayDau: yesterdayDau, dropPct: dropPct });
    }

    var slackMsg = JSON.stringify({
        text: ":rotating_light: *QuizVerse DAU Alert* — " + todayKey,
        blocks: [{
            type: "section",
            text: {
                type: "mrkdwn",
                text: ":rotating_light: *DAU dropped >" + (100 - AO_DAU_THRESHOLD_PCT * 100).toFixed(0) +
                      "%* on *" + todayKey + "*\n" +
                      ">*Today DAU:* " + todayDau + "\n" +
                      ">*Yesterday DAU:* " + yesterdayDau + "\n" +
                      ">*Drop:* " + dropPct.toFixed(1) + "%\n" +
                      "Check: https://nakama.intelli-verse-x.ai/analytics.html"
            }
        }]
    });

    var slackOk = false;
    try {
        var resp = nk.httpRequest(webhookUrl, "post", { "Content-Type": "application/json" }, slackMsg);
        slackOk = resp.code >= 200 && resp.code < 300;
        if (!slackOk) logger.warn("[dau_alert] Slack webhook returned HTTP " + resp.code);
        else          logger.info("[dau_alert] Slack alert sent. drop=" + dropPct.toFixed(1) + "% todayDau=" + todayDau);
    } catch (e) {
        logger.error("[dau_alert] Failed to send Slack webhook: " + e.message);
    }

    return aoOk({ alerted: true, slackOk: slackOk, todayDau: todayDau, yesterdayDau: yesterdayDau, dropPct: dropPct });
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_schema_check", rpcAnalyticsSchemaCheck);
    initializer.registerRpc("analytics_backfill_events", rpcAnalyticsBackfillEvents);
    initializer.registerRpc("analytics_feature_flags", rpcAnalyticsFeatureFlags);
    initializer.registerRpc("analytics_metrics", rpcAnalyticsMetrics);
    initializer.registerRpc("analytics_dau_alert_check", rpcAnalyticsDauAlertCheck);
    logger.info("[analytics_ops] Module registered: 5 RPCs (schema_check, backfill_events, feature_flags, metrics, dau_alert_check)");
}
