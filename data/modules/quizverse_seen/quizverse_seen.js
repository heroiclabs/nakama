// quizverse_seen.js - Per-user "seen question" ledger for zero-repetition quiz delivery
// Nakama V8 JavaScript runtime (No ES Modules)
// Collection: qv_seen | Key: {scope_slug}_{topic_slug} | User-owned

// ============================================================================
// CONSTANTS
// ============================================================================

var QVS_COLLECTION = "qv_seen";
var QVS_VERSION = 2;              // Bumped: timestamps now stored as ISO-8601 strings for human readability
var QVS_DEFAULT_REPEAT_AFTER_DAYS = 90; // Increased from 30 → 90 days so questions repeat less often
var QVS_MAX_LEDGER_SIZE = 10000; // Safety cap per key
var QVS_OCC_MAX_RETRIES = 3;    // Optimistic concurrency retries on version conflict

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

/**
 * Read a storage record and return both its value AND its version token.
 * The version token is used for OCC writes (prevents concurrent-session data loss).
 *
 * @returns {{ value: object|null, version: string }}
 */
function qvsStorageRead(nk, collection, key, userId) {
    var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
        return { value: records[0].value, version: records[0].version || "" };
    }
    return { value: null, version: "" };
}

/**
 * Write a storage record.
 * When `version` is a non-empty string, Nakama performs an OCC check:
 * the write is rejected if the stored version has changed since the read.
 * Callers must catch the resulting error and retry.
 * When `version` is falsy the write is unconditional (first-time creation).
 */
function qvsStorageWrite(nk, collection, key, userId, value, version) {
    var writeObj = {
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    };
    if (version) {
        writeObj.version = version; // OCC guard — omit for unconditional first write
    }
    nk.storageWrite([writeObj]);
}

function qvsNowUnix() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Returns a human-readable ISO-8601 UTC datetime string for storage.
 * Example: "2026-05-27T18:30:00Z"
 * Stored as the value for each seen question ID instead of a raw unix integer.
 */
function qvsNowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Parse a seen-entry value (ISO string OR legacy unix number) to unix seconds.
 * Ensures backward compatibility with ledgers written before v2.
 */
function qvsParseTimestamp(val) {
    if (typeof val === "number") return val;               // legacy unix int
    if (typeof val === "string" && val.length > 0) {
        var ms = Date.parse(val);
        if (!isNaN(ms)) return Math.floor(ms / 1000);     // ISO string → unix
    }
    return 0;
}

function qvsSlugify(str) {
    if (!str) return "unknown";
    return str.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .substring(0, 64);
}

/**
 * Build the Nakama storage key for a (scope, topic) pair.
 * Both scope AND topic are slugified so that "daily quiz" and "daily_quiz"
 * cannot collide with "daily" + topic "quiz".
 */
function qvsBuildStorageKey(scope, topic) {
    return qvsSlugify(scope || "global") + "_" + qvsSlugify(topic || "general");
}

// ============================================================================
// CORE LEDGER OPERATIONS
// ============================================================================

/**
 * Read the seen ledger for a given (scope, topic).
 * Returns { ids: { questionId: unixTimestamp, ... }, version: 1 }
 */
function qvsSeenRead(nk, userId, scope, topic) {
    var key = qvsBuildStorageKey(scope, topic);
    var record = qvsStorageRead(nk, QVS_COLLECTION, key, userId);
    if (!record.value || !record.value.ids) {
        return { ids: {}, version: QVS_VERSION };
    }
    return record.value;
}

/**
 * Merge new question IDs into the seen ledger using OCC to prevent
 * data loss when two quiz sessions finish at the same instant.
 *
 * Each ID gets the current Unix timestamp so staleness can be detected later.
 * Retries up to QVS_OCC_MAX_RETRIES times on version conflict before throwing.
 */
function qvsSeenMerge(nk, userId, scope, topic, questionIds) {
    if (!questionIds || questionIds.length === 0) return;

    var key = qvsBuildStorageKey(scope, topic);

    for (var attempt = 0; attempt < QVS_OCC_MAX_RETRIES; attempt++) {
        var record = qvsStorageRead(nk, QVS_COLLECTION, key, userId);
        var data = record.value || { ids: {}, version: QVS_VERSION };
        if (!data.ids) data.ids = {};

        var nowIso  = qvsNowIso();
        var nowUnix = qvsNowUnix();
        for (var i = 0; i < questionIds.length; i++) {
            var qid = questionIds[i];
            if (qid && typeof qid === "string") {
                data.ids[qid] = nowIso; // human-readable ISO-8601 string
            }
        }

        // Safety: cap ledger size by removing oldest entries
        var idKeys = Object.keys(data.ids);
        if (idKeys.length > QVS_MAX_LEDGER_SIZE) {
            var sorted = idKeys.sort(function(a, b) {
                return qvsParseTimestamp(data.ids[a]) - qvsParseTimestamp(data.ids[b]);
            });
            var toRemove = sorted.length - QVS_MAX_LEDGER_SIZE;
            for (var r = 0; r < toRemove; r++) {
                delete data.ids[sorted[r]];
            }
        }

        data.version = QVS_VERSION;

        try {
            qvsStorageWrite(nk, QVS_COLLECTION, key, userId, data, record.version);
            return; // Success
        } catch (writeErr) {
            if (attempt === QVS_OCC_MAX_RETRIES - 1) {
                throw writeErr; // Retries exhausted — propagate
            }
            // Version conflict from a concurrent write — re-read and retry
        }
    }
}

/**
 * Purge stale entries older than repeatAfterDays.
 * Uses OCC to avoid racing with a concurrent merge.
 * Returns the number of entries purged.
 */
function qvsSeenPurgeStale(nk, userId, scope, topic, repeatAfterDays) {
    var key = qvsBuildStorageKey(scope, topic);

    for (var attempt = 0; attempt < QVS_OCC_MAX_RETRIES; attempt++) {
        var record = qvsStorageRead(nk, QVS_COLLECTION, key, userId);
        if (!record.value || !record.value.ids) return 0;

        var data = record.value;
        var cutoff = qvsNowUnix() - (repeatAfterDays * 86400);
        var purged = 0;
        var keys = Object.keys(data.ids);

        for (var i = 0; i < keys.length; i++) {
            // qvsParseTimestamp handles both ISO strings (v2) and legacy unix ints (v1)
            if (qvsParseTimestamp(data.ids[keys[i]]) < cutoff) {
                delete data.ids[keys[i]];
                purged++;
            }
        }

        if (purged === 0) return 0; // Nothing to write

        data.version = QVS_VERSION;

        try {
            qvsStorageWrite(nk, QVS_COLLECTION, key, userId, data, record.version);
            return purged; // Success
        } catch (writeErr) {
            if (attempt === QVS_OCC_MAX_RETRIES - 1) {
                throw writeErr;
            }
        }
    }
    return 0;
}

/**
 * Get the set of seen IDs (keys only, boolean true values) for fast O(1) filtering.
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
            " IDs for user " + userId + ", scope=" + qvsBuildStorageKey(data.scope, data.topic) +
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
            userId + ", key=" + qvsBuildStorageKey(data.scope, data.topic));

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
 * Reset is intentionally unconditional — it wins over any concurrent merge.
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
        // Unconditional reset — no OCC needed; caller intent is to wipe the ledger
        qvsStorageWrite(nk, QVS_COLLECTION, key, userId, { ids: {}, version: QVS_VERSION }, null);

        logger.info("[QuizverseSeen] Reset ledger for user " + userId +
            ", key=" + key + ", cleared=" + clearedCount);

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
// SHARED MODULE INTERFACE
// Exposed on globalThis so quizverse_quiz_generate.js and quiz_results.js
// can use the same battle-tested, OCC-correct implementation instead of
// maintaining independent copies that risk diverging.
// Safe to access from RPC handlers (called after all modules are loaded).
// ============================================================================

globalThis.__qvsSeen = {
    buildKey:   qvsBuildStorageKey,
    merge:      qvsSeenMerge,
    purgeStale: qvsSeenPurgeStale,
    read:       qvsSeenRead,
    getIdSet:   qvsSeenGetIdSet
};

// ============================================================================
// REGISTRATION
// ============================================================================

function registerQuizverseSeenRPCs(initializer, logger) {
    logger.info("[QuizverseSeen] Initializing QuizVerse Seen Ledger RPCs...");

    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }

    var rpcs = [
        { id: "quizverse_seen_get",    handler: rpcQuizverseSeenGet },
        { id: "quizverse_seen_merge",  handler: rpcQuizverseSeenMerge },
        { id: "quizverse_seen_purge",  handler: rpcQuizverseSeenPurge },
        { id: "quizverse_seen_reset",  handler: rpcQuizverseSeenReset },
        { id: "quizverse_seen_stats",  handler: rpcQuizverseSeenStats }
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

// ============================================================================
// MODULE INIT (postbuild AST hook)
// ----------------------------------------------------------------------------
// postbuild.js renames this `InitModule` -> `__ModuleInit_N` so it never
// executes directly. Its purpose is to expose literal registerRpc calls so
// the bundler can:
//   1) Generate `var __rpc_<id>;` stub declarations at the top of index.js
//   2) Rewrite the literal calls below into guarded `__rpc_<id> = __rpc_<id> || (handler)`
//   3) Replay those assignments at IIFE/global scope so every Goja VM has them
//   4) Emit `initializer.registerRpc("<id>", __rpc_<id>)` inside the master InitModule
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("quizverse_seen_get",   rpcQuizverseSeenGet);
    initializer.registerRpc("quizverse_seen_merge", rpcQuizverseSeenMerge);
    initializer.registerRpc("quizverse_seen_purge", rpcQuizverseSeenPurge);
    initializer.registerRpc("quizverse_seen_reset", rpcQuizverseSeenReset);
    initializer.registerRpc("quizverse_seen_stats", rpcQuizverseSeenStats);
    logger.info("[QuizverseSeen] Module InitModule registered: 5 RPCs");
}
