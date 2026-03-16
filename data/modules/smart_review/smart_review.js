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
