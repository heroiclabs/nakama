// quizverse_seen.js - Per-user "seen question" ledger for zero-repetition quiz delivery
// Nakama V8 JavaScript runtime (No ES Modules)
// Collection: qv_seen | Key: {scope}_{topic_slug} | User-owned

// ============================================================================
// CONSTANTS
// ============================================================================

var QVS_COLLECTION = "qv_seen";
var QVS_VERSION = 1;
var QVS_DEFAULT_REPEAT_AFTER_DAYS = 30;
var QVS_MAX_LEDGER_SIZE = 10000; // Safety cap per key

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function qvsParsePayload(payload, requiredFields) {
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (e) {
        throw Error("Invalid JSON payload");
    }
    for (var i = 0; i < requiredFields.length; i++) {
        if (data[requiredFields[i]] === undefined || data[requiredFields[i]] === null) {
            throw Error("Missing required field: " + requiredFields[i]);
        }
    }
    return data;
}

function qvsStorageRead(nk, collection, key, userId) {
    var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
        return records[0].value;
    }
    return null;
}

function qvsStorageWrite(nk, collection, key, userId, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function qvsNowUnix() {
    return Math.floor(Date.now() / 1000);
}

function qvsSlugify(str) {
    if (!str) return "unknown";
    return str.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .substring(0, 64);
}

function qvsBuildStorageKey(scope, topic) {
    var slug = qvsSlugify(topic);
    return (scope || "global") + "_" + slug;
}

// ============================================================================
// CORE LEDGER OPERATIONS
// ============================================================================

/**
 * Read the seen ledger for a given scope+topic.
 * Returns { ids: { questionId: unixTimestamp, ... }, version: 1 }
 */
function qvsSeenRead(nk, userId, scope, topic) {
    var key = qvsBuildStorageKey(scope, topic);
    var data = qvsStorageRead(nk, QVS_COLLECTION, key, userId);
    if (!data || !data.ids) {
        return { ids: {}, version: QVS_VERSION };
    }
    return data;
}

/**
 * Merge new question IDs into the existing ledger.
 * Each ID gets the current Unix timestamp.
 */
function qvsSeenMerge(nk, userId, scope, topic, questionIds) {
    if (!questionIds || questionIds.length === 0) return;

    var key = qvsBuildStorageKey(scope, topic);
    var data = qvsStorageRead(nk, QVS_COLLECTION, key, userId);
    if (!data || !data.ids) {
        data = { ids: {}, version: QVS_VERSION };
    }

    var now = qvsNowUnix();
    for (var i = 0; i < questionIds.length; i++) {
        var qid = questionIds[i];
        if (qid && typeof qid === "string") {
            data.ids[qid] = now;
        }
    }

    // Safety: cap ledger size by removing oldest entries
    var idKeys = Object.keys(data.ids);
    if (idKeys.length > QVS_MAX_LEDGER_SIZE) {
        // Sort by timestamp ascending, remove oldest
        var sorted = idKeys.sort(function(a, b) { return data.ids[a] - data.ids[b]; });
        var toRemove = sorted.length - QVS_MAX_LEDGER_SIZE;
        for (var r = 0; r < toRemove; r++) {
            delete data.ids[sorted[r]];
        }
    }

    data.version = QVS_VERSION;
    qvsStorageWrite(nk, QVS_COLLECTION, key, userId, data);
}

/**
 * Purge stale entries older than repeatAfterDays.
 * Returns the number of entries purged.
 */
function qvsSeenPurgeStale(nk, userId, scope, topic, repeatAfterDays) {
    var key = qvsBuildStorageKey(scope, topic);
    var data = qvsStorageRead(nk, QVS_COLLECTION, key, userId);
    if (!data || !data.ids) return 0;

    var cutoff = qvsNowUnix() - (repeatAfterDays * 86400);
    var purged = 0;
    var ids = data.ids;
    var keys = Object.keys(ids);

    for (var i = 0; i < keys.length; i++) {
        if (ids[keys[i]] < cutoff) {
            delete ids[keys[i]];
            purged++;
        }
    }

    if (purged > 0) {
        data.version = QVS_VERSION;
        qvsStorageWrite(nk, QVS_COLLECTION, key, userId, data);
    }

    return purged;
}

/**
 * Get the set of seen IDs (keys only) for filtering.
 */
function qvsSeenGetIdSet(nk, userId, scope, topic) {
    var data = qvsSeenRead(nk, userId, scope, topic);
    var idSet = {};
    var keys = Object.keys(data.ids);
    for (var i = 0; i < keys.length; i++) {
        idSet[keys[i]] = true;
    }
    return idSet;
}

// ============================================================================
// RPC HANDLERS
// ============================================================================

/**
 * RPC: quizverse_seen_get
 * Get a user's seen ledger for a given scope+topic.
 *
 * Request: { "scope": "global", "topic": "science" }
 * Response: { "success": true, "seen_count": 150, "ids": {...}, "storage_key": "global_science" }
 */
function rpcQuizverseSeenGet(ctx, logger, nk, payload) {
    try {
        var data = qvsParsePayload(payload, ["scope", "topic"]);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        var ledger = qvsSeenRead(nk, userId, data.scope, data.topic);
        var idKeys = Object.keys(ledger.ids);

        return JSON.stringify({
            success: true,
            seen_count: idKeys.length,
            ids: ledger.ids,
            storage_key: qvsBuildStorageKey(data.scope, data.topic),
            version: ledger.version
        });

    } catch (err) {
        logger.error("rpcQuizverseSeenGet error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quizverse_seen_merge
 * Merge a batch of question IDs into the user's seen ledger.
 * Called by quiz_submit_result or directly after a quiz session.
 *
 * Request: { "scope": "global", "topic": "science", "question_ids": ["id1", "id2"] }
 * Response: { "success": true, "merged_count": 10, "total_seen": 160 }
 */
function rpcQuizverseSeenMerge(ctx, logger, nk, payload) {
    try {
        var data = qvsParsePayload(payload, ["scope", "topic", "question_ids"]);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        if (!Array.isArray(data.question_ids)) {
            return JSON.stringify({ success: false, error: "question_ids must be an array" });
        }

        qvsSeenMerge(nk, userId, data.scope, data.topic, data.question_ids);
        var ledger = qvsSeenRead(nk, userId, data.scope, data.topic);

        logger.info("[QuizverseSeen] Merged " + data.question_ids.length +
            " IDs for user " + userId + ", scope=" + data.scope + "_" + data.topic +
            ", total=" + Object.keys(ledger.ids).length);

        return JSON.stringify({
            success: true,
            merged_count: data.question_ids.length,
            total_seen: Object.keys(ledger.ids).length
        });

    } catch (err) {
        logger.error("rpcQuizverseSeenMerge error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quizverse_seen_purge
 * Purge stale entries older than N days.
 *
 * Request: { "scope": "global", "topic": "science", "repeat_after_days": 30 }
 * Response: { "success": true, "purged_count": 5, "remaining": 145 }
 */
function rpcQuizverseSeenPurge(ctx, logger, nk, payload) {
    try {
        var data = qvsParsePayload(payload, ["scope", "topic"]);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        var days = parseInt(data.repeat_after_days) || QVS_DEFAULT_REPEAT_AFTER_DAYS;
        var purged = qvsSeenPurgeStale(nk, userId, data.scope, data.topic, days);
        var ledger = qvsSeenRead(nk, userId, data.scope, data.topic);

        logger.info("[QuizverseSeen] Purged " + purged + " stale entries for user " +
            userId + ", scope=" + data.scope + "_" + data.topic);

        return JSON.stringify({
            success: true,
            purged_count: purged,
            remaining: Object.keys(ledger.ids).length
        });

    } catch (err) {
        logger.error("rpcQuizverseSeenPurge error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quizverse_seen_reset
 * Reset (clear) a user's seen ledger for a scope+topic. Debug/admin use.
 *
 * Request: { "scope": "global", "topic": "science" }
 * Response: { "success": true, "cleared_count": 150 }
 */
function rpcQuizverseSeenReset(ctx, logger, nk, payload) {
    try {
        var data = qvsParsePayload(payload, ["scope", "topic"]);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        var ledger = qvsSeenRead(nk, userId, data.scope, data.topic);
        var clearedCount = Object.keys(ledger.ids).length;

        var key = qvsBuildStorageKey(data.scope, data.topic);
        qvsStorageWrite(nk, QVS_COLLECTION, key, userId, { ids: {}, version: QVS_VERSION });

        logger.info("[QuizverseSeen] Reset ledger for user " + userId +
            ", scope=" + data.scope + "_" + data.topic + ", cleared=" + clearedCount);

        return JSON.stringify({
            success: true,
            cleared_count: clearedCount
        });

    } catch (err) {
        logger.error("rpcQuizverseSeenReset error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quizverse_seen_stats
 * Get aggregated stats across all ledger scopes for a user.
 *
 * Request: {} (no params needed)
 * Response: { "success": true, "scopes": { "global_science": 150, ... }, "total": 500 }
 */
function rpcQuizverseSeenStats(ctx, logger, nk, payload) {
    try {
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        // List all objects in the qv_seen collection for this user
        var cursor = "";
        var allScopes = {};
        var total = 0;

        do {
            var result = nk.storageList(userId, QVS_COLLECTION, 100, cursor);
            if (result && result.objects) {
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var count = 0;
                    if (obj.value && obj.value.ids) {
                        count = Object.keys(obj.value.ids).length;
                    }
                    allScopes[obj.key] = count;
                    total += count;
                }
            }
            cursor = (result && result.cursor) ? result.cursor : "";
        } while (cursor && cursor.length > 0);

        return JSON.stringify({
            success: true,
            scopes: allScopes,
            total: total
        });

    } catch (err) {
        logger.error("rpcQuizverseSeenStats error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// REGISTRATION
// ============================================================================

function registerQuizverseSeenRPCs(initializer, logger) {
    logger.info("[QuizverseSeen] Initializing QuizVerse Seen Ledger RPCs...");

    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }

    var rpcs = [
        { id: "quizverse_seen_get", handler: rpcQuizverseSeenGet },
        { id: "quizverse_seen_merge", handler: rpcQuizverseSeenMerge },
        { id: "quizverse_seen_purge", handler: rpcQuizverseSeenPurge },
        { id: "quizverse_seen_reset", handler: rpcQuizverseSeenReset },
        { id: "quizverse_seen_stats", handler: rpcQuizverseSeenStats }
    ];

    var registered = 0;
    var skipped = 0;

    for (var i = 0; i < rpcs.length; i++) {
        var rpc = rpcs[i];
        if (!globalThis.__registeredRPCs.has(rpc.id)) {
            try {
                initializer.registerRpc(rpc.id, rpc.handler);
                globalThis.__registeredRPCs.add(rpc.id);
                logger.info("[QuizverseSeen] Registered RPC: " + rpc.id);
                registered++;
            } catch (err) {
                logger.error("[QuizverseSeen] Failed to register " + rpc.id + ": " + err.message);
            }
        } else {
            logger.info("[QuizverseSeen] Skipped (already registered): " + rpc.id);
            skipped++;
        }
    }

    logger.info("[QuizverseSeen] Registration complete: " + registered + " registered, " + skipped + " skipped");
}
