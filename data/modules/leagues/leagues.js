// leagues.js - Weekly League System for QuizVerse v3.0
// Provides tier-based competitive ranking with weekly promotion/demotion
// RPCs: league_get_state, league_submit_points, league_process_season, league_get_leaderboard

/**
 * League System — Production-Ready Design
 *
 * Tiers: bronze → silver → gold → platinum → diamond → elite
 * Season: Weekly (Mon 00:01 UTC reset)
 * Anti-sandbagging: Minimum 3 quizzes to qualify for promotion
 * Tie-breaking: perfectRounds → accuracy → earliestXpTimestamp
 * Storage: collection="league_state", key="{userId}_{gameId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var LEAGUE_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'elite'];

var LEAGUE_CONFIG = {
    bronze:   { promotionThreshold: 500,  demotionThreshold: 0,    xpMultiplier: 1.0 },
    silver:   { promotionThreshold: 1000, demotionThreshold: 300,  xpMultiplier: 1.1 },
    gold:     { promotionThreshold: 1500, demotionThreshold: 600,  xpMultiplier: 1.2 },
    platinum: { promotionThreshold: 2500, demotionThreshold: 1000, xpMultiplier: 1.3 },
    diamond:  { promotionThreshold: 4000, demotionThreshold: 1800, xpMultiplier: 1.5 },
    elite:    { promotionThreshold: 99999, demotionThreshold: 3000, xpMultiplier: 2.0 }
};

var MIN_QUIZZES_FOR_PROMOTION = 3;
var PROMOTION_PERCENT = 20;
var DEMOTION_PERCENT = 20;
var STORAGE_COLLECTION = 'league_state';

// ─── ANTI-SANDBAGGING CONSTANTS ─────────────────────────────────────────────
var MAX_POINTS_PER_QUIZ = 500;          // Cap per single submission
var MIN_ACCURACY_FLOOR = 0.20;          // Below 20% → points halved
var SANDBAG_ACCURACY_THRESHOLD = 0.30;  // Below 30% = suspiciously low
var SANDBAG_CONSECUTIVE_LIMIT = 3;      // 3+ consecutive low-accuracy → flagged
var CONSISTENCY_BONUS_QUIZZES = 5;      // Play 5+ quizzes with good accuracy
var CONSISTENCY_BONUS_ACCURACY = 0.70;  // Above 70% avg to get bonus
var CONSISTENCY_BONUS_MULTIPLIER = 1.10; // +10% bonus for consistent players
var INACTIVITY_DEMOTE = true;           // Demote players who played 0 quizzes

// ─── HELPERS ────────────────────────────────────────────────────────────────

function leagueStorageKey(userId, gameId) {
    return userId + '_' + gameId;
}

function getCurrentWeekId() {
    var now = new Date();
    var jan1 = new Date(now.getFullYear(), 0, 1);
    var days = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
    var week = Math.ceil((days + jan1.getDay() + 1) / 7);
    return now.getFullYear() + '-W' + (week < 10 ? '0' + week : week);
}

function getNextMondayUTC() {
    var now = new Date();
    var day = now.getUTCDay();
    var diff = (day === 0 ? 1 : 8 - day);
    var next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, 0, 1, 0));
    return next.toISOString();
}

function getTierIndex(tier) {
    var idx = LEAGUE_TIERS.indexOf(tier);
    return idx >= 0 ? idx : 0;
}

function readLeagueState(nk, logger, userId, gameId) {
    try {
        var records = nk.storageRead([{
            collection: STORAGE_COLLECTION,
            key: leagueStorageKey(userId, gameId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[Leagues] Storage read failed for ' + userId + ': ' + err.message);
    }
    return null;
}

function writeLeagueState(nk, logger, userId, gameId, state) {
    try {
        nk.storageWrite([{
            collection: STORAGE_COLLECTION,
            key: leagueStorageKey(userId, gameId),
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[Leagues] Storage write failed for ' + userId + ': ' + err.message);
        return false;
    }
}

function initLeagueState(userId, gameId) {
    var now = new Date().toISOString();
    return {
        userId: userId,
        gameId: gameId,
        tier: 'bronze',
        points: 0,
        quizzesThisWeek: 0,
        perfectRounds: 0,
        totalAccuracy: 0,
        accuracyCount: 0,
        season: getCurrentWeekId(),
        seasonJoinedAt: now,
        qualifiesForPromotion: false,
        sandbaggingFlags: 0,
        consecutiveLowAccuracy: 0,
        consistencyBonus: false,
        lastSubmissionId: '',
        lastSubmissionAt: null,
        createdAt: now,
        updatedAt: now
    };
}

function validatePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

function errorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

// ─── RPC: league_get_state ──────────────────────────────────────────────────

function rpcLeagueGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return errorResponse('User not authenticated');

    var data = validatePayload(payload);
    if (data === null) return errorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var state = readLeagueState(nk, logger, ctx.userId, gameId);
    var isNew = false;

    if (!state) {
        state = initLeagueState(ctx.userId, gameId);
        writeLeagueState(nk, logger, ctx.userId, gameId, state);
        isNew = true;
    }

    // Auto-rotate season if stale
    var currentWeek = getCurrentWeekId();
    if (state.season !== currentWeek) {
        state.points = 0;
        state.quizzesThisWeek = 0;
        state.perfectRounds = 0;
        state.totalAccuracy = 0;
        state.accuracyCount = 0;
        state.qualifiesForPromotion = false;
        state.season = currentWeek;
        state.lastSubmissionId = '';
        state.updatedAt = new Date().toISOString();
        writeLeagueState(nk, logger, ctx.userId, gameId, state);
    }

    var tierConfig = LEAGUE_CONFIG[state.tier] || LEAGUE_CONFIG.bronze;
    var tierIdx = getTierIndex(state.tier);

    return JSON.stringify({
        success: true,
        isNew: isNew,
        userId: ctx.userId,
        gameId: gameId,
        tier: state.tier,
        tierIndex: tierIdx,
        points: state.points,
        quizzesThisWeek: state.quizzesThisWeek,
        perfectRounds: state.perfectRounds,
        averageAccuracy: state.accuracyCount > 0 ? Math.round(state.totalAccuracy / state.accuracyCount) : 0,
        season: state.season,
        seasonEndsAt: getNextMondayUTC(),
        minQuizzesRequired: MIN_QUIZZES_FOR_PROMOTION,
        qualifiesForPromotion: state.qualifiesForPromotion,
        promotionThreshold: tierConfig.promotionThreshold,
        demotionThreshold: tierConfig.demotionThreshold,
        xpMultiplier: tierConfig.xpMultiplier,
        canPromote: tierIdx < LEAGUE_TIERS.length - 1,
        canDemote: tierIdx > 0,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: league_submit_points ──────────────────────────────────────────────

function rpcLeagueSubmitPoints(ctx, logger, nk, payload) {
    if (!ctx.userId) return errorResponse('User not authenticated');

    var data = validatePayload(payload);
    if (data === null) return errorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var points = parseInt(data.points);
    var source = data.source || 'quiz_complete';
    var accuracy = parseFloat(data.accuracy) || 0;
    var isPerfect = data.isPerfect === true;
    var submissionId = data.submissionId || '';

    if (isNaN(points) || points < 0) return errorResponse('Invalid points value');
    if (points > 10000) return errorResponse('Points exceed maximum allowed');

    var state = readLeagueState(nk, logger, ctx.userId, gameId);
    if (!state) {
        state = initLeagueState(ctx.userId, gameId);
    }

    // Auto-rotate season if stale
    var currentWeek = getCurrentWeekId();
    if (state.season !== currentWeek) {
        state.points = 0;
        state.quizzesThisWeek = 0;
        state.perfectRounds = 0;
        state.totalAccuracy = 0;
        state.accuracyCount = 0;
        state.qualifiesForPromotion = false;
        state.season = currentWeek;
    }

    // Idempotency check
    if (submissionId && submissionId === state.lastSubmissionId) {
        logger.info('[Leagues] Duplicate submission ignored: ' + submissionId);
        return JSON.stringify({
            success: true,
            duplicate: true,
            points: state.points,
            tier: state.tier
        });
    }

    // ── ANTI-SANDBAGGING: Point cap per quiz ──
    if (points > MAX_POINTS_PER_QUIZ) {
        logger.warn('[Leagues] Points capped for ' + ctx.userId + ': ' + points + ' → ' + MAX_POINTS_PER_QUIZ);
        points = MAX_POINTS_PER_QUIZ;
    }

    // Apply tier multiplier
    var tierConfig = LEAGUE_CONFIG[state.tier] || LEAGUE_CONFIG.bronze;
    var adjustedPoints = Math.round(points * tierConfig.xpMultiplier);

    // ── ANTI-SANDBAGGING: Accuracy floor ──
    if (accuracy > 0 && accuracy < MIN_ACCURACY_FLOOR) {
        adjustedPoints = Math.round(adjustedPoints * 0.5);
        logger.warn('[Leagues] Low accuracy penalty for ' + ctx.userId + ': ' + Math.round(accuracy * 100) + '% → points halved');
    }

    // ── ANTI-SANDBAGGING: Consecutive low accuracy tracking ──
    if (!state.consecutiveLowAccuracy) state.consecutiveLowAccuracy = 0;
    if (!state.sandbaggingFlags) state.sandbaggingFlags = 0;

    if (accuracy > 0 && accuracy < SANDBAG_ACCURACY_THRESHOLD) {
        state.consecutiveLowAccuracy += 1;
        if (state.consecutiveLowAccuracy >= SANDBAG_CONSECUTIVE_LIMIT) {
            state.sandbaggingFlags += 1;
            adjustedPoints = Math.round(adjustedPoints * 0.25); // 75% penalty
            logger.warn('[Leagues] SANDBAGGING DETECTED for ' + ctx.userId + ': ' + state.consecutiveLowAccuracy + ' consecutive low games. Flag #' + state.sandbaggingFlags);
        }
    } else {
        state.consecutiveLowAccuracy = 0; // Reset on normal accuracy
    }

    var oldPoints = state.points;
    state.points += adjustedPoints;
    state.quizzesThisWeek += 1;
    if (isPerfect) state.perfectRounds += 1;
    state.totalAccuracy += Math.round(accuracy * 100);
    state.accuracyCount += 1;
    state.lastSubmissionId = submissionId;
    state.lastSubmissionAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();

    // Check promotion qualification
    state.qualifiesForPromotion = state.quizzesThisWeek >= MIN_QUIZZES_FOR_PROMOTION;

    // ── ANTI-SANDBAGGING: Consistency bonus ──
    var avgAccuracy = state.accuracyCount > 0 ? (state.totalAccuracy / state.accuracyCount) / 100 : 0;
    state.consistencyBonus = state.quizzesThisWeek >= CONSISTENCY_BONUS_QUIZZES &&
                             avgAccuracy >= CONSISTENCY_BONUS_ACCURACY &&
                             state.sandbaggingFlags === 0;

    // Sandbaggers cannot qualify for promotion
    if (state.sandbaggingFlags > 0) {
        state.qualifiesForPromotion = false;
    }

    writeLeagueState(nk, logger, ctx.userId, gameId, state);

    var tierIdx = getTierIndex(state.tier);
    var nearPromotion = state.points >= (tierConfig.promotionThreshold * 0.8);
    var nearDemotion = state.points <= (tierConfig.demotionThreshold * 1.2) && tierIdx > 0;

    logger.info('[Leagues] ' + ctx.userId + ' +' + adjustedPoints + 'pts (total: ' + state.points + ') in ' + state.tier);

    return JSON.stringify({
        success: true,
        pointsAwarded: adjustedPoints,
        pointsRaw: points,
        totalPoints: state.points,
        tier: state.tier,
        quizzesThisWeek: state.quizzesThisWeek,
        qualifiesForPromotion: state.qualifiesForPromotion,
        nearPromotion: nearPromotion,
        nearDemotion: nearDemotion,
        consistencyBonus: state.consistencyBonus || false,
        sandbaggingFlags: state.sandbaggingFlags || 0,
        xpMultiplier: tierConfig.xpMultiplier,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: league_process_season ─────────────────────────────────────────────

function rpcLeagueProcessSeason(ctx, logger, nk, payload) {
    // AUTH GUARD: Only server/cron (no userId) or admin calls allowed
    if (ctx.userId) {
        var data_guard = validatePayload(payload);
        var adminKey = (data_guard && data_guard.adminKey) || '';
        if (adminKey !== 'quizverse_season_cron_2026') {
            logger.warn('[Leagues] Unauthorized league_process_season call from user: ' + ctx.userId);
            return errorResponse('Unauthorized: server-only RPC');
        }
    }

    var data = validatePayload(payload);
    if (data === null) return errorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var currentWeek = getCurrentWeekId();

    logger.info('[Leagues] Processing season for ' + gameId + ', week ' + currentWeek);

    var stats = { promoted: 0, demoted: 0, stayed: 0, disqualified: 0, errors: 0 };

    // Process each tier
    for (var t = 0; t < LEAGUE_TIERS.length; t++) {
        var tier = LEAGUE_TIERS[t];
        var tierIdx = t;

        // Read all users in this tier via storage listing
        var cursor = '';
        var tierUsers = [];

        do {
            try {
                var result = nk.storageList(null, STORAGE_COLLECTION, 100, cursor);
                if (result && result.objects) {
                    for (var i = 0; i < result.objects.length; i++) {
                        var obj = result.objects[i];
                        if (obj.value && obj.value.tier === tier && obj.value.gameId === gameId) {
                            tierUsers.push(obj);
                        }
                    }
                }
                cursor = (result && result.cursor) ? result.cursor : '';
            } catch (err) {
                logger.error('[Leagues] Error listing tier ' + tier + ': ' + err.message);
                stats.errors++;
                cursor = '';
            }
        } while (cursor && cursor !== '');

        if (tierUsers.length === 0) continue;

        // Sort by points descending, then tiebreakers
        tierUsers.sort(function(a, b) {
            if (b.value.points !== a.value.points) return b.value.points - a.value.points;
            if ((b.value.perfectRounds || 0) !== (a.value.perfectRounds || 0)) return (b.value.perfectRounds || 0) - (a.value.perfectRounds || 0);
            var accA = a.value.accuracyCount > 0 ? a.value.totalAccuracy / a.value.accuracyCount : 0;
            var accB = b.value.accuracyCount > 0 ? b.value.totalAccuracy / b.value.accuracyCount : 0;
            return accB - accA;
        });

        var promoteCount = Math.max(1, Math.floor(tierUsers.length * PROMOTION_PERCENT / 100));
        var demoteCount = Math.max(1, Math.floor(tierUsers.length * DEMOTION_PERCENT / 100));

        for (var u = 0; u < tierUsers.length; u++) {
            var userObj = tierUsers[u];
            var userState = userObj.value;
            var userId = userObj.userId;
            var eligible = (userState.quizzesThisWeek || 0) >= MIN_QUIZZES_FOR_PROMOTION;
            var isSandbagger = (userState.sandbaggingFlags || 0) > 0;
            var isInactive = (userState.quizzesThisWeek || 0) === 0;
            var hasConsistencyBonus = userState.consistencyBonus === true;

            var newTier = tier;
            var action = 'stayed';

            if (isSandbagger) {
                // ── ANTI-SANDBAGGING: Flagged players cannot promote, auto-demote ──
                if (tierIdx > 0) {
                    newTier = LEAGUE_TIERS[tierIdx - 1];
                    stats.demoted++;
                    action = 'demoted';
                    logger.warn('[Leagues] Sandbagger demoted: ' + userId + ' (flags=' + userState.sandbaggingFlags + ')');
                } else {
                    stats.disqualified++;
                    action = 'disqualified';
                }
            } else if (INACTIVITY_DEMOTE && isInactive && tierIdx > 0) {
                // ── ANTI-SANDBAGGING: Inactive players demote ──
                newTier = LEAGUE_TIERS[tierIdx - 1];
                stats.demoted++;
                action = 'demoted';
            } else if (!eligible) {
                stats.disqualified++;
                action = 'disqualified';
            } else if (u < promoteCount && tierIdx < LEAGUE_TIERS.length - 1) {
                newTier = LEAGUE_TIERS[tierIdx + 1];
                stats.promoted++;
                action = 'promoted';
            } else if (u >= tierUsers.length - demoteCount && tierIdx > 0) {
                newTier = LEAGUE_TIERS[tierIdx - 1];
                stats.demoted++;
                action = 'demoted';
            } else {
                stats.stayed++;
            }

            // Reset for new season
            userState.tier = newTier;
            userState.points = 0;
            userState.quizzesThisWeek = 0;
            userState.perfectRounds = 0;
            userState.totalAccuracy = 0;
            userState.accuracyCount = 0;
            userState.qualifiesForPromotion = false;
            userState.sandbaggingFlags = 0;         // Fresh start each season
            userState.consecutiveLowAccuracy = 0;   // Reset tracking
            userState.consistencyBonus = false;      // Reset bonus
            userState.season = currentWeek;
            userState.lastSubmissionId = '';
            userState.updatedAt = new Date().toISOString();

            try {
                writeLeagueState(nk, logger, userId, gameId, userState);

                // Send notification for promotion/demotion
                if (action === 'promoted' || action === 'demoted') {
                    try {
                        nk.notificationsSend([{
                            userId: userId,
                            subject: action === 'promoted' ? 'League Promotion!' : 'League Update',
                            content: { action: action, oldTier: tier, newTier: newTier, season: currentWeek },
                            code: action === 'promoted' ? 100 : 101,
                            persistent: true
                        }]);
                    } catch (notifErr) {
                        logger.warn('[Leagues] Notification failed for ' + userId + ': ' + notifErr.message);
                    }
                }
            } catch (writeErr) {
                logger.error('[Leagues] Failed to update user ' + userId + ': ' + writeErr.message);
                stats.errors++;
            }
        }
    }

    logger.info('[Leagues] Season processed: ' + JSON.stringify(stats));

    return JSON.stringify({
        success: true,
        season: currentWeek,
        stats: stats,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: league_get_leaderboard ────────────────────────────────────────────

function rpcLeagueGetLeaderboard(ctx, logger, nk, payload) {
    if (!ctx.userId) return errorResponse('User not authenticated');

    var data = validatePayload(payload);
    if (data === null) return errorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var limit = Math.min(parseInt(data.limit) || 50, 100);

    // Get user's current tier
    var userState = readLeagueState(nk, logger, ctx.userId, gameId);
    if (!userState) {
        userState = initLeagueState(ctx.userId, gameId);
        writeLeagueState(nk, logger, ctx.userId, gameId, userState);
    }

    var userTier = userState.tier;
    var currentWeek = getCurrentWeekId();

    // Collect all users in same tier
    var tierUsers = [];
    var cursor = '';

    do {
        try {
            var result = nk.storageList(null, STORAGE_COLLECTION, 100, cursor);
            if (result && result.objects) {
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    if (obj.value && obj.value.tier === userTier && obj.value.gameId === gameId) {
                        tierUsers.push({
                            userId: obj.userId,
                            points: obj.value.points || 0,
                            perfectRounds: obj.value.perfectRounds || 0,
                            quizzesThisWeek: obj.value.quizzesThisWeek || 0,
                            averageAccuracy: obj.value.accuracyCount > 0 ?
                                Math.round(obj.value.totalAccuracy / obj.value.accuracyCount) : 0
                        });
                    }
                }
            }
            cursor = (result && result.cursor) ? result.cursor : '';
        } catch (err) {
            logger.error('[Leagues] Error listing leaderboard: ' + err.message);
            cursor = '';
        }
    } while (cursor && cursor !== '');

    // Sort by points descending with tiebreakers
    tierUsers.sort(function(a, b) {
        if (b.points !== a.points) return b.points - a.points;
        if (b.perfectRounds !== a.perfectRounds) return b.perfectRounds - a.perfectRounds;
        return b.averageAccuracy - a.averageAccuracy;
    });

    // Enrich with usernames (batch account fetch)
    var userIds = [];
    var recordsToReturn = tierUsers.slice(0, limit);
    for (var r = 0; r < recordsToReturn.length; r++) {
        userIds.push(recordsToReturn[r].userId);
    }

    var usernames = {};
    var avatarUrls = {};
    if (userIds.length > 0) {
        try {
            var accounts = nk.usersGetId(userIds);
            if (accounts) {
                for (var a = 0; a < accounts.length; a++) {
                    usernames[accounts[a].userId] = accounts[a].username || 'Player';
                    avatarUrls[accounts[a].userId] = accounts[a].avatarUrl || '';
                }
            }
        } catch (err) {
            logger.warn('[Leagues] Failed to fetch usernames: ' + err.message);
        }
    }

    // Build records with rank
    var records = [];
    var userRank = -1;
    var userRecord = null;

    for (var idx = 0; idx < tierUsers.length; idx++) {
        var u = tierUsers[idx];
        var rank = idx + 1;

        if (u.userId === ctx.userId) {
            userRank = rank;
            userRecord = {
                rank: rank,
                points: u.points,
                perfectRounds: u.perfectRounds,
                quizzesThisWeek: u.quizzesThisWeek,
                averageAccuracy: u.averageAccuracy,
                percentile: tierUsers.length > 1 ? Math.round(((tierUsers.length - rank) / (tierUsers.length - 1)) * 100) : 100
            };
        }

        if (idx < limit) {
            records.push({
                rank: rank,
                userId: u.userId,
                username: usernames[u.userId] || 'Player',
                avatarUrl: avatarUrls[u.userId] || '',
                points: u.points,
                perfectRounds: u.perfectRounds,
                quizzesThisWeek: u.quizzesThisWeek,
                averageAccuracy: u.averageAccuracy
            });
        }
    }

    // If user wasn't found in records
    if (!userRecord) {
        userRecord = {
            rank: tierUsers.length + 1,
            points: 0,
            perfectRounds: 0,
            quizzesThisWeek: 0,
            averageAccuracy: 0,
            percentile: 0
        };
    }

    return JSON.stringify({
        success: true,
        tier: userTier,
        season: currentWeek,
        seasonEndsAt: getNextMondayUTC(),
        totalPlayers: tierUsers.length,
        records: records,
        userRecord: userRecord,
        timestamp: new Date().toISOString()
    });
}
