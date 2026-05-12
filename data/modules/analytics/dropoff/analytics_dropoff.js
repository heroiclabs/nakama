/**
 * Analytics Dropoff Module — drop-off funnel, churn signals, per-question
 * abandonment, and screen-exit heatmap for the dashboard.
 *
 * RPCs registered:
 *   analytics_dropoff_funnel        — onboarding step funnel + quiz session outcomes
 *   analytics_churn_signals         — cold-start / one-and-done / streak-break / pre-IAP cohorts
 *   analytics_per_question_dropoff  — which question index/topic kills the most quizzes
 *   analytics_screen_exit_heatmap   — per-screen exit rate + avg time-on-screen
 *
 * Uses the same scan helpers (`extScanEvents`, `extResolveGameId`) exposed
 * globally by analytics_extended.js. Self-contained fallbacks below.
 */

var AD_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AD_DASH_COLLECTION = "analytics_events";

var AD_QUIZ_STARTED_NAMES = {
    'quiz_started': 1, 'quiz_session_started': 1, 'quiz_session_start': 1
};
var AD_QUIZ_COMPLETED_NAMES = {
    'quiz_completed': 1, 'quiz_complete': 1,
    'quiz_session_completed': 1, 'quiz_session_complete': 1, 'quiz_session_ended': 1
};
var AD_QUIZ_ABANDONED_NAMES = {
    'quiz_abandoned': 1, 'quiz_session_abandoned': 1
};

var AD_ONBOARDING_NAMES = {
    'onboarding_started': 'started',
    'onboarding_step': 'step',
    'onboarding_panel_viewed': 'step',
    'onboarding_panel_skipped': 'skipped',
    'onboarding_video_watched': 'video',
    'onboarding_complete': 'complete',
    'onboarding_completed': 'complete',
    'onboarding_paused': 'paused',
    'onboarding_quit': 'quit',
    'onboarding_abandoned': 'abandoned',
    'onboarding_resumed': 'resumed'
};

var AD_QUESTION_NAMES = {
    'question_displayed': 'displayed',
    'question_presented': 'displayed',
    'question_answered': 'answered',
    'answer_submitted': 'answered',
    'question_answered_correct': 'correct',
    'question_answered_wrong': 'wrong',
    'question_skipped': 'skipped',
    'question_time_expired': 'timeout'
};

// ─── Helpers ──────────────────────────────────────────────

function adSafeJson(payload) {
    try { return JSON.parse(payload || '{}'); } catch (e) { return {}; }
}

function adResolveGameId(g) {
    if (!g) return g;
    try {
        if (typeof extResolveGameId === 'function') return extResolveGameId(g);
        if (typeof resolveGameIdAlias === 'function') return resolveGameIdAlias(g);
    } catch (e) { /* fall through */ }
    return g;
}

function adDaysAgo(days) {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

function adIsoDate(value) {
    if (!value) return null;
    try {
        var n = (typeof value === 'number') ? value : parseInt(value, 10);
        var ts = (n && n < 1e12) ? n * 1000 : n;
        var d = new Date(ts || value);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    } catch (e) { return null; }
}

function adScanEvents(nk, logger, days, filterFn, gameId) {
    if (typeof extScanEvents === 'function') {
        return extScanEvents(nk, logger, AD_DASH_COLLECTION, days, filterFn, gameId);
    }
    var out = [];
    try {
        var cursor = null, iter = 0;
        var cutoff = adDaysAgo(days);
        do {
            var r = nk.storageList(AD_SYSTEM_USER, AD_DASH_COLLECTION, 100, cursor);
            if (!r || !r.objects) break;
            for (var i = 0; i < r.objects.length; i++) {
                var v = r.objects[i].value || {};
                var d = adIsoDate(v.timestamp || v.unixTimestamp);
                if (d && d < cutoff) continue;
                if (gameId && v.gameId && adResolveGameId(v.gameId) !== adResolveGameId(gameId)) continue;
                if (filterFn && !filterFn(v)) continue;
                out.push(v);
            }
            cursor = r.cursor;
            iter++;
        } while (cursor && iter < 20);
    } catch (e) { if (logger) logger.warn('[analytics_dropoff] scan fallback err: ' + e.message); }
    return out;
}

function adClampPct(v) {
    v = Math.round(v);
    if (!isFinite(v) || v < 0) return 0;
    return v > 100 ? 100 : v;
}

function adExtractUser(ev) {
    return ev.userId || ev.user_id || (ev.eventData && (ev.eventData.user_id || ev.eventData.userId)) || null;
}

function adExtractMode(ev) {
    var d = ev.eventData || ev.properties || {};
    var m = d.quiz_mode || d.quizMode || d.game_mode || d.gameMode || ev.quiz_mode || null;
    return m ? String(m).slice(0, 64) : 'unspecified';
}

// ─── RPC: analytics_dropoff_funnel ────────────────────────

/**
 * Combined onboarding funnel + quiz session outcome funnel.
 *
 * REQUEST:  { "days": 30, "game_id": "..." }
 *
 * RESPONSE:
 *   {
 *     "onboarding": {
 *       "started": 200, "step_views": [...], "completed": 110, "abandoned": 78, "completion_rate_pct": 55,
 *       "drop_per_step": [ { "step": 2, "drop_count": 32, "drop_pct": 16 } ],
 *       "abandon_reasons": [ { "reason": "background", "count": 24 } ]
 *     },
 *     "quiz_outcomes": {
 *       "started": 1200, "completed": 800, "abandoned": 400,
 *       "completion_rate_pct": 67,
 *       "by_mode": [ { "mode": "Solo", "started": 400, "completed": 280, "abandoned": 120, "completion_rate_pct": 70 } ],
 *       "abandon_reasons": [ { "reason": "user_exit", "count": 220 } ]
 *     }
 *   }
 */
function rpcAnalyticsDropoffFunnel(ctx, logger, nk, payload) {
    try {
        var data = adSafeJson(payload);
        var days = parseInt(data.days, 10) || 30;
        if (days < 1) days = 1; if (days > 90) days = 90;
        var gameId = adResolveGameId(data.game_id || data.gameId || null);

        var events = adScanEvents(nk, logger, days, function(ev) {
            var n = (ev.eventName || '').toLowerCase();
            return AD_ONBOARDING_NAMES[n] || AD_QUIZ_STARTED_NAMES[n] ||
                   AD_QUIZ_COMPLETED_NAMES[n] || AD_QUIZ_ABANDONED_NAMES[n];
        }, gameId);

        // Onboarding aggregates
        var ob = {
            started: 0, completed: 0, abandoned: 0, paused: 0, quit: 0, resumed: 0,
            video: 0, skipped: 0, stepViews: {}, dropAtStep: {}, reasons: {}
        };
        // Quiz aggregates
        var qz = { started: 0, completed: 0, abandoned: 0, byMode: {}, reasons: {} };

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var n = (ev.eventName || '').toLowerCase();
            var d = ev.eventData || ev.properties || {};

            if (AD_ONBOARDING_NAMES[n]) {
                var kind = AD_ONBOARDING_NAMES[n];
                if (kind === 'started') ob.started++;
                else if (kind === 'complete') ob.completed++;
                else if (kind === 'abandoned') {
                    ob.abandoned++;
                    var reason = d.dropoff_reason || d.reason || 'unknown';
                    ob.reasons[reason] = (ob.reasons[reason] || 0) + 1;
                    var step = d.abandon_step != null ? d.abandon_step : (d.step_number != null ? d.step_number : null);
                    if (step != null) ob.dropAtStep[step] = (ob.dropAtStep[step] || 0) + 1;
                }
                else if (kind === 'paused') ob.paused++;
                else if (kind === 'quit') ob.quit++;
                else if (kind === 'resumed') ob.resumed++;
                else if (kind === 'video') ob.video++;
                else if (kind === 'skipped') ob.skipped++;
                else if (kind === 'step') {
                    var s = d.step_number != null ? d.step_number : (d.step != null ? d.step : 'unknown');
                    ob.stepViews[s] = (ob.stepViews[s] || 0) + 1;
                }
            } else if (AD_QUIZ_STARTED_NAMES[n]) {
                qz.started++;
                var m = adExtractMode(ev);
                var bk = qz.byMode[m] || (qz.byMode[m] = { mode: m, started: 0, completed: 0, abandoned: 0 });
                bk.started++;
            } else if (AD_QUIZ_COMPLETED_NAMES[n]) {
                var outcome = (d.quiz_outcome || d.outcome || 'completed').toString().toLowerCase();
                var m2 = adExtractMode(ev);
                var bk2 = qz.byMode[m2] || (qz.byMode[m2] = { mode: m2, started: 0, completed: 0, abandoned: 0 });
                if (outcome === 'completed' || outcome === 'win' || outcome === 'success') {
                    qz.completed++; bk2.completed++;
                } else {
                    qz.abandoned++; bk2.abandoned++;
                    qz.reasons[outcome] = (qz.reasons[outcome] || 0) + 1;
                }
            } else if (AD_QUIZ_ABANDONED_NAMES[n]) {
                qz.abandoned++;
                var m3 = adExtractMode(ev);
                var bk3 = qz.byMode[m3] || (qz.byMode[m3] = { mode: m3, started: 0, completed: 0, abandoned: 0 });
                bk3.abandoned++;
                var r = (d.abandon_reason || d.reason || 'unknown').toString().toLowerCase();
                qz.reasons[r] = (qz.reasons[r] || 0) + 1;
            }
        }

        function topN(obj, n) {
            var arr = [];
            for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) arr.push({ name: k, count: obj[k] });
            arr.sort(function(a, b) { return b.count - a.count; });
            return arr.slice(0, n || 10);
        }

        var onboardingTotal = ob.started || (ob.completed + ob.abandoned) || 1;
        var stepViewArr = topN(ob.stepViews, 30);
        var dropArr = topN(ob.dropAtStep, 30).map(function(r) {
            return { step: r.name, drop_count: r.count, drop_pct: adClampPct((r.count / onboardingTotal) * 100) };
        });

        var byMode = [];
        for (var mk in qz.byMode) {
            if (!Object.prototype.hasOwnProperty.call(qz.byMode, mk)) continue;
            var bm = qz.byMode[mk];
            var t = bm.started || 1;
            byMode.push({
                mode: bm.mode,
                started: bm.started,
                completed: bm.completed,
                abandoned: bm.abandoned,
                completion_rate_pct: adClampPct((bm.completed / t) * 100),
                abandonment_rate_pct: adClampPct((bm.abandoned / t) * 100)
            });
        }
        byMode.sort(function(a, b) { return b.started - a.started; });

        return JSON.stringify({
            game_id: gameId || 'all',
            days: days,
            onboarding: {
                started: ob.started,
                completed: ob.completed,
                abandoned: ob.abandoned,
                paused: ob.paused,
                quit: ob.quit,
                resumed: ob.resumed,
                video_watched: ob.video,
                skipped: ob.skipped,
                completion_rate_pct: adClampPct((ob.completed / onboardingTotal) * 100),
                abandonment_rate_pct: adClampPct((ob.abandoned / onboardingTotal) * 100),
                step_views: stepViewArr,
                drop_per_step: dropArr,
                abandon_reasons: topN(ob.reasons, 10)
            },
            quiz_outcomes: {
                started: qz.started,
                completed: qz.completed,
                abandoned: qz.abandoned,
                completion_rate_pct: adClampPct((qz.completed / (qz.started || 1)) * 100),
                abandonment_rate_pct: adClampPct((qz.abandoned / (qz.started || 1)) * 100),
                by_mode: byMode,
                abandon_reasons: topN(qz.reasons, 10)
            }
        });
    } catch (e) {
        logger.error('[analytics_dropoff_funnel] error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_churn_signals ─────────────────────────

/**
 * Cohort buckets that signal early-life churn risk:
 *  - cold_start_no_quiz   — users with session_start but zero quiz_session_started
 *  - one_and_done         — users with exactly 1 lifetime session_start
 *  - streak_break_no_return — streak_broken event followed by 7+ days inactive
 *  - paywall_no_convert   — saw paywall_shown but never paywall_converted
 *  - app_open_low_engagement — opened app 3+ times but no quiz completed
 *
 * REQUEST:  { "days": 30, "game_id": "..." }
 * RESPONSE: { "buckets": [ { "name": "...", "count": N, "users": [...truncated...] } ], "total_unique_users": N }
 */
function rpcAnalyticsChurnSignals(ctx, logger, nk, payload) {
    try {
        var data = adSafeJson(payload);
        var days = parseInt(data.days, 10) || 30;
        if (days < 1) days = 1; if (days > 90) days = 90;
        var gameId = adResolveGameId(data.game_id || data.gameId || null);

        var events = adScanEvents(nk, logger, days, function(ev) {
            var n = (ev.eventName || '').toLowerCase();
            return n === 'session_start' || n === 'app_open' || n === 'first_open' ||
                   AD_QUIZ_STARTED_NAMES[n] || AD_QUIZ_COMPLETED_NAMES[n] ||
                   n === 'streak_broken' || n === 'paywall_shown' || n === 'paywall_converted' ||
                   n === 'purchase_completed';
        }, gameId);

        // user → flags
        var byUser = {};
        function flag(u, k, v) {
            if (!u) return;
            var r = byUser[u] || (byUser[u] = {
                sessions: 0, opens: 0, quizStarted: 0, quizCompleted: 0,
                streakBroken: 0, lastStreakBreakTs: 0, lastActiveTs: 0,
                paywallShown: 0, paywallConverted: 0, purchases: 0
            });
            r[k] = (r[k] || 0) + (v || 1);
        }

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var n = (ev.eventName || '').toLowerCase();
            var u = adExtractUser(ev);
            if (!u) continue;
            var ts = parseInt(ev.timestamp || ev.unixTimestamp || 0, 10) || 0;
            var rec = byUser[u] || (byUser[u] = {
                sessions: 0, opens: 0, quizStarted: 0, quizCompleted: 0,
                streakBroken: 0, lastStreakBreakTs: 0, lastActiveTs: 0,
                paywallShown: 0, paywallConverted: 0, purchases: 0
            });
            if (ts > rec.lastActiveTs) rec.lastActiveTs = ts;

            if (n === 'session_start') flag(u, 'sessions');
            else if (n === 'app_open' || n === 'first_open') flag(u, 'opens');
            else if (AD_QUIZ_STARTED_NAMES[n]) flag(u, 'quizStarted');
            else if (AD_QUIZ_COMPLETED_NAMES[n]) flag(u, 'quizCompleted');
            else if (n === 'streak_broken') {
                flag(u, 'streakBroken');
                if (ts > rec.lastStreakBreakTs) rec.lastStreakBreakTs = ts;
            }
            else if (n === 'paywall_shown') flag(u, 'paywallShown');
            else if (n === 'paywall_converted') flag(u, 'paywallConverted');
            else if (n === 'purchase_completed') flag(u, 'purchases');
        }

        var buckets = {
            cold_start_no_quiz: [],
            one_and_done: [],
            streak_break_no_return: [],
            paywall_no_convert: [],
            app_open_low_engagement: []
        };
        var nowTs = Math.floor(Date.now() / 1000);

        for (var uid in byUser) {
            if (!Object.prototype.hasOwnProperty.call(byUser, uid)) continue;
            var u2 = byUser[uid];
            if (u2.sessions >= 1 && u2.quizStarted === 0) buckets.cold_start_no_quiz.push(uid);
            if (u2.sessions === 1) buckets.one_and_done.push(uid);
            if (u2.streakBroken >= 1 && (nowTs - u2.lastStreakBreakTs) >= 7 * 86400) buckets.streak_break_no_return.push(uid);
            if (u2.paywallShown >= 1 && u2.paywallConverted === 0 && u2.purchases === 0) buckets.paywall_no_convert.push(uid);
            if (u2.opens >= 3 && u2.quizCompleted === 0) buckets.app_open_low_engagement.push(uid);
        }

        var rows = [];
        for (var bk in buckets) {
            if (!Object.prototype.hasOwnProperty.call(buckets, bk)) continue;
            rows.push({
                name: bk,
                count: buckets[bk].length,
                sample_user_ids: buckets[bk].slice(0, 10)
            });
        }

        return JSON.stringify({
            game_id: gameId || 'all',
            days: days,
            buckets: rows,
            total_unique_users: Object.keys(byUser).length
        });
    } catch (e) {
        logger.error('[analytics_churn_signals] error: ' + e.message);
        return JSON.stringify({ error: e.message, buckets: [] });
    }
}

// ─── RPC: analytics_per_question_dropoff ──────────────────

/**
 * For each question_index, count: displayed, answered_correct, answered_wrong,
 * skipped, timeout, and the count of quizzes that ABANDONED at this index.
 * "Abandoned at index" = user fired question_displayed at index N then never
 * answered/displayed N+1 within the same quiz_session_id.
 *
 * REQUEST:  { "days": 30, "game_id": "...", "mode": "SoloChallenge" (optional) }
 * RESPONSE: { "by_index": [ { "index": 0, "displayed": 120, "correct": 80, "wrong": 25, "skipped": 5, "timeout": 4, "abandoned_here": 6, "drop_pct": 5 } ] }
 */
function rpcAnalyticsPerQuestionDropoff(ctx, logger, nk, payload) {
    try {
        var data = adSafeJson(payload);
        var days = parseInt(data.days, 10) || 30;
        if (days < 1) days = 1; if (days > 90) days = 90;
        var gameId = adResolveGameId(data.game_id || data.gameId || null);
        var modeFilter = data.mode || data.quiz_mode || null;
        if (modeFilter) modeFilter = String(modeFilter);

        var events = adScanEvents(nk, logger, days, function(ev) {
            var n = (ev.eventName || '').toLowerCase();
            return AD_QUESTION_NAMES[n];
        }, gameId);

        // Collect by index across all sessions; also build session→max-index-displayed
        // and session→max-index-answered to detect abandonment.
        var byIdx = {}; // idx → counts
        var sessLastDisplayed = {}; // sid → max idx displayed
        var sessLastAnswered = {}; // sid → max idx answered

        function bump(idx, kind) {
            var r = byIdx[idx] || (byIdx[idx] = {
                index: idx, displayed: 0, correct: 0, wrong: 0,
                skipped: 0, timeout: 0, abandoned_here: 0
            });
            r[kind] = (r[kind] || 0) + 1;
        }

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var n = (ev.eventName || '').toLowerCase();
            var kind = AD_QUESTION_NAMES[n];
            if (!kind) continue;
            if (modeFilter && adExtractMode(ev) !== modeFilter) continue;
            var d = ev.eventData || ev.properties || {};
            var idx = parseInt(d.question_index != null ? d.question_index : d.questionIndex, 10);
            if (isNaN(idx) || idx < 0 || idx > 200) continue;
            var sid = d.quiz_session_id || d.quizSessionId || ev.quiz_session_id || null;

            if (kind === 'displayed') {
                bump(idx, 'displayed');
                if (sid) sessLastDisplayed[sid] = Math.max(sessLastDisplayed[sid] || -1, idx);
            } else if (kind === 'correct') {
                bump(idx, 'correct'); bump(idx, 'displayed'); // answered implies displayed
                if (sid) sessLastAnswered[sid] = Math.max(sessLastAnswered[sid] || -1, idx);
            } else if (kind === 'wrong') {
                bump(idx, 'wrong'); bump(idx, 'displayed');
                if (sid) sessLastAnswered[sid] = Math.max(sessLastAnswered[sid] || -1, idx);
            } else if (kind === 'answered') {
                // Generic answered — we don't know correct/wrong; just count as answered
                bump(idx, 'displayed');
                var corr = d.is_correct != null ? d.is_correct : d.isCorrect;
                if (corr === true || corr === 1 || corr === '1') bump(idx, 'correct');
                else if (corr === false || corr === 0 || corr === '0') bump(idx, 'wrong');
                if (sid) sessLastAnswered[sid] = Math.max(sessLastAnswered[sid] || -1, idx);
            } else if (kind === 'skipped') {
                bump(idx, 'skipped'); bump(idx, 'displayed');
            } else if (kind === 'timeout') {
                bump(idx, 'timeout'); bump(idx, 'displayed');
            }
        }

        // Abandonment detection: for each session, last-displayed > last-answered means
        // user saw the question but never answered → abandoned at that index.
        for (var sid2 in sessLastDisplayed) {
            if (!Object.prototype.hasOwnProperty.call(sessLastDisplayed, sid2)) continue;
            var lastD = sessLastDisplayed[sid2];
            var lastA = sessLastAnswered[sid2] != null ? sessLastAnswered[sid2] : -1;
            if (lastD > lastA) bump(lastD, 'abandoned_here');
        }

        var rows = [];
        for (var k in byIdx) {
            if (!Object.prototype.hasOwnProperty.call(byIdx, k)) continue;
            var r = byIdx[k];
            r.drop_pct = r.displayed > 0 ? adClampPct((r.abandoned_here / r.displayed) * 100) : 0;
            r.accuracy_pct = (r.correct + r.wrong) > 0 ? adClampPct((r.correct / (r.correct + r.wrong)) * 100) : 0;
            rows.push(r);
        }
        rows.sort(function(a, b) { return a.index - b.index; });

        return JSON.stringify({
            game_id: gameId || 'all',
            days: days,
            mode: modeFilter || 'all',
            by_index: rows,
            total_indices: rows.length
        });
    } catch (e) {
        logger.error('[analytics_per_question_dropoff] error: ' + e.message);
        return JSON.stringify({ error: e.message, by_index: [] });
    }
}

// ─── RPC: analytics_screen_exit_heatmap ───────────────────

/**
 * Per-screen view + exit + time-on-screen metrics.
 *  - views:  count of `screen_view` events for this screen
 *  - exits:  count of `screen_left` events
 *  - exit_rate_pct: exits / views (capped 0-100)
 *  - avg_time_on_screen_ms: from `screen_left.time_on_screen_ms` payload
 *
 * REQUEST:  { "days": 30, "game_id": "..." }
 * RESPONSE: { "screens": [ { "screen": "home_screen", "views": 1200, "exits": 1100, "exit_rate_pct": 91, "avg_time_ms": 45000 } ] }
 */
function rpcAnalyticsScreenExitHeatmap(ctx, logger, nk, payload) {
    try {
        var data = adSafeJson(payload);
        var days = parseInt(data.days, 10) || 30;
        if (days < 1) days = 1; if (days > 90) days = 90;
        var gameId = adResolveGameId(data.game_id || data.gameId || null);

        var events = adScanEvents(nk, logger, days, function(ev) {
            var n = (ev.eventName || '').toLowerCase();
            return n === 'screen_view' || n === 'screen_left' || n === 'screen_back_pressed';
        }, gameId);

        var byScreen = {}; // name → { views, exits, backs, durations:[ms] }

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var n = (ev.eventName || '').toLowerCase();
            var d = ev.eventData || ev.properties || {};
            var screen = d.screen_name || d.screen || d.screenName || 'unknown';
            var bk = byScreen[screen] || (byScreen[screen] = { screen: screen, views: 0, exits: 0, backs: 0, durations: [] });
            if (n === 'screen_view') bk.views++;
            else if (n === 'screen_left') {
                bk.exits++;
                var t = parseInt(d.time_on_screen_ms || d.timeOnScreenMs || d.duration_ms || 0, 10);
                if (t > 0 && t < 7200000) bk.durations.push(t);
            } else if (n === 'screen_back_pressed') bk.backs++;
        }

        var rows = [];
        for (var k in byScreen) {
            if (!Object.prototype.hasOwnProperty.call(byScreen, k)) continue;
            var r = byScreen[k];
            var avg = r.durations.length ? Math.round(r.durations.reduce(function(a, c) { return a + c; }, 0) / r.durations.length) : 0;
            rows.push({
                screen: r.screen,
                views: r.views,
                exits: r.exits,
                back_presses: r.backs,
                exit_rate_pct: r.views > 0 ? adClampPct((r.exits / r.views) * 100) : 0,
                avg_time_ms: avg,
                avg_time_seconds: Math.round(avg / 1000)
            });
        }
        rows.sort(function(a, b) { return b.views - a.views; });

        return JSON.stringify({
            game_id: gameId || 'all',
            days: days,
            screens: rows
        });
    } catch (e) {
        logger.error('[analytics_screen_exit_heatmap] error: ' + e.message);
        return JSON.stringify({ error: e.message, screens: [] });
    }
}

// ─── Module init ──────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_dropoff_funnel", rpcAnalyticsDropoffFunnel);
    initializer.registerRpc("analytics_churn_signals", rpcAnalyticsChurnSignals);
    initializer.registerRpc("analytics_per_question_dropoff", rpcAnalyticsPerQuestionDropoff);
    initializer.registerRpc("analytics_screen_exit_heatmap", rpcAnalyticsScreenExitHeatmap);
    logger.info("[analytics_dropoff] Module registered: 4 RPCs");
}
