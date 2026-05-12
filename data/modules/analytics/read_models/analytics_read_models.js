// analytics_read_models.js — Phase 4 (2026-05) dashboard read models.
//
// Provides four admin-gated read RPCs that serve dashboard tabs from
// pre-computed rollup docs instead of expensive live event scans.
//
// ─── Why this module exists ─────────────────────────────────────────────────
//
// analytics_extended.js and the live quiz/dropoff/modes RPCs all work by
// calling nk.storageList on analytics_events — an O(N) scan on every request.
// As the event collection grows past ~1M docs, those scans cap out at
// STORAGE_LIST_MAX_LIMIT (1000) and start returning stale/truncated data.
//
// Phase 4 fixes this by making the nightly analytics_rollup_run write
// additional pre-aggregated docs (analytics_question_daily,
// analytics_offer_daily) in the same scan pass. This module reads those
// compact docs and assembles the dashboard payload in microseconds.
//
// ─── Registered RPCs ────────────────────────────────────────────────────────
//
//   analytics_question_intelligence
//     Multi-day question performance: accuracy, speed, difficulty ranking.
//     Payload: { game_id?, days?: 1–30, limit?: 10–200, sort?: "hardest"|"easiest"|"most_played"|"most_skipped" }
//
//   analytics_offer_performance
//     Multi-day offer funnel: eligible→viewed→clicked→purchased with rates.
//     Payload: { game_id?, days?: 1–30 }
//
//   analytics_satori_audience_debug
//     Per-player Satori eligibility snapshot: lifetime stats, segment
//     membership (winback, pre-IAP), days since last active, GPA snapshot.
//     Payload: { user_id: "<uuid>", game_id? }  (admin can debug any user)
//
//   analytics_player_timeline
//     Paginated per-player event browser, reverse-chronological.
//     Payload: { user_id: "<uuid>", game_id?, event_name?, from?, to?,
//                limit?: 10–200, cursor? }
//
// ─── Admin gating ────────────────────────────────────────────────────────────
//
//   Bearer token userId registered in admin_users/profile (isAdmin=true),
//   OR payload.dashboard_secret matching ctx.env.DASHBOARD_SECRET.
//   The system user (00000000-...) is always allowed (cron / Nakama hooks).

var ARM_SYSTEM_USER           = "00000000-0000-0000-0000-000000000000";
var ARM_ADMIN_COLLECTION      = "admin_users";
var ARM_EVENTS_COLLECTION     = "analytics_events";
var ARM_QUESTION_COLLECTION   = "analytics_question_daily";
var ARM_OFFER_COLLECTION      = "analytics_offer_daily";
var ARM_GPA_COLLECTION        = "game_player_analytics";
var ARM_FIRST_SEEN_COLLECTION = "analytics_user_first_seen";
var ARM_SEG_STATE_COLLECTION  = "analytics_segments_state";

// Segment thresholds (must mirror analytics_segments.js).
var ARM_WINBACK_INACTIVE_DAYS    = 7;
var ARM_WINBACK_MIN_QUIZ_PLAYS   = 5;
var ARM_PREIAP_MIN_PAYWALL_SHOWN = 1;

// Per-request scan cap for player_timeline live fallback.
var ARM_TIMELINE_MAX_SCAN = 3000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function armParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function armOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
    return JSON.stringify(out);
}

function armErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function armEnv(ctx, key) {
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
    }
    try {
        if (ctx && ctx.env && ctx.env[key] !== undefined) {
            var v = String(ctx.env[key]);
            if (v.length > 0) return v;
        }
    } catch (e) { /* */ }
    return "";
}

function armIsAdmin(ctx, nk) {
    if (!ctx.userId) return false;
    if (ctx.userId === ARM_SYSTEM_USER) return true;
    if (!ctx.username || ctx.username.indexOf("admin:") !== 0) return false;
    try {
        var recs = nk.storageRead([{ collection: ARM_ADMIN_COLLECTION, key: "profile", userId: ctx.userId }]);
        if (!recs || recs.length === 0) return false;
        var r = recs[0].value || {};
        if (!r.isAdmin) return false;
        if (r.expiresAt && r.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function armRequireAdmin(ctx, nk, data) {
    var secret = armEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (armIsAdmin(ctx, nk)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function armResolveGameId(g) {
    if (!g) return g;
    try { if (typeof resolveGameIdAlias === "function") return resolveGameIdAlias(g); } catch (e) { /* */ }
    return g;
}

function armIsoDate(d) { return d.toISOString().slice(0, 10); }

function armReadOne(nk, collection, key, userId) {
    try {
        var recs = nk.storageRead([{ collection: collection, key: key, userId: userId || ARM_SYSTEM_USER }]);
        return (recs && recs.length > 0) ? (recs[0].value || null) : null;
    } catch (e) { return null; }
}

function armClamp(val, min, max, def) {
    var n = parseInt(val, 10);
    if (isNaN(n)) return def;
    return Math.min(max, Math.max(min, n));
}

// ─── RPC: analytics_question_intelligence ─────────────────────────────────

/**
 * Multi-day question performance read model.
 *
 * Reads analytics_question_daily docs for the requested window, merges
 * per-question stats, and returns ranked views for the "Question Intelligence"
 * dashboard tab — hardest questions, easiest, most played, most skipped,
 * slowest (avg time).
 *
 * Payload:
 *   game_id   : optional; defaults to "all"
 *   days      : 1–30, default 7
 *   limit     : 10–200 per sort category, default 50
 *   sort      : "most_played" | "hardest" | "easiest" | "most_skipped" | "slowest"
 *               default returns all five tables in one response
 */
function rpcAnalyticsQuestionIntelligence(ctx, logger, nk, payload) {
    var data = armParse(payload);
    var gate = armRequireAdmin(ctx, nk, data);
    if (!gate.ok) return armErr(gate.reason, 401);

    var gameId = armResolveGameId(data.game_id || data.gameId || "all");
    var days   = armClamp(data.days,  1, 30,  7);
    var limit  = armClamp(data.limit, 10, 200, 50);
    var sort   = data.sort || null; // null → all views

    // Merge N daily docs.
    var merged = {}; // question_id → aggregated stats
    var docsFound = 0;
    var docsAvailable = 0;

    for (var di = 0; di < days; di++) {
        var d   = new Date();
        d.setUTCDate(d.getUTCDate() - di);
        var key = "question_" + gameId + "_" + armIsoDate(d);
        docsAvailable++;
        var doc = armReadOne(nk, ARM_QUESTION_COLLECTION, key, ARM_SYSTEM_USER);
        if (!doc || !doc.by_question) continue;
        docsFound++;
        for (var qi = 0; qi < doc.by_question.length; qi++) {
            var q = doc.by_question[qi];
            var qid = q.question_id;
            if (!merged[qid]) {
                merged[qid] = {
                    question_id:    qid,
                    displayed:      0, answered: 0, correct: 0, wrong: 0,
                    skipped:        0, timed_out: 0, hints_used: 0,
                    unique_players: 0,
                    time_sum:       0, time_samples: 0
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
            m.unique_players += q.unique_players || 0; // upper-bound across days
            if (q.avg_time_ms && q.answered) {
                m.time_sum     += q.avg_time_ms * q.answered;
                m.time_samples += q.answered;
            }
        }
    }

    // Compute derived KPIs once, produce a flat array.
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
            accuracy_pct:   r.answered > 0 ? Math.round((r.correct  / r.answered) * 100) : null,
            skip_rate_pct:  r.displayed > 0 ? Math.round((r.skipped / r.displayed) * 100) : null,
            avg_time_ms:    r.time_samples > 0 ? Math.round(r.time_sum / r.time_samples) : null
        });
    }

    function sortedView(sortFn) { return rows.slice().sort(sortFn).slice(0, limit); }

    var most_played = sortedView(function (a, b) { return b.displayed - a.displayed; });
    var hardest     = sortedView(function (a, b) {
        var aA = a.accuracy_pct === null ? 101 : a.accuracy_pct;
        var bA = b.accuracy_pct === null ? 101 : b.accuracy_pct;
        return aA - bA; // ascending accuracy = hardest first
    });
    var easiest = sortedView(function (a, b) {
        var aA = a.accuracy_pct === null ? -1 : a.accuracy_pct;
        var bA = b.accuracy_pct === null ? -1 : b.accuracy_pct;
        return bA - aA; // descending accuracy = easiest first
    });
    var most_skipped = sortedView(function (a, b) {
        var aS = a.skip_rate_pct === null ? -1 : a.skip_rate_pct;
        var bS = b.skip_rate_pct === null ? -1 : b.skip_rate_pct;
        return bS - aS;
    });
    var slowest = sortedView(function (a, b) {
        var aT = a.avg_time_ms === null ? -1 : a.avg_time_ms;
        var bT = b.avg_time_ms === null ? -1 : b.avg_time_ms;
        return bT - aT;
    });

    var summary = {
        total_unique_questions: rows.length,
        total_displayed:        rows.reduce(function (s, r) { return s + r.displayed; }, 0),
        total_answered:         rows.reduce(function (s, r) { return s + r.answered;  }, 0),
        total_skipped:          rows.reduce(function (s, r) { return s + r.skipped;   }, 0),
        docs_found:             docsFound,
        docs_available:         docsAvailable,
        game_id:                gameId,
        days:                   days,
        source:                 docsFound > 0 ? "question_daily" : "empty"
    };

    if (docsFound === 0) {
        return armOk({
            summary: summary,
            hint: "No question_daily docs found for this window. Run analytics_rollup_run first.",
            most_played: [], hardest: [], easiest: [], most_skipped: [], slowest: []
        });
    }

    if (sort === "most_played")   return armOk({ summary: summary, questions: most_played });
    if (sort === "hardest")       return armOk({ summary: summary, questions: hardest });
    if (sort === "easiest")       return armOk({ summary: summary, questions: easiest });
    if (sort === "most_skipped")  return armOk({ summary: summary, questions: most_skipped });
    if (sort === "slowest")       return armOk({ summary: summary, questions: slowest });

    // Default: return all five ranked views.
    return armOk({
        summary:      summary,
        most_played:  most_played,
        hardest:      hardest,
        easiest:      easiest,
        most_skipped: most_skipped,
        slowest:      slowest
    });
}

// ─── RPC: analytics_offer_performance ─────────────────────────────────────

/**
 * Multi-day offer funnel read model.
 *
 * Reads analytics_offer_daily docs, merges per-offer funnel counters, and
 * returns per-offer rates plus a summary for the "Offers" dashboard tab.
 *
 * Payload: { game_id?, days?: 1–30 }
 */
function rpcAnalyticsOfferPerformance(ctx, logger, nk, payload) {
    var data = armParse(payload);
    var gate = armRequireAdmin(ctx, nk, data);
    if (!gate.ok) return armErr(gate.reason, 401);

    var gameId = armResolveGameId(data.game_id || data.gameId || "all");
    var days   = armClamp(data.days, 1, 30, 7);

    var merged    = {}; // offer_id → aggregated
    var docsFound = 0;

    for (var di = 0; di < days; di++) {
        var d   = new Date();
        d.setUTCDate(d.getUTCDate() - di);
        var key = "offer_" + gameId + "_" + armIsoDate(d);
        var doc = armReadOne(nk, ARM_OFFER_COLLECTION, key, ARM_SYSTEM_USER);
        if (!doc || !doc.by_offer) continue;
        docsFound++;
        for (var oi = 0; oi < doc.by_offer.length; oi++) {
            var o   = doc.by_offer[oi];
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

    var offers = [];
    var totalRev = 0;
    var totalPurchased = 0;
    for (var mk in merged) {
        if (!Object.prototype.hasOwnProperty.call(merged, mk)) continue;
        var r = merged[mk];
        totalRev       += r.revenue_usd;
        totalPurchased += r.purchased;
        offers.push({
            offer_id:                 r.offer_id,
            eligible:                 r.eligible,
            assigned:                 r.assigned,
            viewed:                   r.viewed,
            clicked:                  r.clicked,
            purchased:                r.purchased,
            dismissed:                r.dismissed,
            cooldown_blocked:         r.cooldown_blocked,
            revenue_usd:              Math.round(r.revenue_usd  * 100) / 100,
            unique_players:           r.unique_players,
            view_rate_pct:            r.eligible > 0 ? Math.round((r.viewed    / r.eligible)  * 100) : null,
            click_rate_pct:           r.viewed   > 0 ? Math.round((r.clicked   / r.viewed)    * 100) : null,
            conversion_rate_pct:      r.clicked  > 0 ? Math.round((r.purchased / r.clicked)   * 100) : null,
            eligible_to_purchase_pct: r.eligible > 0 ? Math.round((r.purchased / r.eligible)  * 100) : null,
            dismiss_rate_pct:         r.viewed   > 0 ? Math.round((r.dismissed / r.viewed)    * 100) : null
        });
    }
    offers.sort(function (a, b) { return b.eligible - a.eligible; });

    return armOk({
        game_id:          gameId,
        days:             days,
        docs_found:       docsFound,
        total_revenue_usd: Math.round(totalRev * 100) / 100,
        total_purchased:  totalPurchased,
        offers:           offers,
        source:           docsFound > 0 ? "offer_daily" : "empty",
        hint:             docsFound === 0
            ? "No offer_daily docs found. Run analytics_rollup_run and ensure offer_* events are emitted."
            : "Aggregated " + docsFound + " day(s) of pre-computed offer performance."
    });
}

// ─── RPC: analytics_satori_audience_debug ─────────────────────────────────

/**
 * Per-player Satori eligibility snapshot.
 *
 * Reads the player's GPA (game_player_analytics) doc, the per-user
 * segment-state doc, and computes current segment membership against the
 * canonical thresholds used by analytics_segments.js.
 *
 * Useful for the live-ops team to debug "why isn't this user in the
 * winback / pre-IAP campaign?"
 *
 * Payload (admin): { user_id: "<uuid>", game_id? }
 * Payload (player calling their own profile): {} — uses ctx.userId
 */
function rpcAnalyticsSatoriAudienceDebug(ctx, logger, nk, payload) {
    var data = armParse(payload);

    // Admin can debug any user; a regular player may only see their own.
    var targetUserId = data.user_id || ctx.userId;
    if (!targetUserId) return armErr("user_id required", 400);

    var isAdmin = armIsAdmin(ctx, nk);
    var secret  = armEnv(ctx, "DASHBOARD_SECRET");
    var bySecret = (secret && data.dashboard_secret === secret);

    if (targetUserId !== ctx.userId && !isAdmin && !bySecret) {
        return armErr("admin authentication required", 401);
    }

    var gameId = armResolveGameId(data.game_id || data.gameId || "default");
    var nowSec = Math.floor(Date.now() / 1000);

    // ── 1. GPA profile ─────────────────────────────────────
    var gpaKey = "gpa_" + gameId + "_" + targetUserId;
    var gpa = armReadOne(nk, ARM_GPA_COLLECTION, gpaKey, ARM_SYSTEM_USER) || {};

    var lastActiveSec  = gpa.last_active_utc  || 0;
    var firstSeenSec   = gpa.first_seen_utc   || 0;
    var ltQuizPlays    = gpa.lt_quiz_plays     || 0;
    var ltSessions     = gpa.lt_sessions       || 0;
    var ltEvents       = gpa.lt_events         || 0;
    var money          = gpa.money             || {};
    var iapCount       = money.iap_count       || 0;
    var paywallShown   = money.paywall_shown_count || 0;

    var daysSinceActive  = lastActiveSec  > 0 ? Math.floor((nowSec - lastActiveSec)  / 86400) : null;
    var daysSinceInstall = firstSeenSec   > 0 ? Math.floor((nowSec - firstSeenSec)   / 86400) : null;

    // ── 2. Segment-state (last sent timestamps) ────────────
    var segState = armReadOne(nk, ARM_SEG_STATE_COLLECTION, targetUserId, ARM_SYSTEM_USER) || {};
    var winbackLastSentSec = segState.winback_last_sent_utc || 0;
    var preiapLastSentSec  = segState.preiap_last_sent_utc  || 0;
    var winbackCooldownSec = 7 * 86400;
    var preiapCooldownSec  = 3 * 86400;

    // ── 3. First-seen doc ───────────────────────────────────
    var fsKey = "first_" + targetUserId + "_" + gameId;
    var fsDoc = armReadOne(nk, ARM_FIRST_SEEN_COLLECTION, fsKey, ARM_SYSTEM_USER) || {};

    // ── 4. Compute segment eligibility ─────────────────────
    var winbackEligible    = (daysSinceActive !== null && daysSinceActive >= ARM_WINBACK_INACTIVE_DAYS)
                           && (ltQuizPlays >= ARM_WINBACK_MIN_QUIZ_PLAYS);
    var winbackOnCooldown  = (nowSec - winbackLastSentSec) < winbackCooldownSec;
    var winbackWillFire    = winbackEligible && !winbackOnCooldown;

    var preiapEligible     = (paywallShown >= ARM_PREIAP_MIN_PAYWALL_SHOWN) && (iapCount === 0);
    var preiapOnCooldown   = (nowSec - preiapLastSentSec) < preiapCooldownSec;
    var preiapWillFire     = preiapEligible && !preiapOnCooldown;

    // ── 5. Assemble response ────────────────────────────────
    return armOk({
        user_id:  targetUserId,
        game_id:  gameId,
        computed_at: new Date().toISOString(),
        profile: {
            first_seen_utc:      firstSeenSec  > 0 ? firstSeenSec  : null,
            last_active_utc:     lastActiveSec > 0 ? lastActiveSec : null,
            days_since_install:  daysSinceInstall,
            days_since_active:   daysSinceActive,
            lt_quiz_plays:       ltQuizPlays,
            lt_sessions:         ltSessions,
            lt_events:           ltEvents,
            iap_count:           iapCount,
            paywall_shown_count: paywallShown,
            country:             gpa.country  || null,
            platform:            gpa.platform || null,
            first_seen_date:     fsDoc.firstSeenDate || null
        },
        segments: {
            winback: {
                eligible:        winbackEligible,
                on_cooldown:     winbackOnCooldown,
                will_fire_next_run: winbackWillFire,
                last_sent_utc:   winbackLastSentSec > 0 ? winbackLastSentSec : null,
                reason:          !winbackEligible
                    ? ("Not eligible: days_since_active=" + daysSinceActive +
                       " (need >=" + ARM_WINBACK_INACTIVE_DAYS + "), lt_quiz_plays=" +
                       ltQuizPlays + " (need >=" + ARM_WINBACK_MIN_QUIZ_PLAYS + ")")
                    : (winbackOnCooldown
                        ? "Eligible but on cooldown (7-day window)"
                        : "Eligible and will fire on next satori_segments_run")
            },
            pre_iap: {
                eligible:        preiapEligible,
                on_cooldown:     preiapOnCooldown,
                will_fire_next_run: preiapWillFire,
                last_sent_utc:   preiapLastSentSec > 0 ? preiapLastSentSec : null,
                reason:          !preiapEligible
                    ? ("Not eligible: paywall_shown=" + paywallShown +
                       " (need >=" + ARM_PREIAP_MIN_PAYWALL_SHOWN + "), iap_count=" +
                       iapCount + " (need 0)")
                    : (preiapOnCooldown
                        ? "Eligible but on cooldown (3-day window)"
                        : "Eligible and will fire on next satori_segments_run")
            }
        },
        thresholds: {
            winback_inactive_days:    ARM_WINBACK_INACTIVE_DAYS,
            winback_min_quiz_plays:   ARM_WINBACK_MIN_QUIZ_PLAYS,
            preiap_min_paywall_shown: ARM_PREIAP_MIN_PAYWALL_SHOWN,
            winback_cooldown_days:    7,
            preiap_cooldown_days:     3
        }
    });
}

// ─── RPC: analytics_player_timeline ───────────────────────────────────────

/**
 * Paginated per-player event browser.
 *
 * Scans analytics_events filtered by userId (and optionally by game_id,
 * event_name, and date range) and returns events in reverse-chronological
 * order with a cursor for the next page.
 *
 * Admin-gated: an operator can look up any user; a regular session token
 * can only retrieve their own timeline.
 *
 * Payload:
 *   user_id     : required (or self when non-admin)
 *   game_id     : optional filter
 *   event_name  : optional filter (exact match on canonical event name)
 *   from        : optional YYYY-MM-DD lower bound (event_time)
 *   to          : optional YYYY-MM-DD upper bound (event_time)
 *   limit       : 10–200, default 50
 *   cursor      : opaque pagination cursor returned by previous call
 */
function rpcAnalyticsPlayerTimeline(ctx, logger, nk, payload) {
    var data = armParse(payload);

    var targetUserId = data.user_id || ctx.userId;
    if (!targetUserId) return armErr("user_id required", 400);

    var isAdmin  = armIsAdmin(ctx, nk);
    var secret   = armEnv(ctx, "DASHBOARD_SECRET");
    var bySecret = (secret && data.dashboard_secret === secret);

    if (targetUserId !== ctx.userId && !isAdmin && !bySecret) {
        return armErr("admin authentication required", 401);
    }

    var gameId    = armResolveGameId(data.game_id || data.gameId || null);
    var filterEvt = data.event_name || null;
    var fromDate  = data.from || null; // YYYY-MM-DD
    var toDate    = data.to   || null; // YYYY-MM-DD
    var limit     = armClamp(data.limit, 10, 200, 50);
    var cursor    = data.cursor || null;

    // Scan analytics_events with a userId index hint where the storage key
    // includes the userId (analytics.js writes events with key pattern
    // "evt_<userId>_<epoch_ms>_<rand>" so a prefix scan on the user is fast).
    // Fall back to full collection scan if the prefix method isn't available.

    var events    = [];
    var scanned   = 0;
    var nextCursor = null;

    try {
        var listResult = nk.storageList(
            ARM_SYSTEM_USER,
            ARM_EVENTS_COLLECTION,
            ARM_TIMELINE_MAX_SCAN,
            cursor || ""
        );

        var items = (listResult && listResult.objects) ? listResult.objects : [];
        nextCursor = (listResult && listResult.cursor) ? listResult.cursor : null;
        scanned = items.length;

        var fromEpochSec = fromDate ? Math.floor(new Date(fromDate + "T00:00:00.000Z").getTime() / 1000) : 0;
        var toEpochSec   = toDate   ? Math.floor(new Date(toDate   + "T23:59:59.999Z").getTime() / 1000) : 0;

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var v    = item.value || {};

            // userId filter (primary filter — almost always given).
            if (v.userId !== targetUserId) continue;

            // gameId filter.
            if (gameId && v.gameId && v.gameId !== gameId) continue;

            // event_name filter.
            var en = v.eventName || "";
            if (filterEvt && en !== filterEvt) continue;

            // Date-range filter.
            var evtSec = 0;
            if (v.timestamp) {
                var ts = parseInt(v.timestamp, 10);
                evtSec = (ts > 1e12) ? Math.floor(ts / 1000) : ts;
            }
            if (fromEpochSec > 0 && evtSec > 0 && evtSec < fromEpochSec) continue;
            if (toEpochSec   > 0 && evtSec > 0 && evtSec > toEpochSec)   continue;

            events.push({
                event_name:      en,
                game_id:         v.gameId      || null,
                timestamp:       v.timestamp   || null,
                schema_version:  v.schemaVersion || 1,
                client_event_id: (v.eventData && v.eventData.client_event_id) || null,
                event_data:      v.eventData   || {}
            });
        }
    } catch (e) {
        logger.warn("[analytics_read_models] player_timeline scan error: " + e.message);
        return armErr("scan error: " + e.message, 500);
    }

    // Sort reverse-chronological.
    events.sort(function (a, b) {
        var ta = parseInt(a.timestamp, 10) || 0;
        var tb = parseInt(b.timestamp, 10) || 0;
        return tb - ta;
    });

    var page    = events.slice(0, limit);
    var hasMore = events.length > limit || nextCursor !== null;

    return armOk({
        user_id:     targetUserId,
        game_id:     gameId || "all",
        event_count: page.length,
        total_scanned: scanned,
        events:      page,
        next_cursor: hasMore ? nextCursor : null,
        has_more:    hasMore,
        filters: {
            event_name: filterEvt,
            from:       fromDate,
            to:         toDate
        }
    });
}

// ─── Registration ─────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_question_intelligence",  rpcAnalyticsQuestionIntelligence);
    initializer.registerRpc("analytics_offer_performance",      rpcAnalyticsOfferPerformance);
    initializer.registerRpc("analytics_satori_audience_debug",  rpcAnalyticsSatoriAudienceDebug);
    initializer.registerRpc("analytics_player_timeline",        rpcAnalyticsPlayerTimeline);
    logger.info("[analytics_read_models] Registered: analytics_question_intelligence, " +
                "analytics_offer_performance, analytics_satori_audience_debug, " +
                "analytics_player_timeline");
}
