// analytics.js - Analytics System (Per gameId UUID)

var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var FIRST_SEEN_COLLECTION = "analytics_user_first_seen";

/**
 * Canonical event-name alias map. Clients emit various "-ed" suffix variants
 * (historical), but the rollup/funnel logic keys on a single canonical form.
 * Applied in normalizeInboundEvent so every downstream consumer sees the same
 * name. Mirrored in analytics_rollup.js for events that may have been written
 * before this alias map existed.
 */
var EVENT_ALIASES = {
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
    "paywall_viewed": "paywall_shown"
};

/**
 * Accept a client-supplied unix timestamp only if it's within ±48h of server
 * clock. This lets the Unity offline-queue replay attribute events to the day
 * they actually happened, while rejecting clock-skew / malicious future dates.
 */
function resolveEventTimestamp(rawEvent) {
    var serverNow = utils.getUnixTimestamp();
    var candidate = null;
    if (rawEvent.unixTimestamp != null) candidate = parseInt(rawEvent.unixTimestamp, 10);
    else if (rawEvent.unix_timestamp != null) candidate = parseInt(rawEvent.unix_timestamp, 10);
    else if (rawEvent.client_unix_ts != null) candidate = parseInt(rawEvent.client_unix_ts, 10);
    else if (typeof rawEvent.timestamp === "string" && rawEvent.timestamp) {
        var parsedMs = Date.parse(rawEvent.timestamp);
        if (!isNaN(parsedMs)) candidate = Math.floor(parsedMs / 1000);
    } else if (typeof rawEvent.timestamp === "number" && isFinite(rawEvent.timestamp)) {
        // JSON numeric epoch seconds (e.g. Unity Newtonsoft serializing long timestamp).
        candidate = Math.floor(rawEvent.timestamp);
    }
    if (!candidate || !isFinite(candidate)) return serverNow;
    // Guard: reject absurd values (before 2020 or > 48h in future).
    if (candidate < 1577836800) return serverNow;
    if (candidate > serverNow + 172800) return serverNow;
    return candidate;
}

/**
 * Normalize a single inbound event into the canonical server-side record.
 * Handles legacy casings (gameID, eventData=properties, etc.) so the dashboard
 * sees one consistent shape regardless of client version.
 */
function normalizeInboundEvent(ctx, rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') return null;

    var gameId = rawEvent.gameId || rawEvent.game_id || rawEvent.gameID || null;
    if (!gameId || !utils.isValidUUID(gameId)) return { __invalid: "Invalid or missing gameId UUID" };

    var eventName = rawEvent.eventName || rawEvent.event_name || rawEvent.event || null;
    if (!eventName) return { __invalid: "Missing eventName" };
    if (EVENT_ALIASES[eventName]) eventName = EVENT_ALIASES[eventName];

    var eventData = rawEvent.eventData || rawEvent.event_data || rawEvent.properties || rawEvent.data || {};
    if (typeof eventData !== 'object' || eventData === null) eventData = {};

    // Inject platform / app_version from top-level if client didn't put them in eventData.
    if (!eventData.platform && rawEvent.platform) eventData.platform = rawEvent.platform;
    if (!eventData.app_version && rawEvent.app_version) eventData.app_version = rawEvent.app_version;
    if (!eventData.device_model && rawEvent.device_model) eventData.device_model = rawEvent.device_model;
    if (!eventData.session_id && rawEvent.session_id) eventData.session_id = rawEvent.session_id;
    if (!eventData.session_id && rawEvent.sessionId) eventData.session_id = rawEvent.sessionId;

    // Server-authoritative user id.
    var userId = ctx.userId;
    if (!userId) return { __invalid: "User not authenticated" };

    var unixTs = resolveEventTimestamp(rawEvent);

    return {
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        eventData: eventData,
        platform: eventData.platform || null,
        sessionId: eventData.session_id || null,
        timestamp: new Date(unixTs * 1000).toISOString(),
        unixTimestamp: unixTs
    };
}

/**
 * Atomic first-seen marker: creates analytics_user_first_seen/first_<uid>_<gid>
 * on first write, otherwise no-ops. Returns true when THIS call created the
 * doc (i.e. the user is new for this game on this day). Uses version:"*" for
 * create-only semantics — the race loser reads back the winner's doc.
 */
function trackFirstSeen(nk, logger, userId, gameId, unixTs) {
    if (!userId || !gameId) return false;
    var key = "first_" + userId + "_" + gameId;
    try {
        var existing = nk.storageRead([{ collection: FIRST_SEEN_COLLECTION, key: key, userId: SYSTEM_USER }]);
        if (existing && existing.length > 0 && existing[0].value) return false;
    } catch (e) { /* fall through to create */ }
    try {
        var dateStr = new Date((unixTs || utils.getUnixTimestamp()) * 1000).toISOString().slice(0, 10);
        nk.storageWrite([{
            collection: FIRST_SEEN_COLLECTION,
            key: key,
            userId: SYSTEM_USER,
            value: { userId: userId, gameId: gameId, firstSeenDate: dateStr, firstSeenUnix: unixTs || utils.getUnixTimestamp() },
            permissionRead: 2,
            permissionWrite: 0,
            version: "*"
        }]);
        return true;
    } catch (e) {
        // Lost race — another call created it first. Treat as not new.
        return false;
    }
}

/**
 * Persist a single normalized event + fan-out to DAU + session aggregator.
 * Returns null on success, or a string error.
 */
function persistNormalizedEvent(nk, logger, ev) {
    var userKey = "event_" + ev.userId + "_" + ev.gameId + "_" + ev.unixTimestamp +
                  "_" + Math.floor(Math.random() * 10000);
    if (!utils.writeStorage(nk, logger, "analytics_events", userKey, ev.userId, ev)) {
        return "Failed to write user event";
    }

    // Dashboard-aggregation copy under SYSTEM_USER so scans don't need cross-user lookups.
    // Key day bucket off the event's unixTimestamp (honors client offline replay),
    // not server wall-clock, so the rollup's date-bucket scan sees it correctly.
    var eventDay = new Date(ev.unixTimestamp * 1000).toISOString().slice(0, 10);
    var dashboardKey = "dash_" + eventDay + "_" + ev.eventName +
                       "_" + ev.unixTimestamp + "_" + Math.floor(Math.random() * 10000);
    utils.writeStorage(nk, logger, "analytics_events", dashboardKey, SYSTEM_USER, ev);

    // First-seen → daily active users. isNew only bumps newUsers on the day
    // where the creator "won" the atomic storageWrite above.
    var isNew = trackFirstSeen(nk, logger, ev.userId, ev.gameId, ev.unixTimestamp);
    trackDAU(nk, logger, ev.userId, ev.gameId, isNew);

    // Session lifecycle.
    if (ev.eventName === "session_start" || ev.eventName === "session_end") {
        trackSession(nk, logger, ev.userId, ev.gameId, ev.eventName, ev.eventData);
    }

    // Platform breakdown key (cheap counter keyed per day+platform+gameId).
    if (ev.platform) {
        trackPlatform(nk, logger, ev.gameId, ev.platform);
    }

    return null;
}

/**
 * RPC: Log analytics event(s). Accepts a SINGLE event payload OR a BATCH.
 *   Single: { gameId, eventName, eventData }
 *   Batch : { events: [ { gameId, eventName, eventData }, ... ] }
 *
 * Returns: { success, accepted, rejected, errors?: [...] }
 */
function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC analytics_log_event called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data || {};

    // Accept batch or single.
    var inbound = [];
    if (Array.isArray(data.events) && data.events.length > 0) {
        if (data.events.length > 200) {
            return utils.handleError(ctx, null, "Batch too large: max 200 events per call");
        }
        inbound = data.events;
    } else {
        inbound = [data];
    }

    var accepted = 0;
    var rejected = 0;
    var errors = [];

    for (var i = 0; i < inbound.length; i++) {
        var normalized = normalizeInboundEvent(ctx, inbound[i]);
        if (!normalized || normalized.__invalid) {
            rejected++;
            errors.push({ index: i, reason: (normalized && normalized.__invalid) || "Invalid event" });
            continue;
        }
        var err = persistNormalizedEvent(nk, logger, normalized);
        if (err) {
            rejected++;
            errors.push({ index: i, reason: err });
        } else {
            accepted++;
        }
    }

    utils.logInfo(logger, "analytics_log_event accepted=" + accepted + " rejected=" + rejected);

    // Best-effort counter tick (for analytics_metrics RPC). Ignored on failure
    // so it never blocks event ingestion.
    try { bumpMetricsCounter(nk, { accepted: accepted, rejected: rejected }); } catch (e) { /* swallow */ }

    var resp = {
        success: accepted > 0 || rejected === 0,
        accepted: accepted,
        rejected: rejected
    };
    if (errors.length > 0) resp.errors = errors.slice(0, 20);
    return JSON.stringify(resp);
}

/**
 * Optimistic-concurrency helper for read-modify-write counters.
 *
 * Race fix: prior versions did a naïve read → mutate → write. Under burst
 * load (e.g. simultaneous iap_purchased and ad_impression for the same
 * gameId/platform/day), two concurrent writers would both read the same
 * stale doc, increment their copies, and the later writer would clobber
 * the earlier one — losing increments silently.
 *
 * We now pass the record's `version` back to storageWrite; Nakama rejects
 * the write with OCC failure if the doc changed underneath us, and we
 * retry up to `maxRetries` times. On create we use version:"*" so only
 * one of the racing creators wins; losers retry as updaters.
 */
function casUpdate(nk, logger, collection, key, owner, mutate) {
    var maxRetries = 5;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
        var existing = null;
        var version = null;
        try {
            var objs = nk.storageRead([{ collection: collection, key: key, userId: owner }]);
            if (objs && objs.length > 0) {
                existing = objs[0].value || null;
                version = objs[0].version || null;
            }
        } catch (e) { /* treat as not-exists */ }

        var isCreate = !existing;
        var next = mutate(existing ? JSON.parse(JSON.stringify(existing)) : null);
        if (!next) return true; // mutator returned nothing → no write needed

        try {
            nk.storageWrite([{
                collection: collection,
                key: key,
                userId: owner,
                value: next,
                permissionRead: 2,
                permissionWrite: 0,
                version: isCreate ? "*" : version
            }]);
            return true;
        } catch (e) {
            // Race lost — loop and re-read. If we keep losing after maxRetries,
            // fall through to logging but don't throw: losing an occasional
            // counter tick under extreme contention is better than failing
            // the whole event-ingest path.
            if (attempt === maxRetries - 1 && logger && logger.warn) {
                logger.warn("[Analytics] CAS update lost after " + maxRetries + " tries: " +
                            collection + "/" + key + " (" + e.message + ")");
            }
        }
    }
    return false;
}

/**
 * Lightweight ops counter, bucketed by UTC day.
 * Collection: analytics_metrics_counters
 * Key:        counter_<YYYY-MM-DD>
 * Prometheus-style reset on day boundary. Used by analytics_metrics RPC.
 */
function bumpMetricsCounter(nk, delta) {
    var today = new Date().toISOString().slice(0, 10);
    var key = "counter_" + today;
    casUpdate(nk, null, "analytics_metrics_counters", key, SYSTEM_USER, function (rec) {
        if (!rec) rec = { date: today, events_accepted: 0, events_rejected: 0, log_calls: 0, updated_at: null };
        rec.events_accepted += (delta.accepted || 0);
        rec.events_rejected += (delta.rejected || 0);
        rec.log_calls += 1;
        rec.updated_at = new Date().toISOString();
        return rec;
    });
}

/**
 * Track per-platform daily counter (used by analytics_platform_breakdown).
 */
function trackPlatform(nk, logger, gameId, platform) {
    var today = utils.getStartOfDay();
    var key = "platform_" + gameId + "_" + today + "_" + platform;
    casUpdate(nk, logger, "analytics_platform", key, SYSTEM_USER, function (rec) {
        if (!rec) rec = { gameId: gameId, date: today, platform: platform, count: 0 };
        rec.count = (rec.count || 0) + 1;
        return rec;
    });
}

/**
 * Track Daily Active User - writes both game-level and platform-level DAU keys.
 * Dashboard reads: dauData.uniqueUsers, dauData.count, dauData.newUsers
 *
 * isNewUser signals that trackFirstSeen just created the first-seen doc for
 * this (user,game) pair. We bump newUsers only once per user per day-per-key.
 */
function trackDAU(nk, logger, userId, gameId, isNewUser) {
    var today = utils.getStartOfDay();
    var collection = "analytics_dau";

    var keys = [
        "dau_" + gameId + "_" + today,
        "dau_platform_" + today
    ];

    for (var k = 0; k < keys.length; k++) {
        (function (key) {
            casUpdate(nk, logger, collection, key, SYSTEM_USER, function (dauData) {
                if (!dauData) {
                    dauData = { date: today, uniqueUsers: [], count: 0, newUsers: 0 };
                }
                if (!Array.isArray(dauData.uniqueUsers)) {
                    dauData.uniqueUsers = Array.isArray(dauData.users) ? dauData.users : [];
                }
                if (dauData.uniqueUsers.indexOf(userId) !== -1) return null; // no-op, already recorded
                dauData.uniqueUsers.push(userId);
                dauData.count = dauData.uniqueUsers.length;
                if (isNewUser) dauData.newUsers = (dauData.newUsers || 0) + 1;
                return dauData;
            });
        })(keys[k]);
    }
}

/**
 * Track session data (start/end).
 *
 * Double-fire guard: if a session_start arrives while the previous session
 * is still "active" (client missed a session_end on kill/crash/background),
 * we synthesize an end for the dangling session before starting the new one.
 * Previously we silently overwrote the active-session doc and lost the
 * prior session's duration entirely.
 */
function trackSession(nk, logger, userId, gameId, eventName, eventData) {
    var collection = "analytics_sessions";
    var key = utils.makeGameStorageKey("analytics_session", userId, gameId);

    if (eventName === "session_start") {
        var existing = utils.readStorage(nk, logger, collection, key, userId);
        if (existing && existing.active && existing.startTime) {
            // Close out the dangling session with a best-effort end time.
            var nowUnix = utils.getUnixTimestamp();
            var duration = nowUnix - existing.startTime;
            if (duration > 0 && duration < 86400) {
                existing.endTime = nowUnix;
                existing.endTimestamp = new Date(nowUnix * 1000).toISOString();
                existing.duration = duration;
                existing.active = false;
                existing.closedBy = "session_start_double_fire";
                var staleSummaryKey = "session_summary_" + userId + "_" + gameId + "_" + existing.startTime;
                utils.writeStorage(nk, logger, "analytics_session_summaries", staleSummaryKey, userId, existing);
                aggregateSessionStats(nk, logger, duration, gameId);
            }
        }
        var sessionData = {
            userId: userId,
            gameId: gameId,
            startTime: utils.getUnixTimestamp(),
            startTimestamp: utils.getCurrentTimestamp(),
            active: true
        };
        utils.writeStorage(nk, logger, collection, key, userId, sessionData);
    } else if (eventName === "session_end") {
        var sessionData = utils.readStorage(nk, logger, collection, key, userId);
        if (sessionData && sessionData.active) {
            sessionData.endTime = utils.getUnixTimestamp();
            sessionData.endTimestamp = utils.getCurrentTimestamp();
            sessionData.duration = sessionData.endTime - sessionData.startTime;
            sessionData.active = false;

            var summaryKey = "session_summary_" + userId + "_" + gameId + "_" + sessionData.startTime;
            utils.writeStorage(nk, logger, "analytics_session_summaries", summaryKey, userId, sessionData);
            utils.writeStorage(nk, logger, collection, key, userId, { active: false });

            aggregateSessionStats(nk, logger, sessionData.duration, gameId);
        }
    }
}

/**
 * Aggregate session stats into a daily summary for the analytics dashboard.
 * Writes TWO keys so both "All games" and per-game dashboard views can resolve:
 *   - session_stats_{YYYY-MM-DD}                  (platform-wide)
 *   - session_stats_{gameId}_{YYYY-MM-DD}         (per-game)
 * Both stored under SYSTEM_USER so dashboard scans don't need to cross users.
 * Uses casUpdate to survive concurrent session_end bursts.
 */
function aggregateSessionStats(nk, logger, durationSeconds, gameId) {
    var today = utils.getStartOfDay();
    var collection = "analytics_sessions";
    var keys = ["session_stats_" + today];
    if (gameId) keys.push("session_stats_" + gameId + "_" + today);
    for (var k = 0; k < keys.length; k++) {
        (function (key) {
            casUpdate(nk, logger, collection, key, SYSTEM_USER, function (stats) {
                if (!stats) {
                    stats = { date: today, gameId: gameId || null, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
                }
                stats.totalSessions++;
                stats.totalDuration += (durationSeconds || 0);
                stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;
                return stats;
            });
        })(keys[k]);
    }
}

/**
 * Read a pre-aggregated rollup doc (written by analytics_rollup_run).
 * Returns null if the rollup is missing for that date (caller should
 * fall back to live-compute).
 */
function readRollupDaily(nk, gameId, dateStr) {
    try {
        var key = "rollup_" + (gameId || "all") + "_" + dateStr;
        var r = nk.storageRead([{
            collection: "analytics_rollup_daily",
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function preferRollups(ctx) {
    if (!ctx || !ctx.env) return true;
    var v = ctx.env.DASHBOARD_PREFER_ROLLUPS;
    if (v === undefined || v === null || v === "" || v === "true" || v === "1") return true;
    return false;
}

/**
 * RPC: analytics_dashboard
 * Returns DAU, WAU, MAU, retention ratios, trends for the dashboard.
 *
 * Phase-2 read path: for every day older than today we try to read a
 * pre-computed rollup from `analytics_rollup_daily` first. Only fall back
 * to the legacy DAU storageRead when the rollup is missing. Today is always
 * computed live (from analytics_dau counters) because the nightly rollup
 * hasn't run yet for today's date.
 *
 * Payload: { game_id?: string, gameId?: string, days?: number }
 */
function rpcAnalyticsDashboard(ctx, logger, nk, payload) {
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    var parsed = {};
    try { parsed = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }

    var gameId = parsed.game_id || parsed.gameId || 'all';
    var days = parseInt(parsed.days, 10) || 30;

    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    var useRollups = preferRollups(ctx);
    var rollupHits = 0;
    var liveFallbacks = 0;

    // Collect DAU for the past N days.
    //
    // WAU/MAU strategy: we dedup across days using the full user list when
    // available (live-fallback path stores the list in analytics_dau). Rollup
    // docs don't carry user lists — we fall back to summing daily DAU with an
    // explicit `wau_estimated`/`mau_estimated` flag so the dashboard knows it
    // is an upper-bound approximation, not an undercount. Previously the
    // rollup-hit path bucketed each day into a distinct key (`rollup_<date>`),
    // which made `Object.keys(wauSet).length` return the *day count* (≤7) and
    // capped WAU at 7 — completely wrong.
    var dauTrend = [];
    var wauUserSet = {};
    var mauUserSet = {};
    var wauDailySum = 0;
    var mauDailySum = 0;
    var wauAnyRollup = false;
    var mauAnyRollup = false;
    var newUsersToday = 0;

    for (var d = 0; d < days; d++) {
        var date = new Date(now.getTime() - d * 86400000);
        var dateStr = date.toISOString().slice(0, 10);

        var dayUsers = 0;
        var dayNewUsers = 0;
        var resolved = false;
        var dayHasUserList = false;

        // Phase-2: try rollup first for any day older than today.
        if (useRollups && d > 0) {
            var rollup = readRollupDaily(nk, gameId, dateStr);
            if (rollup) {
                dayUsers = rollup.dau || 0;
                dayNewUsers = rollup.new_users || 0;
                if (d < 7) { wauDailySum += dayUsers; wauAnyRollup = true; }
                mauDailySum += dayUsers; mauAnyRollup = true;
                rollupHits++;
                resolved = true;
            }
        }

        if (!resolved) {
            var key = gameId === 'all' ? 'dau_platform_' + dateStr : 'dau_' + gameId + '_' + dateStr;
            var record = null;
            try {
                var objs = nk.storageRead([{ collection: 'analytics_dau', key: key, userId: SYSTEM_USER }]);
                if (objs && objs.length > 0) record = objs[0].value;
            } catch (e) { /* no data */ }
            liveFallbacks++;

            if (record) {
                dayUsers = record.count || record.uniqueUsers || (record.users ? record.users.length : 0);
                dayNewUsers = record.newUsers || 0;
                if (d === 0) newUsersToday = dayNewUsers;

                var userList = record.users || record.uniqueUsers || [];
                if (Array.isArray(userList) && userList.length > 0) {
                    dayHasUserList = true;
                    for (var ui = 0; ui < userList.length; ui++) {
                        var uid = userList[ui];
                        if (d < 7) wauUserSet[uid] = true;
                        mauUserSet[uid] = true;
                    }
                }
                if (!dayHasUserList && typeof dayUsers === 'number') {
                    if (d < 7) wauDailySum += dayUsers;
                    mauDailySum += dayUsers;
                }
            }
        }

        dauTrend.unshift({ date: dateStr, count: dayUsers, newUsers: dayNewUsers });
    }

    // Calculate DAU (today), WAU (7d), MAU (30d).
    var dau = dauTrend.length > 0 ? dauTrend[dauTrend.length - 1].count : 0;
    var wauUnique = Object.keys(wauUserSet).length;
    var mauUnique = Object.keys(mauUserSet).length;
    // If we saw any rollup days (no user lists), we must use the sum path to
    // avoid silently undercounting. The sum is an upper bound but more honest
    // than zero or a days-with-data count.
    var wau = wauAnyRollup ? (wauUnique + wauDailySum) : Math.max(wauUnique, wauDailySum);
    var mau = mauAnyRollup ? (mauUnique + mauDailySum) : Math.max(mauUnique, mauDailySum);
    var wauEstimated = wauAnyRollup || (wauUnique === 0 && wauDailySum > 0);
    var mauEstimated = mauAnyRollup || (mauUnique === 0 && mauDailySum > 0);

    var dauMauRatio = mau > 0 ? dau / mau : 0;

    // 7-day change percent
    var dau7dAgo = dauTrend.length >= 8 ? dauTrend[dauTrend.length - 8].count : dau;
    var dau7dChangePct = dau7dAgo > 0 ? Math.round(((dau - dau7dAgo) / dau7dAgo) * 100) : 0;

    // Session stats
    var sessionKey = gameId === 'all'
        ? 'session_stats_' + todayStr
        : 'session_stats_' + gameId + '_' + todayStr;
    var sessionStats = null;
    try {
        var sessObjs = nk.storageRead([{ collection: 'analytics_sessions', key: sessionKey, userId: SYSTEM_USER }]);
        if (sessObjs && sessObjs.length > 0) sessionStats = sessObjs[0].value;
    } catch (e) { /* no data */ }

    var avgSessionDuration = sessionStats ? sessionStats.avgDuration : 0;

    // Top games (if platform-wide). Paginate up to 10 pages * 100 = 1000
    // DAU records so active games beyond the first page aren't silently
    // truncated. Previously a single 100-row slice capped the entire scan.
    var topGames = [];
    if (gameId === 'all') {
        try {
            var gameStats = {};
            var cursor = null;
            var pagesScanned = 0;
            var maxPages = 10;
            var pageSize = 100;
            while (pagesScanned < maxPages) {
                var scanObjs = nk.storageList(SYSTEM_USER, 'analytics_dau', pageSize, cursor);
                if (!scanObjs || !scanObjs.objects || scanObjs.objects.length === 0) break;
                for (var i = 0; i < scanObjs.objects.length; i++) {
                    var obj = scanObjs.objects[i];
                    if (!obj.key || obj.key.indexOf('dau_') !== 0) continue;
                    if (obj.key.indexOf('dau_platform_') === 0) continue;
                    var parts = obj.key.split('_');
                    if (parts.length < 3) continue;
                    var gid = parts[1];
                    if (!gameStats[gid]) gameStats[gid] = { gameId: gid, totalDau: 0, days: 0 };
                    gameStats[gid].totalDau += (obj.value && (obj.value.count || obj.value.uniqueUsers)) || 0;
                    gameStats[gid].days++;
                }
                pagesScanned++;
                if (!scanObjs.cursor) break;
                cursor = scanObjs.cursor;
            }
            topGames = Object.keys(gameStats).map(function(gid) {
                var avgDau = Math.round(gameStats[gid].totalDau / Math.max(1, gameStats[gid].days));
                return {
                    gameId: gid,
                    game_id: gid,
                    avgDau: avgDau,
                    avg_dau: avgDau,
                    dau: avgDau
                };
            }).sort(function(a, b) { return b.avgDau - a.avgDau; }).slice(0, 5);
        } catch (e) {
            if (logger && logger.warn) logger.warn('[Analytics] Top games scan error: ' + e.message);
        }
    }

    var dauWindow = dauTrend.slice(-7).map(function(day) { return day.count || 0; });
    var dau7dMin = dauWindow.length > 0 ? Math.min.apply(null, dauWindow) : 0;
    var dau7dMax = dauWindow.length > 0 ? Math.max.apply(null, dauWindow) : 0;

    return JSON.stringify({
        success: true,
        dau: dau,
        wau: wau,
        mau: mau,
        wau_estimated: wauEstimated,
        mau_estimated: mauEstimated,
        dau_mau_ratio: dauMauRatio,
        new_users_today: newUsersToday,
        returning_users_today: Math.max(0, dau - newUsersToday),
        avg_session_duration_seconds: avgSessionDuration,
        dau_7d_min: dau7dMin,
        dau_7d_max: dau7dMax,
        dau_trend: dauTrend.slice(-14).map(function(d) { return { date: d.date, dau: d.count }; }),
        trends: {
            dau_7d_change_pct: dau7dChangePct
        },
        top_games: topGames,
        _meta: {
            read_path: useRollups ? "rollup-preferred" : "live-only",
            rollup_hits: rollupHits,
            live_fallbacks: liveFallbacks,
            generated_at: new Date().toISOString()
        }
    });
}

// ─── RPC: analytics_dashboard_summary ────────────────────
//
// Phase-2 convenience RPC. Returns the full rollup doc for a single date
// (defaults to yesterday) so the dashboard can render one card with one
// round-trip. Complements analytics_dashboard (trend) with one-shot "KPI
// for the most recent rolled-up day" reads.

function rpcAnalyticsDashboardSummary(ctx, logger, nk, payload) {
    var parsed = {};
    try { parsed = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }

    var gameId = parsed.game_id || parsed.gameId || "all";
    var dateStr = parsed.date;
    if (!dateStr) {
        var y = new Date();
        y.setUTCDate(y.getUTCDate() - 1);
        dateStr = y.toISOString().slice(0, 10);
    }

    var doc = readRollupDaily(nk, gameId, dateStr);
    if (!doc) {
        return JSON.stringify({
            success: false,
            error: "No rollup for " + gameId + "/" + dateStr + ". Trigger analytics_rollup_run first.",
            gameId: gameId,
            date: dateStr
        });
    }
    doc.success = true;
    doc.source = "rollup";
    return JSON.stringify(doc);
}

// Registration - postbuild.js scans for this
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
    initializer.registerRpc("analytics_dashboard", rpcAnalyticsDashboard);
    initializer.registerRpc("analytics_dashboard_summary", rpcAnalyticsDashboardSummary);
    logger.info("[Analytics] Module registered: 3 RPCs");
}