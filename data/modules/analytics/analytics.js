// analytics.js - Analytics System (Per gameId UUID)

/**
 * RPC: Log analytics event
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { gameId: "uuid", eventName: "string", eventData: {} }
 * @returns {string} JSON response
 */
function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC analytics_log_event called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId', 'eventName']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var eventName = data.eventName;
    var eventData = data.eventData || {};
    
    // Create event record
    var event = {
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        eventData: eventData,
        timestamp: utils.getCurrentTimestamp(),
        unixTimestamp: utils.getUnixTimestamp()
    };
    
    // Store event under user's ID (for user-specific queries)
    var collection = "analytics_events";
    var key = "event_" + userId + "_" + gameId + "_" + utils.getUnixTimestamp();
    
    if (!utils.writeStorage(nk, logger, collection, key, userId, event)) {
        return utils.handleError(ctx, null, "Failed to log event");
    }
    
    // ALSO store under SYSTEM_USER for dashboard aggregation (analytics_extended RPCs)
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    var dashboardKey = "dash_" + utils.getStartOfDay() + "_" + eventName + "_" + utils.getUnixTimestamp();
    utils.writeStorage(nk, logger, collection, dashboardKey, SYSTEM_USER, event);
    
    // Track DAU (Daily Active Users)
    trackDAU(nk, logger, userId, gameId);
    
    // Track session if session event
    if (eventName === "session_start" || eventName === "session_end") {
        trackSession(nk, logger, userId, gameId, eventName, eventData);
    }
    
    utils.logInfo(logger, "Event logged: " + eventName + " for user " + userId + " in game " + gameId);
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        timestamp: event.timestamp
    });
}

/**
 * Track Daily Active User - writes both game-level and platform-level DAU keys.
 * Dashboard reads: dauData.uniqueUsers, dauData.count, dauData.newUsers
 */
function trackDAU(nk, logger, userId, gameId) {
    var today = utils.getStartOfDay();
    var collection = "analytics_dau";
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

    var keys = [
        "dau_" + gameId + "_" + today,
        "dau_platform_" + today
    ];

    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var dauData = utils.readStorage(nk, logger, collection, key, SYSTEM_USER);

        if (!dauData) {
            dauData = {
                date: today,
                uniqueUsers: [],
                count: 0,
                newUsers: 0
            };
        }

        // Migrate old "users" field to "uniqueUsers" for dashboard compatibility
        if (!Array.isArray(dauData.uniqueUsers)) {
            dauData.uniqueUsers = Array.isArray(dauData.users) ? dauData.users : [];
        }

        if (dauData.uniqueUsers.indexOf(userId) === -1) {
            dauData.uniqueUsers.push(userId);
            dauData.count = dauData.uniqueUsers.length;
            utils.writeStorage(nk, logger, collection, key, SYSTEM_USER, dauData);
        }
    }
}

/**
 * Track session data (start/end)
 */
function trackSession(nk, logger, userId, gameId, eventName, eventData) {
    var collection = "analytics_sessions";
    var key = utils.makeGameStorageKey("analytics_session", userId, gameId);
    
    if (eventName === "session_start") {
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
            
            // Save session summary
            var summaryKey = "session_summary_" + userId + "_" + gameId + "_" + sessionData.startTime;
            utils.writeStorage(nk, logger, "analytics_session_summaries", summaryKey, userId, sessionData);
            
            // Clear active session
            utils.writeStorage(nk, logger, collection, key, userId, { active: false });

            // Aggregate session stats for dashboard
            aggregateSessionStats(nk, logger, sessionData.duration);
        }
    }
}

/**
 * Aggregate session stats into a daily summary for the analytics dashboard.
 * Key: session_stats_{YYYY-MM-DD}, stored under SYSTEM_USER.
 */
function aggregateSessionStats(nk, logger, durationSeconds) {
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    var today = utils.getStartOfDay();
    var collection = "analytics_sessions";
    var key = "session_stats_" + today;

    var stats = utils.readStorage(nk, logger, collection, key, SYSTEM_USER);
    if (!stats) {
        stats = { date: today, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
    }

    stats.totalSessions++;
    stats.totalDuration += (durationSeconds || 0);
    stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;

    utils.writeStorage(nk, logger, collection, key, SYSTEM_USER, stats);
}

/**
 * RPC: analytics_dashboard
 * Returns DAU, WAU, MAU, retention ratios, trends for the dashboard.
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload { game_id?: string, days?: number }
 * @returns {string} JSON with dau, wau, mau, trends, top_games, etc.
 */
function rpcAnalyticsDashboard(ctx, logger, nk, payload) {
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    var parsed = {};
    try { parsed = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }

    var gameId = parsed.game_id || parsed.gameId || 'all';
    var days = parseInt(parsed.days, 10) || 30;

    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);

    // Collect DAU for the past N days
    var dauTrend = [];
    var dauSet = {};  // userId -> first seen date
    var wauSet = {};
    var mauSet = {};
    var newUsersToday = 0;

    for (var d = 0; d < days; d++) {
        var date = new Date(now.getTime() - d * 86400000);
        var dateStr = date.toISOString().slice(0, 10);
        var key = gameId === 'all' ? 'dau_platform_' + dateStr : 'dau_' + gameId + '_' + dateStr;

        var record = null;
        try {
            var objs = nk.storageRead([{ collection: 'analytics_dau', key: key, userId: SYSTEM_USER }]);
            if (objs && objs.length > 0) record = objs[0].value;
        } catch (e) { /* no data */ }

        var dayUsers = 0;
        var dayNewUsers = 0;
        if (record) {
            dayUsers = record.count || record.uniqueUsers || (record.users ? record.users.length : 0);
            dayNewUsers = record.newUsers || 0;
            if (d === 0) newUsersToday = dayNewUsers;

            // Track unique users for WAU/MAU
            var userList = record.users || record.uniqueUsers || [];
            if (Array.isArray(userList)) {
                userList.forEach(function(uid) {
                    if (d < 7) wauSet[uid] = true;
                    mauSet[uid] = true;
                });
            } else if (typeof dayUsers === 'number') {
                // If we only have count, estimate
                if (d < 7) wauSet['day_' + d] = dayUsers;
                mauSet['day_' + d] = dayUsers;
            }
        }

        dauTrend.unshift({ date: dateStr, count: dayUsers, newUsers: dayNewUsers });
    }

    // Calculate DAU (today), WAU (7d), MAU (30d)
    var dau = dauTrend.length > 0 ? dauTrend[dauTrend.length - 1].count : 0;
    var wau = Object.keys(wauSet).length;
    var mau = Object.keys(mauSet).length;

    // If wauSet/mauSet has estimated counts, sum them
    if (wau === 0 && dauTrend.length > 0) {
        wau = dauTrend.slice(-7).reduce(function(sum, day) { return sum + day.count; }, 0);
    }
    if (mau === 0 && dauTrend.length > 0) {
        mau = dauTrend.reduce(function(sum, day) { return sum + day.count; }, 0);
    }

    var dauMauRatio = mau > 0 ? dau / mau : 0;

    // 7-day change percent
    var dau7dAgo = dauTrend.length >= 8 ? dauTrend[dauTrend.length - 8].count : dau;
    var dau7dChangePct = dau7dAgo > 0 ? Math.round(((dau - dau7dAgo) / dau7dAgo) * 100) : 0;

    // Session stats
    var sessionKey = 'session_stats_' + todayStr;
    var sessionStats = null;
    try {
        var sessObjs = nk.storageRead([{ collection: 'analytics_sessions', key: sessionKey, userId: SYSTEM_USER }]);
        if (sessObjs && sessObjs.length > 0) sessionStats = sessObjs[0].value;
    } catch (e) { /* no data */ }

    var avgSessionDuration = sessionStats ? sessionStats.avgDuration : 0;

    // Top games (if platform-wide)
    var topGames = [];
    if (gameId === 'all') {
        // Scan recent DAU keys to find game-specific data
        try {
            var cursor = null;
            var gameStats = {};
            var scanObjs = nk.storageList(SYSTEM_USER, 'analytics_dau', 100, cursor);
            if (scanObjs && scanObjs.objects) {
                scanObjs.objects.forEach(function(obj) {
                    if (obj.key.indexOf('dau_platform_') === -1 && obj.key.indexOf('dau_') === 0) {
                        var parts = obj.key.split('_');
                        if (parts.length >= 3) {
                            var gid = parts[1];
                            if (!gameStats[gid]) gameStats[gid] = { gameId: gid, totalDau: 0, days: 0 };
                            gameStats[gid].totalDau += obj.value.count || obj.value.uniqueUsers || 0;
                            gameStats[gid].days++;
                        }
                    }
                });
            }
            topGames = Object.keys(gameStats).map(function(gid) {
                return { gameId: gid, avgDau: Math.round(gameStats[gid].totalDau / Math.max(1, gameStats[gid].days)) };
            }).sort(function(a, b) { return b.avgDau - a.avgDau; }).slice(0, 5);
        } catch (e) {
            logger.warn('[Analytics] Top games scan error: ' + e.message);
        }
    }

    return JSON.stringify({
        success: true,
        dau: dau,
        wau: wau,
        mau: mau,
        dau_mau_ratio: dauMauRatio,
        new_users_today: newUsersToday,
        avg_session_duration_seconds: avgSessionDuration,
        dau_trend: dauTrend.slice(-14).map(function(d) { return { date: d.date, dau: d.count }; }),
        trends: {
            dau_7d_change_pct: dau7dChangePct
        },
        top_games: topGames
    });
}

// Registration - postbuild.js scans for this
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
    initializer.registerRpc("analytics_dashboard", rpcAnalyticsDashboard);
    logger.info("[Analytics] Module registered: 2 RPCs");
}