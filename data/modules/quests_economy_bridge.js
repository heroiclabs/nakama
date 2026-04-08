/**
 * Quests Economy Bridge — Nakama is the single source of truth for XUT wallet.
 *
 * All balance reads and mutations use Nakama's NATIVE wallet system:
 *   - nk.walletUpdate(userId, changeset, metadata, updateLedger)
 *   - nk.walletLedgerList(userId, limit, cursor)
 *   - nk.accountGetId(userId) → account.wallet
 *
 * No HTTP callbacks to Postgres. The quests-economy API consumes these RPCs
 * via REST and treats Nakama as the authoritative store.
 *
 * Environment variables:
 *   QUESTS_ECONOMY_API_URL  — still used for IntelliDraws / non-wallet RPCs
 *   NAKAMA_WEBHOOK_SECRET   — shared HMAC secret for S2S auth
 *   DEFAULT_GAME_ID         — default game_id if not provided
 */

var QUESTS_API_URL = '';
var WEBHOOK_SECRET = '';
var DEFAULT_GAME_ID = 'f6f7fe36-03de-43b8-8b5d-1a1892da4eed';
var _bridgeEnvInitialized = false;

var GAME_CONVERSION_RATIOS = {};

function _ensureBridgeEnv(ctx) {
    if (_bridgeEnvInitialized) return;
    if (ctx && ctx.env) {
        QUESTS_API_URL = QUESTS_API_URL
            || (ctx.env['QUESTS_ECONOMY_API_URL'] || 'http://quests-api.quests-economy.svc.cluster.local:3001').replace(/\/$/, '');
        WEBHOOK_SECRET = WEBHOOK_SECRET || ctx.env['NAKAMA_WEBHOOK_SECRET'] || '';
        DEFAULT_GAME_ID = ctx.env['DEFAULT_GAME_ID'] || DEFAULT_GAME_ID;
        _bridgeEnvInitialized = true;
    }
}

function _QuestsBridgeInit(ctx, logger, nk, initializer) {
    QUESTS_API_URL = (ctx.env['QUESTS_ECONOMY_API_URL'] || 'http://localhost:3001').replace(/\/$/, '');
    WEBHOOK_SECRET = ctx.env['NAKAMA_WEBHOOK_SECRET'] || '';
    DEFAULT_GAME_ID = ctx.env['DEFAULT_GAME_ID'] || DEFAULT_GAME_ID;

    loadConversionRatios(nk, logger);

    logger.info('[QuestsBridge] Initializing — Nakama native wallet as single source of truth');

    // Wallet RPCs — Nakama native (no Postgres proxy)
    initializer.registerRpc('quests_wallet_balance', rpcQuestsWalletBalance);
    initializer.registerRpc('quests_wallet_earn', rpcQuestsWalletEarn);
    initializer.registerRpc('quests_wallet_spend', rpcQuestsWalletSpend);
    initializer.registerRpc('quests_wallet_history', rpcQuestsWalletHistory);

    // Keep old names as aliases for backward compatibility (games may call them)
    initializer.registerRpc('global_wallet_balance', rpcQuestsWalletBalance);
    initializer.registerRpc('global_wallet_earn', rpcQuestsWalletEarn);
    initializer.registerRpc('global_wallet_spend', rpcQuestsWalletSpend);
    initializer.registerRpc('global_wallet_history', rpcQuestsWalletHistory);

    // One-time migration RPC (admin use only)
    initializer.registerRpc('quests_wallet_migrate_from_postgres', rpcMigrateFromPostgres);

    // Conversion RPCs
    initializer.registerRpc('game_to_global_convert', rpcGameToGlobalConvert);
    initializer.registerRpc('game_to_global_preview', rpcGameToGlobalPreview);
    initializer.registerRpc('conversion_ratio_set', rpcConversionRatioSet);
    initializer.registerRpc('conversion_ratio_get', rpcConversionRatioGet);

    // IntelliDraws RPCs
    initializer.registerRpc('intellidraws_list', rpcIntelliDrawsList);
    initializer.registerRpc('intellidraws_winners', rpcIntelliDrawsWinners);
    initializer.registerRpc('intellidraws_enter', rpcIntelliDrawsEnter);
    initializer.registerRpc('intellidraws_past', rpcIntelliDrawsPast);

    logger.info('[QuestsBridge] RPCs registered (native wallet + conversion + intellidraws + migration)');
}

function signRequest(nk, body) {
    if (!WEBHOOK_SECRET) return '';
    return nk.hmacSha256Hash(WEBHOOK_SECRET, body);
}

// ═══════════════════════════════════════════════════════════════════
//  NATIVE WALLET RPCs (Nakama single source of truth)
// ═══════════════════════════════════════════════════════════════════

/**
 * RPC: quests_wallet_balance
 * Returns all currency balances from Nakama's native wallet.
 * No HTTP callback — reads directly from nk.accountGetId().
 */
function rpcQuestsWalletBalance(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    try {
        var account = nk.accountGetId(userId);
        var wallet = {};
        if (account.wallet) {
            wallet = typeof account.wallet === 'string'
                ? JSON.parse(account.wallet)
                : account.wallet;
        }

        return JSON.stringify({
            success: true,
            data: {
                userId: userId,
                xut: wallet.xut || 0,
                ivx: wallet.ivx || 0,
                spark: wallet.spark || 0,
                nova: wallet.nova || 0,
                nexus: wallet.nexus || 0,
            },
        });
    } catch (err) {
        logger.error('[QuestsBridge] quests_wallet_balance failed: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quests_wallet_earn
 * Credits currency to the user's Nakama native wallet.
 * Payload: { amount, currency?, sourceType?, sourceId?, description? }
 */
function rpcQuestsWalletEarn(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var amount = parsed.amount;
    if (!amount || amount <= 0) {
        return JSON.stringify({ success: false, error: 'amount must be > 0' });
    }

    var currency = parsed.currency || 'xut';
    var changeset = {};
    changeset[currency] = amount;

    var metadata = {
        type: 'earn',
        source: parsed.sourceType || 'quests_reward',
        sourceId: parsed.sourceId || '',
        description: parsed.description || ('Earned ' + amount + ' ' + currency),
    };

    try {
        var result = nk.walletUpdate(userId, changeset, metadata, true);
        var updated = result.updated || {};

        // Auto-credit 1 NOVA per XUT earned (loyalty program)
        if (currency === 'xut' && amount > 0) {
            try {
                nk.walletUpdate(userId, { nova: amount }, {
                    type: 'earn',
                    source: 'nova_auto_credit',
                    description: 'Auto NOVA: 1 per XUT earned',
                }, true);
            } catch (novaErr) {
                logger.warn('[QuestsBridge] NOVA auto-credit failed: ' + novaErr.message);
            }
        }

        logger.info('[QuestsBridge] Earned ' + amount + ' ' + currency + ' for user ' + userId);

        return JSON.stringify({
            success: true,
            data: {
                userId: userId,
                amountEarned: amount,
                currency: currency,
                newBalance: updated[currency] || 0,
                wallet: updated,
            },
        });
    } catch (err) {
        logger.error('[QuestsBridge] quests_wallet_earn failed: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quests_wallet_spend
 * Debits currency from the user's Nakama native wallet.
 * Nakama natively rejects negative balances.
 * Payload: { amount, currency?, sourceType?, sourceId?, description? }
 */
function rpcQuestsWalletSpend(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var amount = parsed.amount;
    if (!amount || amount <= 0) {
        return JSON.stringify({ success: false, error: 'amount must be > 0' });
    }

    var currency = parsed.currency || 'xut';

    // Pre-check balance to give a clear error message
    try {
        var account = nk.accountGetId(userId);
        var wallet = {};
        if (account.wallet) {
            wallet = typeof account.wallet === 'string'
                ? JSON.parse(account.wallet)
                : account.wallet;
        }
        var currentBalance = wallet[currency] || 0;
        if (currentBalance < amount) {
            return JSON.stringify({
                success: false,
                error: 'Insufficient ' + currency + ' balance. Available: ' + currentBalance + ', Required: ' + amount,
            });
        }
    } catch (err) {
        logger.error('[QuestsBridge] Balance pre-check failed: ' + err.message);
        return JSON.stringify({ success: false, error: 'Failed to check balance' });
    }

    var changeset = {};
    changeset[currency] = -amount;

    var metadata = {
        type: 'spend',
        source: parsed.sourceType || 'redemption',
        sourceId: parsed.sourceId || '',
        description: parsed.description || ('Spent ' + amount + ' ' + currency),
    };

    try {
        var result = nk.walletUpdate(userId, changeset, metadata, true);
        var updated = result.updated || {};

        logger.info('[QuestsBridge] Spent ' + amount + ' ' + currency + ' for user ' + userId);

        return JSON.stringify({
            success: true,
            data: {
                userId: userId,
                amountSpent: amount,
                currency: currency,
                newBalance: updated[currency] || 0,
                wallet: updated,
            },
        });
    } catch (err) {
        logger.error('[QuestsBridge] quests_wallet_spend failed: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: quests_wallet_history
 * Returns wallet ledger entries from Nakama's built-in wallet ledger.
 * Payload: { limit?, cursor? }
 */
function rpcQuestsWalletHistory(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ error: 'User not authenticated' });
    }

    var parsed = JSON.parse(payload || '{}');
    var limit = parsed.limit || 50;
    var cursor = parsed.cursor || '';

    try {
        var result = nk.walletLedgerList(userId, limit, cursor);
        var items = result.items || [];

        var entries = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            entries.push({
                id: item.id,
                changeset: item.changeset,
                metadata: item.metadata,
                create_time: item.createTime
                    ? Math.floor(new Date(item.createTime).getTime() / 1000)
                    : 0,
            });
        }

        return JSON.stringify({
            success: true,
            data: {
                userId: userId,
                entries: entries,
                count: entries.length,
                cursor: result.cursor || '',
            },
        });
    } catch (err) {
        logger.error('[QuestsBridge] quests_wallet_history failed: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ONE-TIME MIGRATION: Postgres → Nakama native wallet
// ═══════════════════════════════════════════════════════════════════

/**
 * RPC: quests_wallet_migrate_from_postgres
 * Seeds user balances into Nakama's native wallet via nk.walletUpdate.
 *
 * Payload: { dryRun?: boolean, balances: [{ user_id: string, balance: number }] }
 *
 * If balances are provided in the payload, uses them directly.
 * Otherwise attempts to fetch from the quests-economy API.
 * Should be called once by an admin after deploying native wallet RPCs.
 */
function rpcMigrateFromPostgres(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
    var parsed = JSON.parse(payload || '{}');
    var dryRun = parsed.dryRun === true;
    var balances = parsed.balances || [];

    if (balances.length === 0) {
        var apiUrl = QUESTS_API_URL || 'http://quests-api.quests-economy.svc.cluster.local:3001';
        logger.info('[QuestsBridge] No balances in payload, fetching from API: ' + apiUrl);

        var bodyStr = JSON.stringify({});
        var sig = WEBHOOK_SECRET ? nk.hmacSha256Hash(WEBHOOK_SECRET, bodyStr) : '';
        var url = apiUrl + '/api/game-bridge/s2s/wallet/all-balances';
        var headers = {};
        headers['Content-Type'] = 'application/json';
        headers['X-Source'] = 'nakama-rpc';
        if (sig) headers['X-Webhook-Signature'] = sig;

        try {
            var response = nk.httpRequest(url, 'POST', headers, bodyStr);
            if (response.code >= 200 && response.code < 300) {
                var data = JSON.parse(response.body);
                balances = data.balances || data.data || [];
            } else {
                logger.error('[QuestsBridge] API returned ' + response.code);
                return JSON.stringify({ success: false, error: 'API returned ' + response.code });
            }
        } catch (err) {
            logger.error('[QuestsBridge] HTTP call failed: ' + err.message);
            return JSON.stringify({ success: false, error: 'HTTP failed: ' + err.message + '. Pass balances directly in the payload instead.' });
        }
    }

    logger.info('[QuestsBridge] Starting migration (dryRun=' + dryRun + ', users=' + balances.length + ')');
    var migrated = 0;
    var skipped = 0;
    var errors = 0;

    for (var i = 0; i < balances.length; i++) {
        var entry = balances[i];
        var userId = entry.user_id || entry.userId;
        var xut = entry.balance || entry.xut || 0;

        if (!userId || xut <= 0) {
            skipped++;
            continue;
        }

        if (dryRun) {
            logger.info('[QuestsBridge] DRY RUN: would migrate user=' + userId + ' xut=' + xut);
            migrated++;
            continue;
        }

        try {
            // Check if Nakama wallet already has a balance
            var account = nk.accountGetId(userId);
            var wallet = {};
            if (account.wallet) {
                wallet = typeof account.wallet === 'string'
                    ? JSON.parse(account.wallet)
                    : account.wallet;
            }

            if ((wallet.xut || 0) > 0) {
                logger.info('[QuestsBridge] Skip user=' + userId + ' — already has ' + wallet.xut + ' XUT in Nakama');
                skipped++;
                continue;
            }

            nk.walletUpdate(userId, { xut: xut }, {
                type: 'migration',
                source: 'postgres_migration',
                description: 'One-time migration from Postgres points_ledger',
            }, true);

            migrated++;
            logger.info('[QuestsBridge] Migrated user=' + userId + ' xut=' + xut);
        } catch (err) {
            errors++;
            logger.error('[QuestsBridge] Failed to migrate user=' + userId + ': ' + err.message);
        }
    }

    var summary = 'Migration complete: ' + migrated + ' migrated, ' + skipped + ' skipped, ' + errors + ' errors (total ' + balances.length + ')';
    logger.info('[QuestsBridge] ' + summary);

    return JSON.stringify({
        success: true,
        dryRun: dryRun,
        migrated: migrated,
        skipped: skipped,
        errors: errors,
        total: balances.length,
        summary: summary,
    });
}

// ═══════════════════════════════════════════════════════════════════
//  GAME WALLET HELPERS (Nakama storage-based — unchanged)
// ═══════════════════════════════════════════════════════════════════

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
//  CONVERSION RPCs (game coins → global XUT via Nakama native wallet)
// ═══════════════════════════════════════════════════════════════════

function rpcGameToGlobalPreview(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
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

    var gameWallet = bridgeGetGameWallet(nk, logger, userId, gameId);
    var gameBalance = (gameWallet.currencies && (gameWallet.currencies.game || gameWallet.currencies.tokens)) || 0;

    var gameCoinAmount = parsed.gameCoinAmount || gameBalance;
    if (gameCoinAmount <= 0) {
        return JSON.stringify({ success: false, error: 'No game coins to convert' });
    }

    var globalPointsYield = Math.floor(gameCoinAmount / ratio);

    // Read global balance from Nakama native wallet
    var currentGlobalBalance = 0;
    try {
        var account = nk.accountGetId(userId);
        var wallet = {};
        if (account.wallet) {
            wallet = typeof account.wallet === 'string'
                ? JSON.parse(account.wallet)
                : account.wallet;
        }
        currentGlobalBalance = wallet.xut || 0;
    } catch (err) {
        logger.warn('[QuestsBridge] Failed to read global balance for preview: ' + err.message);
    }

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

function rpcGameToGlobalConvert(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
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

    if (gameCoinAmount < ratio) {
        return JSON.stringify({
            success: false,
            error: 'Minimum conversion is ' + ratio + ' game coins (= 1 global point)',
        });
    }

    var gameWallet = bridgeGetGameWallet(nk, logger, userId, gameId);
    var gameBalance = (gameWallet.currencies && (gameWallet.currencies.game || gameWallet.currencies.tokens)) || 0;

    if (gameBalance < gameCoinAmount) {
        return JSON.stringify({
            success: false,
            error: 'Insufficient game balance. Have ' + gameBalance + ', need ' + gameCoinAmount,
        });
    }

    var globalPointsEarned = Math.floor(gameCoinAmount / ratio);
    var actualCoinsBurned = globalPointsEarned * ratio;

    // Step 1: Deduct from game wallet (Nakama storage)
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

    // Step 2: Credit to Nakama native wallet (NOT Postgres)
    try {
        var walletResult = nk.walletUpdate(userId, { xut: globalPointsEarned }, {
            type: 'earn',
            source: 'game_to_global_conversion',
            sourceId: gameId,
            description: 'Converted ' + actualCoinsBurned + ' game coins → ' + globalPointsEarned + ' XUT (ratio ' + ratio + ':1)',
        }, true);

        // Also auto-credit NOVA
        try {
            nk.walletUpdate(userId, { nova: globalPointsEarned }, {
                type: 'earn',
                source: 'nova_auto_credit',
                description: 'Auto NOVA from game conversion',
            }, true);
        } catch (novaErr) {
            logger.warn('[QuestsBridge] NOVA auto-credit failed during conversion: ' + novaErr.message);
        }

        var newGlobalBalance = (walletResult.updated && walletResult.updated.xut) || 0;

        bridgeLogTransaction(nk, logger, userId, {
            type: 'game_to_global_conversion',
            gameId: gameId,
            gameCoinsBurned: actualCoinsBurned,
            globalPointsEarned: globalPointsEarned,
            ratio: ratio,
        });

        var newGameBalance = (gameWallet.currencies.game || gameWallet.currencies.tokens || 0);

        logger.info('[QuestsBridge] User ' + userId + ' converted ' + actualCoinsBurned + ' game coins → ' +
            globalPointsEarned + ' XUT (game ' + gameId + ')');

        return JSON.stringify({
            success: true,
            gameId: gameId,
            gameCoinsBurned: actualCoinsBurned,
            globalPointsEarned: globalPointsEarned,
            ratio: ratio,
            newGameBalance: newGameBalance,
            newGlobalBalance: newGlobalBalance,
        });
    } catch (err) {
        // Rollback: re-add game coins
        for (var i = 0; i < currenciesToUpdate.length; i++) {
            var curr = currenciesToUpdate[i];
            if (gameWallet.currencies[curr] !== undefined) {
                gameWallet.currencies[curr] += actualCoinsBurned;
            }
        }
        bridgeSaveGameWallet(nk, logger, userId, gameId, gameWallet);
        logger.error('[QuestsBridge] Conversion rolled back for user ' + userId + ': ' + err.message);
        return JSON.stringify({ success: false, error: 'Failed to credit global wallet, game coins restored' });
    }
}

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
//  INTELLIDRAWS (LOTTERY) RPCs — still proxy to quests-economy API
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

function rpcIntelliDrawsList(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
    var result = questsApiGet(nk, logger, '/consumer/intellidraws');
    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }
    return JSON.stringify({ success: true, sweepstakes: result });
}

function rpcIntelliDrawsWinners(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
    var result = questsApiGet(nk, logger, '/consumer/intellidraws/winners');
    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }
    return JSON.stringify({ success: true, winners: result });
}

function rpcIntelliDrawsEnter(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
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

function rpcIntelliDrawsPast(ctx, logger, nk, payload) {
    _ensureBridgeEnv(ctx);
    var result = questsApiGet(nk, logger, '/consumer/intellidraws/past');
    if (result.error) {
        return JSON.stringify({ success: false, error: result.error });
    }
    return JSON.stringify({ success: true, pastDraws: result });
}
