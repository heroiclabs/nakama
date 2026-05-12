// quizverse_quiz_generate.js - Server-authoritative question delivery RPC
// Nakama V8 JavaScript runtime (No ES Modules)
//
// Fetches the question pool (from S3 URL), filters out seen questions using
// the qv_seen ledger (via globalThis.__qvsSeen from quizverse_seen.js),
// handles exhaustion (purge stale → backfill oldest), and returns a fresh,
// deduplicated set of questions.

// ============================================================================
// CONSTANTS
// ============================================================================

var QQG_DEFAULT_COUNT = 10;
var QQG_DEFAULT_REPEAT_AFTER_DAYS = 30;
var QQG_MAX_COUNT = 50;
var QQG_HTTP_TIMEOUT_MS = 10000;

// ============================================================================
// UTILITY HELPERS
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

/**
 * Slugify for question ID hashing — must match Unity's QuestionIdHasher.cs normalization.
 * Kept here (not shared with __qvsSeen) because question ID computation is this module's
 * own concern and the algorithm must stay stable independent of storage key changes.
 */
function qqgSlugify(str) {
    if (!str) return "unknown";
    return str.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .substring(0, 64);
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

    var hashBytes = nk.sha256Hash(raw); // returns hex string
    var hash12 = hashBytes.substring(0, 12);

    var slug = qqgSlugify(topic);
    return prefix + "_" + slug + "_" + hash12;
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

        // Format 1: { questions: [...] }
        if (parsed.questions && Array.isArray(parsed.questions)) {
            return parsed.questions;
        }
        // Format 2: { topics: { science: { questions: [...] } } }
        if (parsed.topics && typeof parsed.topics === "object") {
            return parsed;
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

    if (Array.isArray(poolData)) {
        return poolData;
    }

    if (poolData.topics && typeof poolData.topics === "object") {
        var topicSlug = qqgSlugify(topic);
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
 * Compute IDs for all questions in the pool and split into unseen / seen.
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

        if (!Array.isArray(qOpts)) qOpts = [];
        var strOpts = [];
        for (var oi = 0; oi < qOpts.length; oi++) {
            strOpts.push(String(qOpts[oi] || ""));
        }

        var qid = qqgComputeQuestionId(nk, prefix, topic, qText, strOpts);
        q._qid = qid;
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
 */
function qqgBackfillFromOldest(seenQuestions, seenLedger, needed) {
    if (!seenQuestions || seenQuestions.length === 0 || needed <= 0) return [];

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
 * Seen ledger operations are delegated to globalThis.__qvsSeen (quizverse_seen.js)
 * so that OCC, scope slugification, and the safety cap are all applied consistently.
 *
 * Request:
 * {
 *   "mode": "PickATopic",
 *   "scope": "global",
 *   "topic": "science",
 *   "count": 10,
 *   "question_bank_url": "https://...",
 *   "repeat_after_days": 30,
 *   "id_prefix": "s3",
 *   "questions": [...]    // optional: pre-fetched (skip HTTP)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "questions": [...],
 *   "question_ids": ["s3_science_abc123", ...],
 *   "meta": {
 *     "total_pool": 200, "unseen_pool": 185,
 *     "stale_recycled": 0, "backfilled": 0,
 *     "pool_exhaustion_pct": 7.5, "source": "s3_filtered"
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

        // Shared seen ledger — guaranteed available when any RPC is called
        // (all modules finish loading before Nakama dispatches the first request)
        var seen = globalThis.__qvsSeen;
        if (!seen) {
            return JSON.stringify({ success: false, error: "Seen ledger module not available" });
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

        if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
            questions = data.questions;
            logger.info("[QuizGen] Using " + questions.length + " inline questions");
        } else if (data.question_bank_url) {
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

        // ── Step 2: Read seen ledger & build filter set ──
        var seenLedger = seen.read(nk, userId, scope, topic);
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
            var purged = seen.purgeStale(nk, userId, scope, topic, repeatAfterDays);
            if (purged > 0) {
                staleRecycled = purged;
                logger.info("[QuizGen] Purged " + purged + " stale entries, re-filtering...");

                seenLedger = seen.read(nk, userId, scope, topic);
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
// RPC: quizverse_seen_resolve
// ============================================================================

/**
 * RPC: quizverse_seen_resolve
 *
 * Cross-references the user's seen ledger with the live question pool from S3
 * and returns the actual question text for every question they have seen.
 *
 * Useful for debugging via the Nakama Dashboard → API Explorer.
 *
 * Request:
 *   {
 *     "scope": "global",
 *     "topic": "science",
 *     "url":   "https://your-bucket.s3.amazonaws.com/science.json",
 *     "prefix": "s3"           // optional, default "s3"
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "seen_count": 12,
 *     "pool_size": 80,
 *     "seen_questions": [
 *       {
 *         "id":       "s3_science_a1b2c3d4e5f6",
 *         "question": "What is the capital of France?",
 *         "options":  ["Paris", "London", "Berlin", "Madrid"],
 *         "correct":  "Paris",
 *         "seen_on":  "2026-05-08T09:15:00Z",
 *         "days_ago": 4
 *       },
 *       ...
 *     ]
 *   }
 */
function rpcQuizverseSeenResolve(ctx, logger, nk, payload) {
    try {
        var data = qqgParsePayload(payload, ["scope", "topic", "url"]);
        var userId = ctx.userId;
        if (!userId) {
            return JSON.stringify({ success: false, error: "User not authenticated" });
        }

        var scope   = data.scope;
        var topic   = data.topic;
        var url     = data.url;
        var prefix  = data.prefix || "s3";

        // 1. Load the user's seen ledger
        if (!globalThis.__qvsSeen) {
            return JSON.stringify({ success: false, error: "__qvsSeen module not loaded" });
        }
        var seenIdSet = globalThis.__qvsSeen.getIdSet(nk, userId, scope, topic);
        var seenLedger = globalThis.__qvsSeen.read(nk, userId, scope, topic);

        // 2. Fetch question pool from S3
        var poolData = qqgFetchPool(nk, logger, url);
        if (!poolData) {
            return JSON.stringify({ success: false, error: "Failed to fetch question pool from URL" });
        }
        var questions = qqgExtractTopicQuestions(poolData, topic);
        if (!questions || questions.length === 0) {
            return JSON.stringify({ success: false, error: "No questions found in pool for topic: " + topic });
        }

        // 3. Cross-reference: compute each question's ID, collect the ones that are seen
        var seenQuestions = [];
        var nowSec = Math.floor(Date.now() / 1000);

        for (var i = 0; i < questions.length; i++) {
            var q = questions[i];
            var qText = q.question || q.Question || q.text || "";
            var qOpts = q.options || q.Options || q.answers || [];
            if (!Array.isArray(qOpts)) qOpts = [];

            var strOpts = [];
            for (var oi = 0; oi < qOpts.length; oi++) {
                var opt = qOpts[oi];
                strOpts.push(typeof opt === "object" ? (opt.text || opt.label || String(opt)) : String(opt));
            }

            var qId = qqgComputeQuestionId(nk, prefix, topic, qText, strOpts);

            if (seenIdSet[qId]) {
                var seenTs  = seenLedger.ids[qId] || 0;
                var daysAgo = seenTs > 0 ? Math.floor((nowSec - seenTs) / 86400) : -1;
                var seenIso = seenTs > 0 ? new Date(seenTs * 1000).toISOString() : null;

                // Detect the correct answer (various field names used across question formats)
                var correct = q.correct_answer || q.correctAnswer || q.answer || q.correct || null;
                if (correct === null && q.correct_index !== undefined && strOpts.length > 0) {
                    correct = strOpts[q.correct_index] || null;
                }

                seenQuestions.push({
                    id:       qId,
                    question: qText,
                    options:  strOpts,
                    correct:  correct,
                    seen_on:  seenIso,
                    days_ago: daysAgo
                });
            }
        }

        // Sort oldest-seen first so the dashboard view is chronological
        seenQuestions.sort(function(a, b) {
            return (seenLedger.ids[a.id] || 0) - (seenLedger.ids[b.id] || 0);
        });

        logger.info("[SeenResolve] user=" + userId +
            " scope=" + scope + " topic=" + topic +
            " pool=" + questions.length + " seen=" + seenQuestions.length);

        return JSON.stringify({
            success:        true,
            seen_count:     seenQuestions.length,
            pool_size:      questions.length,
            seen_questions: seenQuestions
        });

    } catch (err) {
        logger.error("[SeenResolve] error: " + err.message);
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
        { id: "quizverse_quiz_generate",  handler: rpcQuizverseQuizGenerate },
        { id: "quizverse_seen_resolve",   handler: rpcQuizverseSeenResolve }
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

// ============================================================================
// MODULE INIT (postbuild AST hook — see quizverse_seen.js for full rationale)
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("quizverse_quiz_generate", rpcQuizverseQuizGenerate);
    initializer.registerRpc("quizverse_seen_resolve",  rpcQuizverseSeenResolve);
    logger.info("[QuizGen] Module InitModule registered: 2 RPCs");
}
