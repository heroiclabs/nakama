// analytics_player_profile.js
// Per-player analytics snapshot — backs the AnalyticsManager.GetPlayerAnalyticsProfile
// client call. Reads the player's first_seen marker, lifetime event counters from
// storage_user, and computes simple D-bucket / engagement signals. Cheap enough
// to call once per session at boot for tier/country/device-aware HUD widgets.
//
// REGISTERS:
//   analytics_get_player_profile  — returns { success, data:{...profile...} }
//
// REQUEST PAYLOAD:
//   { "gameId": "quizverse" }   // optional, defaults to "default"
//
// RESPONSE:
//   {
//     "success": true,
//     "data": {
//       "user_id":           "<uuid>",
//       "game_id":           "quizverse",
//       "first_seen_utc":    1700000000,
//       "days_since_install": 12,
//       "lifetime_event_count": 2840,
//       "lifetime_session_count": 18,
//       "last_event_utc":    1701000000,
//       "tier_signals": { "country": "US", "platform": "ios" }
//     }
//   }
//
// SAFETY:
//   * Reads ONLY storage objects owned by the caller (or system).
//   * No writes — pure read snapshot.
//   * Falls back to zero-valued profile on any error (never throws to client).

var FIRST_SEEN_COLLECTION = "analytics_user_first_seen";
// Removed unused `analytics_event_count_user` declaration — never read or
// written; the per-user event count is now derived from the GPA doc's
// `events` ring buffer in analytics_player_profile.js drill-down RPCs.
var DEFAULT_GAME_ID = "default";

// Slug→UUID alias for legacy ingestion ("quizverse" → "126bf539-...").
// Delegates to the bundled global resolveGameIdAlias when available so the
// alias map (defined in analytics.js) stays the single source of truth.
function appResolveGameId(g) {
    if (!g) return g;
    try {
        if (typeof resolveGameIdAlias === 'function') return resolveGameIdAlias(g);
    } catch (e) { /* fall through */ }
    return g;
}

function rpcAnalyticsGetPlayerProfile(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) { /* ignore */ }

        var gameId = appResolveGameId(data.gameId || data.game_id || DEFAULT_GAME_ID);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "no_session" });
        }

        // Single-read from unified game_player_analytics collection
        var profile = gpaReadProfile(nk, gameId, userId);

        var nowUtc = Math.floor(Date.now() / 1000);
        var firstSeenUtc = profile.first_seen_utc || nowUtc;
        var daysSinceInstall = Math.floor((nowUtc - firstSeenUtc) / 86400);

        var country = profile.country || (ctx.vars && ctx.vars.country) || "??";
        var platform = profile.platform || (ctx.vars && ctx.vars.platform) || "unknown";

        return JSON.stringify({
            success: true,
            data: {
                user_id: userId,
                game_id: gameId,
                first_seen_utc: firstSeenUtc,
                days_since_install: daysSinceInstall,
                lifetime_event_count: profile.lt_events,
                lifetime_session_count: profile.lt_sessions,
                last_event_utc: profile.last_active_utc,
                mode_counts: profile.mode_counts,
                lifetime_quiz_plays: profile.lt_quiz_plays,
                favorite_mode: profile.fav_mode,
                favorite_mode_count: profile.fav_mode_n,
                engagement: profile.eng,
                money: profile.money,
                tier_signals: {
                    country: country,
                    platform: platform,
                    device_tier: profile.device_tier,
                    device_model: profile.device_model,
                    app_version: profile.app_version
                }
            }
        });
    } catch (err) {
        logger.warn("[analytics_get_player_profile] error: " + err.message);
        return JSON.stringify({ success: false, error: err.message || "unknown_error" });
    }
}

// ─────────────────────────────────────────────────────────────────────
// analytics_record_user_rollup
// ─────────────────────────────────────────────────────────────────────
// Daily client-side counter flush. Client tracks event/session counts in
// PlayerPrefs and calls this RPC at most once per 24h (idempotency-key
// guarded). Server reads the existing rollup, adds the day's deltas, and
// writes back. This is what makes analytics_get_player_profile's
// lifetime_event_count + lifetime_session_count fields actually accurate.
//
// PAYLOAD:
//   {
//     "gameId":         "quizverse",   // optional
//     "events_delta":   42,            // events fired since last flush
//     "sessions_delta": 1,             // sessions started since last flush
//     "last_event_utc": 1700000000,    // optional, defaults to now
//     "idempotency_key": "2026-04-22"  // typically a date string; replays
//                                       // within 36h are silent no-ops
//   }
//
// RESPONSE:
//   { success:true, data:{ event_count, session_count, last_event_utc,
//                          accepted, replayed } }
//
// SAFETY:
//   * Caps single-call deltas at 10k events / 50 sessions (anti-abuse).
//   * Idempotency: the last accepted key is persisted alongside counters;
//     re-sends with the same key return the current totals with
//     replayed:true and DO NOT double-count.
//   * On any error returns { success:false } — client should treat as
//     "try again next session" and not retry hard.

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
var MAX_EVENTS_PER_FLUSH   = 10000;
var MAX_SESSIONS_PER_FLUSH = 50;
// Per-mode counts are an *absolute* snapshot (not a delta); cap each entry
// to the same daily ceiling as events to bound storage/abuse. Cap mode-key
// length so a malicious client can't pump huge keys into our storage row.
var MAX_MODE_COUNT         = 1000000;
var MAX_MODE_KEY_LEN       = 64;
var MAX_MODE_ENTRIES       = 64;

function rpcAnalyticsRecordUserRollup(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) { /* ignore */ }

        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "no_session" });
        }

        var gameId = appResolveGameId(data.gameId || data.game_id || DEFAULT_GAME_ID);
        var idempotencyKey = (data.idempotency_key || data.idempotencyKey || "").toString();

        var eventsDelta = parseInt(data.events_delta || data.eventsDelta || 0, 10) || 0;
        var sessionsDelta = parseInt(data.sessions_delta || data.sessionsDelta || 0, 10) || 0;
        if (eventsDelta < 0) eventsDelta = 0;
        if (sessionsDelta < 0) sessionsDelta = 0;
        if (eventsDelta > MAX_EVENTS_PER_FLUSH) eventsDelta = MAX_EVENTS_PER_FLUSH;
        if (sessionsDelta > MAX_SESSIONS_PER_FLUSH) sessionsDelta = MAX_SESSIONS_PER_FLUSH;

        var nowUtc = Math.floor(Date.now() / 1000);
        var lastEventUtc = parseInt(data.last_event_utc || data.lastEventUtc || nowUtc, 10) || nowUtc;
        if (lastEventUtc > nowUtc + 300) lastEventUtc = nowUtc;

        // Sanitize incoming mode_counts
        var incomingMode = (data.mode_counts || data.modeCounts) || null;
        var sanitizedModes = {};
        if (incomingMode && typeof incomingMode === "object") {
            var entries = 0;
            for (var ik in incomingMode) {
                if (!Object.prototype.hasOwnProperty.call(incomingMode, ik)) continue;
                if (entries >= MAX_MODE_ENTRIES) break;
                var key = ("" + ik).substring(0, MAX_MODE_KEY_LEN);
                var iv = parseInt(incomingMode[ik], 10) || 0;
                if (iv < 0) iv = 0;
                if (iv > MAX_MODE_COUNT) iv = MAX_MODE_COUNT;
                sanitizedModes[key] = iv;
                entries++;
            }
        }

        // Write to unified game_player_analytics via CAS
        var rollupData = {
            eventsDelta: eventsDelta,
            sessionsDelta: sessionsDelta,
            lastEventUtc: lastEventUtc,
            idempotencyKey: idempotencyKey,
            modeCounts: sanitizedModes
        };

        var success = gpaUpsertRollup(nk, logger, userId, gameId, rollupData);

        // Read back for response
        var profile = gpaReadProfile(nk, gameId, userId);

        return JSON.stringify({
            success: true,
            data: {
                event_count: profile.lt_events,
                session_count: profile.lt_sessions,
                last_event_utc: profile.last_active_utc,
                mode_counts: profile.mode_counts,
                accepted: success,
                replayed: !success
            }
        });
    } catch (err) {
        logger.warn("[analytics_record_user_rollup] error: " + err.message);
        return JSON.stringify({ success: false, error: err.message || "unknown_error" });
    }
}

// ═════════════════════════════════════════════════════════
// ADMIN-SIDE: player search + full drill-down profile
// ═════════════════════════════════════════════════════════
//
// These RPCs back the dashboard's "Player Drill-down" tab. They
// scan analytics_events to build a per-player snapshot:
//   * Lifetime KPIs (sessions / quizzes / spend / streaks / last seen)
//   * Mode-by-mode play counts
//   * IAP history with timestamps
//   * 30-day timeline of every event firing
//   * Churn-risk score (0-100) + recommended retention actions
//
// SAFETY:
//   * Admin-gated via the same dashboard secret used by analytics_admin.
//   * Read-only on storage (no writes from this RPC family).
//   * Output bounded: max 200 timeline events, max 50 IAP rows.

var APP_DASH_COLLECTION = "analytics_events";

function appAdminScanEvents(nk, logger, days, filterFn, gameId) {
    if (typeof extScanEvents === 'function') {
        return extScanEvents(nk, logger, APP_DASH_COLLECTION, days, filterFn, gameId);
    }
    var out = [];
    try {
        var cursor = null, iter = 0;
        var cutoff = new Date(); cutoff.setUTCDate(cutoff.getUTCDate() - days);
        var cutoffIso = cutoff.toISOString().slice(0, 10);
        do {
            var r = nk.storageList(SYSTEM_USER_ID, APP_DASH_COLLECTION, 100, cursor);
            if (!r || !r.objects) break;
            for (var i = 0; i < r.objects.length; i++) {
                var v = r.objects[i].value || {};
                if (filterFn && !filterFn(v)) continue;
                out.push(v);
            }
            cursor = r.cursor; iter++;
        } while (cursor && iter < 30);
    } catch (e) { if (logger) logger.warn('[app_admin] scan err: ' + e.message); }
    return out;
}

function appAdminClampPct(v) {
    v = Math.round(v);
    if (!isFinite(v) || v < 0) return 0;
    return v > 100 ? 100 : v;
}

/**
 * Verify the dashboard secret on admin RPC calls.
 * Mirrors aaVerifyDashboardSecret() from analytics_admin.js so this
 * module doesn't require that one being loaded first.
 */
function appAdminVerifySecret(payload, ctx, nk, logger) {
    // 1. Session-based admin: same gate as every other dashboard RPC.
    //    The dashboard logs in via `admin_login` which provisions a Nakama
    //    user with username "admin:<name>" and writes admin_users/profile.
    try {
        if (ctx && ctx.userId && ctx.username && typeof aaIsAdminUser === 'function') {
            if (aaIsAdminUser(nk, logger, ctx.userId, ctx.username)) return true;
        }
    } catch (e) { /* fall through to secret check */ }

    // 2. Shared-secret fallback (CI / scripts that don't have a session).
    try {
        var got = (payload && (payload.dashboard_secret || payload.secret || payload.token)) || '';
        if (typeof aaEnv === 'function') {
            try {
                var env = aaEnv();
                if (env && env.dashboard_secret && got === env.dashboard_secret) return true;
            } catch (e2) { /* fall through */ }
        }
        if (typeof AA_FALLBACK_DASHBOARD_SECRET === 'string' && got === AA_FALLBACK_DASHBOARD_SECRET) return true;
        return false;
    } catch (e) { return false; }
}

/**
 * analytics_admin_player_search — find players by user_id prefix or username.
 *
 * REQUEST:  { "dashboard_secret": "...", "query": "abc", "game_id": "...", "limit": 20 }
 * RESPONSE: { "players": [ { "user_id": "...", "username": "...", "lt_events": N, "last_active_utc": ts } ] }
 */
function rpcAnalyticsAdminPlayerSearch(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) {}
        if (!appAdminVerifySecret(data, ctx, nk, logger)) return JSON.stringify({ error: 'invalid_secret' });

        // Accept "q" (used by the dashboard) as an alias for "query".
        var query = (data.q || data.query || '').toString().trim().toLowerCase();
        if (!query || query.length < 2) return JSON.stringify({ error: 'query must be at least 2 chars' });
        var limit = Math.min(parseInt(data.limit, 10) || 20, 50);

        // Scan game_player_analytics user-keyed collection (one record per user/game)
        var players = [];
        try {
            var cursor = null, iter = 0;
            do {
                var r = nk.storageList(null, 'game_player_analytics', 100, cursor);
                if (!r || !r.objects) break;
                for (var i = 0; i < r.objects.length && players.length < limit; i++) {
                    var obj = r.objects[i];
                    var v = obj.value || {};
                    var uid = obj.userId || '';
                    var uname = (v.username || v.display_name || v.user_name || '').toString();
                    var hay = (uid + ' ' + uname).toLowerCase();
                    if (hay.indexOf(query) === -1) continue;
                    players.push({
                        user_id: uid,
                        username: uname,
                        lt_events: v.lt_events || v.lifetime_event_count || 0,
                        lt_sessions: v.lt_sessions || v.lifetime_session_count || 0,
                        lt_quiz_plays: v.lt_quiz_plays || 0,
                        last_active_utc: v.last_active_utc || v.lastEventUtc || 0,
                        platform: v.platform || (v.tier_signals && v.tier_signals.platform) || null,
                        country: v.country || (v.tier_signals && v.tier_signals.country) || null,
                        favorite_mode: v.fav_mode || null
                    });
                }
                cursor = r.cursor; iter++;
            } while (cursor && iter < 50 && players.length < limit);
        } catch (e) { logger.warn('[app_admin_search] scan err: ' + e.message); }

        return JSON.stringify({ query: query, count: players.length, players: players });
    } catch (err) {
        logger.warn('[analytics_admin_player_search] err: ' + err.message);
        return JSON.stringify({ error: err.message });
    }
}

/**
 * analytics_admin_player_full_profile — deep drill-down for the dashboard.
 *
 * REQUEST:  { "dashboard_secret": "...", "user_id": "...", "game_id": "...", "days": 30 }
 *
 * RESPONSE:
 *   {
 *     "user_id": "...",
 *     "summary": { lifetime KPIs },
 *     "mode_history": [ { "mode": "Solo", "plays": 17, "completion_rate_pct": 80 } ],
 *     "iap_history": [ { "ts": 1700000000, "product_id": "...", "price": 0.99, "currency": "USD" } ],
 *     "ad_history": { "impressions": N, "completions": N, "revenue_usd": N },
 *     "timeline": [ { "ts": 1700000000, "name": "...", "data": {...} } ],   // 30-day chronological
 *     "churn_risk": { "score": 0..100, "label": "high/medium/low", "reasons": [...] },
 *     "retention_actions": [ "Send re-engagement push", "Offer 50% discount", ... ]
 *   }
 */
function rpcAnalyticsAdminPlayerFullProfile(ctx, logger, nk, payload) {
    try {
        var data = {};
        try { data = JSON.parse(payload || '{}'); } catch (_) {}
        if (!appAdminVerifySecret(data, ctx, nk, logger)) return JSON.stringify({ error: 'invalid_secret' });

        var userId = (data.user_id || data.userId || '').toString();
        if (!userId) return JSON.stringify({ error: 'user_id required' });
        var days = parseInt(data.days, 10) || 30;
        if (days < 7) days = 7; if (days > 90) days = 90;
        var gameId = data.game_id || data.gameId || DEFAULT_GAME_ID;
        var gameIdResolved = appResolveGameId(gameId);

        // 1. Lifetime profile snapshot
        // Canonical GPA key is `gameId:userId` (see player_analytics_store.js
        // gpaCasUpsert ~L135). Earlier this read used just `gameIdResolved`,
        // which never matched any record → drill-down KPIs were always zero.
        var profile = {};
        try {
            var gpaKey = gameIdResolved + ':' + userId;
            var p = nk.storageRead([{ collection: 'game_player_analytics', key: gpaKey, userId: userId }]);
            if (p && p.length > 0) profile = p[0].value || {};
        } catch (e) { /* ignore */ }

        // 2. Scan events for this user only (filter on userId in event payload)
        var events = appAdminScanEvents(nk, logger, days, function(ev) {
            var u = ev.userId || ev.user_id || (ev.eventData && (ev.eventData.user_id || ev.eventData.userId));
            return u === userId;
        }, gameIdResolved);

        // 3. Aggregate from event stream
        var modeCounts = {}; // mode → { plays, completions, abandoned }
        var iaps = [];
        var ads = { impressions: 0, completions: 0, revenue_usd: 0 };
        var paywallShown = 0, paywallConverted = 0;
        var streakBroken = 0, streakBest = 0, lastEventTs = 0;
        var sessions = 0;
        var timeline = [];

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var n = (ev.eventName || '').toLowerCase();
            var d = ev.eventData || ev.properties || {};
            var ts = parseInt(ev.timestamp || ev.unixTimestamp || 0, 10) || 0;
            if (ts > lastEventTs) lastEventTs = ts;

            if (n === 'session_start') sessions++;
            else if (n === 'quiz_session_started' || n === 'quiz_started') {
                var m = d.quiz_mode || d.quizMode || 'unspecified';
                var b = modeCounts[m] || (modeCounts[m] = { plays: 0, completions: 0, abandoned: 0 });
                b.plays++;
            }
            else if (n === 'quiz_session_ended' || n === 'quiz_completed') {
                var m2 = d.quiz_mode || d.quizMode || 'unspecified';
                var b2 = modeCounts[m2] || (modeCounts[m2] = { plays: 0, completions: 0, abandoned: 0 });
                var oc = (d.quiz_outcome || d.outcome || 'completed').toString().toLowerCase();
                if (oc === 'completed' || oc === 'win') b2.completions++; else b2.abandoned++;
            }
            else if (n === 'quiz_abandoned' || n === 'quiz_session_abandoned') {
                var m3 = d.quiz_mode || d.quizMode || 'unspecified';
                var b3 = modeCounts[m3] || (modeCounts[m3] = { plays: 0, completions: 0, abandoned: 0 });
                b3.abandoned++;
            }
            else if (n === 'purchase_completed' || n === 'iap_completed') {
                if (iaps.length < 50) iaps.push({
                    ts: ts,
                    product_id: d.product_id || d.productId || '',
                    price: parseFloat(d.price || d.price_local || 0) || 0,
                    currency: d.currency || 'USD',
                    transaction_id: d.transaction_id || d.transactionId || ''
                });
            }
            else if (n === 'ad_shown' || n === 'ad_impression') ads.impressions++;
            else if (n === 'ad_completed') ads.completions++;
            else if (n === 'ad_revenue') {
                var rev = parseFloat(d.revenue_usd || d.revenueUSD || 0) || 0;
                if (rev > 0 && rev < 50) ads.revenue_usd += rev;
            }
            else if (n === 'paywall_shown') paywallShown++;
            else if (n === 'paywall_converted') paywallConverted++;
            else if (n === 'streak_broken') streakBroken++;
            else if (n === 'streak_milestone') {
                var sk = parseInt(d.streak_count || 0, 10);
                if (sk > streakBest) streakBest = sk;
            }

            if (timeline.length < 200) timeline.push({ ts: ts, name: ev.eventName, data: d });
        }
        timeline.sort(function(a, b) { return b.ts - a.ts; }); // most-recent first

        // 4. Mode history rows
        var modeRows = [];
        for (var mk in modeCounts) {
            if (!Object.prototype.hasOwnProperty.call(modeCounts, mk)) continue;
            var m4 = modeCounts[mk];
            var t = m4.plays || 1;
            modeRows.push({
                mode: mk,
                plays: m4.plays,
                completions: m4.completions,
                abandoned: m4.abandoned,
                completion_rate_pct: appAdminClampPct((m4.completions / t) * 100)
            });
        }
        modeRows.sort(function(a, b) { return b.plays - a.plays; });

        // 5. Churn-risk score (0-100; higher = more at-risk)
        var nowUtc = Math.floor(Date.now() / 1000);
        var lastActive = profile.last_active_utc || lastEventTs || 0;
        var daysSinceActive = lastActive ? Math.floor((nowUtc - lastActive) / 86400) : 999;
        var totalIapSpend = 0;
        for (var ii = 0; ii < iaps.length; ii++) totalIapSpend += iaps[ii].price;

        var churnScore = 0;
        var reasons = [];
        if (daysSinceActive >= 14) { churnScore += 50; reasons.push('inactive 14+ days'); }
        else if (daysSinceActive >= 7) { churnScore += 25; reasons.push('inactive 7+ days'); }
        if (sessions <= 1) { churnScore += 15; reasons.push('one-and-done user'); }
        if (paywallShown >= 1 && paywallConverted === 0 && totalIapSpend === 0) { churnScore += 15; reasons.push('saw paywall, never converted'); }
        if (streakBroken >= 1) { churnScore += 10; reasons.push('broke a streak'); }
        if (modeRows.length === 0) { churnScore += 10; reasons.push('no quiz plays'); }
        if (churnScore > 100) churnScore = 100;

        var churnLabel = churnScore >= 70 ? 'high' : churnScore >= 40 ? 'medium' : 'low';

        // 6. Recommended retention actions
        var actions = [];
        if (daysSinceActive >= 7) actions.push('Send re-engagement push notification');
        if (paywallShown >= 1 && totalIapSpend === 0) actions.push('Offer 50% discount on first IAP');
        if (streakBroken >= 1) actions.push('Grant streak shield as comeback gift');
        if (sessions <= 1) actions.push('Trigger onboarding tutorial on next open');
        if (modeRows.length > 0 && modeRows[0].mode === 'unspecified') actions.push('Highlight most-popular quiz modes on home screen');
        if (totalIapSpend === 0 && ads.completions > 5) actions.push('Show "remove ads" offer next session');
        if (actions.length === 0) actions.push('User is healthy — no action needed');

        return JSON.stringify({
            user_id: userId,
            game_id: gameIdResolved,
            summary: {
                lt_events: profile.lt_events || 0,
                lt_sessions: profile.lt_sessions || sessions,
                lt_quiz_plays: profile.lt_quiz_plays || 0,
                first_seen_utc: profile.first_seen_utc || 0,
                last_active_utc: lastActive,
                days_since_active: daysSinceActive,
                total_iap_spend_usd: Math.round(totalIapSpend * 100) / 100,
                ad_revenue_usd: Math.round(ads.revenue_usd * 100) / 100,
                ad_impressions: ads.impressions,
                ad_completions: ads.completions,
                paywall_shown: paywallShown,
                paywall_converted: paywallConverted,
                streak_broken_count: streakBroken,
                streak_best: streakBest,
                username: profile.username || profile.display_name || null,
                platform: profile.platform || null,
                country: profile.country || null,
                device_model: profile.device_model || null,
                app_version: profile.app_version || null
            },
            mode_history: modeRows,
            iap_history: iaps.sort(function(a, b) { return b.ts - a.ts; }),
            ad_history: ads,
            timeline: timeline,
            churn_risk: {
                score: churnScore,
                label: churnLabel,
                reasons: reasons
            },
            retention_actions: actions
        });
    } catch (err) {
        logger.warn('[analytics_admin_player_full_profile] err: ' + err.message);
        return JSON.stringify({ error: err.message });
    }
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_get_player_profile", rpcAnalyticsGetPlayerProfile);
    initializer.registerRpc("analytics_record_user_rollup", rpcAnalyticsRecordUserRollup);
    initializer.registerRpc("analytics_admin_player_search", rpcAnalyticsAdminPlayerSearch);
    initializer.registerRpc("analytics_admin_player_full_profile", rpcAnalyticsAdminPlayerFullProfile);
    logger.info("[analytics_player_profile] Module registered: 4 RPCs");
}
