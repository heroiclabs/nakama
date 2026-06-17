// analytics_rollup.js — Phase 2.1 nightly rollup + backfill.
//
// Problem it solves:
//   analytics_dashboard today does storageRead × N days + full storageList scans
//   on every request. That's O(users × days) per page view. This module
//   pre-aggregates once per day into compact rollup docs so the dashboard
//   becomes a pure reader.
//
// Output collections (all keyed under SYSTEM_USER for easy scans):
//   analytics_rollup_daily   key: rollup_<gameId>_<YYYY-MM-DD>
//   analytics_rollup_daily   key: rollup_all_<YYYY-MM-DD>            (platform-wide)
//   analytics_retention      key: cohort_<gameId>_<YYYY-MM-DD>       (daily cohort, d1/d3/d7/d14/d30)
//   analytics_funnel_daily   key: funnel_<gameId>_<YYYY-MM-DD>
//   analytics_rollup_meta    key: last_success                       (bookkeeping)
//
// Registered RPCs:
//   analytics_rollup_run       { date?: "YYYY-MM-DD", gameIds?: string[] } admin-gated
//   analytics_rollup_backfill  { from: "YYYY-MM-DD", to: "YYYY-MM-DD", gameIds?: string[] } admin-gated
//   analytics_rollup_status    {} admin-gated
//
// Admin gating:
//   Same as analytics_admin: bearer token whose userId is registered as admin,
//   OR payload.dashboard_secret matching ctx.env.DASHBOARD_SECRET. The cron
//   sidecar uses the shared secret path so it doesn't need a login flow.
//
// Idempotent: re-running for the same date overwrites the rollup doc, no duplicates.
//
// Feature flag: ROLLUP_ENABLED="false" disables all RPCs (returns 503). Default: enabled.

var AR_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AR_ADMIN_USERS_COLLECTION = "admin_users";
var AR_ROLLUP_COLLECTION = "analytics_rollup_daily";
var AR_RETENTION_COLLECTION = "analytics_retention";
var AR_FUNNEL_COLLECTION = "analytics_funnel_daily";
var AR_META_COLLECTION = "analytics_rollup_meta";
var AR_EVENTS_COLLECTION = "analytics_events";
var AR_FIRST_SEEN_COLLECTION = "analytics_user_first_seen";
// Stores one doc per game per day: top 200 players ranked by event count.
// Read by rpcAnalyticsTopPlayers to avoid scanning raw events at request time.
var AR_TOP_PLAYERS_COLLECTION = "analytics_top_players_daily";

// Phase 4 (2026-05) — pre-aggregated rollups for the new dashboard tabs.
// Both are written by rpcAnalyticsRollupRun in the same scan-pass as the
// canonical daily rollup, so the cron only needs one trigger.
//
// analytics_modes_daily   key: modes_<gameId>_<YYYY-MM-DD>
//   per-quiz-mode breakdown: sessions, users, completes, abandons, revenue,
//   ad-impressions, avg session seconds, top categories. Powers the "Quiz
//   Modes" dashboard tab and the per-mode global filter without forcing it
//   to re-scan analytics_events live.
//
// analytics_dropoff_daily key: dropoff_<gameId>_<YYYY-MM-DD>
//   churn-signal counts (cold_start_no_quiz, onboarding_abandoned,
//   quiz_abandoned, pre_iap_drop, streak_broken, screen_left), plus a
//   per-question abandonment histogram (last_question_index → count) and
//   a per-screen exit-rate map. Powers the "Drop-off & Churn" tab.
var AR_MODES_COLLECTION    = "analytics_modes_daily";
var AR_DROPOFF_COLLECTION  = "analytics_dropoff_daily";
// Phase 4 — pre-aggregated per-question and per-offer read models.
// Written by rpcAnalyticsRollupRun in the same scan pass; read by
// rpcAnalyticsQuestionDailyRead and rpcAnalyticsOfferDailyRead (below),
// and by the analytics_read_models module for multi-day aggregations.
var AR_QUESTION_COLLECTION = "analytics_question_daily";
var AR_OFFER_COLLECTION    = "analytics_offer_daily";

// Legacy → canonical event-name aliases. Must match EVENT_ALIASES in
// analytics.js so events ingested with the old names (before analytics.js
// began normalizing at write time) still roll up against the canonical
// names used by AR_FUNNEL_STEPS and monetization/retention KPIs.
var AR_EVENT_ALIASES = {
    "quiz_started": "quiz_start",
    "quiz_completed": "quiz_complete",
    "quiz_session_completed": "quiz_complete",
    "quiz_abandon": "quiz_abandoned",
    "purchase_completed": "iap_purchased",
    "purchase_started": "iap_clicked",
    "iap_completed": "iap_purchased",
    "iap_started": "iap_clicked",
    "iap_purchase_completed": "iap_purchased",
    "iap_purchase_started": "iap_clicked",
    "login_succeeded": "login_success",
    "onboarding_completed": "onboarded",
    "onboarding_complete": "onboarded",
    "registration_completed": "registration_complete",
    "paywall_viewed": "paywall_shown",
    "paywall_view": "paywall_shown",
    // ── 2026-04 Unity analytics-hardening additions (mirror analytics.js) ──
    "ad_failed": "ad_load_failed",
    "purchase_failed": "iap_failed",
    "ad_started": "ad_shown"
};

// Canonical error categories that should fold into the rollup's
// errors_by_category map. The new client (QVAnalyticsService /
// AnalyticsConstants.cs PRODUCTION HARDENING block) emits these as
// dedicated events instead of stuffing everything into "error_logged".
// Each name here is treated as `error_logged` for aggregation purposes
// and uses the event name itself as the category bucket.
var AR_ERROR_EVENT_CATEGORIES = {
    "error_logged":      "uncategorized",
    "api_failure":       "api_failure",
    "auth_failure":      "auth_failure",
    "nakama_rpc_error":  "nakama_rpc_error",
    "timeout_event":     "timeout",
    "crash_safe_log":    "crash_safe"
};

// Canonical funnel order (must match IVXAnalyticsEvents in the Unity client).
var AR_FUNNEL_STEPS = [
    "app_open",
    "onboarded",
    "login_success",
    "session_start",
    "quiz_start",
    "quiz_complete",
    "iap_clicked",
    "iap_purchased"
];

// Retention windows we compute for each cohort (days since first-seen).
var AR_RETENTION_WINDOWS = [1, 3, 7, 14, 30];

// ─── Helpers ──────────────────────────────────────────────

// Resolve game-id slugs (e.g. "quizverse") to canonical UUIDs so the
// rollup writes a single document per game even when legacy clients are
// still emitting slug-style identifiers.
function arResolveGameId(gameId) {
    if (!gameId) return gameId;
    try {
        if (typeof resolveGameIdAlias === "function") {
            return resolveGameIdAlias(gameId);
        }
    } catch (e) { /* helper not bundled yet — fall through */ }
    return gameId;
}

function arParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function arOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (data.hasOwnProperty(k)) out[k] = data[k];
    return JSON.stringify(out);
}

function arErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function arEnv(ctx, key) {
    // Mirror analytics_admin.js::aaEnv — DASHBOARD_SECRET is hardcoded-FIRST
    // (env IGNORED) so the auto-drain state machine's synthetic admin gate
    // never breaks when the cluster has a different DASHBOARD_SECRET set.
    // Other rollup keys (ROLLUP_ENABLED etc.) stay env-driven.
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
    }
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null) {
        var v = String(ctx.env[key]);
        if (v.length > 0) return v;
    }
    return "";
}

function arFeatureEnabled(ctx) {
    var v = arEnv(ctx, "ROLLUP_ENABLED");
    if (v === "" || v === "true" || v === "1") return true;
    return false;
}

/**
 * Admin check mirrors analytics_admin.aaIsAdminUser: the "admin:" prefix
 * gate runs against ctx.username (the custom_id), and the admin_users/profile
 * doc is keyed by Nakama's UUID (ctx.userId).
 */
function arIsAdminUser(nk, logger, userId, username) {
    if (!userId) return false;
    if (!username || username.indexOf("admin:") !== 0) return false;
    try {
        var records = nk.storageRead([{ collection: AR_ADMIN_USERS_COLLECTION, key: "profile", userId: userId }]);
        if (!records || records.length === 0) return false;
        var rec = records[0].value || {};
        if (!rec.isAdmin) return false;
        if (rec.expiresAt && rec.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function arRequireAdmin(ctx, nk, logger, data) {
    var secret = arEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (ctx.userId && arIsAdminUser(nk, logger, ctx.userId, ctx.username)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function arIsoDate(d) { return d.toISOString().slice(0, 10); }

function arValidDateStr(s) {
    if (!s || typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + "T00:00:00.000Z");
    return !isNaN(d.getTime());
}

function arYesterday() {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return arIsoDate(d);
}

function arDateRange(from, to) {
    var out = [];
    var start = new Date(from + "T00:00:00.000Z");
    var end = new Date(to + "T00:00:00.000Z");
    if (end < start) return out;
    for (var d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(arIsoDate(d));
        if (out.length > 366) break; // hard cap: 1 year at a time
    }
    return out;
}

function arReadOne(nk, collection, key, userId) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: userId || AR_SYSTEM_USER }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function arWriteOne(nk, collection, key, userId, value) {
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId || AR_SYSTEM_USER,
            value: value,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) {
        // Return the error message so callers can decide whether to fail or warn.
        return { ok: false, error: e.message || String(e) };
    }
}

// ─── Core: scan events for one day ────────────────────────

/**
 * Streams analytics_events under SYSTEM_USER and collects records falling on `dateStr`.
 * Returns { events: [...], scanned, truncated, nextCursor }.
 *
 * Note: we rely on the dashboard-fanout copy written by persistNormalizedEvent,
 * which is keyed as `dash_<gameId>_<YYYY-MM-DD>_...`. Scanning under SYSTEM_USER
 * avoids cross-user reads and is the cheapest path. Nakama's JS nk.storageList
 * has no key-prefix filtering, so we must walk the whole collection and filter
 * in memory; there is no per-day key index to read instead.
 *
 * `startCursor` (optional) resumes a previous truncated scan. When the page
 * cap is hit, `truncated` is true and `nextCursor` is the storageList cursor
 * to resume from — the caller checkpoints it and re-invokes later instead of
 * aborting (see rpcAnalyticsRollupRun).
 */
function arScanEventsForDate(nk, logger, dateStr, startCursor) {
    var events = [];
    var scanned = 0;
    var truncated = false;
    var cursor = startCursor || null;
    var pagesScanned = 0;
    // The dashboard-fanout copies (dash_*) accumulate across all days in one
    // collection, so a day's rollup must page the whole collection and filter by
    // timestamp in-memory. The old fixed 100-page (10k-object) cap made every
    // backfill day abort once the collection grew past 10k objects. Govern by a
    // wall-clock budget that stays safely under the 30s RPC gateway timeout
    // instead, with a large hard page ceiling only as an anti-runaway guard.
    // When the budget runs out mid-collection, the caller checkpoints
    // `nextCursor` and resumes on the next invocation (see rpcAnalyticsRollupRun)
    // instead of aborting.
    var pageSize = 100;
    var maxPages = 5000;        // anti-runaway ceiling (≈500k objects); the time budget below is the real governor
    // 15s, not 22s: in prod the HTTP context dies at ~22s (observed 2026-06-10:
    // responses written after that get "empty reply" and storage ops fail with
    // "context canceled"), so leave real headroom for checkpoint writes and the
    // response itself.
    var scanBudgetMs = 15000;
    var startMs = Date.now();
    var dayStart = Math.floor(new Date(dateStr + "T00:00:00.000Z").getTime() / 1000);
    var dayEnd = dayStart + 86400;
    var page = null;

    for (var p = 0; p < maxPages; p++) {
        if (Date.now() - startMs > scanBudgetMs) {
            // Ran out of time budget before exhausting the collection.
            if (page && page.cursor) truncated = true;
            break;
        }
        pagesScanned++;
        try {
            page = nk.storageList(AR_SYSTEM_USER, AR_EVENTS_COLLECTION, pageSize, cursor);
        } catch (e) {
            logger.warn("[analytics_rollup] storageList failed: " + e.message);
            break;
        }
        if (!page || !page.objects || page.objects.length === 0) break;

        for (var i = 0; i < page.objects.length; i++) {
            scanned++;
            var o = page.objects[i];
            if (!o || !o.value) continue;
            // Only consider the dashboard-fanout copies; user-owned event copies are duplicates
            // and would double-count aggregates. The dash_ prefix is written by
            // analytics.js::persistNormalizedEvent.
            if (!o.key || o.key.indexOf("dash_") !== 0) continue;

            var ev = o.value;
            var unix = ev.unixTimestamp;
            if (!unix && ev.timestamp) unix = Math.floor(new Date(ev.timestamp).getTime() / 1000);
            if (!unix) continue;
            if (unix < dayStart || unix >= dayEnd) continue;

            // Normalize event-derived gameId at the source so every downstream
            // consumer (rollup, first-seen, retention, funnels) sees the same
            // canonical UUID. Legacy events emitted with slug like "quizverse"
            // are folded into 126bf539-... here.
            if (ev.gameId) ev.gameId = arResolveGameId(ev.gameId);

            events.push(ev);
        }

        if (!page.cursor) break;
        cursor = page.cursor;
    }

    if (pagesScanned >= maxPages && page && page.cursor) truncated = true;
    // `cursor` already holds the last page's cursor (assigned at loop bottom),
    // i.e. the exact resume point for the next invocation.
    return { events: events, scanned: scanned, truncated: truncated, nextCursor: truncated ? cursor : null };
}

/**
 * Multi-date variant of arScanEventsForDate: one collection walk that buckets
 * matched events by their UTC date for every date in [fromUnix, toUnix).
 * A 23-day backfill costs ONE walk of analytics_events instead of 23
 * (observed prod scan rate is only ~230 objects/sec, so per-date walks of a
 * 180k+ object collection make backfills take hours per date).
 *
 * Returns { byDate: {"YYYY-MM-DD": [events]}, scanned, truncated, nextCursor }.
 */
function arScanEventsForRange(nk, logger, fromUnix, toUnix, startCursor) {
    var byDate = {};
    var scanned = 0;
    var truncated = false;
    var cursor = startCursor || null;
    var pagesScanned = 0;
    var pageSize = 100;
    var maxPages = 5000;
    var scanBudgetMs = 15000;
    var startMs = Date.now();
    var page = null;

    for (var p = 0; p < maxPages; p++) {
        if (Date.now() - startMs > scanBudgetMs) {
            if (page && page.cursor) truncated = true;
            break;
        }
        pagesScanned++;
        try {
            page = nk.storageList(AR_SYSTEM_USER, AR_EVENTS_COLLECTION, pageSize, cursor);
        } catch (e) {
            logger.warn("[analytics_rollup] storageList failed: " + e.message);
            break;
        }
        if (!page || !page.objects || page.objects.length === 0) break;

        for (var i = 0; i < page.objects.length; i++) {
            scanned++;
            var o = page.objects[i];
            if (!o || !o.value) continue;
            if (!o.key || o.key.indexOf("dash_") !== 0) continue;

            var ev = o.value;
            var unix = ev.unixTimestamp;
            if (!unix && ev.timestamp) unix = Math.floor(new Date(ev.timestamp).getTime() / 1000);
            if (!unix) continue;
            if (unix < fromUnix || unix >= toUnix) continue;

            if (ev.gameId) ev.gameId = arResolveGameId(ev.gameId);

            var dStr = arIsoDate(new Date(unix * 1000));
            if (!byDate[dStr]) byDate[dStr] = [];
            byDate[dStr].push(ev);
        }

        if (!page.cursor) break;
        cursor = page.cursor;
    }

    if (pagesScanned >= maxPages && page && page.cursor) truncated = true;
    return { byDate: byDate, scanned: scanned, truncated: truncated, nextCursor: truncated ? cursor : null };
}

// ─── Core: resumable-scan checkpoint (analytics_rollup_meta) ───────────────
//
// When a day's event scan exceeds the per-invocation page cap, we persist the
// storageList cursor plus the events accumulated so far instead of aborting
// with 507. The next analytics_rollup_run invocation for the same date
// resumes from the saved cursor and merges. Events are stored in chunked docs
// (AR_SCAN_CHUNK_SIZE each) so no single storage value grows unbounded.
//
//   analytics_rollup_meta  key: scan_checkpoint_<YYYY-MM-DD>   {cursor, scannedSoFar, chunkCount, eventsSoFar, updatedAt}
//   analytics_rollup_meta  key: scan_events_<YYYY-MM-DD>_<n>   {events: [...]}

var AR_SCAN_CHUNK_SIZE = 1000;

function arScanCheckpointKey(dateStr) { return "scan_checkpoint_" + dateStr; }

function arScanCheckpointRead(nk, dateStr) {
    return arReadOne(nk, AR_META_COLLECTION, arScanCheckpointKey(dateStr), AR_SYSTEM_USER);
}

/**
 * Appends `events` to the checkpoint's chunked event store, starting at chunk
 * index `startChunk`. Returns the new total chunk count, or -1 on write error.
 */
function arScanCheckpointAppendEvents(nk, logger, dateStr, events, startChunk) {
    var chunk = startChunk;
    for (var i = 0; i < events.length; i += AR_SCAN_CHUNK_SIZE) {
        var slice = events.slice(i, i + AR_SCAN_CHUNK_SIZE);
        var w = arWriteOne(nk, AR_META_COLLECTION, "scan_events_" + dateStr + "_" + chunk, AR_SYSTEM_USER, { events: slice });
        if (w !== true) {
            logger.error("[analytics_rollup] checkpoint chunk write failed for " + dateStr + " chunk=" + chunk + ": " + (w.error || "write failed"));
            return -1;
        }
        chunk++;
    }
    return chunk;
}

/** Reads all persisted event chunks for a date back into one array. */
function arScanCheckpointLoadEvents(nk, logger, dateStr, chunkCount) {
    var out = [];
    for (var c = 0; c < chunkCount; c++) {
        var doc = arReadOne(nk, AR_META_COLLECTION, "scan_events_" + dateStr + "_" + c, AR_SYSTEM_USER);
        if (doc && doc.events && doc.events.length) {
            for (var i = 0; i < doc.events.length; i++) out.push(doc.events[i]);
        } else {
            logger.warn("[analytics_rollup] checkpoint chunk missing/empty for " + dateStr + " chunk=" + c);
        }
    }
    return out;
}

/** Deletes the checkpoint doc and all event chunks for a date. Best-effort. */
function arScanCheckpointClear(nk, logger, dateStr, chunkCount) {
    try {
        var dels = [{ collection: AR_META_COLLECTION, key: arScanCheckpointKey(dateStr), userId: AR_SYSTEM_USER }];
        for (var c = 0; c < (chunkCount || 0); c++) {
            dels.push({ collection: AR_META_COLLECTION, key: "scan_events_" + dateStr + "_" + c, userId: AR_SYSTEM_USER });
        }
        nk.storageDelete(dels);
    } catch (e) {
        logger.warn("[analytics_rollup] checkpoint clear failed for " + dateStr + ": " + (e.message || e));
    }
}

// ─── Core: first-seen upsert for per-day new_users + retention cohorts ──────

/**
 * For each userId in `userIds`, ensure analytics_user_first_seen/<first_uid_gid>
 * exists and reflects the earliest date we've seen the user. Returns:
 *   { newUsers: { uid: true, ... }, firstSeen: { uid: "YYYY-MM-DD", ... } }
 *
 * Algorithm:
 *   - Batch-read existing first-seen docs.
 *   - If none exists → create with firstSeenDate = dateStr (version:"*"). User
 *     is "new" today.
 *   - If existing.firstSeenDate > dateStr → backfill is seeing an earlier
 *     appearance; update doc (version-checked) and mark user as "new" for
 *     THIS earlier date. The old cohort doc at the later date stays correct
 *     because its cohort was based on the old firstSeenDate; retention
 *     reporting uses first-seen date at query time.
 *   - If existing.firstSeenDate === dateStr → "new" today.
 *   - Otherwise the user is returning.
 */
function arUpsertFirstSeen(nk, logger, gameId, userIds, dateStr) {
    var result = { newUsers: {}, firstSeen: {} };
    // Defensive aliasing: if a caller hands us a slug like "quizverse" we
    // canonicalize before reading/writing so first_seen keys stay consistent
    // across legacy and current event streams.
    gameId = arResolveGameId(gameId);
    if (!gameId || gameId === "all" || !userIds || userIds.length === 0) return result;

    var batchSize = 50;
    for (var bs = 0; bs < userIds.length; bs += batchSize) {
        var batch = userIds.slice(bs, bs + batchSize);
        var reqs = [];
        for (var i = 0; i < batch.length; i++) {
            reqs.push({
                collection: AR_FIRST_SEEN_COLLECTION,
                key: "first_" + batch[i] + "_" + gameId,
                userId: AR_SYSTEM_USER
            });
        }
        var recs = [];
        try { recs = nk.storageRead(reqs) || []; } catch (e) { recs = []; }
        var existingByUser = {};
        for (var r = 0; r < recs.length; r++) {
            var rec = recs[r];
            if (rec && rec.value && rec.value.userId) {
                existingByUser[rec.value.userId] = { value: rec.value, version: rec.version };
            }
        }

        for (var j = 0; j < batch.length; j++) {
            var uid = batch[j];
            var ex = existingByUser[uid];
            var writeOp = null;
            if (!ex) {
                writeOp = {
                    collection: AR_FIRST_SEEN_COLLECTION,
                    key: "first_" + uid + "_" + gameId,
                    userId: AR_SYSTEM_USER,
                    value: { userId: uid, gameId: gameId, firstSeenDate: dateStr },
                    permissionRead: 2, permissionWrite: 0,
                    version: "*"
                };
                result.firstSeen[uid] = dateStr;
                result.newUsers[uid] = true;
            } else if (ex.value.firstSeenDate > dateStr) {
                writeOp = {
                    collection: AR_FIRST_SEEN_COLLECTION,
                    key: "first_" + uid + "_" + gameId,
                    userId: AR_SYSTEM_USER,
                    value: { userId: uid, gameId: gameId, firstSeenDate: dateStr },
                    permissionRead: 2, permissionWrite: 0,
                    version: ex.version
                };
                result.firstSeen[uid] = dateStr;
                result.newUsers[uid] = true;
            } else {
                result.firstSeen[uid] = ex.value.firstSeenDate;
                if (ex.value.firstSeenDate === dateStr) result.newUsers[uid] = true;
            }

            if (writeOp) {
                try { nk.storageWrite([writeOp]); }
                catch (e) {
                    // Race loser — someone else seeded this user first-seen doc
                    // between our read and write. Re-read to learn the winner's
                    // date. If their firstSeenDate <= ours, the user is NOT new
                    // for us; unmark. If > ours (shouldn't happen given sort),
                    // keep marked as new.
                    try {
                        var reread = nk.storageRead([{
                            collection: AR_FIRST_SEEN_COLLECTION,
                            key: writeOp.key, userId: AR_SYSTEM_USER
                        }]);
                        if (reread && reread.length > 0 && reread[0].value) {
                            var winnerDate = reread[0].value.firstSeenDate;
                            result.firstSeen[uid] = winnerDate;
                            if (winnerDate !== dateStr) delete result.newUsers[uid];
                        }
                    } catch (e2) { /* ignore */ }
                }
            }
        }
    }
    return result;
}

// ─── Core: compute rollup from events for ONE gameId ──────

function arComputeRollup(events, gameId, dateStr, newUsersSet) {
    // Defensive: caller may have passed the slug; canonicalize so the
    // ev.gameId !== gameId filter below matches normalized events.
    gameId = arResolveGameId(gameId);
    var activeUsers = {};
    var sessions = {
        starts: 0,
        ends: 0,
        total_duration_seconds: 0
    };
    var eventCounts = {};
    var screenViews = {};
    var screenTotalTimeMs = {};
    var platforms = {};
    var revenueUsd = 0;
    var iapCount = 0;
    var adImpressions = 0;
    var adClicks = 0;
    var adRevenueUsd = 0;
    // 2026-04 hardening: track the full ad funnel so dashboards can compute
    // request → impression → revenue → completion rates instead of only
    // counting impressions. Populated by the canonical AD_* events emitted
    // from MonetizationAnalytics + AdsAnalyticsBridge in the new Unity client.
    var adRequests = 0;       // ad_requested
    var adLoadFailures = 0;   // ad_load_failed (and legacy "ad_failed" via alias)
    var adCompletions = 0;    // ad_completed (rewarded watched-to-end)
    var adSkips = 0;          // ad_skipped (rewarded closed early)
    var adRevenueByNetwork = {}; // network → usd (ILRD-grade attribution)

    // Phase 4 (2026-05) — extra monetization KPIs surfaced through the
    // dashboard's Revenue panel. The previous dashboard live-scan path
    // computed these by re-walking analytics_events on every page load —
    // moving them into the rollup means the panel can render from one
    // single document read.
    var paywallShown = 0;
    var paywallConverted = 0;
    var paywallDismissed = 0;
    var storeOpens = 0;
    var iapStarted = 0;
    var iapFailed = 0;
    var productPurchases = {};   // product_id → count
    var adTypeCounts = {};       // ad_type    → count

    // Phase 4 (2026-05) — audience-breakdown dimensions (country / platform /
    // device_tier / install_source / consent_state / att_status / locale /
    // app_version). Each dimension is a {value: {events, users:{}}} bag so
    // we can emit both event volume AND unique-user counts (the latter is
    // the only meaningful slice for "X% of installs are from US"). Keys
    // are folded into "unknown" when missing so the dashboard can show
    // tagging coverage gaps.
    var audDims = {
        country: {}, device_tier: {}, install_source: {},
        consent_state: {}, att_status: {}, locale: {}, app_version: {},
        platform: {}
    };
    function audBump(dim, val, userId) {
        if (val === null || val === undefined || val === "") val = "unknown";
        var k = String(val);
        var slot = audDims[dim];
        if (!slot[k]) slot[k] = { events: 0, users: {} };
        slot[k].events++;
        if (userId) slot[k].users[userId] = true;
    }

    // Phase 4 — explicit retention_d1/7/30 milestone counts so the
    // dashboard's Retention tab can render straight from the rollup.
    var retentionMilestones = { retention_d1: 0, retention_d7: 0, retention_d30: 0 };

    var aiUsage = {};
    var funnel = {};
    for (var fi = 0; fi < AR_FUNNEL_STEPS.length; fi++) {
        funnel[AR_FUNNEL_STEPS[fi]] = { users: {}, count: 0 };
    }
    var errorsByCategory = {};

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (gameId && gameId !== "all" && ev.gameId !== gameId) continue;

        var userId = ev.userId || "";
        var eventName = ev.eventName || "";
        var data = ev.eventData || {};

        // Legacy → canonical alias. Clients emit "quiz_started", "purchase_completed",
        // "iap_started", etc.; we fold them into the canonical names used by
        // AR_FUNNEL_STEPS and monetization KPIs. Mirrors analytics.js
        // normalizeInboundEvent so rollup is robust even for events ingested
        // before the write-time alias was introduced.
        if (AR_EVENT_ALIASES[eventName]) eventName = AR_EVENT_ALIASES[eventName];

        if (userId) activeUsers[userId] = true;
        if (eventName) eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;

        if (data.platform) platforms[data.platform] = (platforms[data.platform] || 0) + 1;

        // Funnel
        if (funnel[eventName]) {
            if (userId) funnel[eventName].users[userId] = true;
            funnel[eventName].count++;
        }

        // Sessions
        if (eventName === "session_start") {
            sessions.starts++;
        } else if (eventName === "session_end") {
            sessions.ends++;
            var dur = parseFloat(data.duration_seconds || data.durationSeconds || 0);
            if (isFinite(dur) && dur > 0 && dur < 86400) {
                sessions.total_duration_seconds += dur;
            }
        }

        // Screens
        if (eventName === "screen_view" && data.screen_name) {
            screenViews[data.screen_name] = (screenViews[data.screen_name] || 0) + 1;
            var t = parseFloat(data.time_on_previous_ms || 0);
            if (isFinite(t) && t > 0 && t < 1800000) {
                screenTotalTimeMs[data.screen_name] = (screenTotalTimeMs[data.screen_name] || 0) + t;
            }
        }

        // Revenue — IAP purchase completion. Both legacy `iap_purchased`
        // and the canonical `purchase_completed` (Phase 2 IAP taxonomy)
        // count as a paid IAP; AR_EVENT_ALIASES already collapses
        // purchase_completed → iap_purchased, but we accept both names
        // explicitly here so the rollup is robust even if the alias is
        // ever turned off. Track product_id breakdown for the Revenue
        // panel's top-products card.
        if (eventName === "iap_purchased" || eventName === "purchase_completed") {
            iapCount++;
            var price = parseFloat(data.price_usd || data.priceUsd || data.revenue_usd || data.revenueUsd || data.amount_usd || data.amountUsd || data.price || data.amount || data.value || 0);
            if (isFinite(price) && price > 0) revenueUsd += price;
            var prodId = data.product_id || data.productId;
            if (prodId) productPurchases[prodId] = (productPurchases[prodId] || 0) + 1;
        }
        // Fix SR-9: AR_EVENT_ALIASES already ran above so "purchase_started" and
        // "iap_started" are now "iap_clicked" by the time we reach here.
        // Using the pre-alias names caused iapStarted to always be 0 in the rollup.
        if (eventName === "iap_clicked") iapStarted++;
        if (eventName === "iap_failed")  iapFailed++;
        if (eventName === "paywall_shown")     paywallShown++;
        if (eventName === "paywall_converted") paywallConverted++;
        if (eventName === "paywall_dismissed") paywallDismissed++;
        if (eventName === "store_opened")      storeOpens++;
        // ── Ad funnel (2026-04 hardened taxonomy) ────────────────
        // The new Unity client emits canonical AD_* events. Both `ad_impression`
        // (legacy) and `ad_shown` (canonical) are counted as impressions so
        // dashboards continue to work during the migration window with
        // no double-counting (a single ad fires either name, not both).
        // ILRD revenue arrives on a dedicated `ad_revenue` event with
        // `revenue_usd` — fold those into adRevenueUsd as well.
        if (eventName === "ad_impression" || eventName === "ad_shown") {
            adImpressions++;
            // Inline revenue (some adapters report on the impression event).
            var adRevInline = parseFloat(data.revenue_usd || 0);
            if (isFinite(adRevInline) && adRevInline > 0) {
                adRevenueUsd += adRevInline;
                if (data.ad_network) {
                    adRevenueByNetwork[data.ad_network] =
                        (adRevenueByNetwork[data.ad_network] || 0) + adRevInline;
                }
            }
        } else if (eventName === "ad_revenue") {
            // Dedicated ILRD revenue event from MonetizationAnalytics.TrackAdRevenue.
            var adRevDed = parseFloat(data.revenue_usd || data.revenue || 0);
            if (isFinite(adRevDed) && adRevDed > 0) {
                adRevenueUsd += adRevDed;
                if (data.ad_network) {
                    adRevenueByNetwork[data.ad_network] =
                        (adRevenueByNetwork[data.ad_network] || 0) + adRevDed;
                }
            }
        } else if (eventName === "ad_clicked") {
            adClicks++;
        } else if (eventName === "ad_requested") {
            adRequests++;
        } else if (eventName === "ad_load_failed") {
            adLoadFailures++;
        } else if (eventName === "ad_completed") {
            adCompletions++;
        } else if (eventName === "ad_skipped") {
            adSkips++;
        }

        // Ad-type breakdown — accept both legacy `adType` and canonical
        // `ad_type`. Counted on impression events only so we don't
        // double-count requests/clicks/etc.
        if (eventName === "ad_impression" || eventName === "ad_shown") {
            var adType = data.ad_type || data.adType;
            if (adType) adTypeCounts[adType] = (adTypeCounts[adType] || 0) + 1;
        }

        // Phase 4 — retention milestones (RetentionAnalytics.cs fires once
        // per install). Captured directly so the dashboard can read the
        // retention tab from the rollup instead of scanning ~30 days of
        // events per page load.
        if (eventName === "retention_day_1" || eventName === "retention_d1") retentionMilestones.retention_d1++;
        if (eventName === "retention_day_7" || eventName === "retention_d7") retentionMilestones.retention_d7++;
        if (eventName === "retention_day_30" || eventName === "retention_d30") retentionMilestones.retention_d30++;

        // Phase 4 — audience-breakdown dimensions. Read every event so the
        // distribution reflects the active population, not just events
        // that happen to carry a particular field. Falls back to "unknown".
        audBump("country",        data.country,        userId);
        audBump("device_tier",    data.device_tier,    userId);
        audBump("install_source", data.install_source, userId);
        audBump("consent_state",  data.consent_state,  userId);
        audBump("att_status",     data.att_status,     userId);
        audBump("locale",         data.locale,         userId);
        audBump("app_version",    data.app_version,    userId);
        audBump("platform",       data.platform || ev.platform, userId);

        // AI
        if (eventName === "ai_host_used" || eventName === "ai_fortune_teller_used" ||
            eventName === "ai_hint_used" || eventName === "ai_question_generated") {
            aiUsage[eventName] = (aiUsage[eventName] || 0) + 1;
        }

        // Errors — fold the new canonical error events plus the legacy
        // catch-all `error_logged` into one bucket for the dashboard.
        // For dedicated event types (api_failure, auth_failure, etc.) we use
        // the event name itself as the category fallback so operators can
        // still see the breakdown without depending on data.error_category.
        if (AR_ERROR_EVENT_CATEGORIES.hasOwnProperty(eventName)) {
            var errCat = data.error_category ||
                         AR_ERROR_EVENT_CATEGORIES[eventName] ||
                         "unknown";
            errorsByCategory[errCat] = (errorsByCategory[errCat] || 0) + 1;
        }
    }

    var funnelOut = {};
    var funnelOrder = [];
    for (var fj = 0; fj < AR_FUNNEL_STEPS.length; fj++) {
        var step = AR_FUNNEL_STEPS[fj];
        var entry = funnel[step] || { users: {}, count: 0 };
        var uniq = Object.keys(entry.users).length;
        funnelOut[step] = { users: uniq, total_events: entry.count };
        funnelOrder.push({ step: step, users: uniq, total_events: entry.count });
    }

    var avgSessionSeconds = sessions.ends > 0
        ? Math.round(sessions.total_duration_seconds / sessions.ends)
        : 0;

    var topEvents = [];
    for (var en in eventCounts) topEvents.push({ event_name: en, count: eventCounts[en] });
    topEvents.sort(function (a, b) { return b.count - a.count; });
    topEvents = topEvents.slice(0, 20);

    var topScreens = [];
    for (var sn in screenViews) {
        var views = screenViews[sn];
        var avgMs = screenTotalTimeMs[sn] ? Math.round(screenTotalTimeMs[sn] / views) : 0;
        topScreens.push({ screen_name: sn, views: views, avg_time_ms: avgMs });
    }
    topScreens.sort(function (a, b) { return b.views - a.views; });
    topScreens = topScreens.slice(0, 20);

    var platformBreakdown = [];
    for (var pn in platforms) platformBreakdown.push({ platform: pn, events: platforms[pn] });
    platformBreakdown.sort(function (a, b) { return b.events - a.events; });

    var newUsersCount = 0;
    if (newUsersSet) {
        // Only count new users who actually showed up in this game's events.
        for (var nu in newUsersSet) {
            if (newUsersSet.hasOwnProperty(nu) && activeUsers[nu]) newUsersCount++;
        }
    }

    return {
        gameId: gameId || "all",
        date: dateStr,
        dau: Object.keys(activeUsers).length,
        new_users: newUsersCount,
        sessions: {
            count: sessions.ends,                          // completed sessions
            starts: sessions.starts,
            total_duration_seconds: Math.round(sessions.total_duration_seconds),
            avg_duration_seconds: avgSessionSeconds
        },
        revenue: {
            usd: Math.round(revenueUsd * 100) / 100,
            iap_count: iapCount,
            ad_revenue_usd: Math.round(adRevenueUsd * 100) / 100,
            ad_impressions: adImpressions,
            ad_clicks: adClicks,
            // 2026-04 hardening — full ad funnel (request → impression → completion).
            ad_requests: adRequests,
            ad_load_failures: adLoadFailures,
            ad_completions: adCompletions,
            ad_skips: adSkips,
            ad_fill_rate_pct: adRequests > 0
                ? Math.round((adImpressions / adRequests) * 100)
                : 0,
            ad_completion_rate_pct: adImpressions > 0
                ? Math.round((adCompletions / adImpressions) * 100)
                : 0,
            ad_revenue_by_network: adRevenueByNetwork,
            ad_ecpm_usd: adImpressions > 0
                ? Math.round((adRevenueUsd / adImpressions) * 100000) / 100  // $/1000 imp
                : 0,
            // Phase 4 — IAP funnel + product breakdown so the Revenue
            // panel reads everything it needs from this one doc.
            iap_started: iapStarted,
            iap_failed: iapFailed,
            paywall_shown: paywallShown,
            paywall_converted: paywallConverted,
            paywall_dismissed: paywallDismissed,
            paywall_conversion_rate_pct: paywallShown > 0
                ? Math.round((paywallConverted / paywallShown) * 100)
                : 0,
            store_opens: storeOpens,
            top_products: arTopN(productPurchases, 10, "product_id", "purchases"),
            ad_types: arTopN(adTypeCounts, 5, "type", "count")
        },
        funnel: funnelOut,
        funnel_order: funnelOrder,
        ai_usage: aiUsage,
        top_events: topEvents,
        top_screens: topScreens,
        platform_breakdown: platformBreakdown,
        errors: errorsByCategory,
        // Phase 4 — retention + audience breakdown, computed once per day
        // and surfaced through their dedicated dashboard RPCs.
        retention_milestones: retentionMilestones,
        audience: {
            country:        arMaterializeAud(audDims.country, 25),
            platform:       arMaterializeAud(audDims.platform, 10),
            device_tier:    arMaterializeAud(audDims.device_tier, 10),
            install_source: arMaterializeAud(audDims.install_source, 10),
            consent_state:  arMaterializeAud(audDims.consent_state, 10),
            att_status:     arMaterializeAud(audDims.att_status, 10),
            locale:         arMaterializeAud(audDims.locale, 25),
            app_version:    arMaterializeAud(audDims.app_version, 25)
        },
        computed_at: new Date().toISOString(),
        event_count: events.length
    };
}

// Phase 4 helpers — used inside arComputeRollup. Defined as module-scope
// functions (not closures) so postbuild concatenation can hoist them
// alongside the rest of the analytics_rollup symbols.
function arTopN(map, n, keyName, valueName) {
    var arr = [];
    for (var k in map) {
        if (map.hasOwnProperty(k)) {
            var entry = {};
            entry[keyName] = k;
            entry[valueName] = map[k];
            arr.push(entry);
        }
    }
    arr.sort(function (a, b) { return b[valueName] - a[valueName]; });
    return arr.slice(0, n);
}

/**
 * Compute top-players leaderboard from a single day's events.
 * Called inside the rollup run so it piggy-backs the existing event scan
 * and avoids any additional storageList calls at read time.
 *
 * The result is written to AR_TOP_PLAYERS_COLLECTION as
 *   "top_players_<gameId>_<dateStr>"
 * and the RPC merges N days of these docs to produce the final ranking.
 */
function arComputeTopPlayers(events, gameId, dateStr) {
    gameId = arResolveGameId(gameId);
    var playerStats = {};

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (gameId && gameId !== "all" && ev.gameId !== gameId) continue;

        var userId = ev.userId;
        if (!userId) continue;

        if (!playerStats[userId]) {
            playerStats[userId] = {
                user_id: userId,
                total_events: 0,
                quiz_completed: 0,
                daily_quizzes: 0,
                ai_events: 0,
                sessions: 0,
                purchases: 0,
                total_score: 0,
                last_active: ev.timestamp || dateStr,
                game_id: gameId
            };
        }

        var ps = playerStats[userId];
        ps.total_events++;

        var evName = (ev.eventName || "").toLowerCase();
        var evData = ev.eventData || {};

        if (evName.indexOf("quiz_completed") !== -1 || evName.indexOf("quizcompleted") !== -1) {
            ps.quiz_completed++;
            ps.total_score += evData.score || 0;
        }
        if (evName.indexOf("daily") !== -1) ps.daily_quizzes++;
        if (evName.indexOf("ai") !== -1 || evName.indexOf("voice") !== -1) ps.ai_events++;
        if (evName.indexOf("session") !== -1) ps.sessions++;
        if (evName.indexOf("purchase") !== -1 || evName.indexOf("iap") !== -1) ps.purchases++;

        if (ev.timestamp && ev.timestamp > ps.last_active) {
            ps.last_active = ev.timestamp;
        }
    }

    var players = [];
    for (var uid in playerStats) {
        if (playerStats.hasOwnProperty(uid)) players.push(playerStats[uid]);
    }
    players.sort(function(a, b) { return b.total_events - a.total_events; });

    return {
        gameId: gameId || "all",
        date: dateStr,
        players: players.slice(0, 200),
        computed_at: new Date().toISOString()
    };
}

function arMaterializeAud(dimSlot, topN) {
    var arr = [];
    for (var k in dimSlot) {
        if (!dimSlot.hasOwnProperty(k)) continue;
        var entry = dimSlot[k];
        arr.push({
            value: k,
            events: entry.events,
            unique_users: entry.users ? Object.keys(entry.users).length : 0
        });
    }
    arr.sort(function (a, b) {
        return (b.unique_users - a.unique_users) || (b.events - a.events);
    });
    return arr.slice(0, topN);
}

// ─── Core: retention cohort update ────────────────────────

/**
 * Updates retention cohort for `cohortDate` by checking today which cohort members
 * are still active. This writes partial data — e.g. on 2026-04-18 we can fill
 * the d1 window for cohort 2026-04-17, d3 for cohort 2026-04-15, etc.
 *
 * Key shape: analytics_retention/cohort_<gameId>_<cohortDate>
 * Value shape: { cohortDate, gameId, cohortSize: n, activeByDay: { "1": n, "3": n, ... } }
 */
function arUpdateRetention(nk, logger, gameId, cohortDateStr, activeUserSet, todayOffset) {
    // Canonicalize so all retention cohorts live under the UUID even if a
    // caller still passes the legacy slug.
    gameId = arResolveGameId(gameId);
    if (!gameId || gameId === "all") return;
    var key = "cohort_" + gameId + "_" + cohortDateStr;
    var existing = arReadOne(nk, AR_RETENTION_COLLECTION, key, AR_SYSTEM_USER) || {};
    if (!existing.cohortUserIds) existing.cohortUserIds = null;

    // On the cohort's own day, persist the cohort snapshot.
    if (todayOffset === 0) {
        existing.cohortDate = cohortDateStr;
        existing.gameId = gameId;
        existing.cohortUserIds = Object.keys(activeUserSet);
        existing.cohortSize = existing.cohortUserIds.length;
        existing.activeByDay = existing.activeByDay || {};
        existing.computedAt = new Date().toISOString();
        arWriteOne(nk, AR_RETENTION_COLLECTION, key, AR_SYSTEM_USER, existing);
        return;
    }

    // Otherwise, count cohort members still active today.
    if (!existing.cohortUserIds || existing.cohortUserIds.length === 0) return;
    var matched = 0;
    for (var i = 0; i < existing.cohortUserIds.length; i++) {
        if (activeUserSet[existing.cohortUserIds[i]]) matched++;
    }
    existing.activeByDay = existing.activeByDay || {};
    existing.activeByDay[String(todayOffset)] = matched;
    existing.computedAt = new Date().toISOString();
    arWriteOne(nk, AR_RETENTION_COLLECTION, key, AR_SYSTEM_USER, existing);
}

// ─── Phase 4: per-mode + drop-off compute helpers ──────────

/**
 * Per-quiz-mode breakdown for one game on one date.
 *
 * Aggregates events whose eventData.quiz_mode is set (auto-injected by
 * AnalyticsManager.InjectGlobalContext on every event during a quiz) into
 * a compact map keyed by mode name. Output shape powers the Quiz Modes
 * dashboard tab — see web/analytics-dashboard/index.html::loadModes.
 *
 * @param events   already-filtered events for the day (from arScanEventsForDate)
 * @param gameId   canonical UUID — events with a different gameId are skipped
 * @param dateStr  YYYY-MM-DD (echoed into the doc)
 */
function arComputeModesDaily(events, gameId, dateStr) {
    gameId = arResolveGameId(gameId);
    var modes = {}; // mode → {sessions_started, sessions_completed, sessions_abandoned, total_questions, total_correct, total_seconds, users:{}, revenue, ad_impressions, categories:{}}

    function bucket(name) {
        if (!modes[name]) {
            modes[name] = {
                sessions_started: 0,
                sessions_completed: 0,
                sessions_abandoned: 0,
                total_questions: 0,
                total_correct: 0,
                total_seconds: 0,
                ended_count: 0,
                users: {},
                revenue_usd: 0,
                ad_impressions: 0,
                categories: {}
            };
        }
        return modes[name];
    }

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (gameId && gameId !== "all" && arResolveGameId(ev.gameId) !== gameId) continue;

        var data = ev.eventData || {};
        var mode = data.quiz_mode || data.quizMode || data.game_mode || data.gameMode;
        if (!mode) continue;

        var b = bucket(String(mode));
        var name = ev.eventName || "";
        if (AR_EVENT_ALIASES[name]) name = AR_EVENT_ALIASES[name];

        if (ev.userId) b.users[ev.userId] = true;

        if (data.category || data.category_name) {
            var cat = String(data.category || data.category_name);
            b.categories[cat] = (b.categories[cat] || 0) + 1;
        }

        if (name === "quiz_session_started" || name === "quiz_start") {
            b.sessions_started++;
        } else if (name === "quiz_session_ended" || name === "quiz_complete") {
            b.sessions_completed++;
            b.ended_count++;
            var dur = parseFloat(data.duration_seconds || data.durationSeconds || 0);
            if (isFinite(dur) && dur > 0 && dur < 86400) b.total_seconds += dur;
        } else if (name === "quiz_abandoned") {
            b.sessions_abandoned++;
            b.ended_count++;
            var aDur = parseFloat(data.duration_seconds || 0);
            if (isFinite(aDur) && aDur > 0 && aDur < 86400) b.total_seconds += aDur;
        } else if (name === "question_answered" || name === "answer_submitted") {
            b.total_questions++;
            if (data.is_correct === true || data.is_correct === "true" || data.isCorrect === true) {
                b.total_correct++;
            }
        } else if (name === "iap_purchased" || name === "purchase_completed") {
            var price = parseFloat(data.price_usd || data.priceUsd || data.revenue_usd || data.revenueUsd || data.amount_usd || data.amountUsd || data.price || data.amount || data.value || 0);
            if (isFinite(price) && price > 0) b.revenue_usd += price;
        } else if (name === "ad_impression" || name === "ad_shown") {
            b.ad_impressions++;
        }
    }

    // Materialize into a sorted array for the dashboard
    var modesOut = [];
    for (var m in modes) {
        if (!modes.hasOwnProperty(m)) continue;
        var v = modes[m];
        var topCats = [];
        for (var c in v.categories) topCats.push({ category: c, count: v.categories[c] });
        topCats.sort(function (a, b) { return b.count - a.count; });
        topCats = topCats.slice(0, 5);

        modesOut.push({
            mode: m,
            sessions_started: v.sessions_started,
            sessions_completed: v.sessions_completed,
            sessions_abandoned: v.sessions_abandoned,
            total_questions: v.total_questions,
            total_correct: v.total_correct,
            accuracy_pct: v.total_questions > 0
                ? Math.round((v.total_correct / v.total_questions) * 1000) / 10
                : 0,
            avg_session_seconds: v.ended_count > 0
                ? Math.round(v.total_seconds / v.ended_count)
                : 0,
            unique_users: Object.keys(v.users).length,
            revenue_usd: Math.round(v.revenue_usd * 100) / 100,
            ad_impressions: v.ad_impressions,
            completion_rate_pct: v.sessions_started > 0
                ? Math.round((v.sessions_completed / v.sessions_started) * 1000) / 10
                : 0,
            abandon_rate_pct: v.sessions_started > 0
                ? Math.round((v.sessions_abandoned / v.sessions_started) * 1000) / 10
                : 0,
            top_categories: topCats
        });
    }
    modesOut.sort(function (a, b) { return b.unique_users - a.unique_users; });

    return {
        gameId: gameId || "all",
        date: dateStr,
        modes: modesOut,
        mode_count: modesOut.length,
        computed_at: new Date().toISOString()
    };
}

/**
 * Per-day drop-off / churn signal aggregation.
 *
 * Surfaces the metrics requested in Q4=A:
 *   • cold_start_no_quiz       (sessions ended without quiz_session_started)
 *   • onboarding_abandoned     (count of onboarding_abandoned events)
 *   • quiz_abandoned           (count of quiz_abandoned events)
 *   • pre_iap_drop             (paywall_shown users with no purchase_completed)
 *   • streak_broken            (count of streak_broken events)
 *   • screen_left              (overall count + per-screen exit map)
 *   • per_question_abandon     (last_question_index histogram from quiz_abandoned)
 *
 * Output powers the Drop-off & Churn dashboard tab without it having to
 * scan analytics_events live for every render.
 */
function arComputeDropoffDaily(events, gameId, dateStr) {
    gameId = arResolveGameId(gameId);
    var signals = {
        cold_start_no_quiz: 0,
        onboarding_abandoned: 0,
        quiz_abandoned: 0,
        pre_iap_drop: 0,
        streak_broken: 0,
        screen_left: 0
    };
    var screenExits = {}; // screen → {entries, exits, total_time_ms}
    var perQuestion = {}; // last_question_index → count

    // For pre_iap_drop: users that saw paywall but never completed a purchase
    var paywallUsers = {};
    var purchasedUsers = {};

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (gameId && gameId !== "all" && arResolveGameId(ev.gameId) !== gameId) continue;

        var data = ev.eventData || {};
        var name = ev.eventName || "";
        if (AR_EVENT_ALIASES[name]) name = AR_EVENT_ALIASES[name];

        if (name === "cold_start_no_quiz") signals.cold_start_no_quiz++;
        else if (name === "onboarding_abandoned" || name === "onboarding_quit") signals.onboarding_abandoned++;
        else if (name === "quiz_abandoned") {
            signals.quiz_abandoned++;
            var lastIdx = data.last_question_index !== undefined ? data.last_question_index
                        : (data.question_index !== undefined ? data.question_index : null);
            if (lastIdx !== null && lastIdx !== undefined) {
                var k = String(lastIdx);
                perQuestion[k] = (perQuestion[k] || 0) + 1;
            }
        }
        else if (name === "streak_broken") signals.streak_broken++;
        else if (name === "screen_left" || name === "screen_back_pressed") {
            signals.screen_left++;
            var screen = data.screen_name || data.screen || "unknown";
            if (!screenExits[screen]) screenExits[screen] = { entries: 0, exits: 0, total_time_ms: 0 };
            screenExits[screen].exits++;
            var t = parseFloat(data.time_on_screen_ms || data.duration_ms || 0);
            if (isFinite(t) && t > 0 && t < 1800000) screenExits[screen].total_time_ms += t;
        }
        else if (name === "screen_view") {
            var sc = data.screen_name || data.screen;
            if (sc) {
                if (!screenExits[sc]) screenExits[sc] = { entries: 0, exits: 0, total_time_ms: 0 };
                screenExits[sc].entries++;
            }
        }
        else if (name === "paywall_shown" || name === "paywall_viewed") {
            if (ev.userId) paywallUsers[ev.userId] = true;
        }
        else if (name === "iap_purchased" || name === "purchase_completed") {
            if (ev.userId) purchasedUsers[ev.userId] = true;
        }
    }

    // pre_iap_drop = paywall users that did NOT purchase today
    for (var pu in paywallUsers) {
        if (!purchasedUsers[pu]) signals.pre_iap_drop++;
    }

    // Compute exit_rate per screen
    var screenOut = [];
    for (var s in screenExits) {
        var e = screenExits[s];
        screenOut.push({
            screen_name: s,
            entries: e.entries,
            exits: e.exits,
            avg_time_ms: e.exits > 0 ? Math.round(e.total_time_ms / e.exits) : 0,
            exit_rate_pct: e.entries > 0
                ? Math.round((e.exits / e.entries) * 1000) / 10
                : 0
        });
    }
    screenOut.sort(function (a, b) { return b.exits - a.exits; });

    var perQList = [];
    for (var q in perQuestion) perQList.push({ question_index: parseInt(q, 10), abandons: perQuestion[q] });
    perQList.sort(function (a, b) { return a.question_index - b.question_index; });

    return {
        gameId: gameId || "all",
        date: dateStr,
        signals: signals,
        per_question_abandon: perQList,
        screen_exits: screenOut,
        computed_at: new Date().toISOString()
    };
}

// ─── RPC: analytics_rollup_run ────────────────────────────

function rpcAnalyticsRollupRun(ctx, logger, nk, payload) {
    if (!arFeatureEnabled(ctx)) return arErr("Rollup feature disabled (ROLLUP_ENABLED=false)", 503);

    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var dateStr = data.date || arYesterday();
    if (!arValidDateStr(dateStr)) return arErr("Invalid date (expected YYYY-MM-DD)", 400);

    logger.info("[analytics_rollup] run date=" + dateStr);

    // Resume a previous truncated scan for this date if a checkpoint exists.
    var checkpoint = arScanCheckpointRead(nk, dateStr);
    var startCursor   = (checkpoint && checkpoint.cursor) || null;
    var priorScanned  = (checkpoint && checkpoint.scannedSoFar) || 0;
    var priorChunks   = (checkpoint && checkpoint.chunkCount) || 0;
    var priorEvents   = (checkpoint && checkpoint.eventsSoFar) || 0;
    var scanAlreadyComplete = !!(checkpoint && checkpoint.scanComplete);
    if (checkpoint) {
        logger.info("[analytics_rollup] resuming " + (scanAlreadyComplete ? "finalize" : "scan") +
                    " for " + dateStr +
                    " from checkpoint: scannedSoFar=" + priorScanned +
                    " eventsSoFar=" + priorEvents + " chunks=" + priorChunks);
    }

    var scanResult;
    if (scanAlreadyComplete) {
        // A previous invocation finished the scan and staged all events in
        // chunks; this invocation is compute-only (fast — no collection walk).
        scanResult = { events: [], scanned: 0, truncated: false, nextCursor: null };
    } else {
        try {
            scanResult = arScanEventsForDate(nk, logger, dateStr, startCursor);
        } catch (e) {
            logger.error("[analytics_rollup] scan failed: " + e.message);
            return arErr("Scan failed: " + e.message, 500);
        }
    }

    var totalScanned = priorScanned + scanResult.scanned;

    // Page-cap hit: instead of aborting (the old HTTP-507 path), persist a
    // checkpoint {cursor, accumulated events, scannedSoFar} and return a
    // partial/continue response. The next invocation for the same dateStr
    // resumes from the saved cursor; the rollup is only written once the
    // scan completes. Keeps each invocation inside the 30s RPC budget.
    if (scanResult.truncated) {
        var newChunkCount = arScanCheckpointAppendEvents(nk, logger, dateStr, scanResult.events, priorChunks);
        if (newChunkCount < 0) {
            return arErr("Scan checkpoint write failed for " + dateStr + " — partial progress not saved", 500);
        }
        var totalEventsSoFar = priorEvents + scanResult.events.length;
        var wCp = arWriteOne(nk, AR_META_COLLECTION, arScanCheckpointKey(dateStr), AR_SYSTEM_USER, {
            date: dateStr,
            cursor: scanResult.nextCursor,
            scannedSoFar: totalScanned,
            chunkCount: newChunkCount,
            eventsSoFar: totalEventsSoFar,
            updatedAt: new Date().toISOString()
        });
        if (wCp !== true) {
            return arErr("Scan checkpoint write failed for " + dateStr + ": " + (wCp.error || "write failed"), 500);
        }
        logger.warn("[analytics_rollup] scan page-cap reached for " + dateStr +
                    " — checkpointed (scanned=" + totalScanned +
                    ", events=" + totalEventsSoFar + ", chunks=" + newChunkCount +
                    "). Re-invoke analytics_rollup_run for the same date to continue.");
        return arOk({
            date: dateStr,
            partial: true,
            complete: false,
            events_scanned: totalScanned,
            events_matched_so_far: totalEventsSoFar,
            hint: "Scan checkpointed mid-collection; invoke analytics_rollup_run again with the same date to resume."
        });
    }

    // Scan finished the collection in THIS invocation after one or more
    // resumed passes. Do NOT compute inline: a resumed scan has already burned
    // most of the request budget, and in prod the HTTP context dies at ~22s —
    // every storage op after that fails with "context canceled" (observed
    // 2026-06-10: 52× failed analytics_rollup_yearly lists, zero rollups
    // written). Stage the final events and let the NEXT invocation do the
    // compute+write phase with a fresh, idle context.
    if (!scanAlreadyComplete && checkpoint) {
        var finChunkCount = arScanCheckpointAppendEvents(nk, logger, dateStr, scanResult.events, priorChunks);
        if (finChunkCount < 0) {
            return arErr("Scan-complete checkpoint write failed for " + dateStr, 500);
        }
        var finEvents = priorEvents + scanResult.events.length;
        var wFin = arWriteOne(nk, AR_META_COLLECTION, arScanCheckpointKey(dateStr), AR_SYSTEM_USER, {
            date: dateStr,
            cursor: null,
            scanComplete: true,
            scannedSoFar: totalScanned,
            chunkCount: finChunkCount,
            eventsSoFar: finEvents,
            updatedAt: new Date().toISOString()
        });
        if (wFin !== true) {
            return arErr("Scan-complete checkpoint write failed for " + dateStr + ": " + (wFin.error || "write failed"), 500);
        }
        logger.info("[analytics_rollup] scan COMPLETE for " + dateStr +
                    " (scanned=" + totalScanned + ", events=" + finEvents +
                    ", chunks=" + finChunkCount + ") — compute deferred to next invocation.");
        return arOk({
            date: dateStr,
            partial: true,
            complete: false,
            stage: "scan_complete",
            events_scanned: totalScanned,
            events_matched_so_far: finEvents,
            hint: "Scan finished; invoke analytics_rollup_run again with the same date to compute and write the rollup."
        });
    }

    var events = scanResult.events;

    // Compute phase — merge events accumulated by earlier partial invocations.
    if (priorChunks > 0) {
        var resumedEvents = arScanCheckpointLoadEvents(nk, logger, dateStr, priorChunks);
        events = resumedEvents.concat(events);
        logger.info("[analytics_rollup] merged " + resumedEvents.length +
                    " checkpointed events with " + scanResult.events.length +
                    " from final scan pass for " + dateStr);
    }

    var comp = arComputeAndWriteRollup(nk, logger, dateStr, events, data.gameIds, totalScanned, !!checkpoint, gate.bypass);
    if (!comp.ok) return arErr(comp.error, comp.code || 500);

    // Scan + rollup completed — drop the resumable-scan checkpoint (if any)
    // so a future re-run for this date starts a fresh scan.
    if (checkpoint) {
        arScanCheckpointClear(nk, logger, dateStr, priorChunks);
    }

    return arOk(comp.result);
}

/**
 * Compute + write phase for one date's rollup, operating on the fully
 * collected in-memory `events` array. Shared by rpcAnalyticsRollupRun
 * (single-date path) and rpcAnalyticsRollupBackfill (multi-date staged path).
 * Returns {ok:true, result} or {ok:false, error, code}.
 */
function arComputeAndWriteRollup(nk, logger, dateStr, events, extraGameIds, totalScanned, resumedFromCheckpoint, bypass) {
    // Build list of gameIds present in this date's events, plus optional explicit list.
    // Canonicalize via arResolveGameId so callers passing legacy slugs (e.g. "quizverse")
    // don't create a duplicate rollup bucket alongside the UUID-keyed events.
    var gameIdSet = {};
    for (var i = 0; i < events.length; i++) {
        if (events[i].gameId) gameIdSet[arResolveGameId(events[i].gameId)] = true;
    }
    if (Array.isArray(extraGameIds)) {
        for (var gi = 0; gi < extraGameIds.length; gi++) {
            if (extraGameIds[gi]) gameIdSet[arResolveGameId(extraGameIds[gi])] = true;
        }
    }
    var gameIds = Object.keys(gameIdSet);

    var written = [];
    var writeErrors = [];  // accumulate critical write failures

    // Build per-game active-user sets once — used for both first-seen upsert
    // and retention. This replaces two prior full-events scans per game.
    var activeByGame = {};
    for (var ei = 0; ei < events.length; ei++) {
        // Canonicalize again here in case an event slipped through arScanEventsForDate
        // without its gameId being aliased (defense in depth).
        var egid = arResolveGameId(events[ei].gameId);
        var euid = events[ei].userId;
        if (!egid || !euid) continue;
        if (!activeByGame[egid]) activeByGame[egid] = {};
        activeByGame[egid][euid] = true;
    }

    // Platform-wide new_users = union of all per-game new users. We compute
    // it after the per-game loop so we can aggregate.
    var allNewUsers = {};

    // Per-game rollups
    for (var gj = 0; gj < gameIds.length; gj++) {
        var gameId = gameIds[gj];
        if (!gameId) continue;

        var activeUsersThisGame = activeByGame[gameId] || {};
        var activeUserIds = Object.keys(activeUsersThisGame);

        // Upsert first-seen docs → set of new-today users for THIS game.
        var firstSeen = arUpsertFirstSeen(nk, logger, gameId, activeUserIds, dateStr);
        for (var nuid in firstSeen.newUsers) {
            if (firstSeen.newUsers.hasOwnProperty(nuid)) allNewUsers[nuid] = true;
        }

        var roll = arComputeRollup(events, gameId, dateStr, firstSeen.newUsers);
        var wRoll = arWriteOne(nk, AR_ROLLUP_COLLECTION, "rollup_" + gameId + "_" + dateStr, AR_SYSTEM_USER, roll);
        if (wRoll !== true) writeErrors.push("rollup_" + gameId + ": " + (wRoll.error || "write failed"));
        var wFunnel = arWriteOne(nk, AR_FUNNEL_COLLECTION, "funnel_" + gameId + "_" + dateStr, AR_SYSTEM_USER, {
            gameId: gameId, date: dateStr, funnel: roll.funnel, funnel_order: roll.funnel_order
        });
        if (wFunnel !== true) writeErrors.push("funnel_" + gameId + ": " + (wFunnel.error || "write failed"));

        // Phase 4 — per-mode, dropoff, question-intel, and offer-performance
        // rollups are all computed in the same scan pass so we don't pay
        // the storageList scan cost multiple times.
        try {
            var modesDoc = arComputeModesDaily(events, gameId, dateStr);
            arWriteOne(nk, AR_MODES_COLLECTION, "modes_" + gameId + "_" + dateStr, AR_SYSTEM_USER, modesDoc);
        } catch (eM) { logger.warn("[analytics_rollup] modes rollup failed for " + gameId + ": " + eM.message); }
        try {
            var dropDoc = arComputeDropoffDaily(events, gameId, dateStr);
            arWriteOne(nk, AR_DROPOFF_COLLECTION, "dropoff_" + gameId + "_" + dateStr, AR_SYSTEM_USER, dropDoc);
        } catch (eD) { logger.warn("[analytics_rollup] dropoff rollup failed for " + gameId + ": " + eD.message); }
        try {
            var qiDoc = arComputeQuestionIntel(events, gameId, dateStr);
            arWriteOne(nk, AR_QUESTION_COLLECTION, "question_" + gameId + "_" + dateStr, AR_SYSTEM_USER, qiDoc);
        } catch (eQ) { logger.warn("[analytics_rollup] question intel failed for " + gameId + ": " + eQ.message); }
        try {
            var offerDoc = arComputeOfferPerformance(events, gameId, dateStr);
            arWriteOne(nk, AR_OFFER_COLLECTION, "offer_" + gameId + "_" + dateStr, AR_SYSTEM_USER, offerDoc);
        } catch (eO) { logger.warn("[analytics_rollup] offer perf failed for " + gameId + ": " + eO.message); }
        // Pre-compute top-200 players for this game+day so the RPC can read
        // N daily docs instead of scanning 50k raw events on every request.
        try {
            var tpDoc = arComputeTopPlayers(events, gameId, dateStr);
            arWriteOne(nk, AR_TOP_PLAYERS_COLLECTION, "top_players_" + gameId + "_" + dateStr, AR_SYSTEM_USER, tpDoc);
        } catch (eTP) { logger.warn("[analytics_rollup] top players failed for " + gameId + ": " + eTP.message); }

        written.push({ scope: gameId, date: dateStr, dau: roll.dau, events: roll.event_count, new_users: roll.new_users });

        // Retention seed: cohort = users whose first-seen is THIS date
        // (real first-time users), not all active users. Previously we
        // seeded the cohort with DAU which inflated retention curves.
        arUpdateRetention(nk, logger, gameId, dateStr, firstSeen.newUsers, 0);

        // Back-update older cohorts: on date D, fill window w for cohort
        // (D - w). Numerator is all users active on D (retention doesn't
        // care whether today's users are new or returning — it cares
        // whether they're still alive from the cohort).
        for (var ri = 0; ri < AR_RETENTION_WINDOWS.length; ri++) {
            var windowDays = AR_RETENTION_WINDOWS[ri];
            var cohortDate = new Date(dateStr + "T00:00:00.000Z");
            cohortDate.setUTCDate(cohortDate.getUTCDate() - windowDays);
            arUpdateRetention(nk, logger, gameId, arIsoDate(cohortDate), activeUsersThisGame, windowDays);
        }
    }

    // Platform-wide rollup — compute AFTER per-game so we can reuse the
    // aggregated new-users set across games.
    var allRollup = arComputeRollup(events, "all", dateStr, allNewUsers);
    var wAllRoll = arWriteOne(nk, AR_ROLLUP_COLLECTION, "rollup_all_" + dateStr, AR_SYSTEM_USER, allRollup);
    if (wAllRoll !== true) writeErrors.push("rollup_all: " + (wAllRoll.error || "write failed"));
    var wAllFunnel = arWriteOne(nk, AR_FUNNEL_COLLECTION, "funnel_all_" + dateStr, AR_SYSTEM_USER, {
        gameId: "all", date: dateStr, funnel: allRollup.funnel, funnel_order: allRollup.funnel_order
    });
    if (wAllFunnel !== true) writeErrors.push("funnel_all: " + (wAllFunnel.error || "write failed"));
    try {
        var modesAllDoc = arComputeModesDaily(events, "all", dateStr);
        arWriteOne(nk, AR_MODES_COLLECTION, "modes_all_" + dateStr, AR_SYSTEM_USER, modesAllDoc);
    } catch (eMa) { logger.warn("[analytics_rollup] modes rollup failed for all: " + eMa.message); }
    try {
        var dropAllDoc = arComputeDropoffDaily(events, "all", dateStr);
        arWriteOne(nk, AR_DROPOFF_COLLECTION, "dropoff_all_" + dateStr, AR_SYSTEM_USER, dropAllDoc);
    } catch (eDa) { logger.warn("[analytics_rollup] dropoff rollup failed for all: " + eDa.message); }
    try {
        var qiAllDoc = arComputeQuestionIntel(events, "all", dateStr);
        arWriteOne(nk, AR_QUESTION_COLLECTION, "question_all_" + dateStr, AR_SYSTEM_USER, qiAllDoc);
    } catch (eQa) { logger.warn("[analytics_rollup] question intel failed for all: " + eQa.message); }
    try {
        var offerAllDoc = arComputeOfferPerformance(events, "all", dateStr);
        arWriteOne(nk, AR_OFFER_COLLECTION, "offer_all_" + dateStr, AR_SYSTEM_USER, offerAllDoc);
    } catch (eOa) { logger.warn("[analytics_rollup] offer perf failed for all: " + eOa.message); }
    // Platform-wide top-players doc (scope = "all").
    try {
        var tpAllDoc = arComputeTopPlayers(events, "all", dateStr);
        arWriteOne(nk, AR_TOP_PLAYERS_COLLECTION, "top_players_all_" + dateStr, AR_SYSTEM_USER, tpAllDoc);
    } catch (eTPa) { logger.warn("[analytics_rollup] top players failed for all: " + eTPa.message); }
    written.unshift({ scope: "all", date: dateStr, dau: allRollup.dau, events: allRollup.event_count, new_users: allRollup.new_users });

    // Phase 6 — bump the monthly/yearly/lifetime tiers for every game we
    // just rolled up (plus the platform-wide "all" bucket). arvBumpForDate
    // reads the daily we just wrote and refreshes the longer-tail tiers
    // in place. Best-effort — failures don't fail the daily run.
    if (typeof arvBumpForDate === "function") {
        for (var gb = 0; gb < gameIds.length; gb++) {
            try { arvBumpForDate(nk, logger, gameIds[gb], dateStr); }
            catch (eGB) { logger.warn("[analytics_rollup] history bump failed " + gameIds[gb] + ": " + eGB.message); }
        }
        try { arvBumpForDate(nk, logger, "all", dateStr); }
        catch (eAB) { logger.warn("[analytics_rollup] history bump failed all: " + eAB.message); }
    }

    // Only record success if all critical rollup writes succeeded.
    // A partial write (e.g. storage quota exceeded) must NOT mark the day as done,
    // or the dashboard will show incomplete data as if the rollup finished cleanly.
    if (writeErrors.length > 0) {
        logger.error("[analytics_rollup] critical write failures for " + dateStr + ": " + writeErrors.join("; "));
        return { ok: false, error: "Rollup write failures: " + writeErrors.join("; "), code: 500 };
    }

    // ── Cumulative lifetime counters ──────────────────────────────────────
    // Maintain a running total of unique users ever seen, combined across all
    // games. Read-modify-write is safe here: rollup runs are serialised by
    // the cron (Forbid concurrency policy) and idempotent re-runs guard by
    // only adding users that are genuinely new in analytics_user_first_seen.
    try {
        var prevTotals = arReadOne(nk, AR_META_COLLECTION, "platform_totals", AR_SYSTEM_USER) || {};
        var prevTotal = parseInt(prevTotals.total_users_lifetime, 10) || 0;
        var newThisRun = Object.keys(allNewUsers).length;
        arWriteOne(nk, AR_META_COLLECTION, "platform_totals", AR_SYSTEM_USER, {
            total_users_lifetime: prevTotal + newThisRun,
            new_users_this_run:   newThisRun,
            last_rollup_date:     dateStr,
            last_updated_at:      new Date().toISOString()
        });
    } catch (eTot) {
        logger.warn("[analytics_rollup] platform_totals write failed: " + eTot.message);
    }

    // Record success marker.
    arWriteOne(nk, AR_META_COLLECTION, "last_success", AR_SYSTEM_USER, {
        date: dateStr,
        gameIds: gameIds,
        eventsScanned: totalScanned,
        eventsMatched: events.length,
        truncated: false,
        resumedFromCheckpoint: !!resumedFromCheckpoint,
        timestamp: new Date().toISOString(),
        bypass: bypass
    });

    logger.info("[analytics_rollup] done date=" + dateStr +
                " games=" + gameIds.length +
                " events=" + events.length +
                " scanned=" + totalScanned);

    return {
        ok: true,
        result: {
            date: dateStr,
            partial: false,
            complete: true,
            games_rolled_up: gameIds.length,
            events_matched: events.length,
            events_scanned: totalScanned,
            truncated: false,
            written: written
        }
    };
}

// ─── RPC: analytics_rollup_backfill ───────────────────────

// Resumable multi-date backfill. ONE collection walk buckets events for every
// date in [from, to] (instead of N full walks — at the observed ~230 obj/sec
// prod scan rate a per-date walk of a 180k+ object collection takes ~15 min,
// so the old loop-over-rpcAnalyticsRollupRun body could never finish inside a
// request). Each invocation does one budgeted slice of work and checkpoints:
//
//   phase 1 (scan):    resume cursor → walk ≤15s → append per-date event
//                      chunks → save cursor. Repeat until collection exhausted.
//   phase 2 (compute): one date per invocation — load its chunks, run
//                      arComputeAndWriteRollup on a fresh context, mark done.
//
// Drive it by calling this RPC repeatedly with the same {from,to} until the
// response has complete:true. Pass reset:true to abandon a previous range.
//
//   analytics_rollup_meta key: backfill_checkpoint
//     { from, to, cursor, scannedSoFar, scanComplete,
//       chunks: {date: chunkCount}, eventsSoFar: {date: n},
//       computed: [dates], updatedAt }
function rpcAnalyticsRollupBackfill(ctx, logger, nk, payload) {
    if (!arFeatureEnabled(ctx)) return arErr("Rollup feature disabled", 503);

    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    if (!arValidDateStr(data.from) || !arValidDateStr(data.to)) {
        return arErr("from/to must be YYYY-MM-DD", 400);
    }
    var dates = arDateRange(data.from, data.to);
    if (dates.length === 0) return arErr("Empty date range", 400);
    if (dates.length > 90) return arErr("Backfill range too large (max 90 days)", 400);

    var BF_KEY = "backfill_checkpoint";
    var bf = arReadOne(nk, AR_META_COLLECTION, BF_KEY, AR_SYSTEM_USER);

    // Stale/foreign checkpoint handling.
    if (bf && (bf.from !== data.from || bf.to !== data.to)) {
        if (!data.reset) {
            return arErr("A backfill checkpoint exists for " + bf.from + ".." + bf.to +
                         "; pass reset:true to abandon it.", 409);
        }
        arBackfillClear(nk, logger, bf);
        bf = null;
    }
    if (bf && data.reset) {
        arBackfillClear(nk, logger, bf);
        bf = null;
    }

    if (!bf) {
        // Fresh start: also clear any stale single-date checkpoints for the
        // range left behind by earlier per-date attempts, so chunk keys don't
        // mix events from different scans.
        for (var di = 0; di < dates.length; di++) {
            var stale = arScanCheckpointRead(nk, dates[di]);
            if (stale) arScanCheckpointClear(nk, logger, dates[di], stale.chunkCount || 0);
        }
        bf = { from: data.from, to: data.to, cursor: null, scannedSoFar: 0,
               scanComplete: false, chunks: {}, eventsSoFar: {}, computed: [] };
    }

    // ── Phase 1: scan slice ────────────────────────────────────────────────
    if (!bf.scanComplete) {
        var fromUnix = Math.floor(new Date(data.from + "T00:00:00.000Z").getTime() / 1000);
        var toUnix   = Math.floor(new Date(data.to   + "T00:00:00.000Z").getTime() / 1000) + 86400;
        var scan = arScanEventsForRange(nk, logger, fromUnix, toUnix, bf.cursor || null);

        var matchedThisSlice = 0;
        for (var dStr in scan.byDate) {
            if (!scan.byDate.hasOwnProperty(dStr)) continue;
            var evs = scan.byDate[dStr];
            matchedThisSlice += evs.length;
            var prevChunks = bf.chunks[dStr] || 0;
            var newCount = arScanCheckpointAppendEvents(nk, logger, dStr, evs, prevChunks);
            if (newCount < 0) return arErr("Backfill chunk write failed for " + dStr, 500);
            bf.chunks[dStr] = newCount;
            bf.eventsSoFar[dStr] = (bf.eventsSoFar[dStr] || 0) + evs.length;
        }

        bf.scannedSoFar = (bf.scannedSoFar || 0) + scan.scanned;
        bf.cursor = scan.nextCursor;
        bf.scanComplete = !scan.truncated;
        bf.updatedAt = new Date().toISOString();
        var wBf = arWriteOne(nk, AR_META_COLLECTION, BF_KEY, AR_SYSTEM_USER, bf);
        if (wBf !== true) return arErr("Backfill checkpoint write failed: " + (wBf.error || "write failed"), 500);

        logger.info("[analytics_rollup] backfill scan slice: scannedSoFar=" + bf.scannedSoFar +
                    " matchedThisSlice=" + matchedThisSlice +
                    " scanComplete=" + bf.scanComplete);
        return arOk({
            partial: true, complete: false, stage: bf.scanComplete ? "scan_complete" : "scan",
            from: data.from, to: data.to,
            events_scanned: bf.scannedSoFar,
            dates_with_events: Object.keys(bf.chunks).length,
            hint: "Invoke again to continue."
        });
    }

    // ── Phase 2: compute one date per invocation ───────────────────────────
    var doneSet = {};
    for (var ci = 0; ci < bf.computed.length; ci++) doneSet[bf.computed[ci]] = true;
    var nextDate = null;
    for (var ni = 0; ni < dates.length; ni++) {
        if (!doneSet[dates[ni]]) { nextDate = dates[ni]; break; }
    }

    if (nextDate !== null) {
        var chunkCount = bf.chunks[nextDate] || 0;
        var events = chunkCount > 0 ? arScanCheckpointLoadEvents(nk, logger, nextDate, chunkCount) : [];

        var aliasedGameIds = null;
        if (Array.isArray(data.gameIds)) {
            aliasedGameIds = [];
            for (var ag = 0; ag < data.gameIds.length; ag++) {
                if (data.gameIds[ag]) aliasedGameIds.push(arResolveGameId(data.gameIds[ag]));
            }
        }

        var comp = arComputeAndWriteRollup(nk, logger, nextDate, events, aliasedGameIds,
                                           bf.scannedSoFar, true, gate.bypass);
        if (!comp.ok) return arErr("Backfill compute failed for " + nextDate + ": " + comp.error, comp.code || 500);

        // Free this date's chunks (keep the backfill checkpoint doc itself).
        if (chunkCount > 0) {
            try {
                var dels = [];
                for (var dc = 0; dc < chunkCount; dc++) {
                    dels.push({ collection: AR_META_COLLECTION, key: "scan_events_" + nextDate + "_" + dc, userId: AR_SYSTEM_USER });
                }
                nk.storageDelete(dels);
            } catch (eDel) {
                logger.warn("[analytics_rollup] backfill chunk cleanup failed for " + nextDate + ": " + (eDel.message || eDel));
            }
        }

        bf.computed.push(nextDate);
        bf.updatedAt = new Date().toISOString();
        var wBf2 = arWriteOne(nk, AR_META_COLLECTION, BF_KEY, AR_SYSTEM_USER, bf);
        if (wBf2 !== true) return arErr("Backfill checkpoint write failed after compute: " + (wBf2.error || "write failed"), 500);

        var remaining = dates.length - bf.computed.length;
        logger.info("[analytics_rollup] backfill computed " + nextDate +
                    " (events=" + events.length + ", remaining=" + remaining + ")");
        if (remaining > 0) {
            return arOk({
                partial: true, complete: false, stage: "compute",
                date: nextDate, events_matched: events.length,
                computed: bf.computed.length, remaining: remaining,
                hint: "Invoke again to compute the next date."
            });
        }
        // fall through: that was the last date
    }

    // ── All dates computed: clear checkpoint, report ───────────────────────
    var summary = { computed: bf.computed.slice(), events_scanned: bf.scannedSoFar, eventsByDate: bf.eventsSoFar };
    arBackfillClear(nk, logger, bf);
    logger.info("[analytics_rollup] backfill COMPLETE " + data.from + ".." + data.to +
                " (" + summary.computed.length + " dates, scanned=" + summary.events_scanned + ")");
    return arOk({
        partial: false, complete: true,
        from: data.from, to: data.to,
        backfilled: summary.computed.length,
        events_scanned: summary.events_scanned,
        events_by_date: summary.eventsByDate
    });
}

/** Deletes the backfill checkpoint doc and any remaining per-date chunks. */
function arBackfillClear(nk, logger, bf) {
    try {
        var dels = [{ collection: AR_META_COLLECTION, key: "backfill_checkpoint", userId: AR_SYSTEM_USER }];
        var chunks = (bf && bf.chunks) || {};
        for (var dStr in chunks) {
            if (!chunks.hasOwnProperty(dStr)) continue;
            for (var c = 0; c < (chunks[dStr] || 0); c++) {
                dels.push({ collection: AR_META_COLLECTION, key: "scan_events_" + dStr + "_" + c, userId: AR_SYSTEM_USER });
            }
        }
        nk.storageDelete(dels);
    } catch (e) {
        logger.warn("[analytics_rollup] backfill checkpoint clear failed: " + (e.message || e));
    }
}

// ─── RPC: analytics_rollup_status ─────────────────────────

function rpcAnalyticsRollupStatus(ctx, logger, nk, payload) {
    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var meta = arReadOne(nk, AR_META_COLLECTION, "last_success", AR_SYSTEM_USER) || null;

    // Sample the rollup collection to give the operator a count.
    var rollupSample = 0;
    try {
        var list = nk.storageList(AR_SYSTEM_USER, AR_ROLLUP_COLLECTION, 50, null);
        rollupSample = (list && list.objects) ? list.objects.length : 0;
    } catch (e) { /* ignore */ }

    return arOk({
        enabled: arFeatureEnabled(ctx),
        lastSuccess: meta,
        rollupSampleCount: rollupSample,
        hint: meta
            ? "Last rollup: " + (meta.date || "?") + " at " + (meta.timestamp || "?")
            : "No successful rollup recorded yet. Trigger via analytics_rollup_run."
    });
}

// ─── Phase 4: dashboard reader RPCs (modes + dropoff rollups) ──────────

/**
 * Reads N days of analytics_modes_daily and unions per-mode metrics.
 *
 * Payload: { game_id?, days?: 1-90 (default 7), dashboard_secret? }
 * Returns: { modes: [{mode, sessions_started, sessions_completed,
 *            sessions_abandoned, total_questions, accuracy_pct,
 *            avg_session_seconds, unique_users, revenue_usd,
 *            ad_impressions, completion_rate_pct, abandon_rate_pct,
 *            top_categories: [...], days_present }, ...] }
 *
 * Falls back to the on-demand analytics_modes_breakdown RPC when no
 * rollup docs exist for the period (cold-start grace).
 */
function rpcAnalyticsModesDailyRead(ctx, logger, nk, payload) {
    var data = arParse(payload);
    // Same admin/secret gate as the other dashboard RPCs.
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var days = parseInt(data.days, 10) || 7;
    if (days < 1) days = 1; if (days > 90) days = 90;
    var gameId = arResolveGameId(data.game_id || data.gameId || "all") || "all";

    // Build keys for last N days
    var union = {};
    var rollupsFound = 0;
    var today = new Date();
    for (var d = 0; d < days; d++) {
        var dt = new Date(today);
        dt.setUTCDate(dt.getUTCDate() - d);
        var ds = arIsoDate(dt);
        var key = "modes_" + gameId + "_" + ds;
        var doc = arReadOne(nk, AR_MODES_COLLECTION, key, AR_SYSTEM_USER);
        if (!doc || !doc.modes) continue;
        rollupsFound++;
        for (var i = 0; i < doc.modes.length; i++) {
            var m = doc.modes[i];
            if (!union[m.mode]) {
                union[m.mode] = {
                    mode: m.mode,
                    sessions_started: 0,
                    sessions_completed: 0,
                    sessions_abandoned: 0,
                    total_questions: 0,
                    total_correct: 0,
                    total_session_seconds: 0,
                    ended_count: 0,
                    unique_users: 0,
                    revenue_usd: 0,
                    ad_impressions: 0,
                    days_present: 0,
                    _users_seen: {} // best-effort dedupe via day count rather than user IDs
                };
            }
            var u = union[m.mode];
            u.sessions_started += m.sessions_started || 0;
            u.sessions_completed += m.sessions_completed || 0;
            u.sessions_abandoned += m.sessions_abandoned || 0;
            u.total_questions += m.total_questions || 0;
            u.total_correct += m.total_correct || 0;
            u.revenue_usd += m.revenue_usd || 0;
            u.ad_impressions += m.ad_impressions || 0;
            // unique_users is approximate over multiple days (same user
            // playing on 7 separate days would be counted 7 times). For
            // exact lifetime uniques use the live RPC.
            u.unique_users += m.unique_users || 0;
            // Reconstruct total session seconds from avg × ended_count
            // (we only stored avg in the per-day doc).
            var ec = (m.sessions_completed || 0) + (m.sessions_abandoned || 0);
            if (ec > 0) {
                u.total_session_seconds += (m.avg_session_seconds || 0) * ec;
                u.ended_count += ec;
            }
            u.days_present++;
        }
    }

    var modesOut = [];
    for (var mn in union) {
        var v = union[mn];
        modesOut.push({
            mode: v.mode,
            sessions_started: v.sessions_started,
            sessions_completed: v.sessions_completed,
            sessions_abandoned: v.sessions_abandoned,
            total_questions: v.total_questions,
            total_correct: v.total_correct,
            accuracy_pct: v.total_questions > 0
                ? Math.round((v.total_correct / v.total_questions) * 1000) / 10
                : 0,
            avg_session_seconds: v.ended_count > 0
                ? Math.round(v.total_session_seconds / v.ended_count)
                : 0,
            unique_users_estimate: v.unique_users,
            revenue_usd: Math.round(v.revenue_usd * 100) / 100,
            ad_impressions: v.ad_impressions,
            completion_rate_pct: v.sessions_started > 0
                ? Math.round((v.sessions_completed / v.sessions_started) * 1000) / 10
                : 0,
            abandon_rate_pct: v.sessions_started > 0
                ? Math.round((v.sessions_abandoned / v.sessions_started) * 1000) / 10
                : 0,
            days_present: v.days_present
        });
    }
    modesOut.sort(function (a, b) { return b.sessions_started - a.sessions_started; });

    return arOk({
        game_id: gameId,
        days: days,
        rollups_found: rollupsFound,
        modes: modesOut,
        source: rollupsFound > 0 ? "rollup_daily" : "rollup_empty",
        hint: rollupsFound === 0
            ? "No rollup docs for this period — call analytics_rollup_run for each missing date, or use the live analytics_modes_breakdown RPC."
            : "Aggregated " + rollupsFound + " day(s) of pre-computed rollups."
    });
}

/**
 * Reads N days of analytics_dropoff_daily and unions per-day signals.
 *
 * Payload: { game_id?, days?: 1-90 (default 7), dashboard_secret? }
 * Returns: { signals: { cold_start_no_quiz, onboarding_abandoned, ... },
 *            per_question_abandon: [...], screen_exits: [...] }
 */
function rpcAnalyticsDropoffDailyRead(ctx, logger, nk, payload) {
    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var days = parseInt(data.days, 10) || 7;
    if (days < 1) days = 1; if (days > 90) days = 90;
    var gameId = arResolveGameId(data.game_id || data.gameId || "all") || "all";

    var unionSignals = {
        cold_start_no_quiz: 0,
        onboarding_abandoned: 0,
        quiz_abandoned: 0,
        pre_iap_drop: 0,
        streak_broken: 0,
        screen_left: 0
    };
    var perQ = {};        // index → count
    var screenAgg = {};   // screen → {entries, exits, total_time_ms_weighted, weight}
    var rollupsFound = 0;
    var today = new Date();

    for (var d = 0; d < days; d++) {
        var dt = new Date(today);
        dt.setUTCDate(dt.getUTCDate() - d);
        var ds = arIsoDate(dt);
        var key = "dropoff_" + gameId + "_" + ds;
        var doc = arReadOne(nk, AR_DROPOFF_COLLECTION, key, AR_SYSTEM_USER);
        if (!doc) continue;
        rollupsFound++;
        if (doc.signals) {
            for (var k in unionSignals) {
                unionSignals[k] += (doc.signals[k] || 0);
            }
        }
        if (doc.per_question_abandon) {
            for (var i = 0; i < doc.per_question_abandon.length; i++) {
                var p = doc.per_question_abandon[i];
                var idxStr = String(p.question_index);
                perQ[idxStr] = (perQ[idxStr] || 0) + (p.abandons || 0);
            }
        }
        if (doc.screen_exits) {
            for (var j = 0; j < doc.screen_exits.length; j++) {
                var s = doc.screen_exits[j];
                if (!screenAgg[s.screen_name]) {
                    screenAgg[s.screen_name] = {
                        entries: 0, exits: 0,
                        weighted_time_ms: 0, weight_exits: 0
                    };
                }
                var sa = screenAgg[s.screen_name];
                sa.entries += s.entries || 0;
                sa.exits += s.exits || 0;
                sa.weighted_time_ms += (s.avg_time_ms || 0) * (s.exits || 0);
                sa.weight_exits += (s.exits || 0);
            }
        }
    }

    var perQArr = [];
    for (var pq in perQ) perQArr.push({ question_index: parseInt(pq, 10), abandons: perQ[pq] });
    perQArr.sort(function (a, b) { return a.question_index - b.question_index; });

    var screenArr = [];
    for (var sn in screenAgg) {
        var v = screenAgg[sn];
        screenArr.push({
            screen_name: sn,
            entries: v.entries,
            exits: v.exits,
            avg_time_ms: v.weight_exits > 0 ? Math.round(v.weighted_time_ms / v.weight_exits) : 0,
            exit_rate_pct: v.entries > 0
                ? Math.round((v.exits / v.entries) * 1000) / 10
                : 0
        });
    }
    screenArr.sort(function (a, b) { return b.exits - a.exits; });

    return arOk({
        game_id: gameId,
        days: days,
        rollups_found: rollupsFound,
        signals: unionSignals,
        per_question_abandon: perQArr,
        screen_exits: screenArr,
        source: rollupsFound > 0 ? "rollup_daily" : "rollup_empty",
        hint: rollupsFound === 0
            ? "No rollup docs for this period — call analytics_rollup_run for each missing date, or use the live analytics_dropoff_funnel / analytics_screen_exit_heatmap RPCs."
            : "Aggregated " + rollupsFound + " day(s) of pre-computed rollups."
    });
}

// ─── Phase 4: question intelligence compute helper ────────

/**
 * Per-question performance rollup for one game + one date.
 * Groups question_displayed / question_answered / correct / wrong / skipped /
 * timed_out events by question_id and computes accuracy + speed KPIs.
 *
 * Output collection : analytics_question_daily
 * Key               : question_<gameId>_<YYYY-MM-DD>
 */
function arComputeQuestionIntel(events, gameId, dateStr) {
    gameId = arResolveGameId(gameId);
    var intel = {}; // question_id → stats bucket

    var DISPLAYED_NAMES = { 'question_displayed': 1, 'question_presented': 1 };
    var ANSWERED_NAMES  = { 'question_answered': 1,  'answer_submitted': 1 };
    var CORRECT_NAMES   = { 'question_answered_correct': 1 };
    var WRONG_NAMES     = { 'question_answered_wrong': 1 };
    var SKIPPED_NAMES   = { 'question_skipped': 1 };
    var TIMEOUT_NAMES   = { 'question_time_expired': 1, 'time_expired': 1 };

    function qBucket(qid) {
        if (!intel[qid]) {
            intel[qid] = {
                question_id: qid,
                displayed: 0, answered: 0, correct: 0, wrong: 0,
                skipped: 0, timed_out: 0,
                total_time_ms: 0, time_samples: 0,
                hints_used: 0,
                users: {},
                by_mode: {}
            };
        }
        return intel[qid];
    }

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (gameId && gameId !== "all" && ev.gameId !== gameId) continue;
        var en  = ev.eventName || "";
        var d   = ev.eventData || {};
        var qid = d.question_id || d.questionId || null;
        var uid = ev.userId || "";
        if (!qid) continue;

        var b = qBucket(qid);
        if (uid) b.users[uid] = true;

        var mode = d.quiz_mode || "";
        if (mode) {
            if (!b.by_mode[mode]) b.by_mode[mode] = { answered: 0, correct: 0 };
        }

        if (DISPLAYED_NAMES[en]) {
            b.displayed++;
        } else if (ANSWERED_NAMES[en]) {
            b.answered++;
            var ms = parseInt(d.time_to_answer_ms || d.response_time_ms || 0, 10);
            if (ms > 0 && ms < 120000) { b.total_time_ms += ms; b.time_samples++; }
            if (d.is_correct === true || d.is_correct === "true" || d.is_correct === 1) {
                b.correct++;
                if (mode) b.by_mode[mode].correct++;
            } else {
                b.wrong++;
            }
            if (mode) b.by_mode[mode].answered++;
        } else if (CORRECT_NAMES[en]) {
            b.correct++;
        } else if (WRONG_NAMES[en]) {
            b.wrong++;
        } else if (SKIPPED_NAMES[en]) {
            b.skipped++;
        } else if (TIMEOUT_NAMES[en]) {
            b.timed_out++;
        } else if (en === "hint_used" || en === "question_hint_used") {
            b.hints_used++;
        }
    }

    // Materialise unique-user counts and compute derived KPIs.
    var rows = [];
    for (var qk in intel) {
        if (!Object.prototype.hasOwnProperty.call(intel, qk)) continue;
        var r = intel[qk];
        var uniq = Object.keys(r.users).length;
        var acc  = r.answered > 0 ? Math.round((r.correct / r.answered) * 100) : null;
        var avgMs = r.time_samples > 0 ? Math.round(r.total_time_ms / r.time_samples) : null;
        rows.push({
            question_id:    r.question_id,
            displayed:      r.displayed,
            answered:       r.answered,
            correct:        r.correct,
            wrong:          r.wrong,
            skipped:        r.skipped,
            timed_out:      r.timed_out,
            hints_used:     r.hints_used,
            unique_players: uniq,
            accuracy_pct:   acc,
            avg_time_ms:    avgMs,
            by_mode:        r.by_mode
        });
    }
    rows.sort(function (a, b) { return b.displayed - a.displayed; });

    return {
        gameId:          gameId || "all",
        date:            dateStr,
        total_questions: rows.length,
        by_question:     rows.slice(0, 200), // cap at top-200 by display volume
        computed_at:     new Date().toISOString()
    };
}

// ─── Phase 4: offer performance compute helper ─────────────

/**
 * Per-offer funnel rollup for one game + one date.
 * Groups offer_* lifecycle events by offer_id.
 *
 * Output collection : analytics_offer_daily
 * Key               : offer_<gameId>_<YYYY-MM-DD>
 */
function arComputeOfferPerformance(events, gameId, dateStr) {
    gameId = arResolveGameId(gameId);
    var offers = {}; // offer_id → funnel bucket

    function oBucket(oid) {
        if (!offers[oid]) {
            offers[oid] = {
                offer_id: oid,
                eligible: 0, assigned: 0, viewed: 0,
                clicked: 0, purchased: 0, dismissed: 0,
                cooldown_blocked: 0,
                revenue_usd: 0,
                users: {}
            };
        }
        return offers[oid];
    }

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (gameId && gameId !== "all" && ev.gameId !== gameId) continue;
        var en  = ev.eventName || "";
        var d   = ev.eventData || {};
        var oid = d.offer_id || null;
        var uid = ev.userId || "";
        if (!oid) continue;
        if (en.indexOf("offer_") !== 0) continue;

        var b = oBucket(oid);
        if (uid) b.users[uid] = true;

        switch (en) {
            case "offer_eligible":        b.eligible++;        break;
            case "offer_assigned":        b.assigned++;        break;
            case "offer_viewed":          b.viewed++;          break;
            case "offer_clicked":         b.clicked++;         break;
            case "offer_purchased":
                b.purchased++;
                var rev = parseFloat(d.price_usd || d.price || d.revenue_usd || 0);
                if (isFinite(rev) && rev > 0) b.revenue_usd += rev;
                break;
            case "offer_dismissed":       b.dismissed++;       break;
            case "offer_cooldown_blocked":b.cooldown_blocked++;break;
        }
    }

    var rows = [];
    for (var ok in offers) {
        if (!Object.prototype.hasOwnProperty.call(offers, ok)) continue;
        var r = offers[ok];
        var uCount  = Object.keys(r.users).length;
        var viewRate  = r.eligible > 0 ? Math.round((r.viewed    / r.eligible)  * 100) : null;
        var clickRate = r.viewed   > 0 ? Math.round((r.clicked   / r.viewed)    * 100) : null;
        var convRate  = r.clicked  > 0 ? Math.round((r.purchased / r.clicked)   * 100) : null;
        var e2pRate   = r.eligible > 0 ? Math.round((r.purchased / r.eligible)  * 100) : null;
        rows.push({
            offer_id:          r.offer_id,
            eligible:          r.eligible,
            assigned:          r.assigned,
            viewed:            r.viewed,
            clicked:           r.clicked,
            purchased:         r.purchased,
            dismissed:         r.dismissed,
            cooldown_blocked:  r.cooldown_blocked,
            revenue_usd:       Math.round(r.revenue_usd * 100) / 100,
            unique_players:    uCount,
            view_rate_pct:     viewRate,
            click_rate_pct:    clickRate,
            conversion_rate_pct: convRate,
            eligible_to_purchase_pct: e2pRate
        });
    }
    rows.sort(function (a, b) { return b.eligible - a.eligible; });

    return {
        gameId:       gameId || "all",
        date:         dateStr,
        total_offers: rows.length,
        by_offer:     rows,
        computed_at:  new Date().toISOString()
    };
}

// ─── Phase 4: question_daily + offer_daily read RPCs ──────

/**
 * Read analytics_question_daily docs aggregated over N days.
 * Payload: { game_id, days?: 1-30, limit?: 50-200 }
 */
function rpcAnalyticsQuestionDailyRead(ctx, logger, nk, payload) {
    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var gameId = arResolveGameId(data.game_id || data.gameId || "all");
    var days   = Math.min(30, Math.max(1, parseInt(data.days, 10) || 7));
    var limit  = Math.min(200, Math.max(10, parseInt(data.limit, 10) || 100));

    var merged = {}; // question_id → aggregate
    var docsFound = 0;

    for (var di = 0; di < days; di++) {
        var d   = new Date();
        d.setUTCDate(d.getUTCDate() - di);
        var key = "question_" + gameId + "_" + arIsoDate(d);
        var doc = arReadOne(nk, AR_QUESTION_COLLECTION, key, AR_SYSTEM_USER);
        if (!doc || !doc.by_question) continue;
        docsFound++;
        for (var qi = 0; qi < doc.by_question.length; qi++) {
            var q = doc.by_question[qi];
            var qid = q.question_id;
            if (!merged[qid]) {
                merged[qid] = {
                    question_id: qid, displayed: 0, answered: 0,
                    correct: 0, wrong: 0, skipped: 0, timed_out: 0,
                    hints_used: 0, total_time_sum: 0, time_samples: 0, unique_players: 0
                };
            }
            var m = merged[qid];
            m.displayed      += q.displayed      || 0;
            m.answered       += q.answered       || 0;
            m.correct        += q.correct        || 0;
            m.wrong          += q.wrong          || 0;
            m.skipped        += q.skipped        || 0;
            m.timed_out      += q.timed_out      || 0;
            m.hints_used     += q.hints_used     || 0;
            m.unique_players += q.unique_players || 0; // upper bound across days
            if (q.avg_time_ms && q.answered) {
                m.total_time_sum += q.avg_time_ms * q.answered;
                m.time_samples   += q.answered;
            }
        }
    }

    var rows = [];
    for (var mk in merged) {
        if (!Object.prototype.hasOwnProperty.call(merged, mk)) continue;
        var r = merged[mk];
        rows.push({
            question_id:    r.question_id,
            displayed:      r.displayed,
            answered:       r.answered,
            correct:        r.correct,
            wrong:          r.wrong,
            skipped:        r.skipped,
            timed_out:      r.timed_out,
            hints_used:     r.hints_used,
            unique_players: r.unique_players,
            accuracy_pct:   r.answered > 0 ? Math.round((r.correct / r.answered) * 100) : null,
            avg_time_ms:    r.time_samples > 0 ? Math.round(r.total_time_sum / r.time_samples) : null
        });
    }
    rows.sort(function (a, b) { return b.displayed - a.displayed; });

    return arOk({
        game_id:     gameId,
        days:        days,
        docs_found:  docsFound,
        questions:   rows.slice(0, limit),
        source:      docsFound > 0 ? "question_daily" : "empty",
        hint:        docsFound === 0
            ? "No question_daily docs found — run analytics_rollup_run first."
            : "Aggregated " + docsFound + " day(s) of pre-computed question intelligence."
    });
}

/**
 * Read analytics_offer_daily docs aggregated over N days.
 * Payload: { game_id, days?: 1-30 }
 */
function rpcAnalyticsOfferDailyRead(ctx, logger, nk, payload) {
    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var gameId = arResolveGameId(data.game_id || data.gameId || "all");
    var days   = Math.min(30, Math.max(1, parseInt(data.days, 10) || 7));

    var merged = {}; // offer_id → aggregate
    var docsFound = 0;

    for (var di = 0; di < days; di++) {
        var d   = new Date();
        d.setUTCDate(d.getUTCDate() - di);
        var key = "offer_" + gameId + "_" + arIsoDate(d);
        var doc = arReadOne(nk, AR_OFFER_COLLECTION, key, AR_SYSTEM_USER);
        if (!doc || !doc.by_offer) continue;
        docsFound++;
        for (var oi = 0; oi < doc.by_offer.length; oi++) {
            var o = doc.by_offer[oi];
            var oid = o.offer_id;
            if (!merged[oid]) {
                merged[oid] = {
                    offer_id: oid, eligible: 0, assigned: 0, viewed: 0,
                    clicked: 0, purchased: 0, dismissed: 0, cooldown_blocked: 0,
                    revenue_usd: 0, unique_players: 0
                };
            }
            var m = merged[oid];
            m.eligible        += o.eligible        || 0;
            m.assigned        += o.assigned        || 0;
            m.viewed          += o.viewed          || 0;
            m.clicked         += o.clicked         || 0;
            m.purchased       += o.purchased       || 0;
            m.dismissed       += o.dismissed       || 0;
            m.cooldown_blocked += o.cooldown_blocked || 0;
            m.revenue_usd     += o.revenue_usd     || 0;
            m.unique_players  += o.unique_players  || 0;
        }
    }

    var rows = [];
    for (var mk in merged) {
        if (!Object.prototype.hasOwnProperty.call(merged, mk)) continue;
        var r = merged[mk];
        rows.push({
            offer_id:          r.offer_id,
            eligible:          r.eligible,
            assigned:          r.assigned,
            viewed:            r.viewed,
            clicked:           r.clicked,
            purchased:         r.purchased,
            dismissed:         r.dismissed,
            cooldown_blocked:  r.cooldown_blocked,
            revenue_usd:       Math.round(r.revenue_usd * 100) / 100,
            unique_players:    r.unique_players,
            view_rate_pct:     r.eligible > 0 ? Math.round((r.viewed    / r.eligible)  * 100) : null,
            click_rate_pct:    r.viewed   > 0 ? Math.round((r.clicked   / r.viewed)    * 100) : null,
            conversion_rate_pct: r.clicked > 0 ? Math.round((r.purchased / r.clicked)  * 100) : null,
            eligible_to_purchase_pct: r.eligible > 0 ? Math.round((r.purchased / r.eligible) * 100) : null
        });
    }
    rows.sort(function (a, b) { return b.eligible - a.eligible; });

    return arOk({
        game_id:    gameId,
        days:       days,
        docs_found: docsFound,
        offers:     rows,
        source:     docsFound > 0 ? "offer_daily" : "empty",
        hint:       docsFound === 0
            ? "No offer_daily docs found — run analytics_rollup_run first, and make sure offer_* events are being emitted."
            : "Aggregated " + docsFound + " day(s) of pre-computed offer performance."
    });
}

// ─── Revenue verification ─────────────────────────────────
// Diagnostic RPC: dumps per-day revenue straight from the daily
// rollup docs (rollup_<game>_<date>) so an operator can verify the
// 30-day total reported by analytics_arpu and spot which day(s)
// carry inflated / test revenue. Read-only, admin-gated.
function rpcAnalyticsRevenueVerify(ctx, logger, nk, payload) {
    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var gameId = arResolveGameId(data.game_id || data.gameId || "all");
    var days   = Math.min(365, Math.max(1, parseInt(data.days, 10) || 30));

    var rows = [];
    var totalUsd = 0;
    var totalIap = 0;
    var totalAdUsd = 0;
    var docsFound = 0;

    for (var di = 0; di < days; di++) {
        var d = new Date();
        d.setUTCDate(d.getUTCDate() - di);
        var dayStr = arIsoDate(d);
        var key = "rollup_" + gameId + "_" + dayStr;
        var doc = arReadOne(nk, AR_ROLLUP_COLLECTION, key, AR_SYSTEM_USER);
        if (!doc) continue;
        docsFound++;
        var rev = doc.revenue || {};
        var usd = rev.usd || 0;
        var iap = rev.iap_count || 0;
        var adUsd = rev.ad_revenue_usd || 0;
        totalUsd += usd;
        totalIap += iap;
        totalAdUsd += adUsd;
        rows.push({
            date: dayStr,
            revenue_usd: usd,
            iap_count: iap,
            ad_revenue_usd: adUsd,
            avg_per_iap: iap > 0 ? Math.round((usd / iap) * 100) / 100 : 0,
            dau: doc.dau || 0
        });
    }

    // Surface the biggest single-day contributors first so inflated /
    // test days are obvious at a glance.
    var byRevenue = rows.slice().sort(function (a, b) { return b.revenue_usd - a.revenue_usd; });

    return arOk({
        game_id:    gameId,
        days:       days,
        docs_found: docsFound,
        total_revenue_usd: Math.round(totalUsd * 100) / 100,
        total_iap_count:   totalIap,
        total_ad_revenue_usd: Math.round(totalAdUsd * 100) / 100,
        avg_per_iap: totalIap > 0 ? Math.round((totalUsd / totalIap) * 100) / 100 : 0,
        by_day:     rows,                  // chronological-ish (today → back)
        top_days:   byRevenue.slice(0, 10),
        hint:       docsFound === 0
            ? "No daily rollup docs found for this game/range — run analytics_rollup_run / backfill first."
            : "Compare total_revenue_usd here against analytics_arpu.totalRevenue. Inspect top_days for inflated/test revenue."
    });
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_rollup_run", rpcAnalyticsRollupRun);
    // Alias: dashboard Admin panel calls analytics_run_rollup; forward to same handler.
    initializer.registerRpc("analytics_run_rollup", rpcAnalyticsRollupRun);
    initializer.registerRpc("analytics_rollup_backfill", rpcAnalyticsRollupBackfill);
    initializer.registerRpc("analytics_rollup_status", rpcAnalyticsRollupStatus);
    initializer.registerRpc("analytics_modes_daily_read",     rpcAnalyticsModesDailyRead);
    initializer.registerRpc("analytics_dropoff_daily_read",   rpcAnalyticsDropoffDailyRead);
    initializer.registerRpc("analytics_question_daily_read",  rpcAnalyticsQuestionDailyRead);
    initializer.registerRpc("analytics_offer_daily_read",     rpcAnalyticsOfferDailyRead);
    initializer.registerRpc("analytics_revenue_verify",        rpcAnalyticsRevenueVerify);
    logger.info("[analytics_rollup] Module registered: 9 RPCs (run, run_alias, backfill, status, modes_daily_read, dropoff_daily_read, question_daily_read, offer_daily_read, revenue_verify)");
}
