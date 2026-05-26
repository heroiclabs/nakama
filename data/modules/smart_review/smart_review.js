// smart_review.js - Spaced Repetition (SM-2) Review System for QuizVerse v3.0
// RPCs: smart_review_get_cards, smart_review_rate_card

/**
 * Smart Review System — Production-Ready SM-2 Algorithm
 *
 * Tracks wrong answers from quizzes and creates flashcard review decks.
 * Uses the SM-2 (SuperMemo 2) algorithm for optimal spaced repetition:
 * - EaseFactor: How easy the card is (starts at 2.5)
 * - Interval: Days between reviews
 * - Repetitions: Consecutive correct reviews
 *
 * Storage: collection="smart_review", key="cards_{userId}_{gameId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var SR_STORAGE_COLLECTION = 'smart_review';
var SR_DEFAULT_EASE = 2.5;
var SR_MIN_EASE = 1.3;
var SR_MAX_CARDS_PER_SESSION = 20;
var SR_MAX_STORED_CARDS = 500;

// ─── SM-2 ALGORITHM ─────────────────────────────────────────────────────────

/**
 * SM-2 Algorithm Implementation
 * rating: 0=blackout, 1=wrong, 2=hard, 3=okay, 4=easy, 5=perfect
 */
function sm2Calculate(card, rating) {
    var easeFactor = card.easeFactor || SR_DEFAULT_EASE;
    var interval = card.interval || 1;
    var repetitions = card.repetitions || 0;

    if (rating < 3) {
        // Failed: reset repetitions, keep ease factor
        repetitions = 0;
        interval = 1;
    } else {
        // Passed: increase interval
        if (repetitions === 0) {
            interval = 1;
        } else if (repetitions === 1) {
            interval = 6;
        } else {
            interval = Math.round(interval * easeFactor);
        }
        repetitions += 1;
    }

    // Update ease factor
    easeFactor = easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
    if (easeFactor < SR_MIN_EASE) easeFactor = SR_MIN_EASE;

    // Cap interval at 365 days
    if (interval > 365) interval = 365;

    return {
        interval: interval,
        easeFactor: Math.round(easeFactor * 100) / 100,
        repetitions: repetitions
    };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function srStorageKey(userId, gameId) {
    return 'cards_' + userId + '_' + gameId;
}

function readSmartReviewData(nk, logger, userId, gameId) {
    try {
        var records = nk.storageRead([{
            collection: SR_STORAGE_COLLECTION,
            key: srStorageKey(userId, gameId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[SmartReview] Storage read failed: ' + err.message);
    }
    return null;
}

function writeSmartReviewData(nk, logger, userId, gameId, data) {
    try {
        nk.storageWrite([{
            collection: SR_STORAGE_COLLECTION,
            key: srStorageKey(userId, gameId),
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[SmartReview] Storage write failed: ' + err.message);
        return false;
    }
}

function initSmartReviewData() {
    var now = new Date().toISOString();
    return {
        cards: {},
        totalCardsAdded: 0,
        totalReviews: 0,
        totalCorrect: 0,
        lastReviewAt: null,
        createdAt: now,
        updatedAt: now
    };
}

function srErrorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function srValidatePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

// ─── RPC: smart_review_get_cards ────────────────────────────────────────────

function rpcSmartReviewGetCards(ctx, logger, nk, payload) {
    if (!ctx.userId) return srErrorResponse('User not authenticated');

    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var limit = Math.min(parseInt(data.limit) || 5, SR_MAX_CARDS_PER_SESSION);
    var mode = data.mode || 'due';  // "due" = SM-2 scheduled, "recent_wrong" = latest misses

    var reviewData = readSmartReviewData(nk, logger, ctx.userId, gameId);
    if (!reviewData || !reviewData.cards || Object.keys(reviewData.cards).length === 0) {
        return JSON.stringify({
            success: true,
            cards: [],
            totalCards: 0,
            mode: mode,
            message: 'No review cards available. Complete a quiz to generate cards.',
            timestamp: new Date().toISOString()
        });
    }

    var now = new Date();
    var candidates = [];

    for (var qId in reviewData.cards) {
        var card = reviewData.cards[qId];

        if (mode === 'due') {
            // SM-2 mode: return cards that are due for review
            var nextReview = card.nextReviewAt ? new Date(card.nextReviewAt) : new Date(0);
            if (nextReview.getTime() <= now.getTime()) {
                candidates.push({
                    questionId: qId,
                    card: card,
                    overdueDays: Math.max(0, Math.floor((now.getTime() - nextReview.getTime()) / 86400000)),
                    sortKey: nextReview.getTime()
                });
            }
        } else if (mode === 'recent_wrong') {
            // Recent wrong mode: return latest wrong answers regardless of SM-2 schedule
            candidates.push({
                questionId: qId,
                card: card,
                overdueDays: 0,
                sortKey: card.lastAttemptAt ? new Date(card.lastAttemptAt).getTime() : 0
            });
        }
    }

    // Sort: due mode → oldest first, recent_wrong → newest first
    if (mode === 'due') {
        candidates.sort(function(a, b) { return a.sortKey - b.sortKey; });
    } else {
        candidates.sort(function(a, b) { return b.sortKey - a.sortKey; });
    }

    // Take top N
    var selectedCards = candidates.slice(0, limit);
    var resultCards = [];

    for (var i = 0; i < selectedCards.length; i++) {
        var c = selectedCards[i].card;
        resultCards.push({
            questionId: selectedCards[i].questionId,
            question: c.question || '',
            correctAnswer: c.correctAnswer || '',
            userAnswer: c.userAnswer || '',
            category: c.category || '',
            topic: c.topic || '',
            attempts: c.attempts || 1,
            lastAttemptAt: c.lastAttemptAt || null,
            overdueDays: selectedCards[i].overdueDays,
            sm2: {
                interval: c.interval || 1,
                easeFactor: c.easeFactor || SR_DEFAULT_EASE,
                repetitions: c.repetitions || 0
            }
        });
    }

    return JSON.stringify({
        success: true,
        cards: resultCards,
        totalCards: Object.keys(reviewData.cards).length,
        totalDue: mode === 'due' ? candidates.length : undefined,
        mode: mode,
        reviewStats: {
            totalReviews: reviewData.totalReviews || 0,
            totalCorrect: reviewData.totalCorrect || 0,
            accuracy: reviewData.totalReviews > 0 ?
                Math.round((reviewData.totalCorrect / reviewData.totalReviews) * 100) : 0,
            lastReviewAt: reviewData.lastReviewAt
        },
        timestamp: now.toISOString()
    });
}

// ─── RPC: smart_review_rate_card ────────────────────────────────────────────

function rpcSmartReviewRateCard(ctx, logger, nk, payload) {
    if (!ctx.userId) return srErrorResponse('User not authenticated');

    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var questionId = data.questionId;
    var rating = parseInt(data.rating);

    if (!questionId) return srErrorResponse('Missing required field: questionId');
    if (isNaN(rating) || rating < 0 || rating > 5) {
        return srErrorResponse('Invalid rating. Must be 0-5.');
    }

    var reviewData = readSmartReviewData(nk, logger, ctx.userId, gameId);
    if (!reviewData) {
        return srErrorResponse('No review data found');
    }

    var card = reviewData.cards[questionId];
    if (!card) {
        return srErrorResponse('Card not found: ' + questionId);
    }

    // Apply SM-2 algorithm
    var sm2Result = sm2Calculate(card, rating);

    // Update card
    card.interval = sm2Result.interval;
    card.easeFactor = sm2Result.easeFactor;
    card.repetitions = sm2Result.repetitions;
    card.lastReviewedAt = new Date().toISOString();

    // Calculate next review date
    var nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + sm2Result.interval);
    card.nextReviewAt = nextReview.toISOString();

    card.reviewCount = (card.reviewCount || 0) + 1;

    // Update stats
    reviewData.totalReviews = (reviewData.totalReviews || 0) + 1;
    if (rating >= 3) reviewData.totalCorrect = (reviewData.totalCorrect || 0) + 1;
    reviewData.lastReviewAt = new Date().toISOString();
    reviewData.updatedAt = new Date().toISOString();

    // If card has been answered correctly 5+ times in a row with high ease, consider mastered
    var isMastered = card.repetitions >= 5 && card.easeFactor >= 2.5;

    if (!writeSmartReviewData(nk, logger, ctx.userId, gameId, reviewData)) {
        return srErrorResponse('Failed to save review data');
    }

    logger.info('[SmartReview] Card ' + questionId + ' rated ' + rating +
                ' → interval=' + sm2Result.interval + 'd, ease=' + sm2Result.easeFactor);

    return JSON.stringify({
        success: true,
        questionId: questionId,
        rating: rating,
        newInterval: sm2Result.interval,
        newEaseFactor: sm2Result.easeFactor,
        newRepetitions: sm2Result.repetitions,
        nextReviewAt: card.nextReviewAt,
        isMastered: isMastered,
        reviewCount: card.reviewCount,
        reviewStats: {
            totalReviews: reviewData.totalReviews,
            totalCorrect: reviewData.totalCorrect,
            accuracy: reviewData.totalReviews > 0 ?
                Math.round((reviewData.totalCorrect / reviewData.totalReviews) * 100) : 0
        },
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: smart_review_add_card ─────────────────────────────────────────────
//
// Schema: {
//   gameId?, questionId, question, correctAnswer, userAnswer?,
//   distractors?: string[], category?, topic?, subtopic?, sourceQuizId?
// }
// Idempotent on questionId — re-adding an existing card is a no-op (returns
// existing SM-2 state). When the deck would exceed SR_MAX_STORED_CARDS we LRU-
// evict the lowest-priority cards (mastered first → oldest lastReviewedAt next).

function rpcSmartReviewAddCard(ctx, logger, nk, payload) {
    if (!ctx.userId) return srErrorResponse('User not authenticated');

    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var questionId = data.questionId;
    if (!questionId || typeof questionId !== 'string') {
        return srErrorResponse('Missing required field: questionId');
    }
    if (!data.question || !data.correctAnswer) {
        return srErrorResponse('Missing required fields: question, correctAnswer');
    }

    var reviewData = readSmartReviewData(nk, logger, ctx.userId, gameId) || initSmartReviewData();
    if (!reviewData.cards) reviewData.cards = {};

    var nowIso = new Date().toISOString();

    // Idempotent re-add: if the card already exists, just refresh metadata
    // (question text / distractors may have been corrected).
    if (reviewData.cards[questionId]) {
        var existing = reviewData.cards[questionId];
        existing.question      = data.question;
        existing.correctAnswer = data.correctAnswer;
        if (data.userAnswer)   existing.userAnswer  = data.userAnswer;
        if (data.distractors)  existing.distractors = data.distractors;
        if (data.category)     existing.category    = data.category;
        if (data.topic)        existing.topic       = data.topic;
        if (data.subtopic)     existing.subtopic    = data.subtopic;
        existing.attempts      = (existing.attempts || 1) + 1;
        existing.lastAttemptAt = nowIso;
        reviewData.updatedAt   = nowIso;
        writeSmartReviewData(nk, logger, ctx.userId, gameId, reviewData);
        return JSON.stringify({
            success: true,
            questionId: questionId,
            alreadyExisted: true,
            attempts: existing.attempts,
            totalCards: Object.keys(reviewData.cards).length,
            timestamp: nowIso
        });
    }

    // ── LRU eviction when at cap ──────────────────────────────────────────
    var cardIds = Object.keys(reviewData.cards);
    if (cardIds.length >= SR_MAX_STORED_CARDS) {
        var entries = [];
        for (var ei = 0; ei < cardIds.length; ei++) {
            var id = cardIds[ei];
            var c = reviewData.cards[id];
            // Mastered cards (rep>=5, ease>=2.5) get lowest priority; then
            // ascending lastReviewedAt (oldest first).
            var mastered = (c.repetitions >= 5 && c.easeFactor >= 2.5) ? 1 : 0;
            var ts = c.lastReviewedAt ? new Date(c.lastReviewedAt).getTime() : 0;
            entries.push({ id: id, mastered: mastered, ts: ts });
        }
        entries.sort(function(a, b) {
            if (b.mastered !== a.mastered) return b.mastered - a.mastered; // mastered first
            return a.ts - b.ts; // oldest first
        });
        // Evict enough to make room for one new card
        var toEvict = (cardIds.length - SR_MAX_STORED_CARDS) + 1;
        for (var ev = 0; ev < toEvict; ev++) {
            delete reviewData.cards[entries[ev].id];
        }
    }

    // ── Create card with SM-2 defaults ─────────────────────────────────────
    reviewData.cards[questionId] = {
        question:       data.question,
        correctAnswer:  data.correctAnswer,
        userAnswer:     data.userAnswer || '',
        distractors:    data.distractors || [],
        category:       data.category || '',
        topic:          data.topic || '',
        subtopic:       data.subtopic || '',
        sourceQuizId:   data.sourceQuizId || '',
        attempts:       1,
        easeFactor:     SR_DEFAULT_EASE,
        interval:       1,
        repetitions:    0,
        reviewCount:    0,
        lastAttemptAt:  nowIso,
        lastReviewedAt: null,
        nextReviewAt:   nowIso, // immediately due
        addedAt:        nowIso
    };

    reviewData.totalCardsAdded = (reviewData.totalCardsAdded || 0) + 1;
    reviewData.updatedAt = nowIso;
    if (!writeSmartReviewData(nk, logger, ctx.userId, gameId, reviewData)) {
        return srErrorResponse('Failed to save review data');
    }

    return JSON.stringify({
        success: true,
        questionId: questionId,
        alreadyExisted: false,
        totalCards: Object.keys(reviewData.cards).length,
        totalCardsAdded: reviewData.totalCardsAdded,
        timestamp: nowIso
    });
}

// ─── RPC: smart_review_bulk_rate ────────────────────────────────────────────
//
// Schema: { gameId?, ratings: [{ questionId, rating (0..5), reviewedAt? }] }
// Atomic: all SM-2 updates are applied in one storage write. Skips any
// rating that targets an unknown card and reports it back in `skipped`.

function rpcSmartReviewBulkRate(ctx, logger, nk, payload) {
    if (!ctx.userId) return srErrorResponse('User not authenticated');

    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var ratings = data.ratings;
    if (!ratings || !Array.isArray(ratings) || ratings.length === 0) {
        return srErrorResponse('ratings must be a non-empty array');
    }
    if (ratings.length > 100) {
        return srErrorResponse('Cannot rate more than 100 cards per call');
    }

    var reviewData = readSmartReviewData(nk, logger, ctx.userId, gameId);
    if (!reviewData || !reviewData.cards) {
        return srErrorResponse('No review data found');
    }

    var nowIso = new Date().toISOString();
    var applied = [];
    var skipped = [];

    for (var i = 0; i < ratings.length; i++) {
        var r = ratings[i];
        var qId = r.questionId;
        var rating = parseInt(r.rating);
        if (!qId || isNaN(rating) || rating < 0 || rating > 5) {
            skipped.push({ questionId: qId || null, reason: 'invalid_rating' });
            continue;
        }
        var card = reviewData.cards[qId];
        if (!card) {
            skipped.push({ questionId: qId, reason: 'card_not_found' });
            continue;
        }

        var sm2Result = sm2Calculate(card, rating);
        card.interval       = sm2Result.interval;
        card.easeFactor     = sm2Result.easeFactor;
        card.repetitions    = sm2Result.repetitions;
        card.lastReviewedAt = r.reviewedAt || nowIso;
        var nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + sm2Result.interval);
        card.nextReviewAt = nextReview.toISOString();
        card.reviewCount  = (card.reviewCount || 0) + 1;

        reviewData.totalReviews = (reviewData.totalReviews || 0) + 1;
        if (rating >= 3) reviewData.totalCorrect = (reviewData.totalCorrect || 0) + 1;

        applied.push({
            questionId:    qId,
            rating:        rating,
            newInterval:   sm2Result.interval,
            newEaseFactor: sm2Result.easeFactor,
            nextReviewAt:  card.nextReviewAt
        });
    }

    reviewData.lastReviewAt = nowIso;
    reviewData.updatedAt    = nowIso;

    if (!writeSmartReviewData(nk, logger, ctx.userId, gameId, reviewData)) {
        return srErrorResponse('Failed to save review data');
    }

    return JSON.stringify({
        success: true,
        appliedCount: applied.length,
        skippedCount: skipped.length,
        applied:      applied,
        skipped:      skipped,
        reviewStats: {
            totalReviews: reviewData.totalReviews,
            totalCorrect: reviewData.totalCorrect,
            accuracy: reviewData.totalReviews > 0 ?
                Math.round((reviewData.totalCorrect / reviewData.totalReviews) * 100) : 0
        },
        timestamp: nowIso
    });
}

// ─── RPC: smart_review_get_state ────────────────────────────────────────────
//
// Returns the entire deck snapshot (for client hydration / cross-device sync).
// `get_cards` only returns the due-or-recent slice. This is the heavyweight
// read — clients should call sparingly (cache locally + invalidate by version).

function rpcSmartReviewGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return srErrorResponse('User not authenticated');

    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var reviewData = readSmartReviewData(nk, logger, ctx.userId, gameId);
    if (!reviewData || !reviewData.cards) {
        return JSON.stringify({
            success: true,
            cards: [],
            totalCards: 0,
            totalDue: 0,
            totalMastered: 0,
            stats: { totalReviews: 0, totalCorrect: 0, accuracy: 0 },
            timestamp: new Date().toISOString()
        });
    }

    var nowMs = Date.now();
    var allCards = [];
    var due = 0, mastered = 0;
    for (var qId in reviewData.cards) {
        if (!Object.prototype.hasOwnProperty.call(reviewData.cards, qId)) continue;
        var c = reviewData.cards[qId];
        var nextMs = c.nextReviewAt ? new Date(c.nextReviewAt).getTime() : 0;
        var isDue = nextMs <= nowMs;
        var isMastered = (c.repetitions || 0) >= 5 && (c.easeFactor || 0) >= 2.5;
        if (isDue) due++;
        if (isMastered) mastered++;
        allCards.push({
            questionId:     qId,
            question:       c.question || '',
            correctAnswer:  c.correctAnswer || '',
            userAnswer:     c.userAnswer || '',
            distractors:    c.distractors || [],
            category:       c.category || '',
            topic:          c.topic || '',
            subtopic:       c.subtopic || '',
            attempts:       c.attempts || 1,
            reviewCount:    c.reviewCount || 0,
            lastAttemptAt:  c.lastAttemptAt || null,
            lastReviewedAt: c.lastReviewedAt || null,
            nextReviewAt:   c.nextReviewAt || null,
            addedAt:        c.addedAt || null,
            isDue:          isDue,
            isMastered:     isMastered,
            sm2: {
                interval:    c.interval || 1,
                easeFactor:  c.easeFactor || SR_DEFAULT_EASE,
                repetitions: c.repetitions || 0
            }
        });
    }

    return JSON.stringify({
        success: true,
        cards: allCards,
        totalCards:    allCards.length,
        totalDue:      due,
        totalMastered: mastered,
        totalCardsAdded: reviewData.totalCardsAdded || allCards.length,
        stats: {
            totalReviews: reviewData.totalReviews || 0,
            totalCorrect: reviewData.totalCorrect || 0,
            accuracy: reviewData.totalReviews > 0 ?
                Math.round((reviewData.totalCorrect / reviewData.totalReviews) * 100) : 0,
            lastReviewAt: reviewData.lastReviewAt || null
        },
        version: reviewData.updatedAt || reviewData.createdAt || null,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: smart_review_get_weakness_map ─────────────────────────────────────
//
// Aggregates SM-2 stats by category/topic so the client can render a heatmap
// of "where the player is weakest". Higher attemptsPerCard / lower easeFactor
// → weaker. Returns a list sorted by weakness descending.

function rpcSmartReviewGetWeaknessMap(ctx, logger, nk, payload) {
    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    // Resolve caller — Unity clients use ctx.userId from their session;
    // server-to-server (http_key) callers may supply user_id in the payload.
    // Same trust boundary as qe_player_full_profile; safe because this RPC
    // is READ-ONLY and the http_key is admin-level.
    var userId = ctx.userId || (data && (data.user_id || data.userId)) || '';
    if (!userId) return srErrorResponse('User not authenticated');

    var gameId = data.gameId || 'quizverse';
    var reviewData = readSmartReviewData(nk, logger, userId, gameId);
    if (!reviewData || !reviewData.cards) {
        return JSON.stringify({
            success: true,
            weakness: [],
            timestamp: new Date().toISOString()
        });
    }

    var byCategory = {};
    var byTopic = {};
    for (var qId in reviewData.cards) {
        if (!Object.prototype.hasOwnProperty.call(reviewData.cards, qId)) continue;
        var c = reviewData.cards[qId];
        var cat = c.category || 'Uncategorized';
        var top = c.topic || 'General';

        if (!byCategory[cat]) byCategory[cat] = { cardCount: 0, totalAttempts: 0, totalEase: 0, totalReps: 0, mastered: 0 };
        byCategory[cat].cardCount++;
        byCategory[cat].totalAttempts += (c.attempts || 1);
        byCategory[cat].totalEase     += (c.easeFactor || SR_DEFAULT_EASE);
        byCategory[cat].totalReps     += (c.repetitions || 0);
        if ((c.repetitions || 0) >= 5 && (c.easeFactor || 0) >= 2.5) byCategory[cat].mastered++;

        var topKey = cat + '::' + top;
        if (!byTopic[topKey]) byTopic[topKey] = { category: cat, topic: top, cardCount: 0, totalAttempts: 0, totalEase: 0, mastered: 0 };
        byTopic[topKey].cardCount++;
        byTopic[topKey].totalAttempts += (c.attempts || 1);
        byTopic[topKey].totalEase     += (c.easeFactor || SR_DEFAULT_EASE);
        if ((c.repetitions || 0) >= 5 && (c.easeFactor || 0) >= 2.5) byTopic[topKey].mastered++;
    }

    var categories = [];
    for (var cKey in byCategory) {
        if (!Object.prototype.hasOwnProperty.call(byCategory, cKey)) continue;
        var cv = byCategory[cKey];
        var avgEase = cv.cardCount > 0 ? (cv.totalEase / cv.cardCount) : SR_DEFAULT_EASE;
        var attemptsPerCard = cv.cardCount > 0 ? (cv.totalAttempts / cv.cardCount) : 0;
        // Weakness: 0..1 — higher = weaker. (3.0 - easeFactor) / 1.7 normalizes to roughly [0,1]
        var weakness = Math.max(0, Math.min(1, (3.0 - avgEase) / 1.7));
        categories.push({
            category:        cKey,
            cardCount:       cv.cardCount,
            mastered:        cv.mastered,
            attemptsPerCard: Math.round(attemptsPerCard * 100) / 100,
            avgEaseFactor:   Math.round(avgEase * 100) / 100,
            weaknessScore:   Math.round(weakness * 100) / 100
        });
    }
    categories.sort(function(a, b) { return b.weaknessScore - a.weaknessScore; });

    var topics = [];
    for (var tKey in byTopic) {
        if (!Object.prototype.hasOwnProperty.call(byTopic, tKey)) continue;
        var tv = byTopic[tKey];
        var avgEase2 = tv.cardCount > 0 ? (tv.totalEase / tv.cardCount) : SR_DEFAULT_EASE;
        var attemptsPerCard2 = tv.cardCount > 0 ? (tv.totalAttempts / tv.cardCount) : 0;
        var weakness2 = Math.max(0, Math.min(1, (3.0 - avgEase2) / 1.7));
        topics.push({
            category:        tv.category,
            topic:           tv.topic,
            cardCount:       tv.cardCount,
            mastered:        tv.mastered,
            attemptsPerCard: Math.round(attemptsPerCard2 * 100) / 100,
            avgEaseFactor:   Math.round(avgEase2 * 100) / 100,
            weaknessScore:   Math.round(weakness2 * 100) / 100
        });
    }
    topics.sort(function(a, b) { return b.weaknessScore - a.weaknessScore; });

    return JSON.stringify({
        success: true,
        categories: categories,
        topics:     topics,
        timestamp:  new Date().toISOString()
    });
}

// ─── RPC: smart_review_get_forecast ─────────────────────────────────────────
//
// Returns "cards due per day" for the next N days (default 7, max 30) so the
// client can render a workload calendar / "you'll review X cards tomorrow"
// preview. Counts cards by their nextReviewAt bucket.

function rpcSmartReviewGetForecast(ctx, logger, nk, payload) {
    if (!ctx.userId) return srErrorResponse('User not authenticated');

    var data = srValidatePayload(payload);
    if (data === null) return srErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var days = parseInt(data.days) || 7;
    if (days < 1)  days = 1;
    if (days > 30) days = 30;

    var reviewData = readSmartReviewData(nk, logger, ctx.userId, gameId);
    if (!reviewData || !reviewData.cards) {
        var emptyForecast = [];
        var startMidnight = new Date(); startMidnight.setHours(0,0,0,0);
        for (var ed = 0; ed < days; ed++) {
            var ed2 = new Date(startMidnight.getTime() + ed * 86400000);
            emptyForecast.push({ date: ed2.toISOString().slice(0,10), cardsDue: 0 });
        }
        return JSON.stringify({
            success: true,
            forecast: emptyForecast,
            totalCards: 0,
            overdueCount: 0,
            timestamp: new Date().toISOString()
        });
    }

    var now = new Date();
    var todayMidnight = new Date(now); todayMidnight.setHours(0,0,0,0);
    var horizonMs = todayMidnight.getTime() + days * 86400000;

    var buckets = {};
    for (var d = 0; d < days; d++) {
        var dDate = new Date(todayMidnight.getTime() + d * 86400000);
        buckets[dDate.toISOString().slice(0,10)] = 0;
    }

    var overdueCount = 0;
    var totalCards = 0;
    for (var qId in reviewData.cards) {
        if (!Object.prototype.hasOwnProperty.call(reviewData.cards, qId)) continue;
        totalCards++;
        var c = reviewData.cards[qId];
        var nextMs = c.nextReviewAt ? new Date(c.nextReviewAt).getTime() : 0;

        if (nextMs <= now.getTime()) {
            overdueCount++;
            // Overdue cards are counted in today's bucket
            var todayKey = todayMidnight.toISOString().slice(0,10);
            buckets[todayKey] = (buckets[todayKey] || 0) + 1;
        } else if (nextMs < horizonMs) {
            var b = new Date(nextMs); b.setHours(0,0,0,0);
            var bk = b.toISOString().slice(0,10);
            if (Object.prototype.hasOwnProperty.call(buckets, bk)) {
                buckets[bk]++;
            }
        }
    }

    var forecast = [];
    for (var d2 = 0; d2 < days; d2++) {
        var dd = new Date(todayMidnight.getTime() + d2 * 86400000);
        var key = dd.toISOString().slice(0,10);
        forecast.push({ date: key, cardsDue: buckets[key] || 0 });
    }

    return JSON.stringify({
        success: true,
        forecast: forecast,
        totalCards: totalCards,
        overdueCount: overdueCount,
        days: days,
        timestamp: new Date().toISOString()
    });
}

// ============================================================================
// Module Init — register Smart Review RPCs
// ============================================================================
// postbuild.js renames `InitModule` to `__ModuleInit_N` and rewrites every
// `initializer.registerRpc("id", handler)` into a guarded
// `__rpc_id = __rpc_id || handler` assignment that gets replayed at global
// scope on every Goja VM. Because the modules section is concatenated BEFORE
// legacy_runtime.js, the module-level handler wins — even if legacy still
// has its own registration for `smart_review_get_cards` /
// `smart_review_rate_card`, our handler is what actually fires.
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('smart_review_get_cards',         rpcSmartReviewGetCards);
    initializer.registerRpc('smart_review_rate_card',         rpcSmartReviewRateCard);
    initializer.registerRpc('smart_review_add_card',          rpcSmartReviewAddCard);
    initializer.registerRpc('smart_review_bulk_rate',         rpcSmartReviewBulkRate);
    initializer.registerRpc('smart_review_get_state',         rpcSmartReviewGetState);
    initializer.registerRpc('smart_review_get_weakness_map',  rpcSmartReviewGetWeaknessMap);
    initializer.registerRpc('smart_review_get_forecast',      rpcSmartReviewGetForecast);
    if (logger && logger.info) {
        logger.info('[SmartReview] Registered 7 RPCs (get_cards, rate_card, add_card, bulk_rate, get_state, get_weakness_map, get_forecast)');
    }
}
