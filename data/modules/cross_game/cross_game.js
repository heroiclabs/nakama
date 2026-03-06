// cross_game.js - Cross-game RPCs for multi-game ecosystem features
// Compatible with Nakama V8 JavaScript runtime (no ES modules)

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

var KNOWN_GAMES = ["quizverse", "lasttolive"];

// ============================================================================
// HELPERS
// ============================================================================

function generateCrossGameUUID() {
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

function crossGameSafeRead(nk, collection, key, userId) {
    try {
        var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
        if (recs && recs.length > 0) return recs[0].value;
    } catch (_) { /* swallow */ }
    return null;
}

function crossGameSafeWrite(nk, collection, key, userId, value) {
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

function resolveUserId(nk, data, ctx) {
    if (ctx.userId && ctx.userId !== SYSTEM_USER_ID) {
        return ctx.userId;
    }
    if (data.device_id) {
        try {
            var users = nk.usersGetId([data.device_id]);
            if (users && users.length > 0) return users[0].id;
        } catch (_) { /* fall through */ }
        try {
            var auth = nk.authenticateDevice(data.device_id, null, false);
            if (auth && auth.id) return auth.id;
        } catch (_) { /* fall through */ }
    }
    return ctx.userId || SYSTEM_USER_ID;
}

// ============================================================================
// RPC 1 – rpcCrossGameBonus
// ============================================================================

/**
 * When a player performs an action in one game, grant a bonus in another game.
 * Payload: { device_id, source_game_id, target_game_id, event_type }
 */
function rpcCrossGameBonus(ctx, logger, nk, payload) {
    logger.info("[cross_game] rpcCrossGameBonus called");

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.source_game_id || !data.target_game_id) {
            return JSON.stringify({ success: false, error: "source_game_id and target_game_id are required" });
        }
        if (!data.event_type) {
            return JSON.stringify({ success: false, error: "event_type is required" });
        }

        var userId = resolveUserId(nk, data, ctx);
        var bonusId = generateCrossGameUUID();
        var bonusAmount = 50;

        var bonusRecord = {
            bonus_id: bonusId,
            source_game_id: data.source_game_id,
            target_game_id: data.target_game_id,
            event_type: data.event_type,
            coins_granted: bonusAmount,
            granted_at: nowISO()
        };

        crossGameSafeWrite(nk, "cross_game_bonuses", "bonus:" + bonusId, userId, bonusRecord);

        try {
            nk.walletUpdate(userId, { coins: bonusAmount }, {
                source: "cross_game_bonus",
                source_game: data.source_game_id,
                target_game: data.target_game_id,
                event_type: data.event_type
            }, true);
        } catch (walletErr) {
            logger.warn("[cross_game] Wallet update failed, using storage fallback: " + walletErr.message);
            var walletKey = "wallet:" + data.target_game_id;
            var wallet = crossGameSafeRead(nk, "cross_game_wallets", walletKey, userId) || { coins: 0 };
            wallet.coins = (wallet.coins || 0) + bonusAmount;
            wallet.updated_at = nowISO();
            crossGameSafeWrite(nk, "cross_game_wallets", walletKey, userId, wallet);
        }

        logger.info("[cross_game] Bonus granted: " + bonusAmount + " coins from " + data.source_game_id + " -> " + data.target_game_id);

        return JSON.stringify({
            success: true,
            bonus_granted: bonusAmount,
            source_game: data.source_game_id,
            target_game: data.target_game_id
        });

    } catch (err) {
        logger.error("[cross_game] rpcCrossGameBonus error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC 2 – rpcCrossGameProfile
// ============================================================================

/**
 * Aggregate player data across all games.
 * Payload: { device_id }
 */
function rpcCrossGameProfile(ctx, logger, nk, payload) {
    logger.info("[cross_game] rpcCrossGameProfile called");

    try {
        var data = JSON.parse(payload || '{}');
        var userId = resolveUserId(nk, data, ctx);

        var gamesPlayed = [];
        var totalXP = 0;
        var totalCoins = 0;
        var achievementsCount = 0;

        for (var i = 0; i < KNOWN_GAMES.length; i++) {
            var gameId = KNOWN_GAMES[i];
            var profileKey = "profile_" + userId;
            var profile = crossGameSafeRead(nk, gameId + "_profiles", profileKey, userId);

            var walletKey = "wallet_" + userId;
            var wallet = crossGameSafeRead(nk, gameId + "_wallets", walletKey, userId);

            var achieveKey = "progress:" + gameId;
            var achievements = crossGameSafeRead(nk, "achievements_progress", achieveKey, userId);

            var level = 0;
            var xp = 0;
            var playtime = 0;
            var coins = 0;

            if (profile) {
                level = profile.level || 0;
                xp = profile.xp || 0;
                playtime = profile.playtime || 0;
            }

            if (wallet) {
                coins = wallet.balance || 0;
            }

            var gameAchievements = 0;
            if (achievements && achievements.events) {
                var keys = Object.keys(achievements.events);
                gameAchievements = keys.length;
            }

            gamesPlayed.push({
                game_id: gameId,
                level: level,
                xp: xp,
                playtime: playtime
            });

            totalXP += xp;
            totalCoins += coins;
            achievementsCount += gameAchievements;
        }

        return JSON.stringify({
            success: true,
            games_played: gamesPlayed,
            total_xp: totalXP,
            total_coins: totalCoins,
            achievements_count: achievementsCount
        });

    } catch (err) {
        logger.error("[cross_game] rpcCrossGameProfile error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC 3 – rpcCrossGameChallenge
// ============================================================================

/**
 * Create a multi-game challenge between two players.
 * Payload: { device_id, target_user_id, game_ids }
 */
function rpcCrossGameChallenge(ctx, logger, nk, payload) {
    logger.info("[cross_game] rpcCrossGameChallenge called");

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.target_user_id) {
            return JSON.stringify({ success: false, error: "target_user_id is required" });
        }
        if (!data.game_ids || !data.game_ids.length) {
            return JSON.stringify({ success: false, error: "game_ids array is required" });
        }

        var userId = resolveUserId(nk, data, ctx);
        var challengeId = generateCrossGameUUID();

        var challenge = {
            challenge_id: challengeId,
            challenger_id: userId,
            target_user_id: data.target_user_id,
            game_ids: data.game_ids,
            status: "pending",
            scores: {},
            created_at: nowISO()
        };

        for (var i = 0; i < data.game_ids.length; i++) {
            challenge.scores[data.game_ids[i]] = {
                challenger: 0,
                target: 0
            };
        }

        crossGameSafeWrite(nk, "cross_game_challenges", "challenge:" + challengeId, userId, challenge);
        crossGameSafeWrite(nk, "cross_game_challenges", "challenge:" + challengeId, data.target_user_id, challenge);

        try {
            nk.notificationsSend([{
                userId: data.target_user_id,
                subject: "Cross-Game Challenge!",
                content: {
                    challenge_id: challengeId,
                    challenger_id: userId,
                    games: data.game_ids
                },
                code: 100,
                persistent: true,
                senderId: userId
            }]);
        } catch (notifErr) {
            logger.warn("[cross_game] Challenge notification failed: " + notifErr.message);
        }

        logger.info("[cross_game] Challenge created: " + challengeId + " across " + data.game_ids.length + " games");

        return JSON.stringify({
            success: true,
            challenge_id: challengeId,
            games: data.game_ids,
            status: "pending"
        });

    } catch (err) {
        logger.error("[cross_game] rpcCrossGameChallenge error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC 4 – rpcGameDiscoveryReward
// ============================================================================

/**
 * First-time bonus for trying a new game.
 * Payload: { device_id, game_id }
 */
function rpcGameDiscoveryReward(ctx, logger, nk, payload) {
    logger.info("[cross_game] rpcGameDiscoveryReward called");

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.game_id) {
            return JSON.stringify({ success: false, error: "game_id is required" });
        }

        var userId = resolveUserId(nk, data, ctx);
        var claimKey = "discovery:" + data.game_id;

        var existing = crossGameSafeRead(nk, "cross_game_bonuses", claimKey, userId);
        if (existing) {
            return JSON.stringify({
                success: true,
                first_time: false,
                reward: null,
                message: "Discovery reward already claimed for " + data.game_id
            });
        }

        var reward = { coins: 100, gems: 25 };

        try {
            nk.walletUpdate(userId, { coins: reward.coins, gems: reward.gems }, {
                source: "game_discovery",
                game_id: data.game_id
            }, true);
        } catch (walletErr) {
            logger.warn("[cross_game] Discovery wallet update failed, using storage: " + walletErr.message);
            var walletKey = "wallet:" + data.game_id;
            var wallet = crossGameSafeRead(nk, "cross_game_wallets", walletKey, userId) || { coins: 0, gems: 0 };
            wallet.coins = (wallet.coins || 0) + reward.coins;
            wallet.gems = (wallet.gems || 0) + reward.gems;
            wallet.updated_at = nowISO();
            crossGameSafeWrite(nk, "cross_game_wallets", walletKey, userId, wallet);
        }

        var claimRecord = {
            game_id: data.game_id,
            reward: reward,
            claimed_at: nowISO()
        };
        crossGameSafeWrite(nk, "cross_game_bonuses", claimKey, userId, claimRecord);

        logger.info("[cross_game] Discovery reward granted for " + data.game_id + ": " + reward.coins + " coins + " + reward.gems + " gems");

        return JSON.stringify({
            success: true,
            first_time: true,
            reward: reward
        });

    } catch (err) {
        logger.error("[cross_game] rpcGameDiscoveryReward error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC 5 – rpcGlobalLeaderboardComposite
// ============================================================================

/**
 * Read top scores from multiple game leaderboards, compute combined ranking.
 * Payload: { limit }
 */
function rpcGlobalLeaderboardComposite(ctx, logger, nk, payload) {
    logger.info("[cross_game] rpcGlobalLeaderboardComposite called");

    try {
        var data = JSON.parse(payload || '{}');
        var limit = data.limit || 10;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var leaderboardIds = [
            "quizverse_weekly",
            "lasttolive_survivor_rank"
        ];

        var playerScores = {};

        for (var i = 0; i < leaderboardIds.length; i++) {
            var lbId = leaderboardIds[i];
            try {
                var result = nk.leaderboardRecordsList(lbId, null, 100, null, 0);
                var records = (result && result.records) ? result.records : [];

                for (var j = 0; j < records.length; j++) {
                    var rec = records[j];
                    var uid = rec.ownerId || rec.owner_id;
                    if (!uid) continue;

                    if (!playerScores[uid]) {
                        playerScores[uid] = {
                            user_id: uid,
                            username: rec.username || "",
                            total_score: 0,
                            game_scores: {}
                        };
                    }

                    var score = Number(rec.score) || 0;
                    playerScores[uid].game_scores[lbId] = score;
                    playerScores[uid].total_score += score;

                    if (rec.username && !playerScores[uid].username) {
                        playerScores[uid].username = rec.username;
                    }
                }
            } catch (lbErr) {
                logger.warn("[cross_game] Leaderboard " + lbId + " read failed: " + lbErr.message);
            }
        }

        var rankings = [];
        var uids = Object.keys(playerScores);
        for (var k = 0; k < uids.length; k++) {
            rankings.push(playerScores[uids[k]]);
        }

        rankings.sort(function (a, b) {
            return b.total_score - a.total_score;
        });

        if (rankings.length > limit) {
            rankings = rankings.slice(0, limit);
        }

        return JSON.stringify({
            success: true,
            rankings: rankings
        });

    } catch (err) {
        logger.error("[cross_game] rpcGlobalLeaderboardComposite error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// REGISTRATION
// ============================================================================

function registerCrossGameRPCs(initializer, logger) {
    logger.info('[CrossGame] Initializing Cross-Game RPC Module...');

    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }

    var rpcs = [
        { id: 'cross_game_bonus', handler: rpcCrossGameBonus },
        { id: 'cross_game_profile', handler: rpcCrossGameProfile },
        { id: 'cross_game_challenge', handler: rpcCrossGameChallenge },
        { id: 'game_discovery_reward', handler: rpcGameDiscoveryReward },
        { id: 'global_leaderboard_composite', handler: rpcGlobalLeaderboardComposite }
    ];

    var registered = 0;
    var skipped = 0;

    for (var i = 0; i < rpcs.length; i++) {
        var rpc = rpcs[i];
        if (!globalThis.__registeredRPCs.has(rpc.id)) {
            try {
                initializer.registerRpc(rpc.id, rpc.handler);
                globalThis.__registeredRPCs.add(rpc.id);
                registered++;
            } catch (err) {
                logger.error('[CrossGame] Failed to register ' + rpc.id + ': ' + err.message);
            }
        } else {
            skipped++;
        }
    }

    logger.info('[CrossGame] Registration complete: ' + registered + ' registered, ' + skipped + ' skipped');
}
