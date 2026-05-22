/**
 * Analytics Modes Module — per-quiz-mode breakdown for the dashboard.
 *
 * Unity's `Trivia.Analytics.AnalyticsManager.BeginQuizSession()` auto-tags
 * every event during a quiz with `quiz_mode` / `play_category` /
 * `quiz_session_id`, so this module can compute rich per-mode KPIs by
 * scanning `analytics_events` and grouping by `quiz_mode`.
 *
 * RPCs registered:
 *   analytics_modes_breakdown   — per-mode KPI matrix (plays / completion / abandonment / avg duration / avg score)
 *   analytics_modes_compare     — head-to-head two-mode comparison
 *   analytics_modes_transitions — mode→mode transition matrix (which mode users play after which)
 *   analytics_modes_retention   — D1/D7/D30 retention sliced by first-played mode
 *
 * Uses the same scan helpers (`extScanEvents`, `extResolveGameId`, `extDaysAgo`)
 * exposed at global scope by analytics_extended.js. Falls back gracefully if the
 * module wasn't bundled yet.
 */

var AM_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AM_DASH_COLLECTION = "analytics_events";

var AM_QUIZ_STARTED_NAMES = {
    // Fix SR-11: include canonical "quiz_start" (alias of "quiz_started").
    'quiz_start': 1, 'quiz_started': 1, 'quizstarted': 1,
    'quiz_session_started': 1, 'quiz_session_start': 1
};
var AM_QUIZ_COMPLETED_NAMES = {
    'quiz_completed': 1, 'quizcompleted': 1, 'quiz_complete': 1,
    'quiz_session_completed': 1, 'quiz_session_complete': 1, 'quiz_session_ended': 1
};
var AM_QUIZ_ABANDONED_NAMES = {
    'quiz_abandoned': 1, 'quizabandoned': 1, 'quiz_session_abandoned': 1
};

// ─── Helpers (locally scoped fallbacks) ───────────────────

function amSafeJson(payload) {
    try { return JSON.parse(payload || '{}'); } catch (e) { return {}; }
}

function amResolveGameId(g) {
    if (!g) return g;
    try {
        if (typeof extResolveGameId === 'function') return extResolveGameId(g);
        if (typeof resolveGameIdAlias === 'function') return resolveGameIdAlias(g);
    } catch (e) { /* fall through */ }
    return g;
}

function amDaysAgo(days) {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

function amIsoDate(value) {
    if (!value) return null;
    try {
        var n = (typeof value === 'number') ? value : parseInt(value, 10);
        var ts = (n && n < 1e12) ? n * 1000 : n;
        var d = new Date(ts || value);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    } catch (e) { return null; }
}

function amScanEvents(nk, logger, days, filterFn, gameId) {
    if (typeof extScanEvents === 'function') {
        return extScanEvents(nk, logger, AM_DASH_COLLECTION, days, filterFn, gameId);
    }
    // Fallback inline scan (mirrors extScanEvents minimally)
    var out = [];
    try {
        var cursor = null, iter = 0;
        var cutoff = amDaysAgo(days);
        do {
            var r = nk.storageList(AM_SYSTEM_USER, AM_DASH_COLLECTION, 100, cursor);
            if (!r || !r.objects) break;
            for (var i = 0; i < r.objects.length; i++) {
                var v = r.objects[i].value || {};
                var d = amIsoDate(v.timestamp || v.unixTimestamp);
                if (d && d < cutoff) continue;
                if (gameId && v.gameId && amResolveGameId(v.gameId) !== amResolveGameId(gameId)) continue;
                if (filterFn && !filterFn(v)) continue;
                out.push(v);
            }
            cursor = r.cursor;
            iter++;
        } while (cursor && iter < 20);
    } catch (e) {
        if (logger) logger.warn('[analytics_modes] scan fallback error: ' + e.message);
    }
    return out;
}

/**
 * Pull `quiz_mode` / `play_category` from an event's eventData OR top-level.
 * Falls back to a sentinel "unspecified" so events without mode tags still
 * count somewhere instead of being silently dropped.
 */
function amExtractMode(ev) {
    var d = ev.eventData || ev.properties || {};
    var mode = d.quiz_mode || d.quizMode || d.game_mode || d.gameMode ||
               ev.quiz_mode || ev.quizMode || null;
    if (!mode) return 'unspecified';
    return String(mode).slice(0, 64);
}

function amExtractCategory(ev) {
    var d = ev.eventData || ev.properties || {};
    var c = d.play_category || d.playCategory || d.category || null;
    return c ? String(c).slice(0, 32) : null;
}

function amExtractSessionId(ev) {
    var d = ev.eventData || ev.properties || {};
    return d.quiz_session_id || d.quizSessionId || null;
}

function amExtractDuration(ev) {
    var d = ev.eventData || ev.properties || {};
    var v = d.duration_seconds || d.durationSeconds || d.duration || 0;
    var n = parseFloat(v);
    return (isFinite(n) && n > 0 && n < 7200) ? n : 0;  // cap at 2h to drop garbage
}

function amExtractScore(ev) {
    var d = ev.eventData || ev.properties || {};
    var v = d.score || d.final_score || d.finalScore || 0;
    var n = parseFloat(v);
    return (isFinite(n) && n >= 0 && n < 1e9) ? n : 0;
}

function amExtractCorrect(ev) {
    var d = ev.eventData || ev.properties || {};
    var n = parseInt(d.correct_count || d.correctCount || d.correctAnswers || 0, 10);
    return (n >= 0 && n < 10000) ? n : 0;
}

function amExtractTotalQ(ev) {
    var d = ev.eventData || ev.properties || {};
    var n = parseInt(d.total_questions || d.totalQuestions || d.question_count || d.questionCount || 0, 10);
    return (n > 0 && n < 10000) ? n : 0;
}

function amExtractUser(ev) {
    return ev.userId || ev.user_id || (ev.eventData && (ev.eventData.user_id || ev.eventData.userId)) || null;
}

function amExtractOutcome(ev) {
    var d = ev.eventData || ev.properties || {};
    var o = d.quiz_outcome || d.outcome || null;
    return o ? String(o).toLowerCase() : null;
}

function amClampPct(v) {
    v = Math.round(v);
    if (!isFinite(v) || v < 0) return 0;
    return v > 100 ? 100 : v;
}

function amMedian(arr) {
    if (!arr || !arr.length) return 0;
    var s = arr.slice().sort(function(a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ─── RPC: analytics_modes_breakdown ───────────────────────

/**
 * Per-mode KPI matrix.
 *
 * REQUEST:
 *   { "days": 30, "game_id": "quizverse" }
 *
 * RESPONSE:
 *   {
 *     "game_id": "...",
 *     "days": 30,
 *     "modes": [
 *       {
 *         "mode": "SoloChallenge",
 *         "play_category": "Solo",
 *         "starts": 120,
 *         "completions": 95,
 *         "abandonments": 25,
 *         "completion_rate_pct": 79,
 *         "abandonment_rate_pct": 20,
 *         "unique_players": 67,
 *         "avg_duration_seconds": 142,
 *         "median_duration_seconds": 130,
 *         "avg_score": 850,
 *         "avg_accuracy_pct": 72,
 *         "avg_questions_per_session": 10.0,
 *         "shares_pct": { "starts": 35, "completions": 38 }
 *       },
 *       ...
 *     ],
 *     "totals": { "starts": 340, "completions": 250, "unique_players": 142 }
 *   }
 */
function rpcAnalyticsModesBreakdown(ctx, logger, nk, payload) {
    try {
        var data = amSafeJson(payload);
        var days = parseInt(data.days, 10) || 30;
        if (days < 1) days = 1; if (days > 90) days = 90;
        var gameId = amResolveGameId(data.game_id || data.gameId || null) || "all";

        var SYSUSER = "00000000-0000-0000-0000-000000000000";
        var todayStr = new Date().toISOString().slice(0, 10);

        // ── Phase-4: rollup-first for historical days ─────────────────────────
        // Read pre-computed analytics_modes_daily docs for every day OLDER than
        // today. These are written by analytics_rollup_run (nightly) and cover
        // up to 100k events/day — far more than the live extScanEvents (2000).
        // Today is excluded from the rollup path (rollup hasn't run yet for today)
        // and handled below via a live scan.
        var byMode = {};
        var rollupDays = 0;
        var now = new Date();

        function getModeAcc(key) {
            if (!byMode[key]) {
                byMode[key] = {
                    mode: key,
                    starts: 0, completions: 0, abandonments: 0,
                    total_duration_secs: 0, ended_count: 0,
                    total_correct: 0, total_questions: 0,
                    unique_users_approx: 0, revenue_usd: 0, ad_impressions: 0
                };
            }
            return byMode[key];
        }

        for (var d = 1; d < days; d++) {
            var dt = new Date(now.getTime() - d * 86400000);
            var ds = dt.toISOString().slice(0, 10);
            var rollupKey = "modes_" + gameId + "_" + ds;
            var rollupDoc = null;
            try {
                var rr = nk.storageRead([{
                    collection: "analytics_modes_daily",
                    key: rollupKey,
                    userId: SYSUSER
                }]);
                if (rr && rr.length > 0) rollupDoc = rr[0].value;
            } catch (_) { /* no doc */ }
            if (!rollupDoc || !rollupDoc.modes) continue;
            rollupDays++;
            for (var ri = 0; ri < rollupDoc.modes.length; ri++) {
                var rm = rollupDoc.modes[ri];
                if (!rm || !rm.mode) continue;
                var ra = getModeAcc(rm.mode);
                ra.starts       += rm.sessions_started  || 0;
                ra.completions  += rm.sessions_completed || 0;
                ra.abandonments += rm.sessions_abandoned || 0;
                ra.total_questions  += rm.total_questions || 0;
                ra.total_correct    += rm.total_correct   || 0;
                ra.revenue_usd      += rm.revenue_usd     || 0;
                ra.ad_impressions   += rm.ad_impressions  || 0;
                ra.unique_users_approx += rm.unique_users || 0;
                // avg_session_seconds × ended_count → total_duration_secs
                var ec = (rm.sessions_completed || 0) + (rm.sessions_abandoned || 0);
                ra.ended_count      += ec;
                ra.total_duration_secs += (rm.avg_session_seconds || 0) * ec;
            }
        }

        // ── Live scan for TODAY only ──────────────────────────────────────────
        // Cap live scan to today's events only (filter by date string in key prefix
        // "dash_{gameId}_{todayStr}") so it's O(today's traffic), not O(30 days).
        var liveEvents = amScanEvents(nk, logger, 1, function(ev) {
            var n = (ev.eventName || '').toLowerCase();
            return AM_QUIZ_STARTED_NAMES[n] || AM_QUIZ_COMPLETED_NAMES[n] || AM_QUIZ_ABANDONED_NAMES[n];
        }, gameId);

        var totalStarts = 0, totalCompletions = 0;
        var allUniqueUsersToday = {};
        for (var li = 0; li < liveEvents.length; li++) {
            var ev = liveEvents[li];
            var n2 = (ev.eventName || '').toLowerCase();
            var mode2 = amExtractMode(ev);
            var u = amExtractUser(ev);
            var la = getModeAcc(mode2);

            if (AM_QUIZ_STARTED_NAMES[n2]) {
                la.starts++; totalStarts++;
                if (u) { la.unique_users_approx++; allUniqueUsersToday[u] = 1; }
            } else if (AM_QUIZ_COMPLETED_NAMES[n2]) {
                var outcome2 = amExtractOutcome(ev);
                if (outcome2 === 'abandoned' || outcome2 === 'interrupted' || outcome2 === 'disconnected') {
                    la.abandonments++;
                    la.ended_count++;
                    var aDur2 = amExtractDuration(ev);
                    if (aDur2 > 0) la.total_duration_secs += aDur2;
                } else {
                    la.completions++; totalCompletions++;
                    if (u) { la.unique_users_approx++; allUniqueUsersToday[u] = 1; }
                    la.ended_count++;
                    var dur2 = amExtractDuration(ev);
                    if (dur2 > 0) la.total_duration_secs += dur2;
                    var sc2 = amExtractScore(ev);
                    var c2 = amExtractCorrect(ev), tq2 = amExtractTotalQ(ev);
                    if (tq2 > 0 && c2 >= 0) { la.total_correct += c2; la.total_questions += tq2; }
                }
            } else if (AM_QUIZ_ABANDONED_NAMES[n2]) {
                la.abandonments++;
                la.ended_count++;
                var aDur3 = amExtractDuration(ev);
                if (aDur3 > 0) la.total_duration_secs += aDur3;
            }
        }

        // ── Build output rows ─────────────────────────────────────────────────
        var rows = [];
        var sumStarts = 0, sumCompletions = 0;
        for (var k in byMode) {
            if (!Object.prototype.hasOwnProperty.call(byMode, k)) continue;
            var b = byMode[k];
            sumStarts       += b.starts;
            sumCompletions  += b.completions;
        }
        for (var k2 in byMode) {
            if (!Object.prototype.hasOwnProperty.call(byMode, k2)) continue;
            var bv = byMode[k2];
            var totalSess = bv.starts || 1;
            var avgDur = bv.ended_count > 0 ? Math.round(bv.total_duration_secs / bv.ended_count) : 0;
            var accPct = bv.total_questions > 0
                ? Math.round((bv.total_correct / bv.total_questions) * 1000) / 10
                : 0;
            rows.push({
                mode: bv.mode,
                starts: bv.starts,
                completions: bv.completions,
                abandonments: bv.abandonments,
                sessions_started: bv.starts,
                sessions_completed: bv.completions,
                sessions_abandoned: bv.abandonments,
                completion_rate_pct: amClampPct((bv.completions / totalSess) * 100),
                abandonment_rate_pct: amClampPct((bv.abandonments / totalSess) * 100),
                unique_players: bv.unique_users_approx,
                avg_duration_seconds: avgDur,
                avg_session_seconds: avgDur,
                avg_accuracy_pct: accPct,
                accuracy_pct: accPct,
                total_questions: bv.total_questions,
                revenue_usd: Math.round(bv.revenue_usd * 100) / 100,
                ad_impressions: bv.ad_impressions,
                shares_pct: {
                    starts: sumStarts ? Math.round((bv.starts / sumStarts) * 100) : 0,
                    completions: sumCompletions ? Math.round((bv.completions / sumCompletions) * 100) : 0
                }
            });
        }
        rows.sort(function(a, b) { return b.starts - a.starts; });

        return JSON.stringify({
            game_id: gameId,
            days: days,
            modes: rows,
            totals: {
                starts: sumStarts,
                completions: sumCompletions,
                unique_players: Object.keys(allUniqueUsersToday).length,
                modes_seen: rows.length
            },
            _meta: {
                rollup_days: rollupDays,
                live_today: liveEvents.length > 0,
                source: rollupDays > 0 ? "rollup+" + rollupDays + "d+live_today" : "live_scan_only"
            }
        });
    } catch (e) {
        logger.error('[analytics_modes_breakdown] error: ' + e.message);
        return JSON.stringify({ error: e.message, modes: [], totals: {} });
    }
}

// ─── RPC: analytics_modes_compare ─────────────────────────

/**
 * Head-to-head: pick exactly two modes and return their KPIs side-by-side
 * with delta + winner-on-each-axis. Useful for an "X vs Y" investor chart.
 *
 * REQUEST:  { "days": 30, "modes": ["SoloChallenge", "LiveArena"], "game_id": "..." }
 * RESPONSE: { "left": {...}, "right": {...}, "deltas": {...}, "winner_per_axis": {...} }
 */
function rpcAnalyticsModesCompare(ctx, logger, nk, payload) {
    try {
        var data = amSafeJson(payload);
        var modes = data.modes;
        if (!modes || !modes.length || modes.length !== 2) {
            return JSON.stringify({ error: "must pass exactly 2 modes in 'modes' array" });
        }

        // Reuse the breakdown RPC then pluck the two rows.
        var bdJson = rpcAnalyticsModesBreakdown(ctx, logger, nk, payload);
        var bd = JSON.parse(bdJson || '{}');
        var rows = bd.modes || [];
        function findRow(m) {
            for (var i = 0; i < rows.length; i++) if (rows[i].mode === m) return rows[i];
            return { mode: m, starts: 0, completions: 0, completion_rate_pct: 0, avg_duration_seconds: 0, avg_score: 0, avg_accuracy_pct: 0, unique_players: 0 };
        }
        var L = findRow(modes[0]);
        var R = findRow(modes[1]);

        var axes = ['starts', 'completions', 'unique_players', 'completion_rate_pct',
                    'avg_duration_seconds', 'avg_score', 'avg_accuracy_pct'];
        var deltas = {}, winners = {};
        for (var i = 0; i < axes.length; i++) {
            var a = axes[i];
            var lv = L[a] || 0, rv = R[a] || 0;
            deltas[a] = rv - lv;
            winners[a] = lv === rv ? 'tie' : (lv > rv ? L.mode : R.mode);
        }

        return JSON.stringify({
            game_id: bd.game_id,
            days: bd.days,
            left: L,
            right: R,
            deltas: deltas,
            winner_per_axis: winners
        });
    } catch (e) {
        logger.error('[analytics_modes_compare] error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_modes_transitions ─────────────────────

/**
 * Build a mode-to-mode flow: for each user, collect the chronological sequence of
 * `quiz_session_started` events and count {prev → next} transitions. Lets the
 * dashboard render a Sankey ("after Solo, players go to LiveArena 32% of the time").
 *
 * REQUEST:  { "days": 30, "game_id": "..." }
 * RESPONSE: { "transitions": [ { "from": "Solo", "to": "Live", "count": 17, "pct_from": 32 } ], "first_play": [ { "mode": "Solo", "count": 89 } ] }
 */
function rpcAnalyticsModesTransitions(ctx, logger, nk, payload) {
    try {
        var data = amSafeJson(payload);
        var days = parseInt(data.days, 10) || 30;
        if (days < 1) days = 1; if (days > 90) days = 90;
        var gameId = amResolveGameId(data.game_id || data.gameId || null);

        var events = amScanEvents(nk, logger, days, function(ev) {
            return AM_QUIZ_STARTED_NAMES[(ev.eventName || '').toLowerCase()];
        }, gameId);

        // user → [{ts, mode}]
        var seqByUser = {};
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var u = amExtractUser(ev);
            if (!u) continue;
            var ts = parseInt(ev.timestamp || ev.unixTimestamp || 0, 10) || 0;
            var mode = amExtractMode(ev);
            (seqByUser[u] = seqByUser[u] || []).push({ ts: ts, mode: mode });
        }

        var fromCounts = {}; // mode → total transitions away
        var transitions = {}; // "A→B" → count
        var firstPlay = {}; // mode → count of users whose first session was this mode

        for (var uid in seqByUser) {
            if (!Object.prototype.hasOwnProperty.call(seqByUser, uid)) continue;
            var seq = seqByUser[uid];
            seq.sort(function(a, b) { return a.ts - b.ts; });
            if (seq.length > 0) firstPlay[seq[0].mode] = (firstPlay[seq[0].mode] || 0) + 1;
            for (var s = 1; s < seq.length; s++) {
                var from = seq[s - 1].mode;
                var to = seq[s].mode;
                if (from === to) continue; // skip self-loops to keep the chart clean
                fromCounts[from] = (fromCounts[from] || 0) + 1;
                var key = from + '\u2192' + to;
                transitions[key] = (transitions[key] || 0) + 1;
            }
        }

        var rows = [];
        for (var k in transitions) {
            if (!Object.prototype.hasOwnProperty.call(transitions, k)) continue;
            var parts = k.split('\u2192');
            var f = parts[0], t = parts[1];
            var c = transitions[k];
            var pct = fromCounts[f] ? Math.round((c / fromCounts[f]) * 100) : 0;
            rows.push({ from: f, to: t, count: c, pct_from: pct });
        }
        rows.sort(function(a, b) { return b.count - a.count; });

        var firstPlayRows = [];
        for (var fk in firstPlay) {
            if (Object.prototype.hasOwnProperty.call(firstPlay, fk))
                firstPlayRows.push({ mode: fk, count: firstPlay[fk] });
        }
        firstPlayRows.sort(function(a, b) { return b.count - a.count; });

        return JSON.stringify({
            game_id: gameId || 'all',
            days: days,
            transitions: rows.slice(0, 50),
            first_play: firstPlayRows
        });
    } catch (e) {
        logger.error('[analytics_modes_transitions] error: ' + e.message);
        return JSON.stringify({ error: e.message, transitions: [], first_play: [] });
    }
}

// ─── RPC: analytics_modes_retention ───────────────────────

/**
 * D1/D7/D30 retention bucketed by the user's FIRST-PLAYED mode. Answers
 * "do players who try Solo first stick longer than players who try Live first?"
 *
 * REQUEST:  { "days": 60, "game_id": "..." }   // window must be ≥ 30 to compute D30
 * RESPONSE: { "by_mode": [ { "first_mode": "Solo", "cohort": 50, "d1_pct": 60, "d7_pct": 28, "d30_pct": 14 } ] }
 */
function rpcAnalyticsModesRetention(ctx, logger, nk, payload) {
    try {
        var data = amSafeJson(payload);
        var days = parseInt(data.days, 10) || 60;
        if (days < 30) days = 30; if (days > 90) days = 90;
        var gameId = amResolveGameId(data.game_id || data.gameId || null);

        var events = amScanEvents(nk, logger, days, function(ev) {
            return AM_QUIZ_STARTED_NAMES[(ev.eventName || '').toLowerCase()];
        }, gameId);

        // user → { firstMode, firstTs, plays:{day→1} }
        var byUser = {};
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var u = amExtractUser(ev);
            if (!u) continue;
            var ts = parseInt(ev.timestamp || ev.unixTimestamp || 0, 10) || 0;
            if (!ts) continue;
            var rec = byUser[u] || (byUser[u] = { firstTs: ts, firstMode: amExtractMode(ev), plays: {} });
            if (ts < rec.firstTs) {
                rec.firstTs = ts;
                rec.firstMode = amExtractMode(ev);
            }
            var day = Math.floor(ts / 86400);
            rec.plays[day] = 1;
        }

        // Bucket by first-played mode → cohort + D1/D7/D30 returned
        var modes = {};
        for (var uid in byUser) {
            if (!Object.prototype.hasOwnProperty.call(byUser, uid)) continue;
            var r = byUser[uid];
            var b = modes[r.firstMode] || (modes[r.firstMode] = { cohort: 0, d1: 0, d7: 0, d30: 0 });
            b.cohort++;
            var firstDay = Math.floor(r.firstTs / 86400);
            // D1: any play in firstDay+1..firstDay+2 (inclusive 24-48h)
            for (var d1 = firstDay + 1; d1 <= firstDay + 2; d1++) if (r.plays[d1]) { b.d1++; break; }
            for (var d7 = firstDay + 7; d7 <= firstDay + 8; d7++) if (r.plays[d7]) { b.d7++; break; }
            for (var d30 = firstDay + 30; d30 <= firstDay + 31; d30++) if (r.plays[d30]) { b.d30++; break; }
        }

        var rows = [];
        for (var k in modes) {
            if (!Object.prototype.hasOwnProperty.call(modes, k)) continue;
            var m = modes[k];
            var c = m.cohort || 1;
            rows.push({
                first_mode: k,
                cohort: m.cohort,
                d1_pct: amClampPct((m.d1 / c) * 100),
                d7_pct: amClampPct((m.d7 / c) * 100),
                d30_pct: amClampPct((m.d30 / c) * 100)
            });
        }
        rows.sort(function(a, b) { return b.cohort - a.cohort; });

        return JSON.stringify({
            game_id: gameId || 'all',
            days: days,
            by_mode: rows
        });
    } catch (e) {
        logger.error('[analytics_modes_retention] error: ' + e.message);
        return JSON.stringify({ error: e.message, by_mode: [] });
    }
}

// ─── Module init ──────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_modes_breakdown", rpcAnalyticsModesBreakdown);
    initializer.registerRpc("analytics_modes_compare", rpcAnalyticsModesCompare);
    initializer.registerRpc("analytics_modes_transitions", rpcAnalyticsModesTransitions);
    initializer.registerRpc("analytics_modes_retention", rpcAnalyticsModesRetention);
    logger.info("[analytics_modes] Module registered: 4 RPCs");
}
