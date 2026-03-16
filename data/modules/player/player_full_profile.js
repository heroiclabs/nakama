// player_full_profile.js - Aggregate Player Profile for QuizVerse v3.0
// RPC: player_get_full_profile

/**
 * Full Player Profile — Production-Ready Aggregator
 *
 * Returns complete player data in ONE call, replacing 5+ separate RPCs.
 * Designed for HomeScreen load and ProfileScreen.
 *
 * Aggregates: metadata + wallet + league + streak + badges + cosmetics + stats
 * All reads are parallel-safe (no writes, pure aggregation).
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var PROFILE_BADGE_COLLECTION = 'user_badges';
var PROFILE_LEAGUE_COLLECTION = 'league_state';
var PROFILE_STREAK_COLLECTION = 'streak_data';
var PROFILE_CHAR_COLLECTION = 'player_data';
var PROFILE_COLLECTIONS_COLLECTION = 'user_collections';
var PROFILE_QUIZ_COLLECTION = 'quiz_results';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function profileErrorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function profileValidatePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

function safeStorageRead(nk, logger, collection, key, userId) {
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.debug('[Profile] Read ' + collection + '/' + key + ' failed: ' + err.message);
    }
    return null;
}

// ─── RPC: player_get_full_profile ───────────────────────────────────────────

function rpcPlayerGetFullProfile(ctx, logger, nk, payload) {
    if (!ctx.userId) return profileErrorResponse('User not authenticated');

    var data = profileValidatePayload(payload);
    if (data === null) return profileErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var userId = ctx.userId;

    // ─── 1. Account & Metadata ──────────────────────────────────────────
    var account = null;
    var metadata = {};
    var username = 'Player';
    var avatarUrl = '';

    try {
        account = nk.accountGetId(userId);
        if (account && account.user) {
            username = account.user.username || 'Player';
            avatarUrl = account.user.avatarUrl || '';
            try {
                metadata = JSON.parse(account.user.metadata || '{}');
            } catch (e) { metadata = {}; }
        }
    } catch (err) {
        logger.warn('[Profile] Account fetch failed: ' + err.message);
    }

    // ─── 2. Wallet ──────────────────────────────────────────────────────
    var wallet = { coins: 0, gems: 0 };
    try {
        if (account && account.wallet) {
            var w = JSON.parse(account.wallet);
            wallet.coins = w.coins || 0;
            wallet.gems = w.gems || 0;
        }
    } catch (err) {
        logger.debug('[Profile] Wallet parse failed');
    }

    // ─── 3. League State ────────────────────────────────────────────────
    var league = { tier: 'bronze', points: 0, rank: 0, season: '' };
    var leagueData = safeStorageRead(nk, logger, PROFILE_LEAGUE_COLLECTION,
        userId + '_' + gameId, userId);
    if (leagueData) {
        league.tier = leagueData.tier || 'bronze';
        league.points = leagueData.points || 0;
        league.season = leagueData.season || '';
        league.quizzesThisWeek = leagueData.quizzesThisWeek || 0;
        league.qualifiesForPromotion = leagueData.qualifiesForPromotion || false;
    }

    // ─── 4. Streak Data ────────────────────────────────────────────────
    var streak = { currentDay: 0, state: 'neutral', isBroken: false, hasShield: false };
    var streakData = safeStorageRead(nk, logger, PROFILE_STREAK_COLLECTION,
        userId + '_' + gameId, userId);
    if (streakData) {
        streak.currentDay = streakData.currentDay || 0;
        streak.isBroken = streakData.isBroken || false;
        streak.hasShield = streakData.hasShield || false;
        streak.lastCompletedAt = streakData.lastQuizCompletedAt || null;
        streak.hasActiveWager = !!(streakData.activeWager && streakData.activeWager.status === 'active');

        // Derive state
        if (streak.isBroken) {
            streak.state = 'broken';
        } else if (streak.currentDay >= 30) {
            streak.state = 'legendary';
        } else if (streak.currentDay >= 14) {
            streak.state = 'proud';
        } else if (streak.currentDay >= 7) {
            streak.state = 'strong';
        } else if (streak.currentDay >= 3) {
            streak.state = 'building';
        } else {
            streak.state = 'neutral';
        }
    }

    // ─── 5. Character Data ──────────────────────────────────────────────
    var character = { activeCharacter: 'quizzy', xpBonus: 0 };
    var charData = safeStorageRead(nk, logger, PROFILE_CHAR_COLLECTION,
        'characters_' + userId + '_' + gameId, userId);
    if (charData) {
        character.activeCharacter = charData.activeCharacter || 'quizzy';
        character.totalUnlocked = Object.keys(charData.unlockedCharacters || {}).length;
    }

    // ─── 6. Equipped Cosmetics ──────────────────────────────────────────
    var cosmetics = { frame: null, title: null, badge: null, avatar: null };
    var collectionsData = safeStorageRead(nk, logger, PROFILE_COLLECTIONS_COLLECTION,
        'data_' + userId + '_' + gameId, userId);
    if (collectionsData && collectionsData.equipped) {
        cosmetics.frame = collectionsData.equipped.frame || null;
        cosmetics.title = collectionsData.equipped.title || null;
        cosmetics.badge = collectionsData.equipped.badge || null;
        cosmetics.avatar = collectionsData.equipped.avatar || null;
    }

    // ─── 7. Badge Summary ───────────────────────────────────────────────
    var badges = { displayed: [], total: 0 };
    var badgeData = safeStorageRead(nk, logger, PROFILE_BADGE_COLLECTION,
        'progress_' + userId + '_' + gameId, userId);
    if (badgeData) {
        var earnedBadges = [];
        if (badgeData.badges) {
            for (var bId in badgeData.badges) {
                if (badgeData.badges[bId].earned) {
                    earnedBadges.push(bId);
                }
            }
        }
        badges.total = earnedBadges.length;
        badges.displayed = badgeData.displayed || [];
    }

    // ─── 8. Stats (from metadata) ───────────────────────────────────────
    var stats = {
        totalQuizzes: metadata.totalQuizzes || 0,
        accuracy: metadata.accuracy || 0,
        bestStreak: metadata.bestStreak || 0,
        totalCorrectAnswers: metadata.totalCorrectAnswers || 0,
        totalXp: metadata.totalXp || 0,
        level: metadata.level || 1,
        xp: metadata.xp || 0,
        xpToNextLevel: metadata.xpToNextLevel || 100,
        joinedAt: metadata.joinedAt || (account && account.user ? account.user.createTime : null)
    };

    // ─── ASSEMBLE RESPONSE ──────────────────────────────────────────────
    return JSON.stringify({
        success: true,
        profile: {
            userId: userId,
            username: username,
            avatarUrl: avatarUrl,
            level: stats.level,
            xp: stats.xp,
            xpToNextLevel: stats.xpToNextLevel,
            totalXp: stats.totalXp,
            streakDay: streak.currentDay,
            streakState: streak.state,
            streakIsBroken: streak.isBroken,
            streakHasShield: streak.hasShield,
            streakHasActiveWager: streak.hasActiveWager || false,
            activeCharacter: character.activeCharacter,
            activeCharacterXpBonus: character.xpBonus,
            equippedCosmetics: cosmetics,
            league: league,
            wallet: wallet,
            badges: badges,
            stats: stats
        },
        gameId: gameId,
        timestamp: new Date().toISOString()
    });
}
