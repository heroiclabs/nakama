// analytics_segments.js — Phase 5 (2026-05) Satori live-ops segments.
//
// Satori's "audiences" are rule-based groups of identities matching some
// event/property combination. The cleanest way to drive them from our
// side is to:
//
//   1. Compute the segment membership in Nakama (we have the GPA doc
//      with all the lifetime stats — last_active_utc, lt_quiz_plays,
//      money.iap_count, money.paywall_shown_count, etc.).
//   2. For each member, fire a "trigger" event into Satori
//      (`winback_eligible`, `preiap_nudge_eligible`) and update the
//      identity property `*_segment = true`.
//   3. The live-ops team configures Satori audiences as "users who fired
//      <trigger event> in the last N days" — one rule per segment.
//
// This module also exposes `satori_register_taxonomy` which pings every
// canonical event from SD_EVENT_ALLOWLIST once, so Satori's Console
// auto-registers every name we use. Run once after each deploy that
// adds new canonical events (or just leave it on the auto-tick).
//
// Registered RPCs:
//   - satori_register_taxonomy : admin-gated. Fires one warm-up event per
//     canonical event name to a system identity. Idempotent — Satori
//     dedupes on event name.
//   - satori_segments_winback  : admin-gated. Scans GPA, fires
//     `winback_eligible` events for users matching the win-back rule.
//   - satori_segments_preiap   : admin-gated. Scans GPA, fires
//     `preiap_nudge_eligible` events for users matching the pre-IAP rule.
//   - satori_segments_run      : admin-gated. Runs both winback+preiap.
//   - satori_segments_status   : admin-gated. Returns last-run summary.
//
// Cooldowns (avoid spamming the same user every day):
//   - winback : 7 days  (a user re-emits if they're STILL inactive)
//   - preiap  : 3 days  (a user re-emits if they're STILL un-converted)
//
// State: stored in `analytics_segments_state/<userId>` per user with
//   { winback_last_sent_utc, preiap_last_sent_utc }.
// Last-run summary stored in `analytics_segments_meta/last_run`.

var SEG_SYSTEM_USER          = "00000000-0000-0000-0000-000000000000";
var SEG_GPA_COLLECTION       = "game_player_analytics";
var SEG_STATE_COLLECTION     = "analytics_segments_state";
var SEG_META_COLLECTION      = "analytics_segments_meta";
var SEG_META_LAST_RUN_KEY    = "last_run";

// Win-back rule: inactive ≥ 7 days AND lifetime ≥ 5 quiz plays.
// (Threshold copied verbatim from the user-approved Phase 5 plan.)
var SEG_WINBACK_INACTIVE_DAYS = 7;
var SEG_WINBACK_MIN_QUIZ_PLAYS = 5;
var SEG_WINBACK_COOLDOWN_SEC   = 7 * 86400;   // re-fire after a week if still inactive

// Pre-IAP rule: paywall_shown ≥ 1 AND iap_count === 0.
var SEG_PREIAP_MIN_PAYWALL_SHOWN = 1;
var SEG_PREIAP_COOLDOWN_SEC      = 3 * 86400;

// Per-RPC scan caps. The dashboard auto-tick calls this often, so we
// page through all users over multiple ticks rather than scanning the
// entire collection in one request (which would time out at 1M+ users).
var SEG_MAX_PAGES_PER_RUN     = 8;
var SEG_PAGE_SIZE             = 100;

// ─── Helpers ──────────────────────────────────────────────

function segParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function segOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (data.hasOwnProperty(k)) out[k] = data[k];
    return JSON.stringify(out);
}

function segErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

// Auth: reuse aaRequireAdmin from analytics_admin.js (hoisted to global
// scope by postbuild concatenation). Falls through to the dashboard
// secret bypass when an operator runs from CI.
function segRequireAdmin(ctx, nk, logger, data) {
    if (typeof aaRequireAdmin === "function") {
        return aaRequireAdmin(ctx, nk, logger, data);
    }
    return { ok: false, reason: "aaRequireAdmin not available" };
}

function segNowUtc() {
    return Math.floor(Date.now() / 1000);
}

function segReadState(nk, userId) {
    try {
        var r = nk.storageRead([{
            collection: SEG_STATE_COLLECTION,
            key: userId,
            userId: SEG_SYSTEM_USER
        }]);
        if (r && r.length > 0) return r[0].value || {};
    } catch (e) { /* missing state = first time */ }
    return {};
}

function segWriteState(nk, userId, state) {
    try {
        nk.storageWrite([{
            collection: SEG_STATE_COLLECTION,
            key: userId,
            userId: SEG_SYSTEM_USER,
            value: state,
            permissionRead: 0,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) { return false; }
}

function segWriteMeta(nk, payload) {
    try {
        nk.storageWrite([{
            collection: SEG_META_COLLECTION,
            key: SEG_META_LAST_RUN_KEY,
            userId: SEG_SYSTEM_USER,
            value: payload,
            permissionRead: 2,    // admin-readable for the dashboard
            permissionWrite: 0
        }]);
    } catch (e) { /* swallow — meta is best-effort */ }
}

function segReadMeta(nk) {
    try {
        var r = nk.storageRead([{
            collection: SEG_META_COLLECTION,
            key: SEG_META_LAST_RUN_KEY,
            userId: SEG_SYSTEM_USER
        }]);
        if (r && r.length > 0) return r[0].value || null;
    } catch (e) { /* ignore */ }
    return null;
}

// ─── Satori event helper ──────────────────────────────────

// Send a single segment trigger event. We bypass the per-identity
// batching (sdEnqueueOrFlush) here because segment runs already batch
// many events per second — going straight to the wire keeps latency
// bounded regardless of buffer state. Falls back gracefully if Satori
// is unavailable (the local state still records the attempt so the
// next run honours the cooldown).
function segPublishToSatori(ctx, nk, logger, identifier, eventName, metadata) {
    if (typeof sdEventsPublish !== "function") return false;
    var nowSec = segNowUtc();
    var ev = {
        name: eventName,
        timestamp: nowSec,
        metadata: metadata || {}
    };
    try {
        var res = sdEventsPublish(ctx, nk, logger, identifier, [ev]);
        // sdEventsPublish returns null on success and {ok:false,...} on failure.
        return !res;
    } catch (e) {
        if (logger && logger.warn) logger.warn("[segments] satori publish failed: " + (e.message || e));
        return false;
    }
}

// Update a single Satori identity property bag. Used when transitioning
// a user INTO a segment so live-ops can target them via property filter
// in addition to event-based audiences.
function segMarkSatoriProperty(ctx, nk, logger, identifier, key, value) {
    if (typeof sdPropertiesUpdate !== "function") return false;
    var props = {};
    props[key] = String(value);
    try {
        var res = sdPropertiesUpdate(ctx, nk, logger, identifier, props);
        return !res;
    } catch (e) {
        if (logger && logger.warn) logger.warn("[segments] satori property update failed: " + (e.message || e));
        return false;
    }
}

// ─── Canonical event taxonomy registration ─────────────────

// Mirrors satori_direct.js::SD_EVENT_ALLOWLIST. Kept in sync manually —
// when SD_EVENT_ALLOWLIST changes, this list should be updated too. The
// system-identity warm-up is best-effort: Satori auto-registers names on
// first ingest, so any drift gets corrected on the next real event.
var SEG_TAXONOMY_EVENTS = [
    "session_start", "session_end", "app_open", "app_launched", "first_open",
    "registration_completed", "login_success",
    "onboarding_started", "onboarding_complete", "onboarding_abandoned",
    "quiz_started", "quiz_completed", "quiz_abandoned", "answer_submitted",
    "purchase_started", "purchase_completed", "purchase_failed",
    "iap_impression", "iap_failed",
    "ad_shown", "ad_completed", "ad_revenue",
    "paywall_shown", "paywall_converted", "paywall_dismissed", "premium_conversion",
    "store_opened",
    "retention_day_1", "retention_day_7", "retention_day_30", "user_returned",
    "mp_game_started", "mp_game_completed", "milestone_first_multiplayer",
    "error_logged", "auth_failure",
    "dau_synthetic",
    // Phase 5 — segment trigger events. Live-ops team builds Satori
    // audiences keyed off these.
    "winback_eligible", "preiap_nudge_eligible"
];

// System identity used for taxonomy warm-up events. Reserved UUID used
// throughout the codebase for system-owned writes.
var SEG_TAXONOMY_IDENTITY = "00000000-0000-0000-0000-000000000001";

function rpcSatoriRegisterTaxonomy(ctx, logger, nk, payload) {
    var data = segParse(payload);
    var gate = segRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return segErr(gate.reason, 401);

    if (typeof sdEventsPublish !== "function") {
        return segErr("Satori client (satori_direct.js) not loaded", 500);
    }

    var nowSec = segNowUtc();
    var sent = 0, failed = 0;
    var failures = [];

    for (var i = 0; i < SEG_TAXONOMY_EVENTS.length; i++) {
        var name = SEG_TAXONOMY_EVENTS[i];
        var ev = {
            name: name,
            timestamp: nowSec,
            metadata: {
                taxonomy_warmup: "true",
                source: "analytics_segments.rpcSatoriRegisterTaxonomy",
                bundle_version: "phase5-2026-05"
            }
        };
        try {
            var res = sdEventsPublish(ctx, nk, logger, SEG_TAXONOMY_IDENTITY, [ev]);
            if (res && res.ok === false) {
                failed++;
                failures.push({ name: name, code: res.code, body: res.body });
            } else {
                sent++;
            }
        } catch (e) {
            failed++;
            failures.push({ name: name, error: e.message || String(e) });
        }
    }

    var summary = {
        registered: sent,
        failed: failed,
        total: SEG_TAXONOMY_EVENTS.length,
        completed_at: new Date().toISOString(),
        bypass: gate.bypass,
        failures: failures.slice(0, 10)  // cap so the response stays small
    };
    if (logger && logger.info) {
        logger.info("[segments] taxonomy registered: " + sent + "/" +
            SEG_TAXONOMY_EVENTS.length + " events (failed=" + failed + ")");
    }
    return segOk(summary);
}

// ─── GPA scan helpers ─────────────────────────────────────

// Walk the game_player_analytics collection one page at a time and
// invoke `processFn(userId, gpaDoc)` for each profile. Stops after
// SEG_MAX_PAGES_PER_RUN pages or when storageList exhausts.
function segScanGpa(nk, logger, processFn, cursorIn, maxPages) {
    var cursor = cursorIn || null;
    var pages = 0;
    var pageCap = (typeof maxPages === "number" && maxPages > 0) ? maxPages : SEG_MAX_PAGES_PER_RUN;
    var totalSeen = 0;

    while (pages < pageCap) {
        var page;
        try {
            // GPA docs are written under their owning userId, so we list
            // across ALL users by passing null or undefined to storageList.
            // Older Nakama versions accepted "", but >= 3.24.0 requires
            // null/undefined for "list all users" mode ("expects empty or
            // valid user id" reject path).
            page = nk.storageList(undefined, SEG_GPA_COLLECTION, SEG_PAGE_SIZE, cursor);
        } catch (e) {
            if (logger && logger.warn) logger.warn("[segments] storageList GPA failed: " + (e.message || e));
            break;
        }
        if (!page || !page.objects || page.objects.length === 0) break;

        for (var i = 0; i < page.objects.length; i++) {
            var obj = page.objects[i];
            var doc = obj.value || {};
            var userId = doc.user_id || obj.userId || "";
            if (!userId) continue;
            totalSeen++;
            try {
                processFn(userId, doc);
            } catch (eFn) {
                if (logger && logger.warn) logger.warn("[segments] processFn error for " + userId + ": " + (eFn.message || eFn));
            }
        }

        pages++;
        if (!page.cursor) { cursor = null; break; }
        cursor = page.cursor;
    }

    return { pages: pages, total_seen: totalSeen, next_cursor: cursor };
}

// ─── Win-back segment ─────────────────────────────────────

function segRunWinback(ctx, nk, logger, cursorIn, maxPages) {
    var nowSec = segNowUtc();
    var inactiveCutoffSec = nowSec - SEG_WINBACK_INACTIVE_DAYS * 86400;

    var eligible = 0;
    var fired = 0;
    var cooldown = 0;
    var ineligible = 0;

    var scan = segScanGpa(nk, logger, function (userId, doc) {
        var lastActive = parseInt(doc.last_active_utc, 10) || 0;
        var ltPlays    = parseInt(doc.lt_quiz_plays, 10) || 0;

        // Rule: inactive ≥ N days AND ≥ M quiz plays.
        if (lastActive === 0 || lastActive >= inactiveCutoffSec) { ineligible++; return; }
        if (ltPlays < SEG_WINBACK_MIN_QUIZ_PLAYS) { ineligible++; return; }
        eligible++;

        var state = segReadState(nk, userId);
        var lastSent = parseInt(state.winback_last_sent_utc, 10) || 0;
        if (lastSent && (nowSec - lastSent) < SEG_WINBACK_COOLDOWN_SEC) {
            cooldown++;
            return;
        }

        var daysInactive = Math.floor((nowSec - lastActive) / 86400);
        var meta = {
            days_inactive: String(daysInactive),
            lt_quiz_plays: String(ltPlays),
            lt_revenue_usd: String(((doc.money || {}).spend_usd) || 0),
            fav_mode: String(doc.fav_mode || ""),
            country: String(doc.country || "??"),
            platform: String(doc.platform || "unknown"),
            segment_rule: "winback_v1"
        };

        var pubOk = segPublishToSatori(ctx, nk, logger, userId, "winback_eligible", meta);
        // Best-effort property update — gives live-ops a property filter
        // alternative on the Satori side. Failures don't block the segment.
        segMarkSatoriProperty(ctx, nk, logger, userId, "winback_segment", true);

        // Always update local state on attempt — Satori failures still
        // count for cooldown so we don't hammer the API on every run.
        state.winback_last_sent_utc = nowSec;
        state.winback_last_sent_ok  = !!pubOk;
        segWriteState(nk, userId, state);
        if (pubOk) fired++;
    }, cursorIn, maxPages);

    return {
        scanned: scan.total_seen,
        pages: scan.pages,
        next_cursor: scan.next_cursor,
        eligible: eligible,
        fired: fired,
        cooldown_skipped: cooldown,
        ineligible: ineligible,
        rule: "last_active>" + SEG_WINBACK_INACTIVE_DAYS + "d AND lt_quiz_plays>=" + SEG_WINBACK_MIN_QUIZ_PLAYS
    };
}

function rpcSatoriSegmentsWinback(ctx, logger, nk, payload) {
    var data = segParse(payload);
    var gate = segRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return segErr(gate.reason, 401);

    var maxPages = parseInt(data.max_pages, 10) || SEG_MAX_PAGES_PER_RUN;
    var cursor   = data.cursor || null;
    var summary  = segRunWinback(ctx, nk, logger, cursor, maxPages);
    summary.completed_at = new Date().toISOString();
    summary.bypass = gate.bypass;

    if (logger && logger.info) {
        logger.info("[segments] winback run: scanned=" + summary.scanned +
            " eligible=" + summary.eligible + " fired=" + summary.fired +
            " cooldown=" + summary.cooldown_skipped);
    }
    return segOk(summary);
}

// ─── Pre-IAP segment ──────────────────────────────────────

function segRunPreIAP(ctx, nk, logger, cursorIn, maxPages) {
    var nowSec = segNowUtc();
    var eligible = 0;
    var fired = 0;
    var cooldown = 0;
    var ineligible = 0;

    var scan = segScanGpa(nk, logger, function (userId, doc) {
        var money = doc.money || {};
        var paywallShown = parseInt(money.paywall_shown_count, 10) || 0;
        var iapCount     = parseInt(money.iap_count, 10) || 0;

        // Rule: paywall shown ≥ 1 AND zero IAP completions.
        if (paywallShown < SEG_PREIAP_MIN_PAYWALL_SHOWN) { ineligible++; return; }
        if (iapCount > 0) { ineligible++; return; }
        eligible++;

        var state = segReadState(nk, userId);
        var lastSent = parseInt(state.preiap_last_sent_utc, 10) || 0;
        if (lastSent && (nowSec - lastSent) < SEG_PREIAP_COOLDOWN_SEC) {
            cooldown++;
            return;
        }

        var lastPaywall = parseInt(money.paywall_last_utc, 10) || 0;
        var hoursSincePaywall = lastPaywall > 0 ? Math.floor((nowSec - lastPaywall) / 3600) : -1;
        var meta = {
            paywall_shown_count: String(paywallShown),
            paywall_dismissed_count: String(money.paywall_dismissed_count || 0),
            iap_started_count: String(money.iap_started_count || 0),
            iap_failed_count: String(money.iap_failed_count || 0),
            hours_since_last_paywall: String(hoursSincePaywall),
            lt_quiz_plays: String(doc.lt_quiz_plays || 0),
            country: String(doc.country || "??"),
            platform: String(doc.platform || "unknown"),
            segment_rule: "preiap_v1"
        };

        var pubOk = segPublishToSatori(ctx, nk, logger, userId, "preiap_nudge_eligible", meta);
        segMarkSatoriProperty(ctx, nk, logger, userId, "preiap_segment", true);

        state.preiap_last_sent_utc = nowSec;
        state.preiap_last_sent_ok  = !!pubOk;
        segWriteState(nk, userId, state);
        if (pubOk) fired++;
    }, cursorIn, maxPages);

    return {
        scanned: scan.total_seen,
        pages: scan.pages,
        next_cursor: scan.next_cursor,
        eligible: eligible,
        fired: fired,
        cooldown_skipped: cooldown,
        ineligible: ineligible,
        rule: "paywall_shown_count>=" + SEG_PREIAP_MIN_PAYWALL_SHOWN + " AND iap_count===0"
    };
}

function rpcSatoriSegmentsPreIAP(ctx, logger, nk, payload) {
    var data = segParse(payload);
    var gate = segRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return segErr(gate.reason, 401);

    var maxPages = parseInt(data.max_pages, 10) || SEG_MAX_PAGES_PER_RUN;
    var cursor   = data.cursor || null;
    var summary  = segRunPreIAP(ctx, nk, logger, cursor, maxPages);
    summary.completed_at = new Date().toISOString();
    summary.bypass = gate.bypass;

    if (logger && logger.info) {
        logger.info("[segments] preiap run: scanned=" + summary.scanned +
            " eligible=" + summary.eligible + " fired=" + summary.fired +
            " cooldown=" + summary.cooldown_skipped);
    }
    return segOk(summary);
}

// ─── Combined run RPC ─────────────────────────────────────

function rpcSatoriSegmentsRun(ctx, logger, nk, payload) {
    var data = segParse(payload);
    var gate = segRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return segErr(gate.reason, 401);

    var maxPages = parseInt(data.max_pages, 10) || SEG_MAX_PAGES_PER_RUN;

    var winback = segRunWinback(ctx, nk, logger, null, maxPages);
    var preiap  = segRunPreIAP(ctx, nk, logger, null, maxPages);

    var summary = {
        winback: winback,
        preiap: preiap,
        completed_at: new Date().toISOString(),
        bypass: gate.bypass
    };
    segWriteMeta(nk, summary);

    if (logger && logger.info) {
        logger.info("[segments] combined run done: " +
            "winback fired=" + winback.fired + " preiap fired=" + preiap.fired);
    }
    return segOk(summary);
}

// ─── Status RPC ───────────────────────────────────────────

function rpcSatoriSegmentsStatus(ctx, logger, nk, payload) {
    var data = segParse(payload);
    var gate = segRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return segErr(gate.reason, 401);

    var meta = segReadMeta(nk);
    return segOk({
        last_run: meta || null,
        config: {
            winback: {
                inactive_days: SEG_WINBACK_INACTIVE_DAYS,
                min_quiz_plays: SEG_WINBACK_MIN_QUIZ_PLAYS,
                cooldown_days: SEG_WINBACK_COOLDOWN_SEC / 86400,
                trigger_event: "winback_eligible",
                property: "winback_segment"
            },
            preiap: {
                min_paywall_shown: SEG_PREIAP_MIN_PAYWALL_SHOWN,
                cooldown_days: SEG_PREIAP_COOLDOWN_SEC / 86400,
                trigger_event: "preiap_nudge_eligible",
                property: "preiap_segment"
            },
            scan: {
                page_size: SEG_PAGE_SIZE,
                max_pages_per_run: SEG_MAX_PAGES_PER_RUN
            }
        }
    });
}

// ─── Auto-tick hook (called from analytics_admin.js admin_login) ──

// Called from rpcAdminLogin's piggyback path so opening the dashboard
// kicks one segments run. Best-effort — failures don't break the login
// flow. Throttled by an in-memory timestamp so opening the dashboard
// twice in a minute doesn't double-fire (process-local state, resets on
// Nakama restart, which is fine).
var SEG_AUTO_LAST_RUN_MS = 0;
var SEG_AUTO_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes between auto runs

function segAutoRunIfNeeded(ctx, nk, logger) {
    var now = Date.now();
    if (now - SEG_AUTO_LAST_RUN_MS < SEG_AUTO_THROTTLE_MS) return;
    SEG_AUTO_LAST_RUN_MS = now;
    try {
        // Tight cap — auto-run only walks a couple pages so login latency
        // stays bounded. Operators can call satori_segments_run with a
        // higher max_pages for a fuller sweep.
        var winback = segRunWinback(ctx, nk, logger, null, 2);
        var preiap  = segRunPreIAP(ctx, nk, logger, null, 2);
        segWriteMeta(nk, {
            winback: winback,
            preiap: preiap,
            completed_at: new Date().toISOString(),
            source: "auto_tick"
        });
    } catch (e) {
        if (logger && logger.warn) logger.warn("[segments] auto run failed: " + (e.message || e));
    }
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("satori_register_taxonomy", rpcSatoriRegisterTaxonomy);
    initializer.registerRpc("satori_segments_winback", rpcSatoriSegmentsWinback);
    initializer.registerRpc("satori_segments_preiap", rpcSatoriSegmentsPreIAP);
    initializer.registerRpc("satori_segments_run", rpcSatoriSegmentsRun);
    initializer.registerRpc("satori_segments_status", rpcSatoriSegmentsStatus);
    if (logger && logger.info) {
        logger.info("[analytics_segments] Module registered: 5 RPCs " +
            "(satori_register_taxonomy, satori_segments_{winback,preiap,run,status})");
    }
}
