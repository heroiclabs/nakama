/**
 * Quests Economy Bridge — connects Nakama wallet operations to the
 * quests-economy global PointsLedger via S2S authenticated HTTP calls.
 *
 * The quests-economy API is the single source of truth for all wallet balances.
 * This module exposes RPCs that games can call to earn/spend/query the global wallet.
 *
 * Environment variables (set in Nakama config or docker-compose):
 *   QUESTS_ECONOMY_API_URL  — e.g. http://quests-api:3001
 *   NAKAMA_WEBHOOK_SECRET   — shared HMAC secret for S2S auth
 *   DEFAULT_GAME_ID         — default game_id if not provided
 */

var QUESTS_API_URL = '';
var WEBHOOK_SECRET = '';
var DEFAULT_GAME_ID = 'f6f7fe36-03de-43b8-8b5d-1a1892da4eed';

/**
 * Per-game conversion ratios.
 * Key = game_id, value = how many game coins equal 1 global wallet point.
 * E.g. 1000 means 1000 game coins = 1 global point.
 */
var GAME_CONVERSION_RATIOS = {};

function _QuestsBridgeInit(ctx, logger, nk, initializer) {
    QUESTS_API_URL = (ctx.env['QUESTS_ECONOMY_API_URL'] || 'http://localhost:3001').replace(/\/$/, '');
    WEBHOOK_SECRET = ctx.env['NAKAMA_WEBHOOK_SECRET'] || '';
    DEFAULT_GAME_ID = ctx.env['DEFAULT_GAME_ID'] || DEFAULT_GAME_ID;

    loadConversionRatios(nk, logger);

    logger.info('[QuestsBridge] Initializing — API: ' + QUESTS_API_URL);

    initializer.registerRpc('global_wallet_balance', rpcGlobalWalletBalance);
    initializer.registerRpc('global_wallet_earn', rpcGlobalWalletEarn);
    initializer.registerRpc('global_wallet_spend', rpcGlobalWalletSpend);
    initializer.registerRpc('global_wallet_history', rpcGlobalWalletHistory);
    initializer.registerRpc('game_to_global_convert', rpcGameToGlobalConvert);
    initializer.registerRpc('game_to_global_preview', rpcGameToGlobalPreview);
    initializer.registerRpc('conversion_ratio_set', rpcConversionRatioSet);
    initializer.registerRpc('conversion_ratio_get', rpcConversionRatioGet);

    initializer.registerRpc('intellidraws_list', rpcIntelliDrawsList);
    initializer.registerRpc('intellidraws_winners', rpcIntelliDrawsWinners);
    initializer.registerRpc('intellidraws_enter', rpcIntelliDrawsEnter);
    initializer.registerRpc('intellidraws_past', rpcIntelliDrawsPast);

    logger.info('[QuestsBridge] RPCs registered (wallet + conversion + intellidraws)');
}

function signRequest(nk, body) {
    return nk.hmacSha256Hash(WEBHOOK_SECRET, body);
}

// Lightweight game wallet helpers (self-contained, mirrors index.js storage format)
function bridgeGetGameWallet(nk, logger, userId, gameId) {
    var key = 'wallet_' + userId + '_' + gameId;
    try {
        var records = nk.storageRead([{
            collection: 'wallets',
            key: key,
            userId: userId,
        }]);
        if (records && records.length > 0 && records[0].value) {
            var wallet = records[0].value;
            if (wallet.currencies) {
                if (wallet.currencies.game === undefined) wallet.currencies.game = wallet.currencies.tokens || 0;
                if (wallet.currencies.tokens === undefined) wallet.currencies.tokens = wallet.currencies.game || 0;
            }
            return wallet;
        }
    } catch (err) {
        logger.warn('[QuestsBridge] Failed to read game wallet: ' + err.message);
    }
    return {
        userId: userId,
        gameId: gameId,
        currencies: { game: 0, tokens: 0, xp: 0 },
        items: {},
    };
}

function bridgeSaveGameWallet(nk, logger, userId, gameId, wallet) {
    var key = 'wallet_' + userId + '_' + gameId;
    try {
        nk.storageWrite([{
            collection: 'wallets',
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0,
        }]);
        return true;
    } catch (err) {
        logger.error('[QuestsBridge] Failed to save game wallet: ' + err.message);
        return false;
    }
}

function bridgeLogTransaction(nk, logger, userId, data) {
    try {
        var key = 'txn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        nk.storageWrite([{
            collection: 'transaction_logs',
            key: key,
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0,
        }]);
    } catch (err) {
        logger.warn('[QuestsBridge] Failed to log transaction: ' + err.message);
    }
}

function questsApiCall(nk, logger, userId, gameId, endpoint, body) {
    var bodyStr = JSON.stringify(body || {});
    var signature = signRequest(nk, bodyStr);
    var url = QUESTS_API_URL + '/game-bridge/s2s/wallet/' + endpoint;

    var headers = {
        'Content-Type': 'application/json',
        'X-Source': 'nakama-rpc',
        'X-Webhook-Signature': signature,
        'X-User-Id': userId,
        'X-Game-Id': gameId || DEFAULT_GAME_ID,
    };

    try {
        var response = nk.httpRequest(url, 'post', headers, bodyStr);
        if (response.code >= 200 && response.code < 300) {
            return JSON.parse(response.body);
        }
        logger.error('[QuestsBridge] API error ' + response.code + ': ' + response.body);
        return { error: 'API returned ' + response.code, details: response.body };
    } catch (err) {
        logger.error('[QuestsBridge] HTTP request failed: ' + err.message);
        return { error: 'HTTP request failed', details: err.message };
    }
}

/**
 * RPC: Get global wallet balance from quests-economy PointsLedger.
 * Payload: {} (none required)
 * Returns: { userId, balance }
 */
function rpcGlobalWalletBalance(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var result = questsApiCall(nk, logger, userId, DEFAULT_GAME_ID, 'balance', {});

    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }

    return JSON.stringify({
        success: true,
        userId: userId,
        balance: result.balance || 0,
    });
}

/**
 * RPC: Earn points into the global wallet.
 * Payload: { amount: number, sourceType?: string, sourceId?: string, description?: string }
 * Returns: { userId, amountEarned, newBalance }
 */
function rpcGlobalWalletEarn(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var amount = parsed.amount;
    if (!amount || amount <= 0) {
        return JSON.stringify({ success: false, error: 'amount must be > 0' });
    }

    var gameId = parsed.gameId || DEFAULT_GAME_ID;
    var body = {
        amount: amount,
        sourceType: parsed.sourceType || 'game_reward',
        sourceId: parsed.sourceId || gameId,
        description: parsed.description || ('Game reward: ' + amount + ' points'),
    };

    var result = questsApiCall(nk, logger, userId, gameId, 'earn', body);

    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }

    logger.info('[QuestsBridge] Earned ' + amount + ' for user ' + userId + ' → balance ' + result.newBalance);

    return JSON.stringify({
        success: true,
        userId: userId,
        amountEarned: result.amountEarned,
        newBalance: result.newBalance,
    });
}

/**
 * RPC: Spend points from the global wallet.
 * Payload: { amount: number, sourceType?: string, sourceId?: string, description?: string }
 * Returns: { userId, amountSpent, newBalance }
 */
function rpcGlobalWalletSpend(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var amount = parsed.amount;
    if (!amount || amount <= 0) {
        return JSON.stringify({ success: false, error: 'amount must be > 0' });
    }

    var gameId = parsed.gameId || DEFAULT_GAME_ID;
    var body = {
        amount: amount,
        sourceType: parsed.sourceType || 'game_spend',
        sourceId: parsed.sourceId || gameId,
        description: parsed.description || ('Game spend: ' + amount + ' points'),
    };

    var result = questsApiCall(nk, logger, userId, gameId, 'spend', body);

    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }

    logger.info('[QuestsBridge] Spent ' + amount + ' for user ' + userId + ' → balance ' + result.newBalance);

    return JSON.stringify({
        success: true,
        userId: userId,
        amountSpent: result.amountSpent,
        newBalance: result.newBalance,
    });
}

/**
 * RPC: Get global wallet transaction history.
 * Payload: { limit?: number, offset?: number }
 * Returns: { userId, entries: [...], total }
 */
function rpcGlobalWalletHistory(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var body = {
        limit: parsed.limit || 50,
        offset: parsed.offset || 0,
    };

    var result = questsApiCall(nk, logger, userId, DEFAULT_GAME_ID, 'history', body);

    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }

    return JSON.stringify({
        success: true,
        userId: userId,
        entries: result.entries || [],
        total: result.total || 0,
    });
}

// ═══════════════════════════════════════════════════════════════════
//  CONVERSION RATIO STORAGE
// ═══════════════════════════════════════════════════════════════════

var CONVERSION_STORAGE_COLLECTION = 'economy_config';
var CONVERSION_STORAGE_KEY = 'game_conversion_ratios';
var SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

function loadConversionRatios(nk, logger) {
    try {
        var records = nk.storageRead([{
            collection: CONVERSION_STORAGE_COLLECTION,
            key: CONVERSION_STORAGE_KEY,
            userId: SYSTEM_USER_ID,
        }]);
        if (records && records.length > 0 && records[0].value) {
            GAME_CONVERSION_RATIOS = records[0].value.ratios || {};
        }
    } catch (err) {
        logger.warn('[QuestsBridge] No saved conversion ratios found, using defaults');
    }

    // Hardcoded default: game 126bf539-dae2-4bcf-964d-316c0fa1f92b = 1000:1
    if (!GAME_CONVERSION_RATIOS['126bf539-dae2-4bcf-964d-316c0fa1f92b']) {
        GAME_CONVERSION_RATIOS['126bf539-dae2-4bcf-964d-316c0fa1f92b'] = 1000;
    }

    logger.info('[QuestsBridge] Conversion ratios loaded: ' + JSON.stringify(GAME_CONVERSION_RATIOS));
}

function saveConversionRatios(nk, logger) {
    try {
        nk.storageWrite([{
            collection: CONVERSION_STORAGE_COLLECTION,
            key: CONVERSION_STORAGE_KEY,
            userId: SYSTEM_USER_ID,
            value: { ratios: GAME_CONVERSION_RATIOS, updatedAt: Date.now() },
            permissionRead: 2,
            permissionWrite: 0,
        }]);
        return true;
    } catch (err) {
        logger.error('[QuestsBridge] Failed to save conversion ratios: ' + err.message);
        return false;
    }
}

function getConversionRatio(gameId) {
    return GAME_CONVERSION_RATIOS[gameId] || 0;
}

// ═══════════════════════════════════════════════════════════════════
//  CONVERSION RPCs
// ═══════════════════════════════════════════════════════════════════

/**
 * RPC: Preview how many global points a game coin amount would yield.
 * Payload: { gameId: string, gameCoinAmount: number }
 * Returns: { gameId, gameCoinAmount, globalPointsYield, ratio, gameBalance }
 */
function rpcGameToGlobalPreview(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var gameId = parsed.gameId;
    if (!gameId) {
        return JSON.stringify({ success: false, error: 'gameId is required' });
    }

    var ratio = getConversionRatio(gameId);
    if (ratio <= 0) {
        return JSON.stringify({ success: false, error: 'No conversion ratio configured for game ' + gameId });
    }

    // Read current game wallet balance
    var gameWallet = bridgeGetGameWallet(nk, logger, userId, gameId);
    var gameBalance = (gameWallet.currencies && (gameWallet.currencies.game || gameWallet.currencies.tokens)) || 0;

    var gameCoinAmount = parsed.gameCoinAmount || gameBalance;
    if (gameCoinAmount <= 0) {
        return JSON.stringify({ success: false, error: 'No game coins to convert' });
    }

    var globalPointsYield = Math.floor(gameCoinAmount / ratio);

    // Also fetch global balance from quests-economy
    var globalResult = questsApiCall(nk, logger, userId, gameId, 'balance', {});
    var currentGlobalBalance = (globalResult && !globalResult.error) ? (globalResult.balance || 0) : 0;

    return JSON.stringify({
        success: true,
        gameId: gameId,
        gameCoinAmount: gameCoinAmount,
        globalPointsYield: globalPointsYield,
        ratio: ratio,
        gameBalance: gameBalance,
        currentGlobalBalance: currentGlobalBalance,
        projectedGlobalBalance: currentGlobalBalance + globalPointsYield,
    });
}

/**
 * RPC: Convert game wallet coins into global wallet points.
 * Deducts from game wallet in Nakama storage, credits to quests-economy PointsLedger.
 *
 * Payload: { gameId: string, gameCoinAmount: number }
 * Returns: { gameId, gameCoinsBurned, globalPointsEarned, newGameBalance, newGlobalBalance }
 */
function rpcGameToGlobalConvert(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var gameId = parsed.gameId;
    if (!gameId) {
        return JSON.stringify({ success: false, error: 'gameId is required' });
    }

    var ratio = getConversionRatio(gameId);
    if (ratio <= 0) {
        return JSON.stringify({ success: false, error: 'No conversion ratio configured for game ' + gameId });
    }

    var gameCoinAmount = parsed.gameCoinAmount;
    if (!gameCoinAmount || gameCoinAmount <= 0) {
        return JSON.stringify({ success: false, error: 'gameCoinAmount must be > 0' });
    }

    // Must be at least 1 ratio unit to yield any global points
    if (gameCoinAmount < ratio) {
        return JSON.stringify({
            success: false,
            error: 'Minimum conversion is ' + ratio + ' game coins (= 1 global point)',
        });
    }

    // Read game wallet
    var gameWallet = bridgeGetGameWallet(nk, logger, userId, gameId);
    var gameBalance = (gameWallet.currencies && (gameWallet.currencies.game || gameWallet.currencies.tokens)) || 0;

    if (gameBalance < gameCoinAmount) {
        return JSON.stringify({
            success: false,
            error: 'Insufficient game balance. Have ' + gameBalance + ', need ' + gameCoinAmount,
        });
    }

    // Calculate yield (floor — fractional global points are not awarded)
    var globalPointsEarned = Math.floor(gameCoinAmount / ratio);
    var actualCoinsBurned = globalPointsEarned * ratio; // only burn exact multiples

    // Step 1: Deduct from game wallet
    var currenciesToUpdate = ['game', 'tokens'];
    for (var i = 0; i < currenciesToUpdate.length; i++) {
        var curr = currenciesToUpdate[i];
        if (gameWallet.currencies[curr] !== undefined) {
            gameWallet.currencies[curr] -= actualCoinsBurned;
            if (gameWallet.currencies[curr] < 0) gameWallet.currencies[curr] = 0;
        }
    }
    if (!bridgeSaveGameWallet(nk, logger, userId, gameId, gameWallet)) {
        return JSON.stringify({ success: false, error: 'Failed to deduct game coins' });
    }

    // Step 2: Credit to quests-economy global wallet
    var earnResult = questsApiCall(nk, logger, userId, gameId, 'earn', {
        amount: globalPointsEarned,
        sourceType: 'game_to_global_conversion',
        sourceId: gameId,
        description: 'Converted ' + actualCoinsBurned + ' game coins → ' + globalPointsEarned + ' global points (ratio ' + ratio + ':1)',
    });

    if (earnResult.error) {
        // Rollback: re-add game coins
        for (var i = 0; i < currenciesToUpdate.length; i++) {
            var curr = currenciesToUpdate[i];
            if (gameWallet.currencies[curr] !== undefined) {
                gameWallet.currencies[curr] += actualCoinsBurned;
            }
        }
        bridgeSaveGameWallet(nk, logger, userId, gameId, gameWallet);
        logger.error('[QuestsBridge] Conversion rolled back for user ' + userId + ': ' + earnResult.error);
        return JSON.stringify({ success: false, error: 'Failed to credit global wallet, game coins restored' });
    }

    // Log the conversion
    bridgeLogTransaction(nk, logger, userId, {
        type: 'game_to_global_conversion',
        gameId: gameId,
        gameCoinsBurned: actualCoinsBurned,
        globalPointsEarned: globalPointsEarned,
        ratio: ratio,
    });

    var newGameBalance = (gameWallet.currencies.game || gameWallet.currencies.tokens || 0);

    logger.info('[QuestsBridge] User ' + userId + ' converted ' + actualCoinsBurned + ' game coins → ' +
        globalPointsEarned + ' global pts (game ' + gameId + ')');

    return JSON.stringify({
        success: true,
        gameId: gameId,
        gameCoinsBurned: actualCoinsBurned,
        globalPointsEarned: globalPointsEarned,
        ratio: ratio,
        newGameBalance: newGameBalance,
        newGlobalBalance: earnResult.newBalance,
    });
}

/**
 * RPC: Set conversion ratio for a game (admin only — server-side trusted call).
 * Payload: { gameId: string, ratio: number }
 */
function rpcConversionRatioSet(ctx, logger, nk, payload) {
    var parsed = JSON.parse(payload || '{}');
    var gameId = parsed.gameId;
    var ratio = parsed.ratio;

    if (!gameId || !ratio || ratio <= 0) {
        return JSON.stringify({ success: false, error: 'gameId and ratio (> 0) are required' });
    }

    GAME_CONVERSION_RATIOS[gameId] = ratio;
    saveConversionRatios(nk, logger);

    logger.info('[QuestsBridge] Conversion ratio set: game ' + gameId + ' = ' + ratio + ':1');

    return JSON.stringify({
        success: true,
        gameId: gameId,
        ratio: ratio,
        allRatios: GAME_CONVERSION_RATIOS,
    });
}

/**
 * RPC: Get conversion ratio(s).
 * Payload: { gameId?: string } — if omitted, returns all ratios
 */
function rpcConversionRatioGet(ctx, logger, nk, payload) {
    var parsed = JSON.parse(payload || '{}');

    if (parsed.gameId) {
        var ratio = getConversionRatio(parsed.gameId);
        return JSON.stringify({
            success: true,
            gameId: parsed.gameId,
            ratio: ratio,
            configured: ratio > 0,
        });
    }

    return JSON.stringify({
        success: true,
        ratios: GAME_CONVERSION_RATIOS,
    });
}

// ═══════════════════════════════════════════════════════════════════
//  INTELLIDRAWS (LOTTERY) RPCs
// ═══════════════════════════════════════════════════════════════════

function questsApiGet(nk, logger, path) {
    var url = QUESTS_API_URL + path;
    try {
        var response = nk.httpRequest(url, 'get', { 'Content-Type': 'application/json' }, '');
        if (response.code >= 200 && response.code < 300) {
            return JSON.parse(response.body);
        }
        logger.error('[QuestsBridge] GET ' + path + ' returned ' + response.code);
        return { error: 'API returned ' + response.code };
    } catch (err) {
        logger.error('[QuestsBridge] GET ' + path + ' failed: ' + err.message);
        return { error: err.message };
    }
}

function questsApiPost(nk, logger, userId, path, body) {
    var bodyStr = JSON.stringify(body || {});
    var signature = signRequest(nk, bodyStr);
    var url = QUESTS_API_URL + path;
    var headers = {
        'Content-Type': 'application/json',
        'X-Source': 'nakama-rpc',
        'X-Webhook-Signature': signature,
        'X-User-Id': userId,
    };
    try {
        var response = nk.httpRequest(url, 'post', headers, bodyStr);
        if (response.code >= 200 && response.code < 300) {
            return JSON.parse(response.body);
        }
        logger.error('[QuestsBridge] POST ' + path + ' returned ' + response.code + ': ' + response.body);
        return { error: 'API returned ' + response.code, details: response.body };
    } catch (err) {
        logger.error('[QuestsBridge] POST ' + path + ' failed: ' + err.message);
        return { error: err.message };
    }
}

/**
 * RPC: intellidraws_list — get active IntelliDraws sweepstakes
 */
function rpcIntelliDrawsList(ctx, logger, nk, payload) {
    var result = questsApiGet(nk, logger, '/consumer/intellidraws');
    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }
    return JSON.stringify({ success: true, sweepstakes: result });
}

/**
 * RPC: intellidraws_winners — get recent IntelliDraws winners
 */
function rpcIntelliDrawsWinners(ctx, logger, nk, payload) {
    var result = questsApiGet(nk, logger, '/consumer/intellidraws/winners');
    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }
    return JSON.stringify({ success: true, winners: result });
}

/**
 * RPC: intellidraws_enter — enter an IntelliDraws sweepstake
 * Payload: { sweepstakeId: string, entries?: number }
 */
function rpcIntelliDrawsEnter(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    if (!parsed.sweepstakeId) {
        return JSON.stringify({ success: false, error: 'sweepstakeId is required' });
    }

    var result = questsApiPost(nk, logger, userId, '/consumer/intellidraws/enter', {
        sweepstakeId: parsed.sweepstakeId,
        entries: parsed.entries || 1,
    });

    if (result.error) {
        return JSON.stringify({ success: false, error: result.error, details: result.details });
    }

    logger.info('[QuestsBridge] User ' + userId + ' entered IntelliDraws ' + parsed.sweepstakeId);
    return JSON.stringify({ success: true, result: result });
}

/**
 * RPC: intellidraws_past — get past completed draws
 */
function rpcIntelliDrawsPast(ctx, logger, nk, payload) {
    var result = questsApiGet(nk, logger, '/consumer/intellidraws/past');
    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }
    return JSON.stringify({ success: true, pastDraws: result });
}
