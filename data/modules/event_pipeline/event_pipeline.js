// event_pipeline.js - Unified event ingestion and reward-pending checks
// Compatible with Nakama JavaScript runtime (no ES modules)

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateUUID() {
    var d = new Date().getTime();
    var d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function safeRead(nk, collection, key, userId) {
    try {
        var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
        if (recs && recs.length > 0) return recs[0].value;
    } catch (_) { /* swallow */ }
    return null;
}

function safeWrite(nk, collection, key, userId, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function nowISO() {
    return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Fan-out helpers – each returns { success, data?, error? }
// ---------------------------------------------------------------------------

function fanOutLogEvent(nk, logger, userId, eventType, eventData, deviceId, gameId) {
    var logEntry = {
        event_type: eventType,
        event_data: eventData,
        device_id: deviceId,
        game_id: gameId,
        timestamp: nowISO()
    };
    safeWrite(nk, "event_pipeline_log", eventType + ":" + generateUUID(), userId, logEntry);
    return { success: true };
}

function fanOutGrantXP(nk, logger, userId, xpAmount, source) {
    if (xpAmount <= 0) return { success: true, xp: 0 };
    var xpInt = Math.floor(xpAmount);
    try {
        nk.walletUpdate(userId, { coins: 0, gems: 0, xp: xpInt }, { source: source }, true);
        return { success: true, xp: xpInt };
    } catch (err) {
        logger.warn("[event_pipeline] XP grant failed: " + err.message);
        return { success: false, error: err.message };
    }
}

function fanOutMasteryXP(nk, logger, userId, category, xpAmount, gameId) {
    if (!category) return { success: true, skipped: true };
    var key = "mastery:" + gameId + ":" + category;
    var existing = safeRead(nk, "mastery_xp", key, userId);
    var record = existing || { category: category, game_id: gameId, total_xp: 0, level: 1 };
    record.total_xp += Math.floor(xpAmount);
    record.level = Math.floor(record.total_xp / 1000) + 1;
    record.updated_at = nowISO();
    safeWrite(nk, "mastery_xp", key, userId, record);
    return { success: true, total_xp: record.total_xp, level: record.level };
}

function fanOutAchievements(nk, logger, userId, eventType, eventData, gameId) {
    var key = "progress:" + gameId;
    var progress = safeRead(nk, "achievements_progress", key, userId) || { events: {} };
    var count = (progress.events[eventType] || 0) + 1;
    progress.events[eventType] = count;
    progress.updated_at = nowISO();
    safeWrite(nk, "achievements_progress", key, userId, progress);
    return { success: true, event_count: count };
}

function fanOutSeasonPass(nk, logger, userId, xpAmount, gameId) {
    var key = "season_pass:" + gameId;
    var sp = safeRead(nk, "season_pass", key, userId) || { xp: 0, level: 0, claimed_levels: [] };
    sp.xp += Math.floor(xpAmount);
    sp.level = Math.floor(sp.xp / 500);
    sp.updated_at = nowISO();
    safeWrite(nk, "season_pass", key, userId, sp);
    return { success: true, xp: sp.xp, level: sp.level };
}

function fanOutWeeklyGoals(nk, logger, userId, eventType, eventData, gameId) {
    var now = new Date();
    var weekKey = "weekly:" + gameId + ":" + now.getFullYear() + "W" + Math.ceil((now.getDate() + now.getDay()) / 7);
    var goals = safeRead(nk, "weekly_goals", weekKey, userId) || { tasks: {}, completed: false };
    var count = (goals.tasks[eventType] || 0) + 1;
    goals.tasks[eventType] = count;
    goals.updated_at = nowISO();
    safeWrite(nk, "weekly_goals", weekKey, userId, goals);
    return { success: true, tasks: goals.tasks };
}

function fanOutDailyMissions(nk, logger, userId, eventType, eventData, gameId) {
    var today = nowISO().substring(0, 10);
    var key = "daily_mission:" + gameId + ":" + today;
    var missions = safeRead(nk, "daily_missions", key, userId) || { tasks: {}, completed: false, claimed: false };
    var count = (missions.tasks[eventType] || 0) + 1;
    missions.tasks[eventType] = count;
    missions.updated_at = nowISO();
    safeWrite(nk, "daily_missions", key, userId, missions);
    return { success: true, tasks: missions.tasks };
}

function fanOutDailyStreak(nk, logger, userId, gameId) {
    var today = nowISO().substring(0, 10);
    var key = "daily_streak:" + gameId;
    var streak = safeRead(nk, "daily_streaks", key, userId) || { current: 0, longest: 0, last_login: "", claimed: false };
    if (streak.last_login === today) return { success: true, already_logged: true, current: streak.current };
    var yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
    streak.current = (streak.last_login === yesterday) ? streak.current + 1 : 1;
    if (streak.current > streak.longest) streak.longest = streak.current;
    streak.last_login = today;
    streak.claimed = false;
    streak.updated_at = nowISO();
    safeWrite(nk, "daily_streaks", key, userId, streak);
    return { success: true, current: streak.current, longest: streak.longest };
}

function fanOutAnalytics(nk, logger, userId, eventType, eventData, gameId) {
    var entry = {
        user_id: userId,
        game_id: gameId,
        event_type: eventType,
        event_data: eventData,
        timestamp: nowISO()
    };
    safeWrite(nk, "analytics_events", eventType + ":" + generateUUID(), userId, entry);
    return { success: true };
}

// ---------------------------------------------------------------------------
// RPC 1 – rpcPlayerEventSubmit
// ---------------------------------------------------------------------------

/**
 * Mega-RPC: ingests a player event and fans out to every subsystem.
 * Payload: { device_id, game_id, event_type, event_data }
 */
function rpcPlayerEventSubmit(ctx, logger, nk, payload) {
    logger.info("[event_pipeline] rpcPlayerEventSubmit called");

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.event_type) {
            return JSON.stringify({ success: false, error: "event_type is required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var deviceId = data.device_id || "";
        var gameId = data.game_id || "";
        var eventType = data.event_type;
        var eventData = data.event_data || {};
        var rewards = [];
        var fanOutResults = {};
        var xpEarned = 0;

        // ----- Event-specific logic -----

        if (eventType === "quiz_complete") {
            var score = Number(eventData.score) || 0;
            xpEarned = Math.floor(score * 0.1);
            try {
                fanOutResults.xp_grant = fanOutGrantXP(nk, logger, userId, xpEarned, "quiz_complete");
            } catch (e) { fanOutResults.xp_grant = { success: false, error: e.message }; }

            try {
                fanOutResults.mastery = fanOutMasteryXP(nk, logger, userId, eventData.category, xpEarned, gameId);
            } catch (e) { fanOutResults.mastery = { success: false, error: e.message }; }

            try {
                fanOutResults.analytics = fanOutAnalytics(nk, logger, userId, eventType, eventData, gameId);
            } catch (e) { fanOutResults.analytics = { success: false, error: e.message }; }

            if (xpEarned > 0) rewards.push({ type: "xp", amount: xpEarned, source: "quiz_complete" });

        } else if (eventType === "match_complete") {
            var survivalTime = Number(eventData.survival_time) || 0;
            xpEarned = Math.floor(survivalTime * 0.5);
            try {
                fanOutResults.xp_grant = fanOutGrantXP(nk, logger, userId, xpEarned, "match_complete");
            } catch (e) { fanOutResults.xp_grant = { success: false, error: e.message }; }

            try {
                fanOutResults.analytics = fanOutAnalytics(nk, logger, userId, eventType, eventData, gameId);
            } catch (e) { fanOutResults.analytics = { success: false, error: e.message }; }

            if (xpEarned > 0) rewards.push({ type: "xp", amount: xpEarned, source: "match_complete" });

        } else if (eventType === "login") {
            try {
                fanOutResults.daily_streak = fanOutDailyStreak(nk, logger, userId, gameId);
            } catch (e) { fanOutResults.daily_streak = { success: false, error: e.message }; }

            try {
                fanOutResults.analytics = fanOutAnalytics(nk, logger, userId, eventType, eventData, gameId);
            } catch (e) { fanOutResults.analytics = { success: false, error: e.message }; }

        } else {
            // purchase, friend_added, multiplayer_win, etc.
            try {
                fanOutResults.analytics = fanOutAnalytics(nk, logger, userId, eventType, eventData, gameId);
            } catch (e) { fanOutResults.analytics = { success: false, error: e.message }; }
        }

        // ----- Common fan-out for ALL events -----

        try {
            fanOutResults.event_log = fanOutLogEvent(nk, logger, userId, eventType, eventData, deviceId, gameId);
        } catch (e) { fanOutResults.event_log = { success: false, error: e.message }; }

        try {
            fanOutResults.achievements = fanOutAchievements(nk, logger, userId, eventType, eventData, gameId);
        } catch (e) { fanOutResults.achievements = { success: false, error: e.message }; }

        try {
            fanOutResults.season_pass = fanOutSeasonPass(nk, logger, userId, xpEarned > 0 ? xpEarned : 10, gameId);
        } catch (e) { fanOutResults.season_pass = { success: false, error: e.message }; }

        try {
            fanOutResults.weekly_goals = fanOutWeeklyGoals(nk, logger, userId, eventType, eventData, gameId);
        } catch (e) { fanOutResults.weekly_goals = { success: false, error: e.message }; }

        try {
            fanOutResults.daily_missions = fanOutDailyMissions(nk, logger, userId, eventType, eventData, gameId);
        } catch (e) { fanOutResults.daily_missions = { success: false, error: e.message }; }

        return JSON.stringify({
            success: true,
            event_type: eventType,
            fan_out_results: fanOutResults,
            rewards_earned: rewards
        });

    } catch (err) {
        logger.error("[event_pipeline] rpcPlayerEventSubmit error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// RPC 2 – rpcRewardsPending
// ---------------------------------------------------------------------------

/**
 * Scans every reward sub-system for unclaimed rewards.
 * Payload: { device_id, game_id }
 */
function rpcRewardsPending(ctx, logger, nk, payload) {
    logger.info("[event_pipeline] rpcRewardsPending called");

    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId || SYSTEM_USER_ID;
        var gameId = data.game_id || "";
        var unclaimed = [];
        var totalCoins = 0;
        var totalGems = 0;
        var totalXP = 0;

        // 1. Daily streak reward
        try {
            var streakKey = "daily_streak:" + gameId;
            var streak = safeRead(nk, "daily_streaks", streakKey, userId);
            if (streak && !streak.claimed && streak.current > 0) {
                var streakCoins = streak.current * 50;
                unclaimed.push({
                    source: "daily_streak",
                    description: "Day " + streak.current + " streak reward",
                    reward: { coins: streakCoins, gems: 0, xp: 0 }
                });
                totalCoins += streakCoins;
            }
        } catch (e) {
            logger.warn("[event_pipeline] streak check failed: " + e.message);
        }

        // 2. Daily missions
        try {
            var today = nowISO().substring(0, 10);
            var missionKey = "daily_mission:" + gameId + ":" + today;
            var missions = safeRead(nk, "daily_missions", missionKey, userId);
            if (missions && missions.completed && !missions.claimed) {
                unclaimed.push({
                    source: "daily_missions",
                    description: "Daily missions complete",
                    reward: { coins: 100, gems: 5, xp: 50 }
                });
                totalCoins += 100;
                totalGems += 5;
                totalXP += 50;
            }
        } catch (e) {
            logger.warn("[event_pipeline] daily missions check failed: " + e.message);
        }

        // 3. Weekly goals
        try {
            var now = new Date();
            var weekKey = "weekly:" + gameId + ":" + now.getFullYear() + "W" + Math.ceil((now.getDate() + now.getDay()) / 7);
            var goals = safeRead(nk, "weekly_goals", weekKey, userId);
            if (goals && goals.completed && !goals.claimed) {
                unclaimed.push({
                    source: "weekly_goals",
                    description: "Weekly goals complete",
                    reward: { coins: 500, gems: 20, xp: 200 }
                });
                totalCoins += 500;
                totalGems += 20;
                totalXP += 200;
            }
        } catch (e) {
            logger.warn("[event_pipeline] weekly goals check failed: " + e.message);
        }

        // 4. Season pass – unclaimed levels
        try {
            var spKey = "season_pass:" + gameId;
            var sp = safeRead(nk, "season_pass", spKey, userId);
            if (sp && sp.level > 0) {
                var claimed = sp.claimed_levels || [];
                for (var lvl = 1; lvl <= sp.level; lvl++) {
                    if (claimed.indexOf(lvl) === -1) {
                        var lvlCoins = lvl * 100;
                        var lvlGems = lvl * 5;
                        unclaimed.push({
                            source: "season_pass",
                            description: "Season pass level " + lvl,
                            reward: { coins: lvlCoins, gems: lvlGems, xp: 0 }
                        });
                        totalCoins += lvlCoins;
                        totalGems += lvlGems;
                    }
                }
            }
        } catch (e) {
            logger.warn("[event_pipeline] season pass check failed: " + e.message);
        }

        // 5. Monthly milestones
        try {
            var monthKey = "milestone:" + gameId + ":" + nowISO().substring(0, 7);
            var milestones = safeRead(nk, "monthly_milestones", monthKey, userId);
            if (milestones && milestones.completed && !milestones.claimed) {
                unclaimed.push({
                    source: "monthly_milestones",
                    description: "Monthly milestone complete",
                    reward: { coins: 1000, gems: 50, xp: 500 }
                });
                totalCoins += 1000;
                totalGems += 50;
                totalXP += 500;
            }
        } catch (e) {
            logger.warn("[event_pipeline] monthly milestones check failed: " + e.message);
        }

        return JSON.stringify({
            success: true,
            unclaimed: unclaimed,
            total_value: { coins: totalCoins, gems: totalGems, xp: totalXP }
        });

    } catch (err) {
        logger.error("[event_pipeline] rpcRewardsPending error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}
