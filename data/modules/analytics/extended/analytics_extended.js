/**
 * Analytics Extended Module
 * Implements 14 analytics RPCs for the dashboard.
 *
 * RPCs:
 *   - analytics_session_stats
 *   - analytics_quiz_performance
 *   - analytics_funnel
 *   - analytics_ai_features
 *   - analytics_feature_adoption
 *   - analytics_economy_health
 *   - analytics_monetization_detail
 *   - analytics_platform_breakdown
 *   - analytics_home_heatmap
 *   - analytics_top_players
 *   - analytics_error_log
 */

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ─── Helpers ──────────────────────────────────────────────

function extSafeJsonParse(payload) {
    try { return JSON.parse(payload || '{}'); } catch (e) { return {}; }
}

// Phase 4 (2026-05) — fetch the rollup doc from analytics_rollup_daily
// across a window of N days. Returns an array of {date, doc, missing}
// entries newest-first, where doc=null when the rollup didn't run for
// that date (cold-start days). Uses readRollupDaily from analytics.js
// which is hoisted to global scope by postbuild.js. The "all" gameId
// fan-in is the same one the rollup writes (gameId === "all" doc).
function extReadRollupRange(nk, gameId, days) {
    var out = [];
    var now = new Date();
    var resolvedGid = gameId || "all";
    for (var d = 0; d < days; d++) {
        var date = new Date(now.getTime() - d * 86400000);
        var dateStr = date.toISOString().slice(0, 10);
        var doc = null;
        try {
            if (typeof readRollupDaily === "function") {
                doc = readRollupDaily(nk, resolvedGid, dateStr);
            }
        } catch (e) { /* swallow — falls back to event scan */ }
        out.push({ date: dateStr, doc: doc, missing: !doc });
    }
    return out;
}

// Returns true if at least one day in the rollup range carries a doc.
// The dashboard treats "no rollup days at all" as cold-start and falls
// back to the live event scan for that RPC; a partial range still
// counts as rollup-served (we patch the missing days with zeros).
function extRollupHasAny(rangeArr) {
    if (!rangeArr || rangeArr.length === 0) return false;
    for (var i = 0; i < rangeArr.length; i++) {
        if (rangeArr[i].doc) return true;
    }
    return false;
}

function extIsoDate(value) {
    if (!value) return null;
    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function extDaysSince(value) {
    var dateStr = extIsoDate(value);
    if (!dateStr) return 999;

    var today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    var then = new Date(dateStr + 'T00:00:00.000Z');
    return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

function extNormalizeEvent(val, key) {
    if (!val) return null;

    if (val.event && !val.eventName) {
        val.eventName = val.event;
    }
    if (!val.eventData) {
        if (val.properties) val.eventData = val.properties;
        else if (val.data) val.eventData = val.data;
    }
    if (!val.properties && val.eventData) {
        val.properties = val.eventData;
    }
    if (!val.gameId && val.gameID) {
        val.gameId = val.gameID;
    }
    if (!val.gameId && key) {
        val.gameId = extractGameIdFromKey(key);
    }
    if (!val.date && val.timestamp) {
        val.date = extIsoDate(val.timestamp);
    }

    return val;
}

function extResolveProfile(profile, gameId) {
    if (!profile) return null;
    if (!gameId) return profile;
    if (!profile.games || !profile.games[gameId]) return null;
    return profile.games[gameId];
}

function extProfileFirstSeen(profile) {
    if (!profile) return null;
    if (profile.firstSeenAt) return profile.firstSeenAt;
    if (profile.global && profile.global.firstSeenAt) return profile.global.firstSeenAt;
    if (profile.createdAt) return profile.createdAt;
    return null;
}

function extProfileLastSeen(profile) {
    if (!profile) return null;
    if (profile.lastSeenAt) return profile.lastSeenAt;
    if (profile.engagement && profile.engagement.lastSessionAt) return profile.engagement.lastSessionAt;
    if (profile.global && profile.global.lastSeenAt) return profile.global.lastSeenAt;
    if (profile.updatedAt) return profile.updatedAt;
    return null;
}

function extProfileTotalSpent(profile) {
    if (!profile) return 0;

    if (profile.monetization) {
        return profile.monetization.totalIapSpend || profile.monetization.ltv || 0;
    }

    if (profile.games) {
        var total = 0;
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId)) {
                total += extProfileTotalSpent(profile.games[gameId]);
            }
        }
        return total;
    }

    return (profile.global && profile.global.totalRevenue) || 0;
}

function extProfilePurchaseCount(profile) {
    if (!profile) return 0;

    if (profile.monetization) {
        return profile.monetization.purchaseCount || 0;
    }

    if (profile.games) {
        var total = 0;
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId)) {
                total += extProfilePurchaseCount(profile.games[gameId]);
            }
        }
        return total;
    }

    return 0;
}

function extProfileRewardedAds(profile) {
    if (!profile) return 0;

    if (profile.monetization) {
        return profile.monetization.rewardedAdsWatched || 0;
    }

    if (profile.games) {
        var total = 0;
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId)) {
                total += extProfileRewardedAds(profile.games[gameId]);
            }
        }
        return total;
    }

    return 0;
}

function extProfileAdRemovalPurchased(profile) {
    if (!profile) return false;

    if (profile.monetization) {
        return !!profile.monetization.adRemovalPurchased;
    }

    if (profile.games) {
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId) && extProfileAdRemovalPurchased(profile.games[gameId])) {
                return true;
            }
        }
    }

    return false;
}

function extProfileRecentSessions(profile) {
    if (!profile) return 0;

    if (profile.engagement) {
        return profile.engagement.sessionsThisWeek || profile.engagement.totalSessions || 0;
    }

    if (profile.global) {
        return profile.global.totalSessions || 0;
    }

    return 0;
}

function extProfileStreak(profile) {
    if (!profile) return 0;

    if (profile.engagement) {
        return profile.engagement.currentStreak || 0;
    }

    return 0;
}

function extDaysAgo(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

/**
 * Resolve a gameId slug ("quizverse", "lasttolive", …) to its canonical UUID.
 * Delegates to resolveGameIdAlias (defined in analytics.js, globally available
 * inside the bundled runtime). Falls back to identity when the helper or the
 * input is missing so existing callers stay safe.
 */
function extResolveGameId(gameId) {
    if (!gameId) return gameId;
    try {
        if (typeof resolveGameIdAlias === 'function') {
            return resolveGameIdAlias(gameId);
        }
    } catch (e) { /* helper not bundled yet — keep raw value */ }
    return gameId;
}

function extStorageRead(nk, collection, key, userId) {
    try {
        var objs = nk.storageRead([{ collection: collection, key: key, userId: userId || SYSTEM_USER_ID }]);
        if (objs && objs.length > 0) return objs[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function extStorageList(nk, collection, userId, limit) {
    try {
        var result = nk.storageList(userId || SYSTEM_USER_ID, collection, limit || 100, null);
        if (result && result.objects) return result.objects;
    } catch (e) { /* ignore */ }
    return [];
}

// Collections where events are stored (legacy + new)
var EVENT_COLLECTIONS = ['analytics_events', 'analytics_error_events'];

/**
 * Scan events from storage with optional gameId filtering.
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger
 * @param {string} collection - Collection name
 * @param {number} days - Days to look back
 * @param {function} filter - Custom filter function
 * @param {string} gameId - Optional gameId to filter (null = all games)
 */
function extScanEvents(nk, logger, collection, days, filter, gameId) {
    var events = [];
    var cutoffDate = extDaysAgo(days);

    // Canonicalize the requested gameId once: callers may pass a slug
    // ("quizverse") and stored events may carry either the slug (legacy)
    // or the canonical UUID, so we alias both sides before comparing.
    var canonicalGameId = extResolveGameId(gameId);

    // Determine which collections to scan
    var collectionsToScan = (collection === 'analytics_events') ? EVENT_COLLECTIONS : [collection];

    for (var c = 0; c < collectionsToScan.length; c++) {
        var currentCollection = collectionsToScan[c];

        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 250;  // 250 × 200 = 50k events (was 20 × 100 = 2k)

            do {
                var result = nk.storageList(SYSTEM_USER_ID, currentCollection, 200, cursor);
                if (!result || !result.objects) break;

                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var val = extNormalizeEvent(obj.value, obj.key);
                    if (!val) continue;

                    // GameId filter (supports both key prefix and value.gameId)
                    if (canonicalGameId) {
                        var rawEventGameId = val.gameId || extractGameIdFromKey(obj.key);
                        var eventGameId = extResolveGameId(rawEventGameId);
                        if (eventGameId !== canonicalGameId) continue;
                    }

                    // Date filter
                    var eventDate = val.date || extIsoDate(val.timestamp) || obj.key.slice(-10);
                    if (eventDate && eventDate < cutoffDate) continue;

                    // Custom filter
                    if (filter && !filter(val, obj)) continue;

                    events.push(val);
                }

                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] Scan error (' + currentCollection + '): ' + e.message);
        }
    }

    return events;
}

/**
 * Extract gameId from a storage key.
 *
 * We support multiple historical key shapes:
 *   - "dash_{gameId}_{YYYY-MM-DD}_{eventName}_{ts}_{rand}"   (new aggregated format)
 *   - "dash_{YYYY-MM-DD}_{eventName}_{ts}_{rand}"             (legacy aggregated, gameId only on value)
 *   - "event_{userId}_{gameId}_{ts}_{rand}"                   (per-user event copy)
 *   - "{gameId}_{eventName}_{ts}_{userId}"                    (very old direct-write format)
 *
 * gameId may be a UUID (e.g. "126bf539-dae2-4bcf-964d-316c0fa1f92b") OR a slug
 * (e.g. "quizverse"). UUIDs themselves contain hyphens, never underscores, so
 * splitting on "_" is safe.
 */
function extractGameIdFromKey(key) {
    if (!key) return null;
    var parts = key.split('_');
    if (parts.length < 2) return null;

    // New aggregated dashboard key: dash_{gameId}_{date}_...
    // The "date" segment matches YYYY-MM-DD; if parts[2] looks like a date,
    // parts[1] is the gameId.
    if (parts[0] === 'dash' && parts.length >= 5) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
            return parts[1];
        }
        // Legacy dash_{date}_... — no gameId encoded in the key.
        return null;
    }

    // Per-user event copy: event_{userId}_{gameId}_{ts}_{rand}
    // userId is a UUID (no underscores), so parts[2] is the gameId.
    if (parts[0] === 'event' && parts.length >= 5) {
        return parts[2];
    }

    // Fallback / very old format: {gameId}_{eventName}_{ts}_{userId}
    if (parts.length >= 4) {
        return parts[0];
    }
    return null;
}

/**
 * Get DAU key for a specific gameId or platform-wide
 */
function getDAUKey(dateStr, gameId) {
    if (gameId) {
        return 'dau_' + gameId + '_' + dateStr;
    }
    return 'dau_platform_' + dateStr;
}

function extCountByField(events, field) {
    var counts = {};
    for (var i = 0; i < events.length; i++) {
        var val = events[i][field] || 'unknown';
        counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
}

function extTopN(counts, n, labelKey, countKey) {
    labelKey = labelKey || 'name';
    countKey = countKey || 'count';

    var arr = [];
    for (var k in counts) {
        var item = {};
        item[labelKey] = k;
        item[countKey] = counts[k];
        arr.push(item);
    }
    arr.sort(function(a, b) { return b[countKey] - a[countKey]; });
    return arr.slice(0, n || 10);
}

function extMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function extPercentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

/**
 * Extract the quiz_mode tag from an event (Unity auto-injects this via
 * AnalyticsManager.InjectGlobalContext while a quiz is in flight).
 * Returns null when the event has no mode tag.
 */
function extEventMode(ev) {
    if (!ev) return null;
    var d = ev.eventData || ev.properties || {};
    return d.quiz_mode || d.quizMode || d.game_mode || d.gameMode || ev.quiz_mode || null;
}

/**
 * Check whether an event matches the optional quiz_mode filter passed in
 * the RPC payload. Returns true when no filter is set.
 *
 *  - request.quiz_mode (or .mode / .gameMode) limits to events tagged with
 *    that exact mode string. "all" / "*" / "" disables the filter.
 *  - When the filter is set but the event has no mode tag, the event is
 *    rejected — stops counting un-tagged events when the user explicitly
 *    asked for one mode.
 */
function extMatchesModeFilter(payloadData, ev) {
    if (!payloadData) return true;
    var want = payloadData.quiz_mode || payloadData.mode || payloadData.gameMode || null;
    if (!want) return true;
    var w = String(want).toLowerCase();
    if (w === 'all' || w === '*' || w === '') return true;
    var got = extEventMode(ev);
    if (!got) return false;
    return String(got).toLowerCase() === w;
}

function extEventData(ev) {
    if (!ev) return {};
    return ev.eventData || ev.properties || ev.data || {};
}

function extEventName(ev) {
    if (!ev) return '';
    return String(ev.eventName || ev.event || ev.name || '').toLowerCase();
}

function extEventTimestampSeconds(ev) {
    if (!ev) return 0;
    var d = extEventData(ev);
    var raw = ev.timestamp || ev.created_at || ev.createdAt || ev.time || d.timestamp || d.created_at || d.createdAt || d.time || null;
    if (raw === null || raw === undefined || raw === '') return 0;
    if (typeof raw === 'number') {
        return raw > 10000000000 ? Math.floor(raw / 1000) : Math.floor(raw);
    }
    var asNumber = parseFloat(raw);
    if (isFinite(asNumber) && String(raw).match(/^\d+(\.\d+)?$/)) {
        return asNumber > 10000000000 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
    }
    var parsed = Date.parse(raw);
    return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function extEventDate(ev) {
    var d = extEventData(ev);
    var direct = ev && (ev.date || d.date || d.event_date || d.eventDate);
    var dateStr = extIsoDate(direct);
    if (dateStr) return dateStr;
    var ts = extEventTimestampSeconds(ev);
    if (!ts) return null;
    return new Date(ts * 1000).toISOString().slice(0, 10);
}

function extEventHour(ev) {
    var d = extEventData(ev);
    var hour = parseInt(d.hour || d.utc_hour || d.utcHour, 10);
    if (isFinite(hour) && hour >= 0 && hour < 24) return hour;
    var ts = extEventTimestampSeconds(ev);
    if (!ts) return 0;
    return new Date(ts * 1000).getUTCHours();
}

function extDurationSecondsFromEvent(ev) {
    var d = extEventData(ev);
    var secondKeys = [
        'duration_seconds', 'durationSeconds',
        'session_duration_seconds', 'sessionDurationSeconds',
        'time_spent_seconds', 'timeSpentSeconds',
        'elapsed_seconds', 'elapsedSeconds',
        'duration'
    ];
    for (var i = 0; i < secondKeys.length; i++) {
        var v = parseFloat(d[secondKeys[i]]);
        if (isFinite(v) && v > 0 && v < 86400) return v;
    }
    var msKeys = ['duration_ms', 'durationMs', 'session_duration_ms', 'sessionDurationMs', 'time_spent_ms', 'timeSpentMs'];
    for (var j = 0; j < msKeys.length; j++) {
        var ms = parseFloat(d[msKeys[j]]);
        if (isFinite(ms) && ms > 0 && ms < 86400000) return ms / 1000;
    }
    return 0;
}

function extIsSessionStartName(name) {
    return name === 'session_start' ||
        name === 'session_started' ||
        name === 'app_session_start' ||
        name === 'app_open' ||
        name === 'first_open' ||
        name === 'quiz_session_started' ||
        name === 'quiz_session_start' ||
        name === 'quiz_started' ||
        name === 'quiz_start';
}

function extIsSessionEndName(name) {
    return name === 'session_end' ||
        name === 'session_ended' ||
        name === 'app_session_end' ||
        name === 'quiz_session_ended' ||
        name === 'quiz_session_end' ||
        name === 'quiz_completed' ||
        name === 'quiz_complete' ||
        name === 'quiz_abandoned';
}

function extAddDurationSamples(durations, value, count) {
    if (!isFinite(value) || value <= 0 || value >= 86400) return;
    var limit = Math.min(parseInt(count, 10) || 1, 500);
    for (var i = 0; i < limit; i++) durations.push(value);
}

function extBuildSessionStatsFromEvents(events, days) {
    var dailyMap = {};
    var dailyStats = [];
    for (var d = 0; d < days; d++) {
        var dateStr = extDaysAgo(d);
        dailyMap[dateStr] = { date: dateStr, sessions: 0, durationTotal: 0, durationCount: 0 };
    }

    var sessions = {};
    var hourCounts = {};
    var durations = [];

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var eventDate = extEventDate(ev);
        if (!eventDate || !dailyMap[eventDate]) continue;

        var data = extEventData(ev);
        var name = extEventName(ev);
        var isStart = extIsSessionStartName(name);
        var isEnd = extIsSessionEndName(name);
        var sid = data.session_id || data.sessionId || data.sid || ev.session_id || ev.sessionId || null;
        if (!sid && !isStart && !isEnd) continue;

        var ts = extEventTimestampSeconds(ev);
        var userId = ev.userId || ev.user_id || data.user_id || data.userId || 'anonymous';
        var key = sid ? (userId + '|' + sid) : (userId + '|' + name + '|' + eventDate + '|' + (ts || i));
        var s = sessions[key];
        if (!s) {
            s = sessions[key] = {
                date: eventDate,
                firstTs: ts || 0,
                lastTs: ts || 0,
                startTs: 0,
                endTs: 0,
                explicitDuration: 0,
                hour: extEventHour(ev),
                hasStart: false,
                hasEnd: false
            };
        }

        if (ts) {
            if (!s.firstTs || ts < s.firstTs) {
                s.firstTs = ts;
                s.date = eventDate;
                s.hour = extEventHour(ev);
            }
            if (!s.lastTs || ts > s.lastTs) s.lastTs = ts;
        }
        if (isStart) {
            s.hasStart = true;
            if (ts && (!s.startTs || ts < s.startTs)) {
                s.startTs = ts;
                s.date = eventDate;
                s.hour = extEventHour(ev);
            }
        }
        if (isEnd) {
            s.hasEnd = true;
            if (ts && (!s.endTs || ts > s.endTs)) s.endTs = ts;
        }
        var explicitDuration = extDurationSecondsFromEvent(ev);
        if (explicitDuration > s.explicitDuration) s.explicitDuration = explicitDuration;
    }

    var totalSessions = 0;
    for (var key in sessions) {
        if (!sessions.hasOwnProperty(key)) continue;
        var session = sessions[key];
        var bucket = dailyMap[session.date];
        if (!bucket) continue;

        totalSessions++;
        bucket.sessions++;
        var h = String(session.hour || 0);
        hourCounts[h] = (hourCounts[h] || 0) + 1;

        var duration = session.explicitDuration || 0;
        if (!duration && session.startTs && session.endTs && session.endTs > session.startTs) {
            duration = session.endTs - session.startTs;
        }
        if (!duration && session.firstTs && session.lastTs && session.lastTs > session.firstTs) {
            duration = session.lastTs - session.firstTs;
        }
        if (isFinite(duration) && duration > 0 && duration < 86400) {
            durations.push(duration);
            bucket.durationTotal += duration;
            bucket.durationCount++;
        }
    }

    for (var r = days - 1; r >= 0; r--) {
        var dayStr = extDaysAgo(r);
        var b = dailyMap[dayStr] || { date: dayStr, sessions: 0, durationTotal: 0, durationCount: 0 };
        dailyStats.push({
            date: dayStr,
            sessions: b.sessions,
            avg_duration: b.durationCount > 0 ? Math.round(b.durationTotal / b.durationCount) : 0
        });
    }

    return {
        totalSessions: totalSessions,
        durations: durations,
        hourCounts: hourCounts,
        dailyStats: dailyStats
    };
}

// ─── RPC: analytics_session_stats ─────────────────────────

function rpcAnalyticsSessionStats(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        if (days < 1) days = 7;
        if (days > 365) days = 365;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var totalSessions = 0;
        var durations = [];
        var hourCounts = {};
        var dailyStats = [];
        var rollupReadDays = 0;
        var aggregateReadDays = 0;

        // Prefer daily rollups, then legacy session aggregates. If both are cold,
        // derive counts directly from analytics_events so the dashboard does not
        // show zero while the raw activity log has usable session evidence.
        for (var d = 0; d < days; d++) {
            var dateStr = extDaysAgo(d);
            var daySessions = 0;
            var dayAvgDuration = 0;
            var addedRawDurations = false;

            var rollupDoc = null;
            try {
                if (typeof readRollupDaily === 'function') {
                    rollupDoc = readRollupDaily(nk, gameId || 'all', dateStr);
                }
            } catch (_) { rollupDoc = null; }

            if (rollupDoc && rollupDoc.sessions) {
                var rs = rollupDoc.sessions;
                var starts = parseInt(rs.starts || rs.session_starts || 0, 10) || 0;
                var count = parseInt(rs.count || rs.ends || rs.session_count || 0, 10) || 0;
                daySessions = Math.max(starts, count);
                var totalDuration = parseFloat(rs.total_duration_seconds || rs.totalDurationSeconds || 0) || 0;
                dayAvgDuration = parseFloat(rs.avg_duration_seconds || rs.avgDurationSeconds || rs.avgDuration || 0) || 0;
                if (!dayAvgDuration && daySessions > 0 && totalDuration > 0) {
                    dayAvgDuration = totalDuration / daySessions;
                }
                if (daySessions > 0 || totalDuration > 0) rollupReadDays++;
            }

            if (!daySessions) {
                var key = gameId
                    ? 'session_stats_' + gameId + '_' + dateStr
                    : 'session_stats_' + dateStr;
                var stats = extStorageRead(nk, 'analytics_sessions', key, SYSTEM_USER_ID);

                if (stats) {
                    daySessions = parseInt(stats.totalSessions || stats.count || stats.sessions || 0, 10) || 0;
                    dayAvgDuration = parseFloat(stats.avgDuration || stats.avg_duration_seconds || stats.avg_duration || 0) || 0;
                    var statsTotalDuration = parseFloat(stats.totalDuration || stats.total_duration_seconds || 0) || 0;
                    if (!dayAvgDuration && daySessions > 0 && statsTotalDuration > 0) {
                        dayAvgDuration = statsTotalDuration / daySessions;
                    }

                    if (stats.durations && Array.isArray(stats.durations)) {
                        for (var i = 0; i < stats.durations.length; i++) {
                            var rawDuration = parseFloat(stats.durations[i]);
                            if (isFinite(rawDuration) && rawDuration > 0 && rawDuration < 86400) durations.push(rawDuration);
                        }
                        addedRawDurations = true;
                    }

                    if (stats.hourDistribution) {
                        for (var h in stats.hourDistribution) {
                            hourCounts[h] = (hourCounts[h] || 0) + stats.hourDistribution[h];
                        }
                    }
                    if (daySessions > 0) aggregateReadDays++;
                }
            }

            if (daySessions > 0) {
                totalSessions += daySessions;
                if (!addedRawDurations && dayAvgDuration > 0) {
                    extAddDurationSamples(durations, dayAvgDuration, daySessions);
                }
            }

            dailyStats.unshift({
                date: dateStr,
                sessions: daySessions,
                avg_duration: Math.round(dayAvgDuration)
            });
        }

        var usedLiveEvents = false;
        var needsLiveEvents = totalSessions === 0 || durations.length === 0 || Object.keys(hourCounts).length === 0;
        if (needsLiveEvents) {
            var liveEvents = extScanEvents(nk, logger, 'analytics_events', days, function(v) {
                var n = extEventName(v);
                if (n.indexOf('error') !== -1 || n === 'exception') return false;
                return extMatchesModeFilter(data, v);
            }, gameId);
            var liveStats = extBuildSessionStatsFromEvents(liveEvents, days);
            if (liveStats.totalSessions > 0) {
                if (totalSessions === 0) {
                    totalSessions = liveStats.totalSessions;
                    dailyStats = liveStats.dailyStats;
                    durations = liveStats.durations;
                    hourCounts = liveStats.hourCounts;
                    usedLiveEvents = true;
                } else {
                    if (durations.length === 0) durations = liveStats.durations;
                    if (Object.keys(hourCounts).length === 0) hourCounts = liveStats.hourCounts;
                    usedLiveEvents = true;
                }
            }
        }

        // Calculate metrics
        var avgDuration = durations.length > 0 ? Math.round(durations.reduce(function(a, b) { return a + b; }, 0) / durations.length) : 0;
        var medianDuration = Math.round(extMedian(durations));
        var p95Duration = Math.round(extPercentile(durations, 95));
        var sessionsPerDayAvg = days > 0 ? Math.round(totalSessions / days) : 0;

        // Peak hours
        var peakHours = [];
        for (var hour = 0; hour < 24; hour++) {
            peakHours.push({
                hour: hour,
                count: hourCounts[hour.toString()] || hourCounts[hour] || 0
            });
        }

        return JSON.stringify({
            game_id: gameId || 'all',
            total_sessions: totalSessions,
            avg_duration_seconds: avgDuration,
            median_duration_seconds: medianDuration,
            p95_duration_seconds: p95Duration,
            sessions_per_day_avg: sessionsPerDayAvg,
            peak_hours: peakHours,
            daily_breakdown: dailyStats,
            _meta: {
                source: usedLiveEvents && totalSessions > 0 && rollupReadDays === 0 && aggregateReadDays === 0 ? 'analytics_events' : 'rollup_or_aggregate',
                rollup_days: rollupReadDays,
                aggregate_days: aggregateReadDays,
                live_event_fallback: usedLiveEvents
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] session_stats error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_quiz_performance ──────────────────────

function rpcAnalyticsQuizPerformance(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var quizStarted = 0;
        var quizCompleted = 0;
        var quizAbandoned = 0;
        var hintsUsed = 0;
        var dailyCompleted = 0;
        var totalScore = 0;
        var totalCorrect = 0;
        var totalQuestions = 0;
        var streakSum = 0;
        var streakCount = 0;
        var topicCounts = {};
        var difficultyCounts = {};

        // Read quiz stats from storage (game-specific key if gameId provided)
        for (var d = 0; d < days; d++) {
            var dateStr = extDaysAgo(d);
            var key = gameId
                ? 'quiz_stats_' + gameId + '_' + dateStr
                : 'quiz_stats_' + dateStr;
            var stats = extStorageRead(nk, 'analytics_quiz', key, SYSTEM_USER_ID);

            if (stats) {
                quizStarted += stats.started || 0;
                quizCompleted += stats.completed || 0;
                quizAbandoned += stats.abandoned || 0;
                hintsUsed += stats.hints || 0;
                totalScore += stats.totalScore || 0;
                totalCorrect += stats.correctAnswers || 0;
                totalQuestions += stats.totalQuestions || 0;

                if (d === 0) {
                    dailyCompleted = stats.dailyCompleted || stats.completed || 0;
                }

                if (stats.avgStreak) {
                    streakSum += stats.avgStreak;
                    streakCount++;
                }

                // Topic breakdown
                if (stats.topics) {
                    for (var t in stats.topics) {
                        topicCounts[t] = (topicCounts[t] || 0) + stats.topics[t];
                    }
                }

                // Difficulty breakdown
                if (stats.difficulty) {
                    for (var df in stats.difficulty) {
                        difficultyCounts[df] = (difficultyCounts[df] || 0) + stats.difficulty[df];
                    }
                }
            }
        }

        // Today's live patch — analytics_live_daily is written on every ingest,
        // so it contains today's event counts before the nightly cron runs.
        // Only applies to the today bucket (d=0); historical days are served
        // by quiz_stats_* rollup docs above.
        try {
            var todayStr = extDaysAgo(0);
            var liveDailyKey = "live_" + (gameId || "all") + "_" + todayStr;
            var liveRecs = nk.storageRead([{ collection: "analytics_live_daily", key: liveDailyKey, userId: SYSTEM_USER_ID }]);
            if (liveRecs && liveRecs.length > 0 && liveRecs[0].value) {
                var ld = liveRecs[0].value;
                var bn = ld.by_name || {};
                // Map canonical event names → quiz metric buckets
                var STARTED_LIVE   = ['quiz_started','quiz_session_started','quiz_session_start','quiz_start'];
                var COMPLETED_LIVE = ['quiz_completed','quiz_complete','quiz_session_completed','quiz_session_complete','quiz_session_ended'];
                var ABANDONED_LIVE = ['quiz_abandoned','quiz_session_abandoned'];
                for (var li = 0; li < STARTED_LIVE.length; li++)   quizStarted   += bn[STARTED_LIVE[li]]   || 0;
                for (var li = 0; li < COMPLETED_LIVE.length; li++) quizCompleted += bn[COMPLETED_LIVE[li]] || 0;
                for (var li = 0; li < ABANDONED_LIVE.length; li++) quizAbandoned += bn[ABANDONED_LIVE[li]] || 0;
                hintsUsed += (bn['hint_used'] || bn['hintused'] || 0);
                dailyCompleted += (bn['daily_quiz_completed'] || bn['dailyquizcompleted'] || 0);
            }
        } catch (_ld_err) { /* live_daily read failure must not break the RPC */ }

        // Fallback: scan events collection (with gameId filter)
        if (quizStarted === 0) {
            var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
                if (!val.eventName || val.eventName.toLowerCase().indexOf('quiz') === -1) return false;
                return extMatchesModeFilter(data, val);
            }, gameId);

            // 2026-05 hardening — alias Unity's actual event names to canonical
            // dashboard names. The Unity client (QuizGameAnalytics.cs) emits
            // `quiz_session_started/ended/complete` whereas the dashboard
            // historically expected `quiz_started/completed`. Without this
            // alias, the Quiz panel shows zero even when 30+ session events
            // exist in the collection.
            var STARTED_NAMES = {
                'quiz_started': 1, 'quizstarted': 1,
                'quiz_session_started': 1, 'quiz_session_start': 1
            };
            var COMPLETED_NAMES = {
                'quiz_completed': 1, 'quizcompleted': 1, 'quiz_complete': 1,
                'quiz_session_completed': 1, 'quiz_session_complete': 1, 'quiz_session_ended': 1
            };
            var ABANDONED_NAMES = {
                'quiz_abandoned': 1, 'quizabandoned': 1, 'quiz_session_abandoned': 1
            };

            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                var evName = (ev.eventName || '').toLowerCase();

                if (STARTED_NAMES[evName]) quizStarted++;
                if (COMPLETED_NAMES[evName]) {
                    quizCompleted++;
                    if (ev.eventData) {
                        totalScore += ev.eventData.score || ev.eventData.final_score || 0;
                        totalCorrect += ev.eventData.correctAnswers || ev.eventData.correct_answers || 0;
                        totalQuestions += ev.eventData.totalQuestions || ev.eventData.total_questions || ev.eventData.question_count || 0;
                        hintsUsed += ev.eventData.hintsUsed || ev.eventData.hints_used || 0;

                        var topic = ev.eventData.topic || ev.eventData.category || ev.eventData.quiz_topic;
                        if (topic) topicCounts[topic] = (topicCounts[topic] || 0) + 1;
                        var diff = ev.eventData.difficulty || ev.eventData.quiz_difficulty;
                        if (diff) difficultyCounts[diff] = (difficultyCounts[diff] || 0) + 1;
                    }
                }
                if (ABANDONED_NAMES[evName]) quizAbandoned++;
                if (evName === 'hint_used' || evName === 'hintused') hintsUsed++;
                if (evName === 'daily_quiz_completed' || evName === 'dailyquizcompleted') dailyCompleted++;
            }
        }

        // Calculate rates (clamped 0..100)
        var qpClamp = function(v) {
            v = Math.round(v);
            if (!isFinite(v) || v < 0) return 0;
            return v > 100 ? 100 : v;
        };
        var completionRate = quizStarted > 0 ? qpClamp((quizCompleted / quizStarted) * 100) : 0;
        var accuracyRate = totalQuestions > 0 ? qpClamp((totalCorrect / totalQuestions) * 100) : 0;
        var avgScore = quizCompleted > 0 ? Math.round(totalScore / quizCompleted) : 0;
        var avgStreak = streakCount > 0 ? Math.round(streakSum / streakCount) : 0;

        // Convert to arrays
        var topTopics = extTopN(topicCounts, 10, 'topic', 'count');
        var difficultyBreakdown = extTopN(difficultyCounts, 5, 'difficulty', 'count');

        return JSON.stringify({
            game_id: gameId || 'all',
            quiz_started: quizStarted,
            quiz_completed: quizCompleted,
            completion_rate_pct: completionRate,
            accuracy_rate_pct: accuracyRate,
            avg_score: avgScore,
            hints_used: hintsUsed,
            daily_completed: dailyCompleted,
            avg_streak: avgStreak,
            quiz_abandoned: quizAbandoned,
            top_topics: topTopics,
            difficulty_breakdown: difficultyBreakdown
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] quiz_performance error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_funnel ────────────────────────────────

function rpcAnalyticsFunnel(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs
        var funnelType = data.funnel || 'onboarding';

        var stepCounts = {};
        var stepOrder = [];

        // Funnel definitions per type. The "default" funnel uses the canonical
        // AR_FUNNEL_STEPS taxonomy that analytics_rollup.js populates in
        // analytics_funnel_daily — that's the rollup-served path. The other
        // types (onboarding/quiz/purchase) still scan events because the
        // rollup doesn't bucket them separately.
        if (funnelType === 'onboarding') {
            stepOrder = ['app_open', 'onboarding_start', 'name_entered', 'avatar_selected', 'tutorial_completed', 'first_quiz_completed'];
        } else if (funnelType === 'quiz') {
            stepOrder = ['quiz_view', 'quiz_started', 'first_answer', 'quiz_completed'];
        } else if (funnelType === 'purchase') {
            stepOrder = ['store_opened', 'product_viewed', 'purchase_started', 'purchase_completed'];
        } else if (funnelType === 'canonical' || funnelType === 'default') {
            // The canonical AR_FUNNEL_STEPS used by analytics_rollup.js.
            stepOrder = ['app_open', 'onboarded', 'login_success', 'session_start',
                        'quiz_start', 'quiz_complete', 'iap_clicked', 'iap_purchased'];
        } else {
            stepOrder = ['step_1', 'step_2', 'step_3', 'step_4'];
        }

        for (var i = 0; i < stepOrder.length; i++) {
            stepCounts[stepOrder[i]] = 0;
        }

        // Phase 4 (2026-05) — analytics_funnel_daily rollup. The Phase 4
        // rollup writes one doc per game per day with shape
        //   { funnel: { step: { users, total_events } }, funnel_order: [...] }
        // keyed `funnel_<gameId>_<date>`. We aggregate users (deduped across
        // days is impossible without user lists — the rollup only stores
        // per-day uniques — so the union is actually a "sum of daily uniques",
        // which is the same upper-bound estimate AR_RETENTION uses). Powers
        // the canonical funnel; per-type funnels (onboarding/quiz/purchase)
        // still go through the legacy storage / live-scan path below.
        var rollupServedFunnel = false;
        var funnelRollupHits = 0;
        if (funnelType === 'canonical' || funnelType === 'default') {
            for (var fd = 0; fd < days; fd++) {
                var fDateStr = extDaysAgo(fd);
                var funnelKey = "funnel_" + (gameId || "all") + "_" + fDateStr;
                var fDoc = extStorageRead(nk, 'analytics_funnel_daily', funnelKey, SYSTEM_USER_ID);
                if (fDoc && fDoc.funnel) {
                    funnelRollupHits++;
                    for (var fStep in fDoc.funnel) {
                        if (stepCounts.hasOwnProperty(fStep) && fDoc.funnel[fStep]) {
                            // Prefer unique users over event count for funnel
                            // step counts (canonical industry definition).
                            stepCounts[fStep] += fDoc.funnel[fStep].users || fDoc.funnel[fStep].total_events || 0;
                        }
                    }
                }
            }
            rollupServedFunnel = funnelRollupHits > 0;
        }

        // Per-type rollups — the legacy `analytics_funnel` collection (NOT
        // the new analytics_funnel_daily) is read here. Nothing currently
        // writes to it but we keep the read for any operator who wires up
        // a custom funnel rollup later.
        if (!rollupServedFunnel) {
            for (var d = 0; d < days; d++) {
                var dateStr = extDaysAgo(d);
                var key = gameId
                    ? 'funnel_' + funnelType + '_' + gameId + '_' + dateStr
                    : 'funnel_' + funnelType + '_' + dateStr;
                var stats = extStorageRead(nk, 'analytics_funnel', key, SYSTEM_USER_ID);

                if (stats && stats.steps) {
                    for (var step in stats.steps) {
                        if (stepCounts.hasOwnProperty(step)) {
                            stepCounts[step] += stats.steps[step];
                        }
                    }
                }
            }
        }

        // Today's live patch — fill in today's step counts from analytics_live_daily
        // before falling back to the expensive extScanEvents path. The rollup
        // doc for today doesn't exist until the nightly cron runs, so this
        // bridge covers the current day for all funnel types.
        try {
            var fTodayStr = extDaysAgo(0);
            var fLiveDailyKey = "live_" + (gameId || "all") + "_" + fTodayStr;
            var fLiveRecs = nk.storageRead([{ collection: "analytics_live_daily", key: fLiveDailyKey, userId: SYSTEM_USER_ID }]);
            if (fLiveRecs && fLiveRecs.length > 0 && fLiveRecs[0].value) {
                var fbn = fLiveRecs[0].value.by_name || {};
                for (var fsi = 0; fsi < stepOrder.length; fsi++) {
                    var fStep = stepOrder[fsi];
                    // Try exact name match and common camelCase/snake_case aliases
                    var fCount = (fbn[fStep] || 0) +
                                 (fbn[fStep.replace(/_/g, '')] || 0) +  // snake→camel strip
                                 (fbn[fStep.replace(/_([a-z])/g, function(m, c) { return c.toUpperCase(); })] || 0); // snake→camelCase
                    stepCounts[fStep] = (stepCounts[fStep] || 0) + fCount;
                }
            }
        } catch (_fl_err) { /* live_daily read failure must not break the RPC */ }

        // Fallback: scan events (with gameId filter). Cold-start path —
        // only triggers when both the rollup and the legacy per-type
        // funnel collection were empty AND live_daily has no data yet.
        if (stepCounts[stepOrder[0]] === 0) {
            var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);

            for (var j = 0; j < events.length; j++) {
                var ev = events[j];
                var evName = (ev.eventName || '').toLowerCase().replace(/([A-Z])/g, '_$1').toLowerCase();

                for (var s = 0; s < stepOrder.length; s++) {
                    if (evName.indexOf(stepOrder[s]) !== -1 || evName === stepOrder[s]) {
                        stepCounts[stepOrder[s]]++;
                    }
                }
            }
        }

        // Build funnel steps with conversion metrics
        var steps = [];
        var totalFirst = stepCounts[stepOrder[0]] || 1;
        var worstDropOff = { step: '', drop_pct: 0 };

        for (var k = 0; k < stepOrder.length; k++) {
            var stepName = stepOrder[k];
            var count = stepCounts[stepName];
            var pctOfTotal = Math.round((count / totalFirst) * 100);
            var previousCount = k > 0 ? stepCounts[stepOrder[k - 1]] : count;
            var pctOfPrevious = previousCount > 0 ? Math.round((count / previousCount) * 100) : 100;
            var dropOffPct = 100 - pctOfPrevious;

            steps.push({
                name: stepName.replace(/_/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); }),
                count: count,
                pct_of_total: pctOfTotal,
                pct_of_previous: pctOfPrevious,
                drop_off_pct: dropOffPct
            });

            if (dropOffPct > worstDropOff.drop_pct && k > 0) {
                worstDropOff = { step: stepName, drop_pct: dropOffPct };
            }
        }

        return JSON.stringify({
            game_id: gameId || 'all',
            steps: steps,
            worst_drop_off: worstDropOff,
            _meta: {
                funnel_type: funnelType,
                read_path: rollupServedFunnel ? "rollup-preferred" :
                           (stepCounts[stepOrder[0]] > 0 ? "legacy-storage" : "live-scan"),
                rollup_hits: funnelRollupHits,
                generated_at: new Date().toISOString()
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] funnel error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_ai_features ───────────────────────────

function rpcAnalyticsAIFeatures(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var totalAIEvents = 0;
        var aiUserSet = {};
        var creditsConsumed = 0;
        var voiceAnswers = 0;
        var featureCounts = {};
        var featureUsers = {};

        // 2026-05 hardening — strict AI-event taxonomy.
        // The previous filter used substring match on "ai" which leaked any
        // event name containing the letters "ai" (e.g. login_failed → 'fail'
        // contains 'ai'; ad_failed; daily_*; player_*; etc). That's why the
        // AI tab was showing login_failed as a feature.
        //
        // The canonical AI-feature taxonomy is:
        //   • events whose name BEGINS with "ai_" (ai_assist, ai_voice_*,
        //     ai_trivia_*, ai_question_*)
        //   • events that BEGIN with "voice_" (voice_input, voice_answer)
        //   • events that BEGIN with "gemini_"
        //   • events that BEGIN with "trivia_ai_"
        //   • exact name "trivia_generated"
        var isAiEvent = function(name) {
            var n = (name || '').toLowerCase();
            if (!n) return false;
            if (n.indexOf('ai_') === 0) return true;
            if (n.indexOf('voice_') === 0) return true;
            if (n.indexOf('gemini_') === 0) return true;
            if (n.indexOf('trivia_ai_') === 0) return true;
            if (n === 'trivia_generated') return true;
            return false;
        };

        var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
            if (!isAiEvent(val.eventName)) return false;
            return extMatchesModeFilter(data, val);
        }, gameId);

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            totalAIEvents++;

            if (ev.userId) {
                aiUserSet[ev.userId] = true;
            }

            var evName = ev.eventName || 'ai_event';
            featureCounts[evName] = (featureCounts[evName] || 0) + 1;

            if (ev.userId) {
                if (!featureUsers[evName]) featureUsers[evName] = {};
                featureUsers[evName][ev.userId] = true;
            }

            if (ev.eventData) {
                creditsConsumed += ev.eventData.credits || ev.eventData.tokensUsed || 0;
                if (evName.indexOf('voice_') === 0 || evName.indexOf('ai_voice_') === 0) {
                    voiceAnswers++;
                }
            }
        }

        var totalAIUsers = Object.keys(aiUserSet).length;

        // Read DAU to calculate adoption % (game-specific if filtered)
        var dauKey = gameId ? 'dau_' + gameId + '_' + extDaysAgo(0) : 'dau_platform_' + extDaysAgo(0);
        var todayDau = extStorageRead(nk, 'analytics_dau', dauKey, SYSTEM_USER_ID);
        var totalActiveUsers = (todayDau && todayDau.count) ? todayDau.count : (todayDau && todayDau.uniqueUsers) ? todayDau.uniqueUsers : 100;
        var aiAdoptionPct = totalActiveUsers > 0 ? Math.round((totalAIUsers / totalActiveUsers) * 100) : 0;

        // Build features array
        var features = [];
        for (var feat in featureCounts) {
            features.push({
                feature: feat,
                events: featureCounts[feat],
                unique_users: featureUsers[feat] ? Object.keys(featureUsers[feat]).length : 0,
                adoption_pct: Math.round(((featureUsers[feat] ? Object.keys(featureUsers[feat]).length : 0) / Math.max(1, totalActiveUsers)) * 100)
            });
        }
        features.sort(function(a, b) { return b.events - a.events; });

        return JSON.stringify({
            game_id: gameId || 'all',
            total_ai_events: totalAIEvents,
            total_ai_users: totalAIUsers,
            ai_adoption_pct: aiAdoptionPct,
            credits_consumed: creditsConsumed,
            voice_answers: voiceAnswers,
            users_sampled: totalActiveUsers,
            features: features.slice(0, 15)
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] ai_features error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_feature_adoption ──────────────────────

function rpcAnalyticsFeatureAdoption(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        // Define features to track
        var featureDefs = [
            { name: 'Daily Quiz', collection: 'daily_quiz', eventName: 'daily_quiz' },
            { name: 'Multiplayer', collection: 'multiplayer', eventName: 'multiplayer' },
            { name: 'Leaderboard', collection: 'leaderboard', eventName: 'leaderboard' },
            { name: 'Profile Customization', collection: 'profiles', eventName: 'profile' },
            { name: 'Achievements', collection: 'achievements', eventName: 'achievement' },
            { name: 'Friend Quests', collection: 'friend_quests', eventName: 'friend_quest' },
            { name: 'Store', collection: 'store', eventName: 'store' },
            { name: 'Voice Answers', collection: 'voice', eventName: 'voice' },
            { name: 'AI Trivia', collection: 'ai_trivia', eventName: 'ai_trivia' },
            { name: 'Streaks', collection: 'streaks', eventName: 'streak' }
        ];

        // Get total active users (game-specific if filtered)
        var dauKey = gameId ? 'dau_' + gameId + '_' + extDaysAgo(0) : 'dau_platform_' + extDaysAgo(0);
        var todayDau = extStorageRead(nk, 'analytics_dau', dauKey, SYSTEM_USER_ID);
        var totalActiveUsers = (todayDau && todayDau.count) ? todayDau.count : 100;

        var features = [];
        var lowAdoptionFeatures = [];

        // Scan events for feature usage (with gameId filter)
        var allEvents = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);
        var featureUserSets = {};

        for (var i = 0; i < allEvents.length; i++) {
            var ev = allEvents[i];
            var evName = (ev.eventName || '').toLowerCase();

            for (var j = 0; j < featureDefs.length; j++) {
                var feat = featureDefs[j];
                if (evName.indexOf(feat.eventName) !== -1) {
                    if (!featureUserSets[feat.name]) featureUserSets[feat.name] = {};
                    if (ev.userId) featureUserSets[feat.name][ev.userId] = true;
                }
            }
        }

        // Build features array
        for (var k = 0; k < featureDefs.length; k++) {
            var f = featureDefs[k];
            var userCount = featureUserSets[f.name] ? Object.keys(featureUserSets[f.name]).length : 0;
            var adoptionPct = Math.round((userCount / Math.max(1, totalActiveUsers)) * 100);

            features.push({
                name: f.name,
                users_count: userCount,
                adoption_pct: adoptionPct,
                collection: f.collection
            });

            if (adoptionPct < 20 && userCount > 0) {
                lowAdoptionFeatures.push('Boost ' + f.name + ' engagement (' + adoptionPct + '% adoption)');
            }
        }

        features.sort(function(a, b) { return b.adoption_pct - a.adoption_pct; });

        return JSON.stringify({
            game_id: gameId || 'all',
            features: features,
            recommendations: lowAdoptionFeatures.slice(0, 5)
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] feature_adoption error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_economy_health ────────────────────────

function rpcAnalyticsEconomyHealth(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var sampleSize = parseInt(data.sample_size, 10) || 100;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var coinBalances = [];
        var sourcesTotal = 0;
        var sinksTotal = 0;
        var whaleCount = 0;
        var whaleThreshold = 10000; // coins

        // 2026-05 — QuizVerse uses a single-currency economy (coins only).
        // Gems were removed by product. We no longer expose total_gems on
        // this endpoint; the dashboard hides the Gems KPI accordingly.

        var economyKey = gameId ? 'economy_stats_' + gameId : 'economy_stats';
        var economyStats = extStorageRead(nk, 'analytics_economy', economyKey, SYSTEM_USER_ID);

        if (economyStats) {
            coinBalances = economyStats.coinBalances || [];
            sourcesTotal = economyStats.sources || 0;
            sinksTotal = economyStats.sinks || 0;
        }

        // Fallback: scan wallet/purchase events (with gameId filter).
        // Strict prefix-match — substring 'coin' previously matched too many
        // events (and 'gem' was scanned even though we don't surface gems).
        //
        // 2026-05 schema fix: the previous version looked for `evData.coins`
        // or `evData.amount`+`currency='coins'` — neither key is emitted by
        // the Unity client. EconomyAnalytics.TrackCoinsEarned writes
        // `coins_earned: N` and TrackCoinsSpent writes `coins_spent: N`
        // (both positive numbers). We now read those keys directly and use
        // the event NAME to decide source vs sink (sign of the value is no
        // longer reliable). `balance_after` is also collected as the true
        // post-transaction balance sample for the Gini distribution — much
        // more accurate than summing absolute deltas, which double-counts.
        if (coinBalances.length === 0) {
            var walletEvents = extScanEvents(nk, logger, 'analytics_events', 30, function(val) {
                var evName = (val.eventName || '').toLowerCase();
                if (!evName) return false;
                var match = evName.indexOf('coin') === 0 ||
                       evName.indexOf('wallet_') === 0 ||
                       evName === 'purchase_completed' ||
                       evName === 'currency_granted' ||
                       evName === 'currency_spent' ||
                       evName === 'balance_snapshot' ||
                       evName === 'insufficient_coins' ||
                       evName === 'insufficient_funds_action';
                if (!match) return false;
                return extMatchesModeFilter(data, val);
            }, gameId);

            for (var i = 0; i < walletEvents.length; i++) {
                var ev = walletEvents[i];
                var evData = ev.eventData || {};
                var evName = (ev.eventName || '').toLowerCase();

                // Read amount from any of the canonical property keys that
                // QuizVerse actually emits. Order matters: prefer the
                // explicit earned/spent keys, then generic `coins`, then
                // `amount` with a coins currency tag.
                var amount = null;
                if (evData.coins_earned !== undefined && isFinite(evData.coins_earned)) {
                    amount = Math.abs(evData.coins_earned);
                } else if (evData.coins_spent !== undefined && isFinite(evData.coins_spent)) {
                    amount = Math.abs(evData.coins_spent);
                } else if (evData.coins !== undefined && isFinite(evData.coins)) {
                    amount = Math.abs(evData.coins);
                } else if (evData.amount !== undefined && isFinite(evData.amount) &&
                           (evData.currency === 'coins' || evData.currency_type === 'coins')) {
                    amount = Math.abs(evData.amount);
                }

                if (amount !== null && amount !== undefined && isFinite(amount) && amount > 0) {
                    // Classify by event name — `coins_spent` / `*_spent`
                    // events always represent a sink even though the amount
                    // is positive in the payload.
                    var isSink = (evName.indexOf('coins_spent') !== -1) ||
                                 (evName.indexOf('currency_spent') !== -1) ||
                                 (evName === 'wallet_spent') ||
                                 (evName === 'insufficient_coins') ||
                                 (evName === 'insufficient_funds_action');
                    if (isSink) sinksTotal += amount;
                    else        sourcesTotal += amount;
                }

                // Collect `balance_after` snapshots as the balance
                // distribution sample. This is the player's wallet balance
                // post-transaction — the right denominator for Gini /
                // whales / median, far more accurate than per-event deltas.
                var balance = null;
                if (evData.balance_after !== undefined && isFinite(evData.balance_after)) {
                    balance = evData.balance_after;
                } else if (evData.balance_current !== undefined && isFinite(evData.balance_current)) {
                    balance = evData.balance_current;
                } else if (evData.current_balance !== undefined && isFinite(evData.current_balance)) {
                    balance = evData.current_balance;
                }
                if (balance !== null && balance !== undefined && balance >= 0) {
                    coinBalances.push(balance);
                }
            }

            // Fallback: if no balance_after snapshots were emitted (older
            // clients), seed the distribution sample from the absolute
            // deltas so Gini / avg / median still return a non-zero value
            // instead of 0 across the board. This matches the legacy
            // behaviour pre-2026-05.
            if (coinBalances.length === 0 && (sourcesTotal > 0 || sinksTotal > 0)) {
                for (var bi = 0; bi < walletEvents.length; bi++) {
                    var bev = walletEvents[bi].eventData || {};
                    var bAmt = (bev.coins_earned !== undefined) ? bev.coins_earned
                             : (bev.coins_spent  !== undefined) ? bev.coins_spent
                             : (bev.coins        !== undefined) ? bev.coins
                             : (bev.amount       !== undefined) ? bev.amount
                             : null;
                    if (bAmt !== null && isFinite(bAmt) && bAmt > 0) {
                        coinBalances.push(Math.abs(bAmt));
                    }
                }
            }
        }

        // Calculate metrics
        var totalCoins = coinBalances.reduce(function(a, b) { return a + b; }, 0);
        var avgCoins = coinBalances.length > 0 ? Math.round(totalCoins / coinBalances.length) : 0;
        var medianCoins = Math.round(extMedian(coinBalances));

        // Count whales
        for (var j = 0; j < coinBalances.length; j++) {
            if (coinBalances[j] > whaleThreshold) whaleCount++;
        }

        // Calculate Gini coefficient (inequality measure)
        var gini = 0;
        if (coinBalances.length > 1) {
            var sorted = coinBalances.slice().sort(function(a, b) { return a - b; });
            var n = sorted.length;
            var sumOfDiffs = 0;
            var sumOfBalances = totalCoins;

            for (var k = 0; k < n; k++) {
                sumOfDiffs += (2 * (k + 1) - n - 1) * sorted[k];
            }

            gini = sumOfBalances > 0 ? Math.round((sumOfDiffs / (n * sumOfBalances)) * 100) / 100 : 0;
        }

        var sourceSinkRatio = sinksTotal > 0 ? Math.round((sourcesTotal / sinksTotal) * 100) / 100 : 0;

        return JSON.stringify({
            game_id: gameId || 'all',
            gini_coefficient: gini,
            total_coins: totalCoins,
            avg_coins: avgCoins,
            median_coins: medianCoins,
            whale_count: whaleCount,
            sample_size: coinBalances.length,
            source_sink_ratio: {
                ratio: sourceSinkRatio,
                sources_total: sourcesTotal,
                sinks_total: sinksTotal
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] economy_health error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_monetization_detail ───────────────────

function rpcAnalyticsMonetizationDetail(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var adImpressions = 0;
        var adCompleted = 0;
        var adRevenue = 0;
        var iapCompleted = 0;
        var paywallShown = 0;
        var paywallConverted = 0;
        var storeOpens = 0;
        var adTypeCounts = {};
        var dailyAdRevenue = [];
        var productPurchases = {};
        // 2026-04 hardening — full ad funnel signals emitted by Unity
        // (MonetizationAnalytics + AdsAnalyticsBridge). These power the
        // world-class Monetization tab (request → impression → completion,
        // per-network ILRD revenue, eCPM, true fill rate).
        var adRequests = 0;
        var adLoadFailures = 0;
        var adSkips = 0;
        var adClicks = 0;
        var adRevenueByNetwork = {};

        // Phase 4 (2026-05) — read analytics_rollup_daily first. The Phase 4
        // rollup compute writes every monetization KPI we need (revenue,
        // IAP funnel, paywall, store opens, top products, ad types, full
        // ad funnel + per-network revenue). One single doc per game per
        // day, vs the legacy live-scan path that re-walked thousands of
        // events on every dashboard load. We still fall back to the live
        // scan for cold-start days (no rollup yet).
        var rollupRange = extReadRollupRange(nk, gameId, days);
        var rollupServed = extRollupHasAny(rollupRange);
        var readPath = rollupServed ? "rollup-preferred" : "live-scan";
        var rollupHits = 0;
        var liveFallbacks = 0;

        if (rollupServed) {
            for (var ri = 0; ri < rollupRange.length; ri++) {
                var entry = rollupRange[ri];
                var dayRev = 0;
                if (entry.doc && entry.doc.revenue) {
                    var rv = entry.doc.revenue;
                    adImpressions    += rv.ad_impressions || 0;
                    adCompleted      += rv.ad_completions || 0;
                    adRevenue        += rv.ad_revenue_usd || 0;
                    adRequests       += rv.ad_requests || 0;
                    adLoadFailures   += rv.ad_load_failures || 0;
                    adSkips          += rv.ad_skips || 0;
                    adClicks         += rv.ad_clicks || 0;
                    iapCompleted     += rv.iap_count || 0;
                    paywallShown     += rv.paywall_shown || 0;
                    paywallConverted += rv.paywall_converted || 0;
                    storeOpens       += rv.store_opens || 0;
                    dayRev            = rv.ad_revenue_usd || 0;
                    if (rv.ad_revenue_by_network) {
                        for (var nn in rv.ad_revenue_by_network) {
                            if (rv.ad_revenue_by_network.hasOwnProperty(nn)) {
                                adRevenueByNetwork[nn] = (adRevenueByNetwork[nn] || 0) + rv.ad_revenue_by_network[nn];
                            }
                        }
                    }
                    if (rv.top_products) {
                        for (var pi = 0; pi < rv.top_products.length; pi++) {
                            var pp = rv.top_products[pi];
                            productPurchases[pp.product_id] = (productPurchases[pp.product_id] || 0) + pp.purchases;
                        }
                    }
                    if (rv.ad_types) {
                        for (var ti = 0; ti < rv.ad_types.length; ti++) {
                            var tt = rv.ad_types[ti];
                            adTypeCounts[tt.type] = (adTypeCounts[tt.type] || 0) + tt.count;
                        }
                    }
                    rollupHits++;
                } else {
                    liveFallbacks++;  // missing day in the range
                }
                dailyAdRevenue.unshift({ date: entry.date, revenue: dayRev });
            }
        }

        // Fallback: scan events (with gameId filter). Triggers when NO day
        // in the range had a rollup doc (cold-start project) or when the
        // operator forces it via DASHBOARD_PREFER_ROLLUPS=false. Partial
        // ranges (some days missing) are intentionally NOT live-scanned
        // here — running an event scan per missing day defeats the whole
        // point of the rollup. Operators with stale ranges can re-run
        // analytics_rollup_backfill to fill the gaps cheaply.
        if (!rollupServed && adImpressions === 0) {
            readPath = "live-scan";
            // Reset dailyAdRevenue (rollup loop above may have pushed
            // empty {date, revenue:0} entries that we don't want when
            // we're going to scan events anyway).
            dailyAdRevenue = [];
            var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
                var evName = (val.eventName || '').toLowerCase();
                var match = evName.indexOf('ad') !== -1 || evName.indexOf('purchase') !== -1 ||
                       evName.indexOf('iap') !== -1 || evName.indexOf('store') !== -1 ||
                       evName.indexOf('paywall') !== -1;
                if (!match) return false;
                return extMatchesModeFilter(data, val);
            }, gameId);

            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                var evName = (ev.eventName || '').toLowerCase();
                var evData = ev.eventData || {};

                // ── Ads (2026-04 hardened taxonomy) ──
                // Count canonical `ad_shown` AND legacy `ad_impression` as
                // impressions. The new Unity client emits `ad_shown` from
                // MonetizationAnalytics.TrackAdShown / AdsAnalyticsBridge.
                // Use exact-match prefix tests (=== or strict prefix) to
                // avoid false-positives like "ad_revenue" matching "ad_".
                if (evName === 'ad_impression' || evName === 'ad_shown' ||
                    evName === 'adimpression' || evName === 'adshown') {
                    adImpressions++;
                }
                // 2026-05 hardening — only count exact completion-event names.
                // The previous filter included `evName.indexOf('rewarded') !== -1`
                // which caused double-counting whenever Unity emitted both
                // `ad_completed` AND a `rewarded_*` event for the same ad
                // (e.g. ad_shown=11, ad_completed=22 → 200% completion rate).
                if (evName === 'ad_completed' || evName === 'adcompleted' ||
                    evName === 'rewarded_completed' || evName === 'rewardedcompleted' ||
                    evName === 'ad_rewarded_completed') {
                    adCompleted++;
                }

                // ── Ad revenue ──
                // Three sources, in priority order:
                //   1. dedicated `ad_revenue` event with `revenue_usd` (canonical)
                //   2. `revenue_usd` on the impression event (some adapters)
                //   3. legacy `revenue` field (kept for back-compat)
                var addedRev = 0;
                if (evName === 'ad_revenue') {
                    var revDed = parseFloat(evData.revenue_usd || evData.revenue || 0);
                    if (isFinite(revDed) && revDed > 0) { adRevenue += revDed; addedRev = revDed; }
                } else if (evName === 'ad_impression' || evName === 'ad_shown') {
                    var revInline = parseFloat(evData.revenue_usd || 0);
                    if (isFinite(revInline) && revInline > 0) { adRevenue += revInline; addedRev = revInline; }
                } else if (evData.revenue) {
                    var revLegacy = parseFloat(evData.revenue) || 0;
                    if (revLegacy > 0) { adRevenue += revLegacy; addedRev = revLegacy; }
                }
                if (addedRev > 0) {
                    var net = evData.ad_network || evData.adNetwork || 'unknown';
                    adRevenueByNetwork[net] = (adRevenueByNetwork[net] || 0) + addedRev;
                }

                // ── Full ad funnel (2026-04 hardened taxonomy) ──
                // Powers Monetization tab's request → impression → completion
                // funnel + true fill-rate (impressions/requests, not the legacy
                // completed/impressions misnomer).
                if (evName === 'ad_requested') adRequests++;
                if (evName === 'ad_load_failed' || evName === 'ad_failed') adLoadFailures++;
                if (evName === 'ad_skipped') adSkips++;
                if (evName === 'ad_clicked') adClicks++;

                // ── IAP / paywall / store ──
                if (evName.indexOf('iap') !== -1 || evName === 'purchase_completed') iapCompleted++;
                if (evName === 'paywall_shown' || evName === 'paywallshown') paywallShown++;
                if (evName === 'paywall_converted') paywallConverted++;
                if (evName === 'store_opened' || evName === 'storeopened' || evName === 'store_open') storeOpens++;

                // Ad-type breakdown — accept both legacy `adType` and the new
                // canonical `ad_type` field name from AnalyticsParams.AD_TYPE.
                var adType = evData.adType || evData.ad_type || null;
                if (adType) adTypeCounts[adType] = (adTypeCounts[adType] || 0) + 1;

                // Product breakdown — accept both `productId` and canonical
                // `product_id` from AnalyticsParams.PRODUCT_ID.
                var prodId = evData.productId || evData.product_id || null;
                if (prodId) productPurchases[prodId] = (productPurchases[prodId] || 0) + 1;
            }
        }

        // ── Computed funnel rates ─────────────────────────────────
        // True fill-rate = impressions / requests (only meaningful when we
        // saw at least one ad_requested event). Falls back to the legacy
        // completed/impressions ratio so existing dashboards keep working
        // during the migration window.
        // 2026-05 hardening — cap rates at 100%. A completion or fill rate
        // greater than 100 is mathematically impossible and almost always
        // indicates either double-counting or a missing upstream event.
        // We clamp on the server so the dashboard never has to second-guess.
        var clampPct = function(v) {
            v = Math.round(v);
            if (!isFinite(v) || v < 0) return 0;
            if (v > 100) return 100;
            return v;
        };
        var adFillRate = adRequests > 0
            ? clampPct((adImpressions / adRequests) * 100)
            : (adImpressions > 0 ? clampPct((adCompleted / adImpressions) * 100) : 0);
        var adCompletionRate = adImpressions > 0
            ? clampPct((adCompleted / adImpressions) * 100)
            : 0;
        // eCPM = revenue per 1000 impressions, in USD, two-decimal.
        var adECPM = adImpressions > 0
            ? Math.round((adRevenue / adImpressions) * 100000) / 100
            : 0;
        // Build per-network breakdown array (sorted desc by revenue).
        var adRevenueNetworkArr = [];
        for (var nk2 in adRevenueByNetwork) {
            adRevenueNetworkArr.push({
                network: nk2,
                revenue_usd: Math.round(adRevenueByNetwork[nk2] * 100) / 100
            });
        }
        adRevenueNetworkArr.sort(function(a, b) { return b.revenue_usd - a.revenue_usd; });

        var paywallConversionRate = paywallShown > 0 ? clampPct((paywallConverted / paywallShown) * 100) : 0;

        return JSON.stringify({
            game_id: gameId || 'all',
            ad_impressions: adImpressions,
            ad_completed: adCompleted,
            ad_fill_rate_pct: adFillRate,
            ad_revenue_total: Math.round(adRevenue * 100) / 100,
            iap_completed: iapCompleted,
            paywall_shown: paywallShown,
            paywall_conversion_rate_pct: paywallConversionRate,
            store_opens: storeOpens,
            ad_types: extTopN(adTypeCounts, 5, 'type', 'count'),
            daily_ad_revenue: dailyAdRevenue,
            top_products: extTopN(productPurchases, 10, 'product_id', 'purchases'),
            // ── New hardened ad-funnel KPIs ────────────────────────
            ad_requests: adRequests,
            ad_load_failures: adLoadFailures,
            ad_skips: adSkips,
            ad_clicks: adClicks,
            ad_completion_rate_pct: adCompletionRate,
            ad_ecpm_usd: adECPM,
            ad_revenue_by_network: adRevenueNetworkArr,
            _meta: {
                read_path: readPath,
                rollup_hits: rollupHits,
                live_fallbacks: liveFallbacks,
                generated_at: new Date().toISOString()
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] monetization_detail error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_platform_breakdown ────────────────────

function rpcAnalyticsPlatformBreakdown(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var platformCounts = {};
        var platformUsers = {};
        var osVersionCounts = {};
        var deviceCounts = {};

        // Scan events for platform data (with gameId filter)
        var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var evData = ev.eventData || {};

            var platform = evData.platform || ev.platform || 'unknown';
            platformCounts[platform] = (platformCounts[platform] || 0) + 1;

            if (ev.userId) {
                if (!platformUsers[platform]) platformUsers[platform] = {};
                platformUsers[platform][ev.userId] = true;
            }

            if (evData.osVersion) {
                osVersionCounts[evData.osVersion] = (osVersionCounts[evData.osVersion] || 0) + 1;
            }

            if (evData.deviceModel) {
                deviceCounts[evData.deviceModel] = (deviceCounts[evData.deviceModel] || 0) + 1;
            }
        }

        // Today's live patch — analytics_live_daily.by_platform is updated on every
        // event ingest, giving us real-time platform counts without waiting for
        // the nightly rollup or relying on the scan reaching today's events.
        try {
            var pTodayStr = extDaysAgo(0);
            var pLiveDailyKey = "live_" + (gameId || "all") + "_" + pTodayStr;
            var pLiveRecs = nk.storageRead([{ collection: "analytics_live_daily", key: pLiveDailyKey, userId: SYSTEM_USER_ID }]);
            if (pLiveRecs && pLiveRecs.length > 0 && pLiveRecs[0].value) {
                var pbpMap = pLiveRecs[0].value.by_platform || {};
                for (var pbpk in pbpMap) {
                    if (!pbpMap.hasOwnProperty(pbpk)) continue;
                    platformCounts[pbpk] = (platformCounts[pbpk] || 0) + pbpMap[pbpk];
                }
            }
        } catch (_pp_err) { /* live_daily read failure must not break the RPC */ }

        // Augment with the per-platform daily counter that ingestion writes
        // via trackPlatform() in analytics.js. The previous implementation
        // here read `dau_<platform>_<date>` keys that ingestion never writes
        // (it writes `dau_<gameId>_<date>` and `dau_platform_<date>`), so the
        // DAU loop never added anything. Now we read the canonical
        // `analytics_platform` collection with keys
        // `platform_<gameId>_<date>_<platform>`.
        for (var d = 0; d < Math.min(days, 7); d++) {
            var dateStr = extDaysAgo(d);
            var platforms = ['android', 'ios', 'webgl', 'editor', 'unknown'];

            for (var p = 0; p < platforms.length; p++) {
                if (gameId) {
                    var pkey = 'platform_' + gameId + '_' + dateStr + '_' + platforms[p];
                    var pRec = extStorageRead(nk, 'analytics_platform', pkey, SYSTEM_USER_ID);
                    if (pRec && pRec.count) {
                        platformCounts[platforms[p]] = (platformCounts[platforms[p]] || 0) + pRec.count;
                    }
                }
                // When gameId is null ("all games") we already have the
                // accurate per-event tally from the scan above; the per-game
                // counter scan is too expensive without the gameId prefix.
            }
        }

        // Build platforms array
        var platforms_arr = [];
        for (var plat in platformCounts) {
            platforms_arr.push({
                platform: plat,
                events: platformCounts[plat],
                unique_users: platformUsers[plat] ? Object.keys(platformUsers[plat]).length : 0
            });
        }
        platforms_arr.sort(function(a, b) { return b.events - a.events; });

        return JSON.stringify({
            game_id: gameId || 'all',
            platforms: platforms_arr,
            os_versions: extTopN(osVersionCounts, 10, 'version', 'count'),
            top_devices: extTopN(deviceCounts, 10, 'model', 'count')
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] platform_breakdown error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_home_heatmap ──────────────────────────

function rpcAnalyticsHomeHeatmap(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var buttonClicks = {};
        var screenViews = {};
        var screenTime = {};
        var screenTimeCounts = {};
        var popupShown = {};

        // Scan UI-related events (with gameId filter)
        var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
            var evName = (val.eventName || '').toLowerCase();
            return evName.indexOf('click') !== -1 || evName.indexOf('view') !== -1 ||
                   evName.indexOf('screen') !== -1 || evName.indexOf('popup') !== -1 ||
                   evName.indexOf('button') !== -1 || evName.indexOf('tap') !== -1;
        }, gameId);

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var evName = ev.eventName || '';
            var evData = ev.eventData || {};

            // Button clicks
            if (evName.toLowerCase().indexOf('click') !== -1 || evName.toLowerCase().indexOf('tap') !== -1) {
                var button = evData.button || evData.buttonName || evName;
                buttonClicks[button] = (buttonClicks[button] || 0) + 1;
            }

            // Screen views
            if (evName.toLowerCase().indexOf('screen') !== -1 || evName.toLowerCase().indexOf('view') !== -1) {
                var screen = evData.screen || evData.screenName || evName;
                screenViews[screen] = (screenViews[screen] || 0) + 1;

                if (evData.duration || evData.timeSpent) {
                    if (!screenTime[screen]) screenTime[screen] = 0;
                    if (!screenTimeCounts[screen]) screenTimeCounts[screen] = 0;
                    screenTime[screen] += evData.duration || evData.timeSpent || 0;
                    screenTimeCounts[screen]++;
                }
            }

            // Popups
            if (evName.toLowerCase().indexOf('popup') !== -1 || evName.toLowerCase().indexOf('modal') !== -1) {
                var popup = evData.popup || evData.popupName || evName;
                popupShown[popup] = (popupShown[popup] || 0) + 1;
            }
        }

        // Calculate average screen time
        var screenTimeAvg = [];
        for (var s in screenTime) {
            screenTimeAvg.push({
                screen: s,
                avg_seconds: screenTimeCounts[s] > 0 ? Math.round(screenTime[s] / screenTimeCounts[s]) : 0
            });
        }
        screenTimeAvg.sort(function(a, b) { return b.avg_seconds - a.avg_seconds; });

        return JSON.stringify({
            game_id: gameId || 'all',
            buttons: extTopN(buttonClicks, 15, 'button', 'count'),
            top_screens: extTopN(screenViews, 10, 'screen', 'views'),
            screen_time: screenTimeAvg.slice(0, 10),
            top_popups: extTopN(popupShown, 10, 'popup', 'shown')
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] home_heatmap error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_top_players ───────────────────────────

function rpcAnalyticsTopPlayers(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var limit = parseInt(data.limit, 10) || 50;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Filter by specific game — alias slugs to canonical UUIDs

        var playerStats = {};

        // Scan events and aggregate by user (with optional game filter) - use extScanEvents with gameId
        var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var userId = ev.userId;
            if (!userId) continue;

            if (!playerStats[userId]) {
                playerStats[userId] = {
                    user_id: userId,
                    display_name: '',
                    total_events: 0,
                    quiz_completed: 0,
                    daily_quizzes: 0,
                    ai_events: 0,
                    sessions: 0,
                    purchases: 0,
                    total_score: 0,
                    last_active: ev.timestamp || '',
                    game_id: ev.gameId || gameId || 'all'
                };
            }

            var ps = playerStats[userId];
            ps.total_events++;

            var evName = (ev.eventName || '').toLowerCase();
            var evData = ev.eventData || {};

            if (evName.indexOf('quiz_completed') !== -1 || evName.indexOf('quizcompleted') !== -1) {
                ps.quiz_completed++;
                ps.total_score += evData.score || 0;
            }
            if (evName.indexOf('daily') !== -1) {
                ps.daily_quizzes++;
            }
            if (evName.indexOf('ai') !== -1 || evName.indexOf('voice') !== -1) {
                ps.ai_events++;
            }
            if (evName.indexOf('session') !== -1) {
                ps.sessions++;
            }
            if (evName.indexOf('purchase') !== -1 || evName.indexOf('iap') !== -1) {
                ps.purchases++;
            }

            if (ev.timestamp && ev.timestamp > ps.last_active) {
                ps.last_active = ev.timestamp;
            }
        }

        // Try to fetch display names for top players
        var userIds = Object.keys(playerStats).slice(0, limit);
        if (userIds.length > 0) {
            try {
                var users = nk.usersGetId(userIds);
                if (users) {
                    for (var u = 0; u < users.length; u++) {
                        var user = users[u];
                        if (playerStats[user.userId]) {
                            playerStats[user.userId].display_name = user.displayName || user.username || '';
                        }
                    }
                }
            } catch (e) {
                logger.warn('[AnalyticsExtended] Could not fetch user names: ' + e.message);
            }
        }

        // Convert to array and sort by total events
        var players = [];
        for (var uid in playerStats) {
            players.push(playerStats[uid]);
        }
        players.sort(function(a, b) { return b.total_events - a.total_events; });
        players = players.slice(0, limit);

        // Get DAU for total active users count (game-specific if filtered)
        var dauKey = gameId ? 'dau_' + gameId + '_' + extDaysAgo(0) : 'dau_platform_' + extDaysAgo(0);
        var todayDau = extStorageRead(nk, 'analytics_dau', dauKey, SYSTEM_USER_ID);
        var totalActiveUsers = (todayDau && todayDau.count) ? todayDau.count : Object.keys(playerStats).length;

        return JSON.stringify({
            total_active_users: totalActiveUsers,
            users_sampled: Object.keys(playerStats).length,
            days: days,
            game_id: gameId || 'all',
            players: players
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] top_players error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_error_log ─────────────────────────────

function rpcAnalyticsErrorLog(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var totalErrors = 0;
        var errorsByRpc = {};
        // 2026-04 hardening: dedicated category bucket so the dashboard can
        // render the Unity client's canonical error event taxonomy
        // (api_failure / auth_failure / nakama_rpc_error / timeout_event / crash_safe_log)
        // without losing data inside the rpc-name aggregation.
        var errorsByCategory = {};

        // Scan error events (with gameId filter).
        // 2026-04: explicitly enumerate the new canonical event names AND keep
        // the legacy substring matches (error/crash/exception/fail) so older
        // events are still counted. `timeout` is added to the substring list
        // so timeout_event from QVAnalyticsService finally shows up.
        var canonicalErrorEvents = {
            'error_logged': 1, 'api_failure': 1, 'auth_failure': 1,
            'nakama_rpc_error': 1, 'timeout_event': 1, 'crash_safe_log': 1
        };
        var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
            var evName = (val.eventName || '').toLowerCase();
            if (canonicalErrorEvents[evName]) return true;
            return evName.indexOf('error') !== -1 || evName.indexOf('crash') !== -1 ||
                   evName.indexOf('exception') !== -1 || evName.indexOf('fail') !== -1 ||
                   evName.indexOf('timeout') !== -1;
        }, gameId);

        // 2026-04 hardening — when none of rpcName / function / eventName are
        // populated, prod was bucketing 100s of errors into a single "unknown"
        // row that gave operators no actionable signal. We now widen the
        // fallback chain (api / endpoint / url / source / category / Unity
        // exception type) AND capture a small redacted sample of each
        // mystery event so the dashboard can render a "why is this unknown?"
        // hint that points at the real upstream gap (typically: client
        // logger forgot to stamp rpcName).
        function deriveBucketName(ed, ev) {
            if (!ed) ed = {};
            return ed.rpcName || ed.rpc || ed.function || ed.endpoint ||
                   ed.api || ed.url || ed.source || ed.error_category ||
                   ed.exceptionType || ed.errorType ||
                   ev.eventName || 'unknown';
        }
        function captureSample(bucket, ev, ed) {
            if (!bucket.samples) bucket.samples = [];
            if (bucket.samples.length >= 3) return;
            bucket.samples.push({
                eventName: ev.eventName || null,
                keys: ed ? Object.keys(ed).slice(0, 12) : [],
                userId: ev.userId ? String(ev.userId).slice(0, 8) + '…' : null,
                gameId: ev.gameId || null,
                ts: ev.timestamp || null
            });
        }

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            totalErrors++;

            var ed = ev.eventData || {};
            var rpcName = deriveBucketName(ed, ev);

            if (!errorsByRpc[rpcName]) {
                errorsByRpc[rpcName] = {
                    rpc_name: rpcName,
                    count: 0,
                    last_occurred: '',
                    sample_error: '',
                    samples: []
                };
            }

            errorsByRpc[rpcName].count++;

            if (ev.timestamp && ev.timestamp > errorsByRpc[rpcName].last_occurred) {
                errorsByRpc[rpcName].last_occurred = ev.timestamp;
            }

            if (!errorsByRpc[rpcName].sample_error && ed.error) {
                errorsByRpc[rpcName].sample_error = String(ed.error).substring(0, 200);
            } else if (!errorsByRpc[rpcName].sample_error && ed.message) {
                errorsByRpc[rpcName].sample_error = String(ed.message).substring(0, 200);
            }

            // Always capture sample shape for the unknown bucket so the
            // dashboard can render a "fix this upstream" diagnostic.
            if (rpcName === 'unknown') captureSample(errorsByRpc[rpcName], ev, ed);

            // Category bucket — prefer explicit error_category field, fall back
            // to the canonical event name (which IS the category for the new
            // dedicated event types), then to "uncategorized".
            var evNameLow = (ev.eventName || '').toLowerCase();
            var cat = (ev.eventData && ev.eventData.error_category) ? ev.eventData.error_category :
                      (canonicalErrorEvents[evNameLow] && evNameLow !== 'error_logged') ? evNameLow :
                      'uncategorized';
            errorsByCategory[cat] = (errorsByCategory[cat] || 0) + 1;
        }

        // Also check error logs storage
        var errorLogs = extStorageList(nk, 'error_logs', SYSTEM_USER_ID, 100);

        for (var j = 0; j < errorLogs.length; j++) {
            var errObj = errorLogs[j];
            var errVal = errObj.value || {};

            totalErrors++;
            // Same widened fallback chain as the event path. Storage key is
            // last because it's typically a non-actionable opaque ID.
            var errRpc = errVal.rpc || errVal.function || errVal.endpoint ||
                         errVal.api || errVal.url || errVal.source ||
                         errVal.error_category || errVal.exceptionType ||
                         errVal.errorType || errObj.key || 'unknown';

            if (!errorsByRpc[errRpc]) {
                errorsByRpc[errRpc] = {
                    rpc_name: errRpc,
                    count: 0,
                    last_occurred: '',
                    sample_error: '',
                    samples: []
                };
            }

            errorsByRpc[errRpc].count++;

            if (errVal.timestamp && errVal.timestamp > errorsByRpc[errRpc].last_occurred) {
                errorsByRpc[errRpc].last_occurred = errVal.timestamp;
            }

            if (!errorsByRpc[errRpc].sample_error && errVal.message) {
                errorsByRpc[errRpc].sample_error = String(errVal.message).substring(0, 200);
            } else if (!errorsByRpc[errRpc].sample_error && errVal.error) {
                errorsByRpc[errRpc].sample_error = String(errVal.error).substring(0, 200);
            }

            if (errRpc === 'unknown') {
                if (!errorsByRpc[errRpc].samples) errorsByRpc[errRpc].samples = [];
                if (errorsByRpc[errRpc].samples.length < 3) {
                    errorsByRpc[errRpc].samples.push({
                        storage_key: errObj.key || null,
                        keys: Object.keys(errVal).slice(0, 12),
                        ts: errVal.timestamp || null
                    });
                }
            }
        }

        // Convert to array and find most failing
        var errorsList = [];
        var mostFailing = { name: 'none', count: 0 };

        for (var rpc in errorsByRpc) {
            var errInfo = errorsByRpc[rpc];
            errorsList.push(errInfo);

            if (errInfo.count > mostFailing.count) {
                mostFailing = { name: rpc, count: errInfo.count };
            }
        }

        errorsList.sort(function(a, b) { return b.count - a.count; });

        // Build category breakdown array (sorted desc) for the dashboard.
        var errorsByCategoryArr = [];
        for (var cName in errorsByCategory) {
            errorsByCategoryArr.push({ category: cName, count: errorsByCategory[cName] });
        }
        errorsByCategoryArr.sort(function(a, b) { return b.count - a.count; });

        return JSON.stringify({
            game_id: gameId || 'all',
            total_errors: totalErrors,
            most_failing_rpc: mostFailing,
            errors_by_rpc: errorsList.slice(0, 20),
            errors_by_category: errorsByCategoryArr
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] error_log error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_player_segments (Phase 4) ─────────────

/**
 * Segment players into categories: whale, power_user, casual, at_risk, churned, new_user
 * Uses player_analytics_profile collection from Phase 2.
 *
 * Segment Definitions:
 * - whale: totalSpent > $100
 * - power_user: 10+ sessions in last 7 days AND 5+ day login streak
 * - casual: active but not power_user
 * - at_risk: 7-14 days inactive
 * - churned: 14+ days inactive
 * - new_user: first seen within 7 days
 */
function rpcAnalyticsPlayerSegments(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        // Thresholds (configurable)
        var WHALE_THRESHOLD = 100; // $100 total spent
        var POWER_USER_SESSIONS = 10; // 10+ sessions in 7 days
        var POWER_USER_STREAK = 5; // 5+ day streak
        var AT_RISK_DAYS = 7;
        var CHURNED_DAYS = 14;
        var NEW_USER_DAYS = 7;

        var now = new Date();
        var segments = {
            whale: 0,
            power_user: 0,
            casual: 0,
            at_risk: 0,
            churned: 0,
            new_user: 0,
            total_profiled: 0
        };

        // Scan player_analytics_profile collection
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 50;

            do {
                var result = nk.storageList(null, 'player_analytics_profile', 100, cursor);
                if (!result || !result.objects) break;

                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var profile = extResolveProfile(obj.value, gameId);
                    if (!profile) continue;

                    segments.total_profiled++;

                    var daysSinceActive = extDaysSince(extProfileLastSeen(profile));
                    var daysSinceFirst = extDaysSince(extProfileFirstSeen(profile));

                    var totalSpent = extProfileTotalSpent(profile);
                    var recentSessions = extProfileRecentSessions(profile);
                    var loginStreak = extProfileStreak(profile);

                    // Classify into segments (mutually exclusive priority order)
                    if (daysSinceActive >= CHURNED_DAYS) {
                        segments.churned++;
                    } else if (daysSinceActive >= AT_RISK_DAYS) {
                        segments.at_risk++;
                    } else if (totalSpent >= WHALE_THRESHOLD) {
                        segments.whale++;
                    } else if (recentSessions >= POWER_USER_SESSIONS && loginStreak >= POWER_USER_STREAK) {
                        segments.power_user++;
                    } else if (daysSinceFirst <= NEW_USER_DAYS) {
                        segments.new_user++;
                    } else {
                        segments.casual++;
                    }
                }

                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] player_segments scan error: ' + e.message);
        }

        // Calculate percentages
        var total = segments.total_profiled || 1;

        return JSON.stringify({
            game_id: gameId || 'all',
            segments: {
                whale: { count: segments.whale, pct: Math.round((segments.whale / total) * 100) },
                power_user: { count: segments.power_user, pct: Math.round((segments.power_user / total) * 100) },
                casual: { count: segments.casual, pct: Math.round((segments.casual / total) * 100) },
                at_risk: { count: segments.at_risk, pct: Math.round((segments.at_risk / total) * 100) },
                churned: { count: segments.churned, pct: Math.round((segments.churned / total) * 100) },
                new_user: { count: segments.new_user, pct: Math.round((segments.new_user / total) * 100) }
            },
            total_profiled: segments.total_profiled,
            thresholds: {
                whale_spend: WHALE_THRESHOLD,
                power_user_sessions: POWER_USER_SESSIONS,
                power_user_streak: POWER_USER_STREAK,
                at_risk_days: AT_RISK_DAYS,
                churned_days: CHURNED_DAYS,
                new_user_days: NEW_USER_DAYS
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] player_segments error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_churn_risk (Phase 4) ──────────────────

/**
 * Identify at-risk and churned players.
 * - At Risk: 7-14 days inactive
 * - Churned: 14+ days inactive
 * Uses player_analytics_profile collection.
 */
function rpcAnalyticsChurnRisk(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        // Thresholds
        var AT_RISK_DAYS = 7;
        var CHURNED_DAYS = 14;

        var now = new Date();
        var stats = {
            active: 0,          // < 7 days
            at_risk: 0,         // 7-14 days
            churned: 0,         // 14+ days
            total_profiled: 0,
            at_risk_trend: 0,   // Change from previous period
            churn_rate_pct: 0
        };

        // Track activity by day for trend analysis
        var inactivityBuckets = {};
        for (var d = 0; d <= 30; d++) {
            inactivityBuckets[d] = 0;
        }

        // Scan player_analytics_profile collection
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 50;

            do {
                var result = nk.storageList(null, 'player_analytics_profile', 100, cursor);
                if (!result || !result.objects) break;

                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var profile = extResolveProfile(obj.value, gameId);
                    if (!profile) continue;

                    stats.total_profiled++;

                    var daysSinceActive = extDaysSince(extProfileLastSeen(profile));

                    // Track in buckets
                    if (daysSinceActive <= 30) {
                        inactivityBuckets[daysSinceActive] = (inactivityBuckets[daysSinceActive] || 0) + 1;
                    }

                    // Classify
                    if (daysSinceActive >= CHURNED_DAYS) {
                        stats.churned++;
                    } else if (daysSinceActive >= AT_RISK_DAYS) {
                        stats.at_risk++;
                    } else {
                        stats.active++;
                    }
                }

                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] churn_risk scan error: ' + e.message);
        }

        // Calculate churn rate
        var total = stats.total_profiled || 1;
        stats.churn_rate_pct = Math.round((stats.churned / total) * 100);
        var atRiskRate = Math.round((stats.at_risk / total) * 100);
        var activeRate = Math.round((stats.active / total) * 100);

        // Build inactivity distribution (days 1-30)
        var distribution = [];
        for (var day = 1; day <= 30; day++) {
            distribution.push({
                days_inactive: day,
                count: inactivityBuckets[day] || 0
            });
        }

        return JSON.stringify({
            game_id: gameId || 'all',
            summary: {
                active: { count: stats.active, pct: activeRate },
                at_risk: { count: stats.at_risk, pct: atRiskRate },
                churned: { count: stats.churned, pct: stats.churn_rate_pct }
            },
            total_profiled: stats.total_profiled,
            churn_rate_pct: stats.churn_rate_pct,
            at_risk_rate_pct: atRiskRate,
            thresholds: {
                at_risk_days: AT_RISK_DAYS,
                churned_days: CHURNED_DAYS
            },
            inactivity_distribution: distribution.slice(0, 14) // First 14 days
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] churn_risk error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_conversion_funnel (Phase 4) ───────────

/**
 * Track conversion rates:
 * - Free → First IAP purchase
 * - Free → Ad removal purchase
 * - Free → Any monetization event (ad watch, IAP)
 * Uses player_analytics_profile collection.
 */
function rpcAnalyticsConversionFunnel(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var gameId = extResolveGameId(data.game_id || data.gameId || null); // Optional filter — alias slugs to canonical UUIDs

        var stats = {
            total_users: 0,
            free_users: 0,
            any_monetization: 0,     // Watched ad or made purchase
            first_iap: 0,            // Made any IAP
            ad_removal: 0,           // Purchased ad removal
            rewarded_ad_watched: 0,  // Watched at least one rewarded ad
            repeat_purchasers: 0     // More than 1 IAP
        };

        // Scan player_analytics_profile collection
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 50;

            do {
                var result = nk.storageList(null, 'player_analytics_profile', 100, cursor);
                if (!result || !result.objects) break;

                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var profile = extResolveProfile(obj.value, gameId);
                    if (!profile) continue;

                    stats.total_users++;

                    var totalSpent = extProfileTotalSpent(profile);
                    var purchaseCount = extProfilePurchaseCount(profile);
                    var adRemovalPurchased = extProfileAdRemovalPurchased(profile);
                    var rewardedAdsWatched = extProfileRewardedAds(profile);

                    // Classify
                    var hasMonetized = totalSpent > 0 || rewardedAdsWatched > 0;

                    if (hasMonetized) {
                        stats.any_monetization++;
                    } else {
                        stats.free_users++;
                    }

                    if (totalSpent > 0 || purchaseCount > 0) {
                        stats.first_iap++;

                        if (purchaseCount > 1) {
                            stats.repeat_purchasers++;
                        }
                    }

                    if (adRemovalPurchased) {
                        stats.ad_removal++;
                    }

                    if (rewardedAdsWatched > 0) {
                        stats.rewarded_ad_watched++;
                    }
                }

                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] conversion_funnel scan error: ' + e.message);
        }

        // Calculate conversion rates
        var total = stats.total_users || 1;

        var conversionRates = {
            any_monetization: Math.round((stats.any_monetization / total) * 100),
            first_iap: Math.round((stats.first_iap / total) * 100),
            ad_removal: Math.round((stats.ad_removal / total) * 100),
            rewarded_ad: Math.round((stats.rewarded_ad_watched / total) * 100),
            repeat_purchase: stats.first_iap > 0 ? Math.round((stats.repeat_purchasers / stats.first_iap) * 100) : 0
        };

        // Build funnel visualization data
        var funnel = [
            { step: 'Total Users', count: stats.total_users, pct: 100 },
            { step: 'Any Monetization', count: stats.any_monetization, pct: conversionRates.any_monetization },
            { step: 'Rewarded Ad Watched', count: stats.rewarded_ad_watched, pct: conversionRates.rewarded_ad },
            { step: 'First IAP', count: stats.first_iap, pct: conversionRates.first_iap },
            { step: 'Ad Removal', count: stats.ad_removal, pct: conversionRates.ad_removal },
            { step: 'Repeat Purchaser', count: stats.repeat_purchasers, pct: Math.round((stats.repeat_purchasers / total) * 100) }
        ];

        return JSON.stringify({
            game_id: gameId || 'all',
            total_users: stats.total_users,
            free_users: stats.free_users,
            conversion_rates: conversionRates,
            counts: {
                any_monetization: stats.any_monetization,
                first_iap: stats.first_iap,
                ad_removal: stats.ad_removal,
                rewarded_ad_watched: stats.rewarded_ad_watched,
                repeat_purchasers: stats.repeat_purchasers
            },
            funnel: funnel
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] conversion_funnel error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_audience_breakdown ────────────────────
//
// Surfaces the user-property dimensions that QVAnalyticsService now pushes
// once-per-session to every event (device_tier, country, install_source,
// consent_state, att_status, locale, app_version). Powers the new world-class
// "Audience" tab on the dashboard so you can see WHO is playing — high-end vs
// low-end devices, organic vs paid installs, EU vs US, granted vs denied
// consent — and make data-driven UA / monetization decisions.
//
// Performance: scans up to `days` of analytics_events with a no-op filter
// (we want every event so distribution is correct), then hash-counts each
// dimension. O(n) over events, O(k) memory per dimension. For typical
// 7-day windows on a single game this is well under 1ms / 100k events.
//
// Distinct users per dimension (via hash-set of user IDs) so dashboards can
// say "X unique installs from US" instead of "Y events from US" (events
// over-weight active power users).

function rpcAnalyticsAudienceBreakdown(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = extResolveGameId(data.game_id || data.gameId || null);

        // Phase 4 (2026-05) — analytics_rollup_daily carries pre-computed
        // top-N for every audience dimension. Merging across N days = N
        // small array merges instead of an O(events × dims) live walk.
        // The rollup only stores the top-N (25 for country/locale/version,
        // 10 for the rest); long-tail values get clipped — fine for an
        // executive dashboard where the tail is noise anyway.
        //
        // Cross-day dedupe of unique_users is impossible from rollup data
        // (each day's rollup persists its own unique-user count, the user
        // IDs themselves aren't stored). We sum events and SUM unique_users
        // across days as an upper bound, same convention as DAU→WAU/MAU
        // in rpcAnalyticsDashboard's wau_estimated/mau_estimated path.

        var rollupRange = extReadRollupRange(nk, gameId, days);
        var rollupServed = extRollupHasAny(rollupRange);
        var rollupHits = 0;

        if (rollupServed) {
            // Aggregate dimension → value → {events, unique_users}
            var agg = {
                country: {}, platform: {}, device_tier: {},
                install_source: {}, consent_state: {}, att_status: {},
                locale: {}, app_version: {}
            };
            var totalEvents = 0;
            var totalUserSum = 0;

            for (var ri = 0; ri < rollupRange.length; ri++) {
                var doc = rollupRange[ri].doc;
                if (!doc || !doc.audience) continue;
                rollupHits++;
                totalEvents += doc.event_count || 0;
                totalUserSum += doc.dau || 0;
                for (var dim in agg) {
                    if (!doc.audience[dim]) continue;
                    var rows = doc.audience[dim];
                    for (var r = 0; r < rows.length; r++) {
                        var row = rows[r];
                        if (!agg[dim][row.value]) agg[dim][row.value] = { events: 0, unique_users: 0 };
                        agg[dim][row.value].events += row.events || 0;
                        agg[dim][row.value].unique_users += row.unique_users || 0;
                    }
                }
            }

            function materializeAgg(dimName, topN) {
                var bag = agg[dimName];
                var arr = [];
                for (var v in bag) {
                    if (bag.hasOwnProperty(v)) {
                        arr.push({
                            value: v,
                            events: bag[v].events,
                            unique_users: bag[v].unique_users
                        });
                    }
                }
                arr.sort(function (a, b) { return (b.unique_users - a.unique_users) || (b.events - a.events); });
                return arr.slice(0, topN);
            }

            // Patch today's data from analytics_live_daily — the rollup only
            // covers yesterday and earlier; today has no rollup doc yet.
            try {
                var aTodayStr = extDaysAgo(0);
                var aLiveDailyKey = "live_" + (gameId || "all") + "_" + aTodayStr;
                var aLiveRecs = nk.storageRead([{ collection: "analytics_live_daily", key: aLiveDailyKey, userId: SYSTEM_USER_ID }]);
                if (aLiveRecs && aLiveRecs.length > 0 && aLiveRecs[0].value) {
                    var ald = aLiveRecs[0].value;
                    totalEvents += ald.total || 0;
                    // Inject platform dimension from live_daily.by_platform
                    var bpMap = ald.by_platform || {};
                    for (var bpk in bpMap) {
                        if (!bpMap.hasOwnProperty(bpk)) continue;
                        if (!agg.platform[bpk]) agg.platform[bpk] = { events: 0, unique_users: 0 };
                        agg.platform[bpk].events += bpMap[bpk];
                    }
                    // Inject country dimension from live_daily.by_country
                    var bcMap = ald.by_country || {};
                    for (var bck in bcMap) {
                        if (!bcMap.hasOwnProperty(bck)) continue;
                        if (!agg.country[bck]) agg.country[bck] = { events: 0, unique_users: 0 };
                        agg.country[bck].events += bcMap[bck];
                    }
                }
            } catch (_al_err) { /* live_daily read failure must not break the RPC */ }

            return JSON.stringify({
                game_id:        gameId || 'all',
                days:           days,
                total_events:   totalEvents,
                unique_users:   totalUserSum,
                unique_users_estimated: true,   // sum-of-daily-uniques upper bound
                country:        materializeAgg('country', 25),
                device_tier:    materializeAgg('device_tier', 10),
                install_source: materializeAgg('install_source', 10),
                consent_state:  materializeAgg('consent_state', 10),
                att_status:     materializeAgg('att_status', 10),
                locale:         materializeAgg('locale', 25),
                app_version:    materializeAgg('app_version', 25),
                platform:       materializeAgg('platform', 10),
                _meta: {
                    read_path: "rollup-preferred+live-today",
                    rollup_hits: rollupHits,
                    generated_at: new Date().toISOString()
                }
            });
        }

        // Cold-start fallback — original live event scan path. Same shape
        // as the rollup-served response but without the `unique_users_estimated`
        // flag (live scan has the real per-user dedupe).
        var dims = {
            country:        { events: {}, users: {} },
            device_tier:    { events: {}, users: {} },
            install_source: { events: {}, users: {} },
            consent_state:  { events: {}, users: {} },
            att_status:     { events: {}, users: {} },
            locale:         { events: {}, users: {} },
            app_version:    { events: {}, users: {} },
            platform:       { events: {}, users: {} }
        };
        var totalUsers = {};
        var totalEventsLive = 0;

        var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var ed = ev.eventData || {};
            totalEventsLive++;
            if (ev.userId) totalUsers[ev.userId] = true;

            var fields = [
                ['country',        ed.country],
                ['device_tier',    ed.device_tier],
                ['install_source', ed.install_source],
                ['consent_state',  ed.consent_state],
                ['att_status',     ed.att_status],
                ['locale',         ed.locale],
                ['app_version',    ed.app_version],
                ['platform',       ed.platform || ev.platform]
            ];

            for (var f = 0; f < fields.length; f++) {
                var dim2 = fields[f][0];
                var val = (fields[f][1] != null && fields[f][1] !== '')
                    ? String(fields[f][1])
                    : 'unknown';
                var slot = dims[dim2];
                slot.events[val] = (slot.events[val] || 0) + 1;
                if (ev.userId) {
                    if (!slot.users[val]) slot.users[val] = {};
                    slot.users[val][ev.userId] = true;
                }
            }
        }

        function materialize(dimName, topN) {
            var slot = dims[dimName];
            var arr = [];
            for (var k in slot.events) {
                if (!slot.events.hasOwnProperty(k)) continue;
                arr.push({
                    value: k,
                    events: slot.events[k],
                    unique_users: slot.users[k] ? Object.keys(slot.users[k]).length : 0
                });
            }
            arr.sort(function(a, b) { return b.unique_users - a.unique_users || b.events - a.events; });
            return arr.slice(0, topN);
        }

        return JSON.stringify({
            game_id:        gameId || 'all',
            days:           days,
            total_events:   totalEventsLive,
            unique_users:   Object.keys(totalUsers).length,
            country:        materialize('country', 25),
            device_tier:    materialize('device_tier', 10),
            install_source: materialize('install_source', 10),
            consent_state:  materialize('consent_state', 10),
            att_status:     materialize('att_status', 10),
            locale:         materialize('locale', 25),
            app_version:    materialize('app_version', 25),
            platform:       materialize('platform', 10),
            _meta: {
                read_path: "live-scan",
                rollup_hits: 0,
                generated_at: new Date().toISOString()
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] audience_breakdown error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_retention_milestones ──────────────────
//
// Surfaces the once-per-install retention_d1 / retention_d7 / retention_d30
// events fired by Trivia.Analytics.Domain.RetentionAnalytics. These are the
// LTV-critical signals every BI dashboard reads — so we expose them as a
// dedicated, dashboard-friendly RPC instead of forcing the UI to roll its
// own from raw events.
//
// Returns counts per milestone over the configured window plus a daily series
// so the dashboard can chart the retention trend visually.

function rpcAnalyticsRetentionMilestones(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 30;
        var gameId = extResolveGameId(data.game_id || data.gameId || null);

        var counts = { retention_d1: 0, retention_d7: 0, retention_d30: 0 };
        var dailyMap = { retention_d1: {}, retention_d7: {}, retention_d30: {} };

        // Phase 4 (2026-05) — read analytics_rollup_daily.retention_milestones
        // first. arComputeRollup tallies retention_day_1/7/30 events per
        // day per game in the same scan it does for everything else, so
        // a 30-day retention chart is now N storage reads instead of one
        // ~30k-event live scan.
        var rollupRange = extReadRollupRange(nk, gameId, days);
        var rollupServed = extRollupHasAny(rollupRange);
        var rollupHits = 0;

        if (rollupServed) {
            for (var ri = 0; ri < rollupRange.length; ri++) {
                var entry = rollupRange[ri];
                if (!entry.doc || !entry.doc.retention_milestones) continue;
                var rm = entry.doc.retention_milestones;
                if (rm.retention_d1)  { counts.retention_d1  += rm.retention_d1;  dailyMap.retention_d1[entry.date]  = rm.retention_d1; }
                if (rm.retention_d7)  { counts.retention_d7  += rm.retention_d7;  dailyMap.retention_d7[entry.date]  = rm.retention_d7; }
                if (rm.retention_d30) { counts.retention_d30 += rm.retention_d30; dailyMap.retention_d30[entry.date] = rm.retention_d30; }
                rollupHits++;
            }
        }

        // Cold-start fallback — same shape as before. Only runs when no
        // rollup days exist at all (operator hasn't run the rollup yet).
        if (!rollupServed) {
            var milestoneEvents = {
                'retention_d1': 1, 'retention_d7': 1, 'retention_d30': 1,
                'retention_day_1': 1, 'retention_day_7': 1, 'retention_day_30': 1
            };

            var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
                return !!milestoneEvents[(val.eventName || '').toLowerCase()];
            }, gameId);

            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                var rawName = (ev.eventName || '').toLowerCase();
                // Normalize retention_day_N → retention_dN (matches dailyMap keys).
                var name = rawName === 'retention_day_1'  ? 'retention_d1'
                         : rawName === 'retention_day_7'  ? 'retention_d7'
                         : rawName === 'retention_day_30' ? 'retention_d30'
                         : rawName;
                if (!counts.hasOwnProperty(name)) continue;
                counts[name]++;
                var dt = (ev.timestamp || '').substring(0, 10);
                if (dt) {
                    dailyMap[name][dt] = (dailyMap[name][dt] || 0) + 1;
                }
            }
        }

        function dailyArr(name) {
            var arr = [];
            for (var k in dailyMap[name]) {
                if (dailyMap[name].hasOwnProperty(k)) {
                    arr.push({ date: k, count: dailyMap[name][k] });
                }
            }
            arr.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
            return arr;
        }

        return JSON.stringify({
            game_id:    gameId || 'all',
            days:       days,
            milestones: {
                d1:  counts.retention_d1,
                d7:  counts.retention_d7,
                d30: counts.retention_d30
            },
            daily: {
                d1:  dailyArr('retention_d1'),
                d7:  dailyArr('retention_d7'),
                d30: dailyArr('retention_d30')
            },
            _meta: {
                read_path: rollupServed ? "rollup-preferred" : "live-scan",
                rollup_hits: rollupHits,
                generated_at: new Date().toISOString()
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] retention_milestones error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_session_stats", rpcAnalyticsSessionStats);
    initializer.registerRpc("analytics_quiz_performance", rpcAnalyticsQuizPerformance);
    initializer.registerRpc("analytics_funnel", rpcAnalyticsFunnel);
    initializer.registerRpc("analytics_ai_features", rpcAnalyticsAIFeatures);
    initializer.registerRpc("analytics_feature_adoption", rpcAnalyticsFeatureAdoption);
    initializer.registerRpc("analytics_economy_health", rpcAnalyticsEconomyHealth);
    initializer.registerRpc("analytics_monetization_detail", rpcAnalyticsMonetizationDetail);
    initializer.registerRpc("analytics_platform_breakdown", rpcAnalyticsPlatformBreakdown);
    initializer.registerRpc("analytics_home_heatmap", rpcAnalyticsHomeHeatmap);
    initializer.registerRpc("analytics_top_players", rpcAnalyticsTopPlayers);
    initializer.registerRpc("analytics_error_log", rpcAnalyticsErrorLog);
    // Phase 4: Advanced Analytics
    initializer.registerRpc("analytics_player_segments", rpcAnalyticsPlayerSegments);
    initializer.registerRpc("analytics_churn_risk", rpcAnalyticsChurnRisk);
    initializer.registerRpc("analytics_conversion_funnel", rpcAnalyticsConversionFunnel);
    // 2026-04 hardening: world-class audience + retention dashboards
    initializer.registerRpc("analytics_audience_breakdown", rpcAnalyticsAudienceBreakdown);
    initializer.registerRpc("analytics_retention_milestones", rpcAnalyticsRetentionMilestones);
    logger.info("[AnalyticsExtended] Module registered: 16 RPCs");
}
