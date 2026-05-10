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

// Legacy → canonical event-name aliases. Must match EVENT_ALIASES in
// analytics.js so events ingested with the old names (before analytics.js
// began normalizing at write time) still roll up against the canonical
// names used by AR_FUNNEL_STEPS and monetization/retention KPIs.
var AR_EVENT_ALIASES = {
    "quiz_started": "quiz_start",
    "quiz_completed": "quiz_complete",
    "quiz_abandon": "quiz_abandoned",
    "purchase_completed": "iap_purchased",
    "purchase_started": "iap_clicked",
    "iap_completed": "iap_purchased",
    "iap_started": "iap_clicked",
    "login_succeeded": "login_success",
    "onboarding_completed": "onboarded",
    "onboarding_complete": "onboarded",
    "registration_completed": "registration_complete",
    "paywall_viewed": "paywall_shown",
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
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null) {
        var v = String(ctx.env[key]);
        if (v.length > 0) return v;
    }
    // Mirror the hardcoded-fallback in analytics_admin.js::aaEnv so the
    // auto-drain state machine (which calls rpcAnalyticsRollupBackfill with
    // a synthesized dashboard_secret) passes the admin gate when env vars
    // aren't set in the cluster. Only the secret falls back here — feature
    // flags etc. stay env-only.
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
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
    } catch (e) { return false; }
}

// ─── Core: scan events for one day ────────────────────────

/**
 * Streams analytics_events under SYSTEM_USER and collects records falling on `dateStr`.
 * Returns { events: [...], scanned, truncated }.
 *
 * Note: we rely on the dashboard-fanout copy written by persistNormalizedEvent,
 * which is keyed as `dash_<YYYY-MM-DD>_<eventName>_...`. Scanning under SYSTEM_USER
 * avoids cross-user reads and is the cheapest path.
 */
function arScanEventsForDate(nk, logger, dateStr) {
    var events = [];
    var scanned = 0;
    var truncated = false;
    var cursor = null;
    var maxPages = 50;          // safety cap: 50 pages × 200 = 10k events / day
    var pageSize = 200;
    var dayStart = Math.floor(new Date(dateStr + "T00:00:00.000Z").getTime() / 1000);
    var dayEnd = dayStart + 86400;

    for (var p = 0; p < maxPages; p++) {
        var page;
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

    if (events.length >= maxPages * pageSize) truncated = true;
    return { events: events, scanned: scanned, truncated: truncated };
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

        // Revenue
        if (eventName === "iap_purchased") {
            iapCount++;
            var price = parseFloat(data.price_usd || data.priceUsd || 0);
            if (isFinite(price) && price > 0) revenueUsd += price;
        }
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
                : 0
        },
        funnel: funnelOut,
        funnel_order: funnelOrder,
        ai_usage: aiUsage,
        top_events: topEvents,
        top_screens: topScreens,
        platform_breakdown: platformBreakdown,
        errors: errorsByCategory,
        computed_at: new Date().toISOString(),
        event_count: events.length
    };
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

// ─── RPC: analytics_rollup_run ────────────────────────────

function rpcAnalyticsRollupRun(ctx, logger, nk, payload) {
    if (!arFeatureEnabled(ctx)) return arErr("Rollup feature disabled (ROLLUP_ENABLED=false)", 503);

    var data = arParse(payload);
    var gate = arRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arErr(gate.reason, 401);

    var dateStr = data.date || arYesterday();
    if (!arValidDateStr(dateStr)) return arErr("Invalid date (expected YYYY-MM-DD)", 400);

    logger.info("[analytics_rollup] run date=" + dateStr);

    var scanResult;
    try {
        scanResult = arScanEventsForDate(nk, logger, dateStr);
    } catch (e) {
        logger.error("[analytics_rollup] scan failed: " + e.message);
        return arErr("Scan failed: " + e.message, 500);
    }

    var events = scanResult.events;

    // Build list of gameIds present in this date's events, plus optional explicit list.
    // Canonicalize via arResolveGameId so callers passing legacy slugs (e.g. "quizverse")
    // don't create a duplicate rollup bucket alongside the UUID-keyed events.
    var gameIdSet = {};
    for (var i = 0; i < events.length; i++) {
        if (events[i].gameId) gameIdSet[arResolveGameId(events[i].gameId)] = true;
    }
    if (Array.isArray(data.gameIds)) {
        for (var gi = 0; gi < data.gameIds.length; gi++) {
            if (data.gameIds[gi]) gameIdSet[arResolveGameId(data.gameIds[gi])] = true;
        }
    }
    var gameIds = Object.keys(gameIdSet);

    var written = [];

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
        arWriteOne(nk, AR_ROLLUP_COLLECTION, "rollup_" + gameId + "_" + dateStr, AR_SYSTEM_USER, roll);
        arWriteOne(nk, AR_FUNNEL_COLLECTION, "funnel_" + gameId + "_" + dateStr, AR_SYSTEM_USER, {
            gameId: gameId, date: dateStr, funnel: roll.funnel, funnel_order: roll.funnel_order
        });
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
    arWriteOne(nk, AR_ROLLUP_COLLECTION, "rollup_all_" + dateStr, AR_SYSTEM_USER, allRollup);
    arWriteOne(nk, AR_FUNNEL_COLLECTION, "funnel_all_" + dateStr, AR_SYSTEM_USER, {
        gameId: "all", date: dateStr, funnel: allRollup.funnel, funnel_order: allRollup.funnel_order
    });
    written.unshift({ scope: "all", date: dateStr, dau: allRollup.dau, events: allRollup.event_count, new_users: allRollup.new_users });

    // Record success marker.
    arWriteOne(nk, AR_META_COLLECTION, "last_success", AR_SYSTEM_USER, {
        date: dateStr,
        gameIds: gameIds,
        eventsScanned: scanResult.scanned,
        eventsMatched: events.length,
        truncated: scanResult.truncated,
        timestamp: new Date().toISOString(),
        bypass: gate.bypass
    });

    logger.info("[analytics_rollup] done date=" + dateStr +
                " games=" + gameIds.length +
                " events=" + events.length +
                " scanned=" + scanResult.scanned);

    return arOk({
        date: dateStr,
        games_rolled_up: gameIds.length,
        events_matched: events.length,
        events_scanned: scanResult.scanned,
        truncated: scanResult.truncated,
        written: written
    });
}

// ─── RPC: analytics_rollup_backfill ───────────────────────

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

    // Canonicalize caller-supplied gameIds once at the entry point so each
    // per-date run downstream sees UUIDs even if the operator passed slugs.
    var aliasedGameIds = null;
    if (Array.isArray(data.gameIds)) {
        aliasedGameIds = [];
        for (var ag = 0; ag < data.gameIds.length; ag++) {
            if (data.gameIds[ag]) aliasedGameIds.push(arResolveGameId(data.gameIds[ag]));
        }
    }

    var results = [];
    for (var i = 0; i < dates.length; i++) {
        var runPayload = { date: dates[i], dashboard_secret: data.dashboard_secret, gameIds: aliasedGameIds };
        var raw;
        try { raw = rpcAnalyticsRollupRun(ctx, logger, nk, JSON.stringify(runPayload)); }
        catch (e) {
            results.push({ date: dates[i], success: false, error: e.message });
            continue;
        }
        try {
            var parsed = JSON.parse(raw);
            results.push({
                date: dates[i],
                success: !!parsed.success,
                events_matched: parsed.events_matched || 0,
                games: parsed.games_rolled_up || 0
            });
        } catch (e) { results.push({ date: dates[i], success: false, error: "parse" }); }
    }
    return arOk({ backfilled: results.length, results: results });
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

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_rollup_run", rpcAnalyticsRollupRun);
    initializer.registerRpc("analytics_rollup_backfill", rpcAnalyticsRollupBackfill);
    initializer.registerRpc("analytics_rollup_status", rpcAnalyticsRollupStatus);
    logger.info("[analytics_rollup] Module registered: 3 RPCs (run, backfill, status)");
}
