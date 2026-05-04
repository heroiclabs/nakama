// quizverse_quiz_generate.js - Server-authoritative question delivery RPC
// Nakama V8 JavaScript runtime (No ES Modules)
//
// Fetches the question pool (from S3 URL), filters out seen questions using
// the qv_seen ledger, handles exhaustion (purge stale → backfill oldest),
// and returns a fresh, deduplicated set of questions.

// ============================================================================
// CONSTANTS
// ============================================================================

var QQG_COLLECTION = "qv_seen";
var QQG_DEFAULT_COUNT = 10;
var QQG_DEFAULT_REPEAT_AFTER_DAYS = 30;
var QQG_MAX_COUNT = 50;
var QQG_HTTP_TIMEOUT_MS = 10000;

// ============================================================================
// UTILITY HELPERS (self-contained, no cross-module deps)
// ============================================================================

function qqgParsePayload(payload, requiredFields) {
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

function qqgStorageRead(nk, collection, key, userId) {
    var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
        return records[0].value;
    }
    return null;
}

function qqgStorageWrite(nk, collection, key, userId, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function qqgNowUnix() {
    return Math.floor(Date.now() / 1000);
}

function qqgSlugify(str) {
    if (!str) return "unknown";
    return str.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .substring(0, 64);
}

function qqgBuildStorageKey(scope, topic) {
    var slug = qqgSlugify(topic);
    return (scope || "global") + "_" + slug;
}

// ============================================================================
// QUESTION ID HASHING (must match Unity QuestionIdHasher.cs)
// ============================================================================

/**
 * Compute a stable question ID.
 * Algorithm: SHA-256 of normalized(question + "|" + sorted_options), take first 12 hex chars.
 * Result: prefix_topicSlug_hash12
 *
 * @param {string} prefix - e.g., "s3", "ai", "ext"
 * @param {string} topic - e.g., "science"
 * @param {string} question - the question text
 * @param {string[]} options - the answer options
 * @returns {string} stable question ID
 */
function qqgComputeQuestionId(nk, prefix, topic, question, options) {
    // Normalize
    var normalizedQ = (question || "").trim().toLowerCase();
    var normalizedOpts = [];
    if (options && options.length > 0) {
        for (var i = 0; i < options.length; i++) {
            normalizedOpts.push((options[i] || "").trim().toLowerCase());
        }
        normalizedOpts.sort();
    }

    var raw = normalizedQ;
    for (var j = 0; j < normalizedOpts.length; j++) {
        raw += "|" + normalizedOpts[j];
    }

    // SHA-256 hash → first 12 hex chars
    var hashBytes = nk.sha256Hash(raw); // returns hex string
    var hash12 = hashBytes.substring(0, 12);

    var slug = qqgSlugify(topic);
    return prefix + "_" + slug + "_" + hash12;
}

// ============================================================================
// SEEN LEDGER HELPERS (read-through, no external module dependency)
// ============================================================================

function qqgSeenRead(nk, userId, scope, topic) {
    var key = qqgBuildStorageKey(scope, topic);
    var data = qqgStorageRead(nk, QQG_COLLECTION, key, userId);
    if (!data || !data.ids) {
        return { ids: {} };
    }
    return data;
}

function qqgSeenMerge(nk, userId, scope, topic, questionIds) {
    if (!questionIds || questionIds.length === 0) return;
    var key = qqgBuildStorageKey(scope, topic);
    var data = qqgStorageRead(nk, QQG_COLLECTION, key, userId);
    if (!data || !data.ids) {
        data = { ids: {}, version: 1 };
    }
    var now = qqgNowUnix();
    for (var i = 0; i < questionIds.length; i++) {
        if (questionIds[i]) data.ids[questionIds[i]] = now;
    }
    data.version = 1;
    qqgStorageWrite(nk, QQG_COLLECTION, key, userId, data);
}

function qqgSeenPurgeStale(nk, userId, scope, topic, repeatAfterDays) {
    var key = qqgBuildStorageKey(scope, topic);
    var data = qqgStorageRead(nk, QQG_COLLECTION, key, userId);
    if (!data || !data.ids) return 0;
    var cutoff = qqgNowUnix() - (repeatAfterDays * 86400);
    var purged = 0;
    var keys = Object.keys(data.ids);
    for (var i = 0; i < keys.length; i++) {
        if (data.ids[keys[i]] < cutoff) {
            delete data.ids[keys[i]];
            purged++;
        }
    }
    if (purged > 0) {
        data.version = 1;
        qqgStorageWrite(nk, QQG_COLLECTION, key, userId, data);
    }
    return purged;
}

// ============================================================================
// POOL FETCHING
// ============================================================================

/**
 * Fetch question pool from an S3 URL via HTTP GET.
 * Returns the parsed JSON array of questions, or null on failure.
 */
function qqgFetchPool(nk, logger, url) {
    if (!url) return null;

    try {
        var response = nk.httpRequest(url, "get", {}, null, QQG_HTTP_TIMEOUT_MS);
        if (response.code !== 200) {
            logger.warn("[QuizGen] HTTP " + response.code + " from " + url);
            return null;
        }

        var body = response.body;
        if (!body) return null;

        var parsed = JSON.parse(body);

        // Handle different S3 JSON formats
        // Format 1: { questions: [...] }
        if (parsed.questions && Array.isArray(parsed.questions)) {
            return parsed.questions;
        }
        // Format 2: { topics: { science: { questions: [...] } } }
        if (parsed.topics && typeof parsed.topics === "object") {
            return parsed;  // Return the whole object, topic extraction done later
        }
        // Format 3: Direct array
        if (Array.isArray(parsed)) {
            return parsed;
        }

        logger.warn("[QuizGen] Unexpected JSON structure from " + url);
        return null;

    } catch (err) {
        logger.error("[QuizGen] Failed to fetch pool from " + url + ": " + err.message);
        return null;
    }
}

/**
 * Extract questions for a specific topic from the pool data.
 * Handles both flat arrays and nested topic structures.
 */
function qqgExtractTopicQuestions(poolData, topic) {
    if (!poolData) return [];

    // If it's a direct array, return all (no topic filtering needed)
    if (Array.isArray(poolData)) {
        return poolData;
    }

    // If it has topics, extract the specific topic
    if (poolData.topics && typeof poolData.topics === "object") {
        var topicSlug = qqgSlugify(topic);
        // Try exact match first, then slug match
        for (var key in poolData.topics) {
            if (key === topic || qqgSlugify(key) === topicSlug) {
                var topicData = poolData.topics[key];
                if (topicData.questions && Array.isArray(topicData.questions)) {
                    return topicData.questions;
                }
                if (Array.isArray(topicData)) {
                    return topicData;
                }
            }
        }
    }

    // If it has a questions array at root
    if (poolData.questions && Array.isArray(poolData.questions)) {
        return poolData.questions;
    }

    return [];
}

// ============================================================================
// FILTERING & SAMPLING
// ============================================================================

/**
 * Fisher-Yates shuffle (in-place).
 */
function qqgShuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

/**
 * Compute IDs for all questions in the pool and filter out seen ones.
 *
 * @returns {{ unseen: Array, seen: Array, allWithIds: Array }}
 */
function qqgFilterPool(nk, questions, seenIdSet, prefix, topic) {
    var unseen = [];
    var seen = [];
    var allWithIds = [];

    for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        var qText = q.question || q.Question || q.text || "";
        var qOpts = q.options || q.Options || q.answers || [];

        // Ensure options is an array of strings
        if (!Array.isArray(qOpts)) qOpts = [];
        var strOpts = [];
        for (var oi = 0; oi < qOpts.length; oi++) {
            strOpts.push(String(qOpts[oi] || ""));
        }

        var qid = qqgComputeQuestionId(nk, prefix, topic, qText, strOpts);
        q._qid = qid;  // Attach the ID to the question object
        allWithIds.push(q);

        if (seenIdSet[qid]) {
            seen.push(q);
        } else {
            unseen.push(q);
        }
    }

    return { unseen: unseen, seen: seen, allWithIds: allWithIds };
}

/**
 * Backfill from oldest-seen questions when pool is exhausted.
 * Sorts the seen questions by timestamp (oldest first) and takes the needed count.
 */
function qqgBackfillFromOldest(seenQuestions, seenLedger, needed) {
    if (!seenQuestions || seenQuestions.length === 0 || needed <= 0) return [];

    // Sort by their seen timestamp (oldest first)
    seenQuestions.sort(function(a, b) {
        var tsA = seenLedger.ids[a._qid] || 0;
        var tsB = seenLedger.ids[b._qid] || 0;
        return tsA - tsB;
    });

    return seenQuestions.slice(0, needed);
}

// ============================================================================
// MAIN RPC
// ============================================================================

/**
 * RPC: quizverse_quiz_generate
 *
 * Server-authoritative question delivery.
 * Fetches pool → filters seen → handles exhaustion → returns fresh questions.
 *
 * Request:
 * {
 *   "mode": "PickATopic",           // Quiz mode name (for logging)
 *   "scope": "global",              // Ledger scope
 *   "topic": "science",             // Topic name
 *   "count": 10,                    // Number of questions requested
 *   "lang": "en",                   // Language code
 *   "question_bank_url": "https://...",  // S3 URL to fetch pool from
 *   "repeat_after_days": 30,        // Optional: days before recycling
 *   "id_prefix": "s3",              // Optional: prefix for question IDs (default "s3")
 *   "questions": [...]              // Optional: pre-fetched questions (skip HTTP fetch)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "questions": [...],
 *   "question_ids": ["s3_science_abc123", ...],
 *   "meta": {
 *     "total_pool": 200,
 *     "unseen_pool": 185,
 *     "stale_recycled": 0,
 *     "backfilled": 0,
 *     "pool_exhaustion_pct": 7.5,
 *     "source": "s3_filtered"
 *   }
 * }
 */
function rpcQuizverseQuizGenerate(ctx, logger, nk, payload) {
    try {
        var data = qqgParsePayload(payload, ["scope", "topic"]);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        var mode = data.mode || "unknown";
        var scope = data.scope || "global";
        var topic = data.topic;
        var count = Math.min(parseInt(data.count) || QQG_DEFAULT_COUNT, QQG_MAX_COUNT);
        var repeatAfterDays = parseInt(data.repeat_after_days) || QQG_DEFAULT_REPEAT_AFTER_DAYS;
        var idPrefix = data.id_prefix || "s3";

        logger.info("[QuizGen] Request: mode=" + mode + " scope=" + scope +
            " topic=" + topic + " count=" + count + " user=" + userId);

        // ── Step 1: Get the question pool ──
        var questions = null;

        // Option A: Questions passed inline (client already fetched)
        if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
            questions = data.questions;
            logger.info("[QuizGen] Using " + questions.length + " inline questions");
        }
        // Option B: Fetch from S3 URL
        else if (data.question_bank_url) {
            var poolData = qqgFetchPool(nk, logger, data.question_bank_url);
            if (poolData) {
                questions = qqgExtractTopicQuestions(poolData, topic);
                logger.info("[QuizGen] Fetched " + questions.length + " questions from S3 for topic=" + topic);
            }
        }

        if (!questions || questions.length === 0) {
            return JSON.stringify({
                success: false,
                error: "No questions available",
                meta: { source: "empty_pool" }
            });
        }

        // ── Step 2: Read the seen ledger ──
        var seenLedger = qqgSeenRead(nk, userId, scope, topic);
        var seenIdSet = {};
        var seenKeys = Object.keys(seenLedger.ids);
        for (var si = 0; si < seenKeys.length; si++) {
            seenIdSet[seenKeys[si]] = true;
        }

        // ── Step 3: Filter pool ──
        var filtered = qqgFilterPool(nk, questions, seenIdSet, idPrefix, topic);
        var totalPool = filtered.allWithIds.length;
        var unseenPool = filtered.unseen.length;
        var staleRecycled = 0;
        var backfilled = 0;

        // ── Step 4: Handle exhaustion ──
        var available = filtered.unseen;

        if (available.length < count) {
            // Try purging stale entries first
            var purged = qqgSeenPurgeStale(nk, userId, scope, topic, repeatAfterDays);
            if (purged > 0) {
                staleRecycled = purged;
                logger.info("[QuizGen] Purged " + purged + " stale entries, re-filtering...");

                // Re-read the ledger and re-filter
                seenLedger = qqgSeenRead(nk, userId, scope, topic);
                seenIdSet = {};
                seenKeys = Object.keys(seenLedger.ids);
                for (var si2 = 0; si2 < seenKeys.length; si2++) {
                    seenIdSet[seenKeys[si2]] = true;
                }
                filtered = qqgFilterPool(nk, questions, seenIdSet, idPrefix, topic);
                available = filtered.unseen;
                unseenPool = available.length;
            }
        }

        if (available.length < count) {
            // Backfill from oldest-seen
            var needed = count - available.length;
            var backfillItems = qqgBackfillFromOldest(filtered.seen, seenLedger, needed);
            backfilled = backfillItems.length;
            available = available.concat(backfillItems);
            logger.info("[QuizGen] Backfilled " + backfilled + " from oldest-seen");
        }

        // ── Step 5: Random sample ──
        qqgShuffle(available);
        var selected = available.slice(0, count);

        // ── Step 6: Build response ──
        var questionIds = [];
        var responseQuestions = [];

        for (var qi = 0; qi < selected.length; qi++) {
            var q = selected[qi];
            questionIds.push(q._qid);

            // Clean up internal field before returning
            var cleanQ = {};
            for (var qk in q) {
                if (qk !== "_qid") {
                    cleanQ[qk] = q[qk];
                }
            }
            cleanQ.id = q._qid;
            responseQuestions.push(cleanQ);
        }

        var exhaustionPct = totalPool > 0
            ? Math.round(((totalPool - unseenPool) / totalPool) * 1000) / 10
            : 0;

        logger.info("[QuizGen] Delivered " + selected.length + " questions: " +
            "pool=" + totalPool + " unseen=" + unseenPool +
            " stale_recycled=" + staleRecycled + " backfilled=" + backfilled +
            " exhaustion=" + exhaustionPct + "%");

        return JSON.stringify({
            success: true,
            questions: responseQuestions,
            question_ids: questionIds,
            meta: {
                total_pool: totalPool,
                unseen_pool: unseenPool,
                stale_recycled: staleRecycled,
                backfilled: backfilled,
                pool_exhaustion_pct: exhaustionPct,
                source: idPrefix + "_filtered"
            }
        });

    } catch (err) {
        logger.error("[QuizGen] rpcQuizverseQuizGenerate error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// REGISTRATION
// ============================================================================

function registerQuizverseQuizGenerateRPCs(initializer, logger) {
    logger.info("[QuizGen] Initializing QuizVerse Quiz Generate RPCs...");

    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }

    var rpcs = [
        { id: "quizverse_quiz_generate", handler: rpcQuizverseQuizGenerate }
    ];

    var registered = 0;
    var skipped = 0;

    for (var i = 0; i < rpcs.length; i++) {
        var rpc = rpcs[i];
        if (!globalThis.__registeredRPCs.has(rpc.id)) {
            try {
                initializer.registerRpc(rpc.id, rpc.handler);
                globalThis.__registeredRPCs.add(rpc.id);
                logger.info("[QuizGen] Registered RPC: " + rpc.id);
                registered++;
            } catch (err) {
                logger.error("[QuizGen] Failed to register " + rpc.id + ": " + err.message);
            }
        } else {
            logger.info("[QuizGen] Skipped (already registered): " + rpc.id);
            skipped++;
        }
    }

    logger.info("[QuizGen] Registration complete: " + registered + " registered, " + skipped + " skipped");
}
