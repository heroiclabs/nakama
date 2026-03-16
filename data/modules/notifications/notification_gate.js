// notification_gate.js - Notification Budget Gate for QuizVerse v3.0
// RPC: notification_gate_get_state

/**
 * Notification Gate — Production-Ready
 *
 * Controls client-side notification budget to prevent spam.
 * Max 3 notifications/day, 3-hour cooldown between each.
 * Priority queue ensures most important notifications fire first.
 *
 * Storage: collection="notification_state", key="{userId}_{gameId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var DAILY_NOTIFICATION_BUDGET = 3;
var COOLDOWN_HOURS = 3;
var NOTIF_STORAGE_COLLECTION = 'notification_state';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function notifStorageKey(userId, gameId) {
    return userId + '_' + gameId;
}

function readNotifState(nk, logger, userId, gameId) {
    try {
        var records = nk.storageRead([{
            collection: NOTIF_STORAGE_COLLECTION,
            key: notifStorageKey(userId, gameId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[NotifGate] Storage read failed: ' + err.message);
    }
    return null;
}

function writeNotifState(nk, logger, userId, gameId, data) {
    try {
        nk.storageWrite([{
            collection: NOTIF_STORAGE_COLLECTION,
            key: notifStorageKey(userId, gameId),
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[NotifGate] Storage write failed: ' + err.message);
        return false;
    }
}

function getTodayKey() {
    var now = new Date();
    return now.getUTCFullYear() + '-' +
           (now.getUTCMonth() + 1 < 10 ? '0' : '') + (now.getUTCMonth() + 1) + '-' +
           (now.getUTCDate() < 10 ? '0' : '') + now.getUTCDate();
}

function initNotifState() {
    var now = new Date().toISOString();
    return {
        dailyBudget: DAILY_NOTIFICATION_BUDGET,
        usedToday: 0,
        todayKey: getTodayKey(),
        lastNotificationAt: null,
        cooldownEndsAt: null,
        pendingQueue: [],
        history: [],
        totalSent: 0,
        createdAt: now,
        updatedAt: now
    };
}

function notifErrorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function notifValidatePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

// ─── RPC: notification_gate_get_state ───────────────────────────────────────

function rpcNotifGateGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return notifErrorResponse('User not authenticated');

    var data = notifValidatePayload(payload);
    if (data === null) return notifErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var state = readNotifState(nk, logger, ctx.userId, gameId);
    var isNew = false;

    if (!state) {
        state = initNotifState();
        writeNotifState(nk, logger, ctx.userId, gameId, state);
        isNew = true;
    }

    // Reset daily counter if new day
    var todayKey = getTodayKey();
    if (state.todayKey !== todayKey) {
        state.usedToday = 0;
        state.todayKey = todayKey;
        state.pendingQueue = [];  // Clear stale queue
        state.updatedAt = new Date().toISOString();
        writeNotifState(nk, logger, ctx.userId, gameId, state);
    }

    var remaining = Math.max(0, DAILY_NOTIFICATION_BUDGET - state.usedToday);
    var now = new Date();
    var inCooldown = false;
    var cooldownEndsAt = null;

    if (state.lastNotificationAt) {
        var lastNotif = new Date(state.lastNotificationAt);
        var cooldownEnd = new Date(lastNotif.getTime() + COOLDOWN_HOURS * 3600000);
        if (now.getTime() < cooldownEnd.getTime()) {
            inCooldown = true;
            cooldownEndsAt = cooldownEnd.toISOString();
        }
    }

    // Sort pending queue by priority (higher priority = more important)
    var sortedQueue = (state.pendingQueue || []).slice();
    sortedQueue.sort(function(a, b) { return (b.priority || 0) - (a.priority || 0); });

    return JSON.stringify({
        success: true,
        isNew: isNew,
        userId: ctx.userId,
        gameId: gameId,
        dailyBudget: DAILY_NOTIFICATION_BUDGET,
        used: state.usedToday,
        remaining: remaining,
        inCooldown: inCooldown,
        cooldownEndsAt: cooldownEndsAt,
        cooldownHours: COOLDOWN_HOURS,
        lastNotificationAt: state.lastNotificationAt,
        pendingQueue: sortedQueue.slice(0, 10),  // Return max 10
        totalSent: state.totalSent || 0,
        timestamp: now.toISOString()
    });
}
